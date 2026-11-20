//! `llm-voice-core` : démon local de lecture native (ADR-012).
//!
//! Serveur HTTP + WebSocket sur `127.0.0.1` (port éphémère), protégé par un
//! jeton de session, un refus de tout `Origin` non vide et un contrôle du
//! `Host` ; instance unique par utilisateur ; aucune connexion sortante. Il
//! pilote `llm-voice-audio` et parle le protocole `contracts/core-v1` via les
//! types de `llm-voice-protocol`.

pub mod engine;
pub mod events;
pub mod lock;
pub mod security;
pub mod server;
