//! Sécurité de la boucle locale (ADR-012 §6), cycle de vie (§5) et forme des
//! réponses HTTP (contrat core-v1), sur le vrai binaire.

mod common;

use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use common::{assert_contract, example, spawn, wait_state, Core};
use futures_util::StreamExt;
use reqwest::StatusCode;
use serde_json::{json, Value};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Error as WsError;

async fn post(core: &Core, route: &str, body: Value) -> (StatusCode, Value) {
    let resp = reqwest::Client::new()
        .post(core.url(route))
        .json(&body)
        .send()
        .await
        .expect("requête");
    let status = resp.status();
    let body: Value = resp.json().await.expect("corps JSON");
    assert_contract("http/ack.response", &body);
    (status, body)
}

fn code(body: &Value) -> &str {
    body["error"]["code"].as_str().unwrap_or_default()
}

#[tokio::test]
async fn health_matches_contract_example() {
    let core = Core::start();
    let resp = reqwest::get(core.url("/health")).await.expect("health");
    assert_eq!(resp.status(), StatusCode::OK);
    let body: Value = resp.json().await.expect("json");
    assert_contract("http/health.response", &body);
    assert_eq!(body, example("health.response.json"));
}

#[tokio::test]
async fn commands_without_or_with_wrong_token_are_401() {
    let core = Core::start();
    for route in [
        "/v1/enqueue",
        "/v1/play",
        "/v1/pause",
        "/v1/resume",
        "/v1/stop",
        "/v1/seek",
    ] {
        let (status, body) = post(&core, route, json!({ "protocolVersion": "1.0" })).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{route} sans jeton");
        assert_eq!(code(&body), "invalid_token");
        let (status, body) = post(
            &core,
            route,
            json!({ "protocolVersion": "1.0", "token": "s3ss10n-t0k3n-abcdef" }),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{route} jeton faux");
        assert_eq!(code(&body), "invalid_token");
    }
    let resp = reqwest::Client::new()
        .post(core.url("/v1/pause"))
        .body("pas du json")
        .send()
        .await
        .expect("requête");
    assert_eq!(resp.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn any_non_empty_origin_is_403_even_with_a_valid_token() {
    let core = Core::start();
    let client = reqwest::Client::new();
    let resp = client
        .post(core.url("/v1/pause"))
        .header("Origin", "https://evil.example")
        .json(&json!({ "protocolVersion": "1.0", "token": core.token }))
        .send()
        .await
        .expect("requête");
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body: Value = resp.json().await.expect("json");
    assert_contract("http/ack.response", &body);
    assert_eq!(code(&body), "invalid_origin");

    let resp = client
        .get(core.url("/health"))
        .header("Origin", "vscode-webview://abc")
        .send()
        .await
        .expect("requête");
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);

    let mut req = core
        .ws_url(Some(&core.token))
        .into_client_request()
        .expect("req");
    req.headers_mut()
        .insert("Origin", "https://evil.example".parse().expect("hdr"));
    match tokio_tungstenite::connect_async(req).await {
        Err(WsError::Http(resp)) => assert_eq!(resp.status(), 403),
        other => panic!("WS avec Origin acceptée : {:?}", other.map(|_| ())),
    }
}

#[tokio::test]
async fn foreign_host_header_is_403() {
    let core = Core::start();
    let resp = reqwest::Client::new()
        .get(core.url("/health"))
        .header("Host", format!("evil.example:{}", core.port))
        .send()
        .await
        .expect("requête");
    assert_eq!(resp.status(), StatusCode::FORBIDDEN);
    let body: Value = resp.json().await.expect("json");
    assert_eq!(code(&body), "invalid_host");
}

#[tokio::test]
async fn websocket_requires_the_token_and_then_sends_the_current_state() {
    let core = Core::start();
    for url in [core.ws_url(None), core.ws_url(Some("s3ss10n-t0k3n-abcdef"))] {
        match tokio_tungstenite::connect_async(url).await {
            Err(WsError::Http(resp)) => assert_eq!(resp.status(), 401),
            other => panic!("WS sans jeton valide acceptée : {:?}", other.map(|_| ())),
        }
    }
    let (mut ws, _) = tokio_tungstenite::connect_async(core.ws_url(Some(&core.token)))
        .await
        .expect("WS avec jeton");
    let first = tokio::time::timeout(Duration::from_secs(5), ws.next())
        .await
        .expect("délai")
        .expect("message")
        .expect("ws");
    let event: Value = serde_json::from_str(first.to_text().expect("texte")).expect("json");
    assert_contract("ws/state.event", &event);
    assert_eq!(event["state"], "stopped");
}

#[tokio::test]
async fn valid_commands_answer_like_the_contract_examples() {
    let core = Core::start();
    let auth = |extra: Value| {
        let mut body = json!({ "protocolVersion": "1.0", "token": core.token });
        if let (Some(b), Some(e)) = (body.as_object_mut(), extra.as_object()) {
            b.extend(e.clone());
        }
        body
    };
    for route in ["/v1/pause", "/v1/resume", "/v1/stop"] {
        let (status, body) = post(&core, route, auth(json!({}))).await;
        assert_eq!(status, StatusCode::OK, "{route}");
        assert_eq!(body, example("ack.response.ok.json"), "{route}");
    }
    let (status, body) = post(&core, "/v1/seek", auth(json!({ "positionMs": 4500 }))).await;
    assert_eq!(
        (status, body),
        (StatusCode::OK, example("ack.response.ok.json"))
    );

    let (status, body) = post(&core, "/v1/play", auth(json!({ "segmentId": "seg-0099" }))).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(code(&body), "segment_not_found");

    let mut wrong_version = auth(json!({}));
    wrong_version["protocolVersion"] = json!("2.0");
    let (status, body) = post(&core, "/v1/pause", wrong_version).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(code(&body), "invalid_protocol_version");

    let (status, _) = post(&core, "/v1/pause", auth(json!({ "volume": 3 }))).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "champ inconnu refusé");

    let (status, body) = post(
        &core,
        "/v1/enqueue",
        auth(json!({ "segmentId": "seg-1", "path": "/etc/hostname", "format": "wav" })),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(code(&body), "path_outside_cache");

    let traversal = format!("{}/../x.wav", core.cache_path("sub").display());
    let (status, _) = post(
        &core,
        "/v1/enqueue",
        auth(json!({ "segmentId": "seg-1", "path": traversal, "format": "wav" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "segment .. refusé");

    let not_wav = core.cache_path("bad.wav");
    std::fs::write(&not_wav, b"pas un wav").expect("écriture");
    let (status, body) = post(
        &core,
        "/v1/enqueue",
        auth(json!({ "segmentId": "seg-1", "path": not_wav, "format": "wav" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(code(&body), "unsupported_format");
}

#[test]
fn single_instance_state_file_and_clean_shutdown() {
    let core = Core::start();
    let path = core.state_dir.path().join("core.json");
    let mode = std::fs::metadata(&path)
        .expect("core.json")
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(mode, 0o600, "core.json en 0600");
    let state = wait_state(core.state_dir.path());
    assert_eq!(state["pid"].as_u64(), Some(u64::from(core.child.id())));
    assert_eq!(state["protocolVersion"], "1.0");
    assert!(core.token.len() >= 16);

    let status = spawn(core.state_dir.path(), core.cache_dir.path())
        .wait()
        .expect("seconde instance");
    assert_eq!(
        status.code(),
        Some(llm_voice_core::lock::ALREADY_RUNNING_EXIT_CODE),
        "seconde instance : code dédié"
    );
    assert!(path.exists(), "la seconde instance ne touche pas core.json");

    let mut core = core;
    let term = std::process::Command::new("kill")
        .arg("-TERM")
        .arg(core.child.id().to_string())
        .status()
        .expect("kill");
    assert!(term.success());
    let exit = core.child.wait().expect("attente");
    assert_eq!(exit.code(), Some(0), "arrêt propre sur SIGTERM");
    assert!(!path.exists(), "core.json retiré à l'arrêt");

    // Le verrou est libéré : une nouvelle instance démarre.
    let mut again = spawn(core.state_dir.path(), core.cache_dir.path());
    let restarted = wait_state(core.state_dir.path());
    assert_eq!(restarted["pid"].as_u64(), Some(u64::from(again.id())));
    let _ = again.kill();
    let _ = again.wait();
}
