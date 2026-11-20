//! Événements WebSocket du protocole Core v1, construits avec les types de
//! `llm-voice-protocol` (miroirs des schémas `contracts/core-v1/ws/*`).

use std::sync::{Arc, Mutex};

use llm_voice_protocol::{
    EndedEvent, ErrorEvent, PositionEvent, SegmentEndedEvent, SegmentStartedEvent, StateEvent,
    UnderrunEvent, PROTOCOL_VERSION,
};
use serde::Serialize;
use tokio::sync::broadcast;

/// État de lecture tel que publié par l'événement `state`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WireState {
    Stopped,
    Playing,
    Paused,
    Ended,
}

impl WireState {
    pub fn as_str(self) -> &'static str {
        match self {
            WireState::Stopped => "stopped",
            WireState::Playing => "playing",
            WireState::Paused => "paused",
            WireState::Ended => "ended",
        }
    }
}

fn v() -> String {
    PROTOCOL_VERSION.to_string()
}

pub fn state(state: WireState, position_ms: u64) -> StateEvent {
    StateEvent {
        protocol_version: v(),
        r#type: "state".into(),
        state: state.as_str().into(),
        position_ms,
    }
}

pub fn position(segment_id: &str, position_ms: u64) -> PositionEvent {
    PositionEvent {
        protocol_version: v(),
        r#type: "position".into(),
        segment_id: segment_id.into(),
        position_ms,
    }
}

pub fn segment_started(segment_id: &str, position_ms: u64) -> SegmentStartedEvent {
    SegmentStartedEvent {
        protocol_version: v(),
        r#type: "segment_started".into(),
        segment_id: segment_id.into(),
        position_ms,
    }
}

pub fn segment_ended(segment_id: &str, position_ms: u64) -> SegmentEndedEvent {
    SegmentEndedEvent {
        protocol_version: v(),
        r#type: "segment_ended".into(),
        segment_id: segment_id.into(),
        position_ms,
    }
}

pub fn underrun(position_ms: u64, segment_id: Option<&str>) -> UnderrunEvent {
    UnderrunEvent {
        protocol_version: v(),
        r#type: "underrun".into(),
        position_ms,
        segment_id: segment_id.map(str::to_string),
    }
}

pub fn ended(position_ms: u64, total_duration_ms: u64) -> EndedEvent {
    EndedEvent {
        protocol_version: v(),
        r#type: "ended".into(),
        position_ms,
        total_duration_ms,
    }
}

pub fn error(code: &str, message: &str, segment_id: Option<&str>) -> ErrorEvent {
    ErrorEvent {
        protocol_version: v(),
        r#type: "error".into(),
        code: code.into(),
        message: message.into(),
        segment_id: segment_id.map(str::to_string),
    }
}

/// Diffusion des événements vers tous les clients WS, plus le dernier
/// `state` publié (envoyé à chaque nouvelle connexion).
#[derive(Clone)]
pub struct EventBus {
    tx: broadcast::Sender<String>,
    last_state: Arc<Mutex<String>>,
}

impl Default for EventBus {
    fn default() -> Self {
        Self::new()
    }
}

impl EventBus {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(1024);
        let initial = serde_json::to_string(&state(WireState::Stopped, 0)).unwrap_or_default();
        Self {
            tx,
            last_state: Arc::new(Mutex::new(initial)),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<String> {
        self.tx.subscribe()
    }

    pub fn last_state(&self) -> String {
        self.last_state
            .lock()
            .map(|s| s.clone())
            .unwrap_or_default()
    }

    /// Sérialise et diffuse ; sans client connecté, l'événement est perdu
    /// (seul le dernier `state` est conservé).
    pub fn emit<T: Serialize>(&self, event: &T) {
        let Ok(json) = serde_json::to_string(event) else {
            return;
        };
        let _ = self.tx.send(json);
    }

    pub fn emit_state(&self, event: &StateEvent) {
        let Ok(json) = serde_json::to_string(event) else {
            return;
        };
        if let Ok(mut last) = self.last_state.lock() {
            last.clone_from(&json);
        }
        let _ = self.tx.send(json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use llm_voice_protocol::deserialize_and_validate;

    fn check<T: Serialize>(kind: &str, event: &T) {
        let json = serde_json::to_string(event).expect("sérialisation");
        deserialize_and_validate(kind, &json).unwrap_or_else(|e| panic!("{kind} : {e} ({json})"));
    }

    #[test]
    fn every_emitted_event_validates_against_the_contract() {
        check("ws/state.event", &state(WireState::Playing, 1200));
        check("ws/state.event", &state(WireState::Ended, 8707));
        check("ws/position.event", &position("seg-0001", 2500));
        check(
            "ws/segment_started.event",
            &segment_started("seg-0002", 8707),
        );
        check("ws/segment_ended.event", &segment_ended("seg-0001", 8707));
        check("ws/underrun.event", &underrun(4300, Some("seg-0002")));
        check("ws/underrun.event", &underrun(4300, None));
        check("ws/ended.event", &ended(8707, 8707));
        check(
            "ws/error.event",
            &error("internal_error", "flux cpal interrompu", Some("seg-0002")),
        );
    }

    /// Même octets sémantiques que les exemples du contrat.
    #[test]
    fn events_match_contract_examples_exactly() {
        let root = llm_voice_protocol::examples_root().join("valid");
        let cases: Vec<(&str, serde_json::Value)> = vec![
            (
                "state.event.json",
                serde_json::to_value(state(WireState::Playing, 1200)).expect("json"),
            ),
            (
                "position.event.json",
                serde_json::to_value(position("seg-0001", 2500)).expect("json"),
            ),
            (
                "segment_started.event.json",
                serde_json::to_value(segment_started("seg-0002", 8707)).expect("json"),
            ),
            (
                "segment_ended.event.json",
                serde_json::to_value(segment_ended("seg-0001", 8707)).expect("json"),
            ),
            (
                "underrun.event.json",
                serde_json::to_value(underrun(4300, Some("seg-0002"))).expect("json"),
            ),
            (
                "ended.event.json",
                serde_json::to_value(ended(8707, 8707)).expect("json"),
            ),
            (
                "error.event.json",
                serde_json::to_value(error(
                    "internal_error",
                    "flux cpal interrompu",
                    Some("seg-0002"),
                ))
                .expect("json"),
            ),
        ];
        for (file, produced) in cases {
            let raw = std::fs::read_to_string(root.join(file)).expect("exemple");
            let expected: serde_json::Value = serde_json::from_str(&raw).expect("json");
            assert_eq!(produced, expected, "{file}");
        }
    }
}
