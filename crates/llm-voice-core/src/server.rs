//! Serveur HTTP + WebSocket (axum) du protocole Core v1.
//!
//! Ordre des contrôles, pour chaque requête : `Host` (rebinding DNS, 403
//! `invalid_host`), `Origin` non vide (403 `invalid_origin`), puis pour les
//! commandes le jeton du corps (401 `invalid_token`), la version de
//! protocole (400 `invalid_protocol_version`) et la forme du message
//! (400). `GET /health` ne demande pas de jeton (contrat : il sert à
//! découvrir la version avant toute connexion authentifiée) ; la connexion
//! `GET /v1/ws` exige le jeton (`?token=` ou `Authorization: Bearer`).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::body::Bytes;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use futures_util::{SinkExt, StreamExt};
use llm_voice_audio::{load_wav, Clip};
use llm_voice_protocol::{
    is_supported_protocol_version, AckError, AckResponse, AudioFormat, Capabilities,
    EnqueueRequest, HealthResponse, PauseRequest, PlayRequest, ResumeRequest, SeekRequest,
    StopRequest, Validate, PROTOCOL_VERSION,
};
use serde::de::DeserializeOwned;
use tokio::sync::broadcast::error::RecvError;

use crate::engine::{Command, EngineError, EngineHandle};
use crate::events::EventBus;
use crate::security::{host_is_allowed, origin_is_allowed, token_matches};

#[derive(Clone)]
pub struct AppState {
    pub token: Arc<String>,
    pub port: u16,
    /// Dossier de cache canonique : tout chemin `enqueue` doit s'y résoudre.
    pub cache_dir: Arc<PathBuf>,
    pub engine: EngineHandle,
    pub events: EventBus,
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/v1/enqueue", post(enqueue))
        .route("/v1/play", post(play))
        .route("/v1/pause", post(pause))
        .route("/v1/resume", post(resume))
        .route("/v1/stop", post(stop))
        .route("/v1/seek", post(seek))
        .route("/v1/ws", get(ws))
        .layer(middleware::from_fn_with_state(state.clone(), guard))
        .with_state(state)
}

fn ack_ok() -> Response {
    Json(AckResponse {
        protocol_version: PROTOCOL_VERSION.to_string(),
        ok: true,
        error: None,
    })
    .into_response()
}

fn ack_err(status: StatusCode, code: &str, message: impl Into<String>) -> Response {
    (
        status,
        Json(AckResponse {
            protocol_version: PROTOCOL_VERSION.to_string(),
            ok: false,
            error: Some(AckError {
                code: code.to_string(),
                message: message.into(),
            }),
        }),
    )
        .into_response()
}

fn engine_err(e: EngineError) -> Response {
    let status = match e.code {
        "segment_not_found" => StatusCode::NOT_FOUND,
        "unsupported_format" => StatusCode::BAD_REQUEST,
        _ => StatusCode::INTERNAL_SERVER_ERROR,
    };
    ack_err(status, e.code, e.message)
}

fn header_str(headers: &HeaderMap, name: header::HeaderName) -> Option<&str> {
    headers.get(name).and_then(|v| v.to_str().ok())
}

/// `Host` et `Origin`, sur toutes les routes (y compris `/health` et WS).
async fn guard(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let headers = request.headers();
    if !host_is_allowed(header_str(headers, header::HOST), state.port) {
        return ack_err(StatusCode::FORBIDDEN, "invalid_host", "en-tête Host refusé");
    }
    if headers.contains_key(header::ORIGIN)
        && !origin_is_allowed(Some(header_str(headers, header::ORIGIN).unwrap_or("?")))
    {
        return ack_err(
            StatusCode::FORBIDDEN,
            "invalid_origin",
            "en-tête Origin refusé : le Core n'accepte aucun client navigateur",
        );
    }
    next.run(request).await
}

/// Réponse d'erreur déjà prête (boîte : `Response` est volumineux).
type Rejection = Box<Response>;

/// Jeton, version, forme : dans cet ordre (un corps illisible n'a pas de
/// jeton, donc 401 — on ne renseigne pas un appelant non authentifié).
fn authorize<T: DeserializeOwned + Validate>(
    state: &AppState,
    body: &Bytes,
) -> Result<T, Rejection> {
    let unauthorized = || {
        ack_err(
            StatusCode::UNAUTHORIZED,
            "invalid_token",
            "jeton absent ou invalide",
        )
    };
    let value: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| Box::new(unauthorized()))?;
    match value.get("token").and_then(serde_json::Value::as_str) {
        Some(token) if token_matches(token, &state.token) => {}
        _ => return Err(Box::new(unauthorized())),
    }
    let version = value
        .get("protocolVersion")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if !is_supported_protocol_version(version) {
        return Err(Box::new(ack_err(
            StatusCode::BAD_REQUEST,
            "invalid_protocol_version",
            format!("version \"{version}\" refusée : le Core parle {PROTOCOL_VERSION}"),
        )));
    }
    // Le contrat v1 n'a pas de code « requête mal formée » : `internal_error`
    // en 400 (écart documenté dans l'evidence-pack, à proposer en v1.1).
    let request: T = serde_json::from_value(value).map_err(|e| {
        Box::new(ack_err(
            StatusCode::BAD_REQUEST,
            "internal_error",
            format!("requête mal formée : {e}"),
        ))
    })?;
    request.validate().map_err(|e| {
        Box::new(ack_err(
            StatusCode::BAD_REQUEST,
            "internal_error",
            format!("requête invalide : {e}"),
        ))
    })?;
    Ok(request)
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        protocol_version: PROTOCOL_VERSION.to_string(),
        status: "ok".to_string(),
        capabilities: Capabilities {
            formats: vec![AudioFormat::Wav, AudioFormat::Pcm16Le],
            engine: "cpal".to_string(),
        },
    })
}

/// Résout `path` et vérifie qu'il reste sous le dossier de cache (liens
/// symboliques compris, grâce à `canonicalize`).
fn resolve_in_cache(cache_dir: &Path, path: &str) -> Result<PathBuf, Rejection> {
    let resolved = std::fs::canonicalize(path).map_err(|e| {
        Box::new(ack_err(
            StatusCode::NOT_FOUND,
            "segment_not_found",
            format!("{path} : {e}"),
        ))
    })?;
    if !resolved.starts_with(cache_dir) {
        return Err(Box::new(ack_err(
            StatusCode::FORBIDDEN,
            "path_outside_cache",
            format!("{path} n'est pas sous le dossier de cache déclaré"),
        )));
    }
    Ok(resolved)
}

fn load_pcm16le(path: &Path, sample_rate: u32, channels: u16) -> Result<Clip, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    if bytes.len() % 2 != 0 {
        return Err("taille impaire pour du PCM 16 bits".to_string());
    }
    let samples = bytes
        .chunks_exact(2)
        .map(|b| i16::from_le_bytes([b[0], b[1]]))
        .collect();
    Ok(Clip {
        samples,
        sample_rate,
        channels,
    })
}

async fn enqueue(State(state): State<AppState>, body: Bytes) -> Response {
    let req: EnqueueRequest = match authorize(&state, &body) {
        Ok(req) => req,
        Err(resp) => return *resp,
    };
    let path = match resolve_in_cache(&state.cache_dir, &req.path) {
        Ok(path) => path,
        Err(resp) => return *resp,
    };
    let format = req.format;
    let (rate, channels) = (
        req.sample_rate.unwrap_or(0),
        req.channels.unwrap_or(0) as u16,
    );
    let decoded = tokio::task::spawn_blocking(move || match format {
        AudioFormat::Wav => load_wav(&path).map_err(|e| e.to_string()),
        AudioFormat::Pcm16Le => load_pcm16le(&path, rate, channels),
    })
    .await;
    let clip = match decoded {
        Ok(Ok(clip)) => clip,
        Ok(Err(e)) => return ack_err(StatusCode::BAD_REQUEST, "unsupported_format", e),
        Err(e) => {
            return ack_err(
                StatusCode::INTERNAL_SERVER_ERROR,
                "internal_error",
                e.to_string(),
            )
        }
    };
    let segment_id = req.segment_id;
    respond(
        state
            .engine
            .call(move |reply| Command::Enqueue {
                segment_id,
                clip,
                reply,
            })
            .await,
    )
}

fn respond(result: Result<(), EngineError>) -> Response {
    match result {
        Ok(()) => ack_ok(),
        Err(e) => engine_err(e),
    }
}

async fn play(State(state): State<AppState>, body: Bytes) -> Response {
    match authorize::<PlayRequest>(&state, &body) {
        Ok(req) => respond(
            state
                .engine
                .call(move |reply| Command::Play {
                    segment_id: req.segment_id,
                    reply,
                })
                .await,
        ),
        Err(resp) => *resp,
    }
}

async fn pause(State(state): State<AppState>, body: Bytes) -> Response {
    match authorize::<PauseRequest>(&state, &body) {
        Ok(_) => respond(state.engine.call(Command::Pause).await),
        Err(resp) => *resp,
    }
}

async fn resume(State(state): State<AppState>, body: Bytes) -> Response {
    match authorize::<ResumeRequest>(&state, &body) {
        Ok(_) => respond(state.engine.call(Command::Resume).await),
        Err(resp) => *resp,
    }
}

async fn stop(State(state): State<AppState>, body: Bytes) -> Response {
    match authorize::<StopRequest>(&state, &body) {
        Ok(_) => respond(state.engine.call(Command::Stop).await),
        Err(resp) => *resp,
    }
}

async fn seek(State(state): State<AppState>, body: Bytes) -> Response {
    match authorize::<SeekRequest>(&state, &body) {
        Ok(req) => respond(
            state
                .engine
                .call(move |reply| Command::Seek {
                    position_ms: req.position_ms,
                    reply,
                })
                .await,
        ),
        Err(resp) => *resp,
    }
}

async fn ws(
    State(state): State<AppState>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
    upgrade: Option<WebSocketUpgrade>,
) -> Response {
    let bearer =
        header_str(&headers, header::AUTHORIZATION).and_then(|v| v.strip_prefix("Bearer "));
    let token = query.get("token").map(String::as_str).or(bearer);
    if !token.is_some_and(|t| token_matches(t, &state.token)) {
        return ack_err(
            StatusCode::UNAUTHORIZED,
            "invalid_token",
            "jeton absent ou invalide",
        );
    }
    let Some(upgrade) = upgrade else {
        return ack_err(
            StatusCode::BAD_REQUEST,
            "internal_error",
            "requête WebSocket attendue",
        );
    };
    upgrade.on_upgrade(move |socket| forward_events(socket, state.events))
}

/// Envoie le dernier `state` puis relaie chaque événement ; les messages
/// entrants sont ignorés (les commandes passent par HTTP).
async fn forward_events(socket: WebSocket, events: EventBus) {
    let mut rx = events.subscribe();
    let (mut sink, mut incoming) = socket.split();
    if sink.send(Message::Text(events.last_state())).await.is_err() {
        return;
    }
    loop {
        tokio::select! {
            event = rx.recv() => match event {
                Ok(json) => {
                    if sink.send(Message::Text(json)).await.is_err() {
                        break;
                    }
                }
                Err(RecvError::Lagged(_)) => continue,
                Err(RecvError::Closed) => break,
            },
            msg = incoming.next() => match msg {
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => {}
            },
        }
    }
}
