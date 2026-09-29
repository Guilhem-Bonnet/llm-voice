//! Bout en bout : le binaire démarre, on enfile deux WAV (silence, rien
//! d'audible), on joue, et le WS livre les événements du contrat jusqu'à
//! `ended` — émis après vidange (≥ durée audio + marge), jamais avant.

mod common;

use std::time::{Duration, Instant};

use common::{assert_contract, write_silent_wav, Core};
use futures_util::StreamExt;
use serde_json::{json, Value};

#[tokio::test]
async fn enqueue_two_wavs_play_and_receive_ended_on_the_websocket() {
    // CI (runner sans carte son) : `LLM_VOICE_NO_AUDIO=1` saute ce seul test,
    // le seul à exiger une vraie sortie audio ; les autres tests du
    // workspace s'exécutent normalement.
    if std::env::var_os("LLM_VOICE_NO_AUDIO").is_some_and(|v| !v.is_empty() && v != "0") {
        eprintln!("SKIP playback : LLM_VOICE_NO_AUDIO est défini (pas de sortie audio)");
        return;
    }
    let core = Core::start();
    let a = core.cache_path("seg-a.wav");
    let b = core.cache_path("seg-b.wav");
    write_silent_wav(&a, 22_050, 500);
    write_silent_wav(&b, 22_050, 400);

    let (mut ws, _) = tokio_tungstenite::connect_async(core.ws_url(Some(&core.token)))
        .await
        .expect("WS");
    let client = reqwest::Client::new();
    let send = |route: &'static str, extra: Value| {
        let mut body = json!({ "protocolVersion": "1.0", "token": core.token });
        if let (Some(o), Some(e)) = (body.as_object_mut(), extra.as_object()) {
            o.extend(e.clone());
        }
        client.post(core.url(route)).json(&body).send()
    };
    for (id, path) in [("seg-a", &a), ("seg-b", &b)] {
        let resp = send(
            "/v1/enqueue",
            json!({ "segmentId": id, "path": path, "format": "wav" }),
        )
        .await
        .expect("enqueue");
        let status = resp.status();
        let body: Value = resp.json().await.expect("json");
        assert!(status.is_success(), "enqueue {id} : {status} {body}");
    }
    let started_at = Instant::now();
    let resp = send("/v1/play", json!({})).await.expect("play");
    assert!(resp.status().is_success());

    let mut events: Vec<Value> = Vec::new();
    let ended_at = loop {
        let msg = tokio::time::timeout(Duration::from_secs(15), ws.next())
            .await
            .expect("aucun événement pendant 15 s")
            .expect("flux fermé")
            .expect("ws");
        let event: Value = serde_json::from_str(msg.to_text().expect("texte")).expect("json");
        let kind = format!("ws/{}.event", event["type"].as_str().expect("type"));
        assert_contract(&kind, &event);
        let is_ended = event["type"] == "ended";
        events.push(event);
        if is_ended {
            break started_at.elapsed();
        }
    };

    let types: Vec<&str> = events.iter().filter_map(|e| e["type"].as_str()).collect();
    let pos = |pred: &dyn Fn(&Value) -> bool| events.iter().position(pred);
    let started_a = pos(&|e| e["type"] == "segment_started" && e["segmentId"] == "seg-a");
    let started_b = pos(&|e| e["type"] == "segment_started" && e["segmentId"] == "seg-b");
    let ended_a = pos(&|e| e["type"] == "segment_ended" && e["segmentId"] == "seg-a");
    let ended_b = pos(&|e| e["type"] == "segment_ended" && e["segmentId"] == "seg-b");
    let ended = pos(&|e| e["type"] == "ended");
    assert!(
        started_a < started_b && started_b < ended_b && ended_a < ended_b && ended_b < ended,
        "ordre des événements : {types:?}"
    );
    assert!(started_a.is_some() && ended_a.is_some(), "{types:?}");
    assert!(types.contains(&"state"), "{types:?}");

    let last = events.last().expect("ended");
    assert_eq!(last["totalDurationMs"], 900);
    assert_eq!(last["positionMs"], 900);
    assert_eq!(events[started_b.unwrap_or(0)]["positionMs"], 500);

    // ≥ 4 Hz : au moins 3 `position` sur 900 ms de lecture.
    let positions: Vec<u64> = events
        .iter()
        .filter(|e| e["type"] == "position")
        .filter_map(|e| e["positionMs"].as_u64())
        .collect();
    assert!(positions.len() >= 4, "position trop rare : {positions:?}");
    assert!(
        positions.windows(2).all(|w| w[0] <= w[1]),
        "position monotone : {positions:?}"
    );

    // CL-004 : `ended` jamais avant la fin audio + marge de vidange (300 ms).
    assert!(
        ended_at >= Duration::from_millis(900 + 300),
        "ended trop tôt : {ended_at:?}"
    );

    let state_after = tokio::time::timeout(Duration::from_secs(2), ws.next())
        .await
        .expect("state après ended")
        .expect("flux")
        .expect("ws");
    let state_after: Value =
        serde_json::from_str(state_after.to_text().expect("texte")).expect("json");
    assert_eq!(state_after["type"], "state");
    assert_eq!(state_after["state"], "ended");
}
