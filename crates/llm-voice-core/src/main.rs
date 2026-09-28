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
//! Argument de ligne de commande, seul autorisé (pas d'information sensible
//! dedans, `ps` peut le montrer) :
//! - `--parent-pid <pid>` : PID du processus qui a lancé ce Core
//!   (`CoreProcess.ts` y passe `process.pid`). Sondé sur `/proc/<pid>`
//!   toutes les secondes (F-02, evidence-pack GAO-audit-s-curi-001, écart
//!   ADR-012 §5 « s'arrête quand son parent disparaît ») ; sa disparition
//!   déclenche le même arrêt propre qu'un SIGTERM. Aucun `unsafe` : pas de
//!   `kill(pid, 0)` ni `prctl` par FFI, juste `Path::exists` sur `/proc`
//!   (Linux uniquement — une plateforme sans `/proc` ignore silencieusement
//!   ce sondage et retombe sur les signaux).
//!
//! Codes de sortie : 0 arrêt propre (SIGTERM/SIGINT ou mort du parent
//! transmis par `--parent-pid`), 1 erreur, 17 (`ALREADY_RUNNING_EXIT_CODE`)
//! une autre instance tient le verrou.

use std::net::{Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

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

/// `--parent-pid <pid>` : rejette tout ce qui ne se parse pas en `u32`
/// (silencieusement, comme un flag absent — la CLI de ce démon n'a pas
/// d'autre argument à mal interpréter).
fn parse_parent_pid<I: IntoIterator<Item = String>>(args: I) -> Option<u32> {
    let mut args = args.into_iter();
    while let Some(arg) = args.next() {
        if let Some(value) = arg.strip_prefix("--parent-pid=") {
            return value.parse().ok();
        }
        if arg == "--parent-pid" {
            return args.next()?.parse().ok();
        }
    }
    None
}

/// Intervalle de sondage du parent transmis par `--parent-pid` (F-02) :
/// assez court pour tenir la fenêtre d'orphelinat sous la seconde (ADR-012
/// §5), assez long pour ne pas solliciter `/proc` inutilement.
const PARENT_POLL_INTERVAL: Duration = Duration::from_secs(1);

/// Vrai tant que `pid` désigne un processus vivant. Sonde `/proc/<pid>`
/// (Linux) plutôt qu'un signal 0 par FFI : aucun `unsafe`, juste un `stat`
/// sur un pseudo-fichier. Une plateforme sans `/proc` verrait toujours
/// `false` ici ; ce Core ne se lance que sous Linux pour l'instant (ADR-012),
/// donc ce n'est pas un cas à traiter.
fn parent_is_alive(pid: u32) -> bool {
    Path::new(&format!("/proc/{pid}")).exists()
}

/// Se résout quand `pid` n'est plus un processus vivant.
async fn wait_for_parent_death(pid: u32) {
    let mut interval = tokio::time::interval(PARENT_POLL_INTERVAL);
    interval.tick().await; // le premier tick de `interval` est immédiat.
    loop {
        interval.tick().await;
        if !parent_is_alive(pid) {
            eprintln!("llm-voice-core : parent {pid} disparu, arrêt");
            return;
        }
    }
}

async fn wait_for_termination_signal() {
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

/// SIGTERM/SIGINT, ou la mort du parent transmis par `--parent-pid` (F-02) :
/// selon celui qui se produit en premier.
async fn shutdown_signal(parent_pid: Option<u32>) {
    match parent_pid {
        Some(pid) => {
            tokio::select! {
                () = wait_for_termination_signal() => {},
                () = wait_for_parent_death(pid) => {},
            }
        }
        None => wait_for_termination_signal().await,
    }
}

async fn run() -> Result<ExitCode, String> {
    let parent_pid = parse_parent_pid(std::env::args());
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
        .with_graceful_shutdown(shutdown_signal(parent_pid))
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

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn parent_pid_absent_by_default() {
        assert_eq!(parse_parent_pid(args(&["llm-voice-core"])), None);
    }

    #[test]
    fn parent_pid_parses_the_space_separated_form() {
        assert_eq!(
            parse_parent_pid(args(&["llm-voice-core", "--parent-pid", "4242"])),
            Some(4242)
        );
    }

    #[test]
    fn parent_pid_parses_the_equals_form() {
        assert_eq!(
            parse_parent_pid(args(&["llm-voice-core", "--parent-pid=4242"])),
            Some(4242)
        );
    }

    #[test]
    fn parent_pid_ignores_a_non_numeric_value() {
        assert_eq!(
            parse_parent_pid(args(&["llm-voice-core", "--parent-pid", "pas-un-pid"])),
            None
        );
    }

    #[test]
    fn parent_pid_ignores_a_dangling_flag_without_value() {
        assert_eq!(
            parse_parent_pid(args(&["llm-voice-core", "--parent-pid"])),
            None
        );
    }

    #[test]
    fn current_process_is_reported_alive() {
        assert!(parent_is_alive(std::process::id()));
    }

    #[test]
    fn an_unlikely_pid_is_reported_dead() {
        // PID max sur Linux (`/proc/sys/kernel/pid_max` par défaut) : un
        // processus réel n'y vit jamais dans un environnement de test.
        assert!(!parent_is_alive(4_294_967_295));
    }
}
