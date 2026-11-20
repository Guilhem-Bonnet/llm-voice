//! Fichier d'état et verrou d'instance unique (ADR-012 §5).
//!
//! Un seul `llm-voice-core` doit posséder le périphérique audio par
//! utilisateur. Deux fichiers vivent dans le dossier d'état (`0700`) :
//!
//! - `core.lock` : verrou exclusif `flock` (`File::try_lock`, std ≥ 1.89) tenu
//!   pendant toute la vie du processus et relâché par le noyau à sa mort —
//!   pas de course entre deux lancements simultanés, pas de verrou orphelin
//!   possible, pas de piège de PID réutilisé ;
//! - `core.json` (mode `0600` dès la création) : PID, port éphémère, jeton de
//!   session, version de protocole ; lu par les clients (extension, script de
//!   preuve) pour découvrir un Core déjà lancé.
//!
//! Une seconde instance qui trouve le verrou pris sort avec
//! [`ALREADY_RUNNING_EXIT_CODE`] au lieu de démarrer un second serveur.

use std::fs::{self, File, OpenOptions, TryLockError};
use std::io::{self, Write};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Code de sortie dédié d'une seconde instance qui trouve un Core déjà en
/// vie (brief GAO-core-rust-mi-001, étape A, point 1).
pub const ALREADY_RUNNING_EXIT_CODE: i32 = 17;

#[derive(Debug, thiserror::Error)]
pub enum LockError {
    #[error("lecture du fichier d'état {path} impossible : {source}")]
    Read { path: PathBuf, source: io::Error },

    #[error("écriture du fichier d'état {path} impossible : {source}")]
    Write { path: PathBuf, source: io::Error },

    #[error("fichier d'état {path} mal formé : {source}")]
    Malformed {
        path: PathBuf,
        source: serde_json::Error,
    },

    #[error("création du dossier d'état {path} impossible : {source}")]
    CreateDir { path: PathBuf, source: io::Error },

    #[error("aucun dossier d'état : ni XDG_RUNTIME_DIR, ni HOME, ni LLM_VOICE_CORE_STATE_DIR")]
    NoStateDir,
}

/// Contenu du fichier d'état, `0600`, partagé avec les clients.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreStateFile {
    pub pid: u32,
    pub port: u16,
    pub token: String,
    pub protocol_version: String,
}

/// Dossier d'état : `$LLM_VOICE_CORE_STATE_DIR` si défini (tests, pour ne
/// jamais toucher l'état réel de l'utilisateur), sinon
/// `$XDG_RUNTIME_DIR/llm-voice`, sinon `$HOME/.cache/llm-voice/run` (jamais
/// un `/tmp` partagé entre utilisateurs).
pub fn state_dir() -> Result<PathBuf, LockError> {
    if let Some(dir) = std::env::var_os("LLM_VOICE_CORE_STATE_DIR") {
        return Ok(PathBuf::from(dir));
    }
    if let Some(runtime) = std::env::var_os("XDG_RUNTIME_DIR") {
        return Ok(PathBuf::from(runtime).join("llm-voice"));
    }
    std::env::var_os("HOME")
        .map(|home| PathBuf::from(home).join(".cache/llm-voice/run"))
        .ok_or(LockError::NoStateDir)
}

pub fn state_file_path(dir: &Path) -> PathBuf {
    dir.join("core.json")
}

fn lock_file_path(dir: &Path) -> PathBuf {
    dir.join("core.lock")
}

fn ensure_dir(dir: &Path) -> Result<(), LockError> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)
        .map_err(|source| LockError::CreateDir {
            path: dir.to_path_buf(),
            source,
        })
}

/// Verrou d'instance tenu tant que la valeur vit (le noyau le relâche aussi
/// si le processus meurt sans passer par `Drop`).
#[derive(Debug)]
pub struct InstanceLock {
    _file: File,
    dir: PathBuf,
}

impl InstanceLock {
    /// `Ok(Some(_))` : ce processus est l'instance unique. `Ok(None)` : un
    /// autre Core tient déjà le verrou.
    pub fn acquire(dir: &Path) -> Result<Option<Self>, LockError> {
        ensure_dir(dir)?;
        let path = lock_file_path(dir);
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .mode(0o600)
            .open(&path)
            .map_err(|source| LockError::Write {
                path: path.clone(),
                source,
            })?;
        match file.try_lock() {
            Ok(()) => Ok(Some(Self {
                _file: file,
                dir: dir.to_path_buf(),
            })),
            Err(TryLockError::WouldBlock) => Ok(None),
            Err(TryLockError::Error(source)) => Err(LockError::Write { path, source }),
        }
    }

    /// Écrit `core.json` : fichier temporaire créé directement en `0600`
    /// (le jeton n'est jamais lisible par d'autres, même un instant), puis
    /// renommage atomique.
    pub fn publish(&self, state: &CoreStateFile) -> Result<(), LockError> {
        write_state(&self.dir, state)
    }
}

impl Drop for InstanceLock {
    fn drop(&mut self) {
        remove_state(&self.dir);
    }
}

/// Lit le fichier d'état s'il existe (`None` sinon).
pub fn read_state(dir: &Path) -> Result<Option<CoreStateFile>, LockError> {
    let path = state_file_path(dir);
    let raw = match fs::read_to_string(&path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(LockError::Read { path, source }),
    };
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|source| LockError::Malformed { path, source })
}

/// Écrit le fichier d'état, mode `0600`.
pub fn write_state(dir: &Path, state: &CoreStateFile) -> Result<(), LockError> {
    ensure_dir(dir)?;
    let path = state_file_path(dir);
    let tmp = dir.join(format!("core.json.{}.tmp", std::process::id()));
    let raw = serde_json::to_vec_pretty(state).map_err(|source| LockError::Malformed {
        path: path.clone(),
        source,
    })?;
    let write = || -> io::Result<()> {
        let _ = fs::remove_file(&tmp);
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(&tmp)?;
        file.write_all(&raw)?;
        file.sync_all()?;
        // `mode` à la création est filtré par l'umask : on force 0600.
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
        fs::rename(&tmp, &path)
    };
    write().map_err(|source| LockError::Write { path, source })
}

/// Supprime le fichier d'état (arrêt propre). Silencieux si déjà absent.
pub fn remove_state(dir: &Path) {
    let _ = fs::remove_file(state_file_path(dir));
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(pid: u32) -> CoreStateFile {
        CoreStateFile {
            pid,
            port: 12345,
            token: "0123456789abcdef".to_string(),
            protocol_version: "1.0".to_string(),
        }
    }

    #[test]
    fn second_lock_in_same_dir_is_refused_then_released_on_drop() {
        let dir = tempfile::tempdir().expect("tmpdir");
        let first = InstanceLock::acquire(dir.path()).expect("acquire");
        assert!(first.is_some(), "premier verrou obtenu");
        let second = InstanceLock::acquire(dir.path()).expect("acquire");
        assert!(
            second.is_none(),
            "second verrou refusé tant que le premier vit"
        );
        drop(first);
        let third = InstanceLock::acquire(dir.path()).expect("acquire");
        assert!(third.is_some(), "verrou repris après libération");
    }

    #[test]
    fn state_file_round_trips_and_is_mode_0600() {
        let dir = tempfile::tempdir().expect("tmpdir");
        let lock = InstanceLock::acquire(dir.path())
            .expect("acquire")
            .expect("libre");
        lock.publish(&sample(std::process::id())).expect("écriture");
        let mode = fs::metadata(state_file_path(dir.path()))
            .expect("metadata")
            .permissions()
            .mode()
            & 0o777;
        assert_eq!(mode, 0o600);
        let read = read_state(dir.path()).expect("lecture").expect("présent");
        assert_eq!(read, sample(std::process::id()));
        drop(lock);
        assert!(
            read_state(dir.path()).expect("lecture").is_none(),
            "core.json supprimé à la libération du verrou"
        );
    }
}
