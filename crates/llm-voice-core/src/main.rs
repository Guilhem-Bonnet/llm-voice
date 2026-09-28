//! Point d'entrée du démon `llm-voice-core` (ADR-012 §5).
//!
//! Environnement (jamais la ligne de commande, visible dans `ps`) :
//! - `LLM_VOICE_CORE_TOKEN` : jeton imposé par le parent (≥ 16 caractères) ;
//!   sinon un jeton aléatoire est généré ;
//! - `LLM_VOICE_CACHE_DIR` : dossier de cache autorisé pour `enqueue`
//!   (défaut `$XDG_CACHE_HOME/llm-voice` ou `$HOME/.cache/llm-voice`) ;
//! - `LLM_VOICE_CORE_STATE_DIR` : dossier d'état (défaut
//!   `$XDG_RUNTIME_DIR/llm-voice`).
//!
//! Codes de sortie : 0 arrêt propre (SIGTERM/SIGINT), 1 erreur,
//! 17 (`ALREADY_RUNNING_EXIT_CODE`) une autre instance tient le verrou.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::process::ExitCode;
use std::sync::Arc;

use llm_voice_core::engine::EngineHandle;
use llm_voice_core::events::EventBus;
use llm_voice_core::lock::{self, CoreStateFile, InstanceLock, ALREADY_RUNNING_EXIT_CODE};
use llm_voice_core::security::generate_token;
use llm_voice_core::server::{router, AppState};
use llm_voice_protocol::PROTOCOL_VERSION;

fn cache_dir() -> Result<PathBuf, String> {
    let dir = if let Some(dir) = std::env::var_os("LLM_VOICE_CACHE_DIR") {
        PathBuf::from(dir)
    } else if let Some(xdg) = std::env::var_os("XDG_CACHE_HOME") {
        PathBuf::from(xdg).join("llm-voice")
    } else if let Some(home) = std::env::var_os("HOME") {
        PathBuf::from(home).join(".cache/llm-voice")
    } else {
        return Err("aucun dossier de cache (LLM_VOICE_CACHE_DIR, XDG_CACHE_HOME, HOME)".into());
    };
    std::fs::create_dir_all(&dir).map_err(|e| format!("{} : {e}", dir.display()))?;
    std::fs::canonicalize(&dir).map_err(|e| format!("{} : {e}", dir.display()))
}

fn session_token() -> Result<String, String> {
    match std::env::var("LLM_VOICE_CORE_TOKEN") {
        Ok(token) if token.len() >= 16 => Ok(token),
        Ok(_) => Err("LLM_VOICE_CORE_TOKEN trop court (minimum 16 caractères)".into()),
        Err(_) => Ok(generate_token()),
    }
}

async fn shutdown_signal() {
    use tokio::signal::unix::{signal, SignalKind};
    let term = signal(SignalKind::terminate());
    let int = signal(SignalKind::interrupt());
    match (term, int) {
        (Ok(mut term), Ok(mut int)) => {
            tokio::select! {
                _ = term.recv() => {},
                _ = int.recv() => {},
            }
        }
        _ => {
            let _ = tokio::signal::ctrl_c().await;
        }
    }
}

async fn run() -> Result<ExitCode, String> {
    let state_dir = lock::state_dir().map_err(|e| e.to_string())?;
    let Some(instance) = InstanceLock::acquire(&state_dir).map_err(|e| e.to_string())? else {
        let port = lock::read_state(&state_dir)
            .ok()
            .flatten()
            .map(|s| s.port.to_string())
            .unwrap_or_else(|| "?".into());
        eprintln!(
            "llm-voice-core : une instance tourne déjà (port {port}, état {})",
            lock::state_file_path(&state_dir).display()
        );
        return Ok(ExitCode::from(ALREADY_RUNNING_EXIT_CODE as u8));
    };

    let token = session_token()?;
    let cache_dir = cache_dir()?;
    let listener = tokio::net::TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))
        .await
        .map_err(|e| format!("liaison 127.0.0.1 impossible : {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();

    let events = EventBus::new();
    let engine = EngineHandle::spawn(events.clone()).map_err(|e| e.to_string())?;
    let app = router(AppState {
        token: Arc::new(token.clone()),
        port,
        cache_dir: Arc::new(cache_dir),
        engine: engine.clone(),
        events,
    });

    instance
        .publish(&CoreStateFile {
            pid: std::process::id(),
            port,
            token,
            protocol_version: PROTOCOL_VERSION.to_string(),
        })
        .map_err(|e| e.to_string())?;
    eprintln!("llm-voice-core : à l'écoute sur 127.0.0.1:{port}");

    let served = axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await;
    engine.shutdown();
    drop(instance);
    served.map_err(|e| e.to_string())?;
    Ok(ExitCode::SUCCESS)
}

fn main() -> ExitCode {
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
    {
        Ok(rt) => rt,
        Err(e) => {
            eprintln!("llm-voice-core : runtime tokio : {e}");
            return ExitCode::FAILURE;
        }
    };
    match runtime.block_on(run()) {
        Ok(code) => code,
        Err(e) => {
            eprintln!("llm-voice-core : {e}");
            ExitCode::FAILURE
        }
    }
}
