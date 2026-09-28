//! Types du protocole Core v1 (ADR-012, GAO-protocole-co-001).
//!
//! Chaque struct ici est le miroir manuel d'un schéma JSON sous
//! `contracts/core-v1/{http,ws}/*.schema.json` : la désérialisation `serde`
//! rejette la forme (champ manquant, type incorrect, champ inconnu grâce à
//! `deny_unknown_fields`) et `Validate::validate` rejette les invariants que
//! `serde` seul ne peut pas exprimer (motifs, énumérations, contraintes
//! `if`/`then`) — mêmes règles que les fichiers `.schema.json`, vérifiées
//! sur les mêmes exemples que le test vitest (`ajv`) côté extension. Pas de
//! moteur JSON Schema générique ici : voir `contracts/core-v1/README.md`.

use std::path::{Path, PathBuf};

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// Racine du dépôt : ce crate vit sous `<repo>/crates/llm-voice-protocol`.
fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(Path::parent)
        .expect("crates/llm-voice-protocol a deux dossiers parents dans le dépôt")
        .to_path_buf()
}

/// `<repo>/contracts/core-v1`, partagé avec le test vitest de l'extension.
pub fn contracts_root() -> PathBuf {
    repo_root().join("contracts/core-v1")
}

/// Version de protocole parlée par cette bibliothèque (et donc par le Core).
pub const PROTOCOL_VERSION: &str = "1.0";

/// Vrai si `value` est une version `1.x` acceptée par le Core
/// (`common.schema.json#/$defs/protocolVersion`).
pub fn is_supported_protocol_version(value: &str) -> bool {
    validate_protocol_version(value).is_ok()
}

/// Liste fermée des codes d'erreur (`common.schema.json#/$defs/errorCode`).
pub fn is_known_error_code(value: &str) -> bool {
    validate_error_code(value).is_ok()
}

/// `<repo>/contracts/core-v1/examples`.
pub fn examples_root() -> PathBuf {
    contracts_root().join("examples")
}

pub trait Validate {
    /// Vérifie les invariants qu'un schéma JSON exprime mais que le typage
    /// `serde` ne peut pas porter (motifs, `const`, `if`/`then`).
    fn validate(&self) -> Result<(), String>;
}

fn validate_protocol_version(value: &str) -> Result<(), String> {
    let mut parts = value.split('.');
    let major = parts.next().unwrap_or_default();
    let minor = parts.next().unwrap_or_default();
    if parts.next().is_some()
        || major != "1"
        || minor.is_empty()
        || !minor.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(format!(
            "protocolVersion \"{value}\" ne respecte pas ^1\\.[0-9]+$"
        ));
    }
    Ok(())
}

fn validate_token(value: &str) -> Result<(), String> {
    if value.len() < 16 {
        return Err(format!(
            "token trop court ({} caractères, minimum 16)",
            value.len()
        ));
    }
    Ok(())
}

fn validate_segment_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        return Err(format!(
            "segmentId \"{value}\" ne respecte pas ^[A-Za-z0-9_-]+$"
        ));
    }
    Ok(())
}

fn validate_absolute_path(value: &str) -> Result<(), String> {
    if value.is_empty() || value.contains("..") {
        return Err(format!(
            "path \"{value}\" est vide ou contient un segment .."
        ));
    }
    let is_posix_absolute = value.starts_with('/');
    let is_windows_absolute = {
        let bytes = value.as_bytes();
        bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\'
    };
    if !is_posix_absolute && !is_windows_absolute {
        return Err(format!("path \"{value}\" n'est pas un chemin absolu"));
    }
    Ok(())
}

const ERROR_CODES: &[&str] = &[
    "invalid_token",
    "invalid_origin",
    "invalid_host",
    "invalid_protocol_version",
    "invalid_request",
    "path_outside_cache",
    "unsupported_format",
    "file_too_large",
    "segment_not_found",
    "internal_error",
];

fn validate_error_code(value: &str) -> Result<(), String> {
    if ERROR_CODES.contains(&value) {
        Ok(())
    } else {
        Err(format!("code d'erreur inconnu : \"{value}\""))
    }
}

/// `common.schema.json#/$defs/audioFormat`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    Wav,
    Pcm16Le,
}

/// `http/health.response.schema.json#/properties/capabilities`.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Capabilities {
    pub formats: Vec<AudioFormat>,
    pub engine: String,
}

impl Validate for Capabilities {
    fn validate(&self) -> Result<(), String> {
        if self.formats.is_empty() {
            return Err("capabilities.formats est vide".to_string());
        }
        if self.engine != "cpal" {
            return Err(format!(
                "capabilities.engine inattendu : \"{}\"",
                self.engine
            ));
        }
        Ok(())
    }
}

/// `http/health.response.schema.json`.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct HealthResponse {
    pub protocol_version: String,
    pub status: String,
    pub capabilities: Capabilities,
}

impl Validate for HealthResponse {
    fn validate(&self) -> Result<(), String> {
        validate_protocol_version(&self.protocol_version)?;
        if self.status != "ok" {
            return Err(format!("status inattendu : \"{}\"", self.status));
        }
        self.capabilities.validate()
    }
}

/// `http/enqueue.request.schema.json`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EnqueueRequest {
    pub protocol_version: String,
    pub token: String,
    pub segment_id: String,
    pub path: String,
    pub format: AudioFormat,
    #[serde(default)]
    pub sample_rate: Option<u32>,
    #[serde(default)]
    pub channels: Option<u32>,
}

impl Validate for EnqueueRequest {
    fn validate(&self) -> Result<(), String> {
        validate_protocol_version(&self.protocol_version)?;
        validate_token(&self.token)?;
        validate_segment_id(&self.segment_id)?;
        validate_absolute_path(&self.path)?;
        if self.format == AudioFormat::Pcm16Le {
            let sample_rate = self.sample_rate.ok_or("format pcm16le sans sampleRate")?;
            let channels = self.channels.ok_or("format pcm16le sans channels")?;
            if !(8000..=192_000).contains(&sample_rate) {
                return Err(format!("sampleRate hors bornes : {sample_rate}"));
            }
            if !(1..=2).contains(&channels) {
                return Err(format!("channels hors bornes : {channels}"));
            }
        }
        Ok(())
    }
}

/// `http/play.request.schema.json`.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PlayRequest {
    pub protocol_version: String,
    pub token: String,
    #[serde(default)]
    pub segment_id: Option<String>,
}

impl Validate for PlayRequest {
    fn validate(&self) -> Result<(), String> {
        validate_protocol_version(&self.protocol_version)?;
        validate_token(&self.token)?;
        if let Some(id) = &self.segment_id {
            validate_segment_id(id)?;
        }
        Ok(())
    }
}

macro_rules! token_only_request {
    ($name:ident, $doc:literal) => {
        #[doc = $doc]
        #[derive(Debug, Deserialize)]
        #[serde(deny_unknown_fields, rename_all = "camelCase")]
        pub struct $name {
            pub protocol_version: String,
            pub token: String,
        }

        impl Validate for $name {
            fn validate(&self) -> Result<(), String> {
                validate_protocol_version(&self.protocol_version)?;
                validate_token(&self.token)
            }
        }
    };
}

token_only_request!(PauseRequest, "`http/pause.request.schema.json`.");
token_only_request!(ResumeRequest, "`http/resume.request.schema.json`.");
token_only_request!(StopRequest, "`http/stop.request.schema.json`.");

/// `http/seek.request.schema.json`. `positionMs: u64` rejette déjà toute
/// valeur négative au moment de la désérialisation.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SeekRequest {
    pub protocol_version: String,
    pub token: String,
    pub position_ms: u64,
}

impl Validate for SeekRequest {
    fn validate(&self) -> Result<(), String> {
        validate_protocol_version(&self.protocol_version)?;
        validate_token(&self.token)
    }
}

/// `http/ack.response.schema.json#/properties/error`.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AckError {
    pub code: String,
    pub message: String,
}

impl Validate for AckError {
    fn validate(&self) -> Result<(), String> {
        validate_error_code(&self.code)?;
        if self.message.is_empty() {
            return Err("error.message est vide".to_string());
        }
        Ok(())
    }
}

/// `http/ack.response.schema.json`.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AckResponse {
    pub protocol_version: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<AckError>,
}

impl Validate for AckResponse {
    fn validate(&self) -> Result<(), String> {
        validate_protocol_version(&self.protocol_version)?;
        match (&self.ok, &self.error) {
            (false, None) => Err("ok: false sans error".to_string()),
            (_, Some(error)) => error.validate(),
            _ => Ok(()),
        }
    }
}

/// `ws/state.event.schema.json`.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StateEvent {
    pub protocol_version: String,
    pub r#type: String,
    pub state: String,
    pub position_ms: u64,
}

impl Validate for StateEvent {
    fn validate(&self) -> Result<(), String> {
        validate_protocol_version(&self.protocol_version)?;
        if self.r#type != "state" {
            return Err(format!("type inattendu : \"{}\"", self.r#type));
        }
        match self.state.as_str() {
            "stopped" | "playing" | "paused" | "ended" => Ok(()),
            other => Err(format!("state inconnu : \"{other}\"")),
        }
    }
}

/// `ws/position.event.schema.json`.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct PositionEvent {
    pub protocol_version: String,
    pub r#type: String,
    pub segment_id: String,
    pub position_ms: u64,
}

impl Validate for PositionEvent {
    fn validate(&self) -> Result<(), String> {
        validate_protocol_version(&self.protocol_version)?;
        if self.r#type != "position" {
            return Err(format!("type inattendu : \"{}\"", self.r#type));
        }
        validate_segment_id(&self.segment_id)
    }
}

macro_rules! segment_lifecycle_event {
    ($name:ident, $expected_type:literal, $doc:literal) => {
        #[doc = $doc]
        #[derive(Debug, Deserialize, Serialize)]
        #[serde(deny_unknown_fields, rename_all = "camelCase")]
        pub struct $name {
            pub protocol_version: String,
            pub r#type: String,
            pub segment_id: String,
            pub position_ms: u64,
        }

        impl Validate for $name {
            fn validate(&self) -> Result<(), String> {
                validate_protocol_version(&self.protocol_version)?;
                if self.r#type != $expected_type {
                    return Err(format!("type inattendu : \"{}\"", self.r#type));
                }
                validate_segment_id(&self.segment_id)
            }
        }
    };
}

segment_lifecycle_event!(
    SegmentStartedEvent,
    "segment_started",
    "`ws/segment_started.event.schema.json`."
);
segment_lifecycle_event!(
    SegmentEndedEvent,
    "segment_ended",
    "`ws/segment_ended.event.schema.json` — posté seulement après vidange \
     complète du tampon audio du segment (GAO-spike-moteur-001, CL-004)."
);

/// `ws/underrun.event.schema.json`.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct UnderrunEvent {
    pub protocol_version: String,
    pub r#type: String,
    pub position_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
}

impl Validate for UnderrunEvent {
    fn validate(&self) -> Result<(), String> {
        validate_protocol_version(&self.protocol_version)?;
        if self.r#type != "underrun" {
            return Err(format!("type inattendu : \"{}\"", self.r#type));
        }
        if let Some(id) = &self.segment_id {
            validate_segment_id(id)?;
        }
        Ok(())
    }
}

/// `ws/ended.event.schema.json` — posté seulement après vidange complète du
/// tampon de sortie (GAO-spike-moteur-001, CL-004 : cause du dernier mot
/// tronqué mesurée au spike).
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EndedEvent {
    pub protocol_version: String,
    pub r#type: String,
    pub position_ms: u64,
    pub total_duration_ms: u64,
}

impl Validate for EndedEvent {
    fn validate(&self) -> Result<(), String> {
        validate_protocol_version(&self.protocol_version)?;
        if self.r#type != "ended" {
            return Err(format!("type inattendu : \"{}\"", self.r#type));
        }
        Ok(())
    }
}

/// `ws/error.event.schema.json`.
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ErrorEvent {
    pub protocol_version: String,
    pub r#type: String,
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_id: Option<String>,
}

impl Validate for ErrorEvent {
    fn validate(&self) -> Result<(), String> {
        validate_protocol_version(&self.protocol_version)?;
        if self.r#type != "error" {
            return Err(format!("type inattendu : \"{}\"", self.r#type));
        }
        validate_error_code(&self.code)?;
        if self.message.is_empty() {
            return Err("message est vide".to_string());
        }
        Ok(())
    }
}

fn parse_and_validate<T: DeserializeOwned + Validate>(json: &str) -> Result<(), String> {
    let value: T = serde_json::from_str(json).map_err(|e| e.to_string())?;
    value.validate()
}

/// Désérialise `json` selon le type associé à `kind` (le même identifiant
/// que `contracts/core-v1/examples/manifest.json`, c'est-à-dire le chemin du
/// schéma sous `contracts/core-v1` sans le suffixe `.schema.json`) puis
/// applique ses invariants. `Err` couvre aussi bien un rejet structurel
/// `serde` (champ manquant, type incorrect, champ inconnu) qu'un rejet de
/// `Validate::validate`.
pub fn deserialize_and_validate(kind: &str, json: &str) -> Result<(), String> {
    match kind {
        "http/health.response" => parse_and_validate::<HealthResponse>(json),
        "http/enqueue.request" => parse_and_validate::<EnqueueRequest>(json),
        "http/play.request" => parse_and_validate::<PlayRequest>(json),
        "http/pause.request" => parse_and_validate::<PauseRequest>(json),
        "http/resume.request" => parse_and_validate::<ResumeRequest>(json),
        "http/stop.request" => parse_and_validate::<StopRequest>(json),
        "http/seek.request" => parse_and_validate::<SeekRequest>(json),
        "http/ack.response" => parse_and_validate::<AckResponse>(json),
        "ws/state.event" => parse_and_validate::<StateEvent>(json),
        "ws/position.event" => parse_and_validate::<PositionEvent>(json),
        "ws/segment_started.event" => parse_and_validate::<SegmentStartedEvent>(json),
        "ws/segment_ended.event" => parse_and_validate::<SegmentEndedEvent>(json),
        "ws/underrun.event" => parse_and_validate::<UnderrunEvent>(json),
        "ws/ended.event" => parse_and_validate::<EndedEvent>(json),
        "ws/error.event" => parse_and_validate::<ErrorEvent>(json),
        other => Err(format!("kind de message inconnu : \"{other}\"")),
    }
}
