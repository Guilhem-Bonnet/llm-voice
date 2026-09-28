//! `llm-voice-audio` : lecture native d'une file de WAV/PCM enchaînés sans
//! blanc, avec pause, reprise et position absolue en millisecondes.
//!
//! Spike GAO-spike-moteur-001 (ADR-012) : cette bibliothèque isole la
//! logique de file et de position de la sortie audio réelle (`cpal`), pour
//! que `cargo test` puisse vérifier la file sans périphérique.

mod error;
mod player;
mod queue;

pub use error::AudioError;
pub use player::{load_wav, DrainStatus, Player};
pub use queue::{Clip, PlaybackState, TrackQueue};
