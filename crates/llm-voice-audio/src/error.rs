//! Erreurs typées de la bibliothèque (pas de `panic!`/`unwrap()` en dehors
//! des tests).

use std::path::PathBuf;

/// Erreur renvoyée par `llm-voice-audio`.
#[derive(Debug, thiserror::Error)]
pub enum AudioError {
    /// Le fichier WAV ne peut pas être ouvert ou décodé par `hound`.
    #[error("lecture du WAV {path} impossible : {source}")]
    WavRead {
        path: PathBuf,
        #[source]
        source: hound::Error,
    },

    /// Aucun périphérique de sortie audio par défaut n'a été trouvé.
    #[error("aucun périphérique de sortie audio par défaut")]
    NoOutputDevice,

    /// `cpal` n'a pas pu déterminer une configuration de flux compatible.
    #[error("configuration de flux audio impossible : {0}")]
    StreamConfig(#[from] cpal::DefaultStreamConfigError),

    /// `cpal` n'a pas pu construire le flux de sortie.
    #[error("construction du flux audio impossible : {0}")]
    BuildStream(#[from] cpal::BuildStreamError),

    /// `cpal` n'a pas pu démarrer le flux de sortie.
    #[error("démarrage du flux audio impossible : {0}")]
    PlayStream(#[from] cpal::PlayStreamError),

    /// La file est vide : rien à jouer.
    #[error("file de lecture vide")]
    EmptyQueue,

    /// Le périphérique par défaut n'expose ni flux entier ni flux flottant
    /// (hors périmètre de ce spike).
    #[error("format d'échantillon de sortie non géré par le spike")]
    UnsupportedSampleFormat,
}
