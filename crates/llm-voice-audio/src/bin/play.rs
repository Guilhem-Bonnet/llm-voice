//! `llm-voice-audio-play` : joue une suite de fichiers WAV enchaînés sans
//! blanc, imprime la position sur `stderr`, et peut marquer une pause et une
//! reprise à des instants donnés (options `--pause-at`/`--resume-after`, en
//! millisecondes depuis le début de la lecture).
//!
//! Spike GAO-spike-moteur-001 (ADR-012).

use std::path::PathBuf;
use std::process::ExitCode;
use std::thread;
use std::time::{Duration, Instant};

use llm_voice_audio::{AudioError, Player};

#[derive(Debug, thiserror::Error)]
enum CliError {
    #[error("aucun fichier WAV fourni ; usage : llm-voice-audio-play <wav>... [--pause-at MS --resume-after MS]")]
    NoInput,

    #[error("valeur numérique invalide pour {flag} : {value}")]
    InvalidNumber { flag: &'static str, value: String },

    #[error(transparent)]
    Audio(#[from] AudioError),
}

struct Args {
    wavs: Vec<PathBuf>,
    pause_at_ms: Option<u64>,
    resume_after_ms: Option<u64>,
}

fn parse_args(raw: impl Iterator<Item = String>) -> Result<Args, CliError> {
    let mut wavs = Vec::new();
    let mut pause_at_ms = None;
    let mut resume_after_ms = None;

    let mut iter = raw.peekable();
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--pause-at" => {
                let value = iter.next().unwrap_or_default();
                pause_at_ms = Some(value.parse::<u64>().map_err(|_| CliError::InvalidNumber {
                    flag: "--pause-at",
                    value,
                })?);
            }
            "--resume-after" => {
                let value = iter.next().unwrap_or_default();
                resume_after_ms =
                    Some(value.parse::<u64>().map_err(|_| CliError::InvalidNumber {
                        flag: "--resume-after",
                        value,
                    })?);
            }
            other => wavs.push(PathBuf::from(other)),
        }
    }

    if wavs.is_empty() {
        return Err(CliError::NoInput);
    }

    Ok(Args {
        wavs,
        pause_at_ms,
        resume_after_ms,
    })
}

fn run() -> Result<(), CliError> {
    let args = parse_args(std::env::args().skip(1))?;

    let mut clips = Vec::with_capacity(args.wavs.len());
    for path in &args.wavs {
        clips.push(llm_voice_audio::load_wav(path)?);
    }

    let player = Player::new(clips)?;
    player.play();

    let total_ms = player.total_duration_ms();
    let start = Instant::now();
    let mut paused_once = false;
    let mut resumed_once = false;

    loop {
        let elapsed_ms = start.elapsed().as_millis() as u64;
        let position_ms = player.position_ms();
        eprintln!(
            "position_ms={position_ms} total_ms={total_ms} state={:?}",
            player.state()
        );

        if let Some(pause_at) = args.pause_at_ms {
            if !paused_once && elapsed_ms >= pause_at {
                player.pause();
                paused_once = true;
                eprintln!("pause_ms={position_ms}");
            }
        }
        if let (Some(pause_at), Some(resume_after)) = (args.pause_at_ms, args.resume_after_ms) {
            if paused_once && !resumed_once && elapsed_ms >= pause_at + resume_after {
                player.resume();
                resumed_once = true;
                eprintln!("resume_ms={position_ms}");
            }
        }

        if player.state() == llm_voice_audio::PlaybackState::Ended {
            eprintln!("ended position_ms={position_ms}");
            break;
        }

        thread::sleep(Duration::from_millis(50));
    }

    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("erreur: {err}");
            ExitCode::FAILURE
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wavs_and_pause_flags() {
        let args = parse_args(
            vec![
                "a.wav",
                "b.wav",
                "--pause-at",
                "1200",
                "--resume-after",
                "500",
            ]
            .into_iter()
            .map(String::from),
        )
        .expect("arguments valides");
        assert_eq!(
            args.wavs,
            vec![PathBuf::from("a.wav"), PathBuf::from("b.wav")]
        );
        assert_eq!(args.pause_at_ms, Some(1200));
        assert_eq!(args.resume_after_ms, Some(500));
    }

    #[test]
    fn rejects_empty_input() {
        let result = parse_args(std::iter::empty());
        assert!(matches!(result, Err(CliError::NoInput)));
    }

    #[test]
    fn rejects_invalid_number() {
        let result = parse_args(
            vec!["a.wav", "--pause-at", "pas-un-nombre"]
                .into_iter()
                .map(String::from),
        );
        assert!(matches!(result, Err(CliError::InvalidNumber { .. })));
    }
}
