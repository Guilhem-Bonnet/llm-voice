//! Démarrage du vrai binaire `llm-voice-core` dans des dossiers d'état et
//! de cache temporaires (jamais l'état réel de l'utilisateur).
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::Value;

pub const BIN: &str = env!("CARGO_BIN_EXE_llm-voice-core");

pub fn spawn(state_dir: &Path, cache_dir: &Path) -> Child {
    Command::new(BIN)
        .env("LLM_VOICE_CORE_STATE_DIR", state_dir)
        .env("LLM_VOICE_CACHE_DIR", cache_dir)
        .env_remove("LLM_VOICE_CORE_TOKEN")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("lancement du binaire")
}

pub fn wait_state(state_dir: &Path) -> Value {
    let path = state_dir.join("core.json");
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                return v;
            }
        }
        assert!(Instant::now() < deadline, "core.json jamais écrit");
        std::thread::sleep(Duration::from_millis(20));
    }
}

pub struct Core {
    pub child: Child,
    pub port: u16,
    pub token: String,
    pub state_dir: tempfile::TempDir,
    pub cache_dir: tempfile::TempDir,
}

impl Core {
    pub fn start() -> Self {
        let state_dir = tempfile::tempdir().expect("tmp");
        let cache_dir = tempfile::tempdir().expect("tmp");
        let child = spawn(state_dir.path(), cache_dir.path());
        let state = wait_state(state_dir.path());
        Self {
            child,
            port: state["port"].as_u64().expect("port") as u16,
            token: state["token"].as_str().expect("token").to_string(),
            state_dir,
            cache_dir,
        }
    }

    pub fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    pub fn ws_url(&self, token: Option<&str>) -> String {
        match token {
            Some(t) => format!("ws://127.0.0.1:{}/v1/ws?token={t}", self.port),
            None => format!("ws://127.0.0.1:{}/v1/ws", self.port),
        }
    }

    pub fn cache_path(&self, name: &str) -> PathBuf {
        std::fs::canonicalize(self.cache_dir.path())
            .expect("cache")
            .join(name)
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

/// WAV PCM 16 bits de silence (aucun son audible pendant `cargo test`).
pub fn write_silent_wav(path: &Path, sample_rate: u32, duration_ms: u32) {
    let spec = hound::WavSpec {
        channels: 1,
        sample_rate,
        bits_per_sample: 16,
        sample_format: hound::SampleFormat::Int,
    };
    let mut w = hound::WavWriter::create(path, spec).expect("wav");
    for _ in 0..(sample_rate * duration_ms / 1000) {
        w.write_sample(0i16).expect("échantillon");
    }
    w.finalize().expect("finalize");
}

pub fn example(name: &str) -> Value {
    let raw = std::fs::read_to_string(llm_voice_protocol::examples_root().join("valid").join(name))
        .expect("exemple du contrat");
    serde_json::from_str(&raw).expect("json")
}

/// Valide un message contre son type du contrat (mêmes règles que
/// `contracts/core-v1/examples/manifest.json`).
pub fn assert_contract(kind: &str, value: &Value) {
    llm_voice_protocol::deserialize_and_validate(kind, &value.to_string())
        .unwrap_or_else(|e| panic!("{kind} non conforme : {e} ({value})"));
}
