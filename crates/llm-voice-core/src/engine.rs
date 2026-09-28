//! Fil audio du Core : possède le `Player` (`cpal::Stream` n'est pas `Send`),
//! exécute les commandes reçues du serveur et publie les événements.
//!
//! Boucle : attente d'une commande au plus [`TICK`] (100 ms), puis constat
//! (position, vidange) et émission des événements — `position` part donc à
//! ~10 Hz pendant la lecture (le contrat demande ≥ 4 Hz).
//!
//! Sémantique retenue (à reprendre par `NativeAudioSink`, étape B) :
//! - `underrun` : la file est à sec alors que la lecture est en cours (le
//!   callback audio a constaté `Ended`) ; émis une fois au début de la
//!   sous-alimentation. Un `enqueue` reçu pendant une sous-alimentation ou
//!   après `ended` repart immédiatement (contrat `AudioSink` v2).
//! - `ended` : seulement quand la file est à sec depuis `DRAIN_MARGIN`
//!   (`llm-voice-audio`), c'est-à-dire après vidange du tampon du
//!   périphérique (GAO-spike-moteur-001, CL-004) ; précédé du
//!   `segment_ended` du dernier segment, suivi de `state: ended`.
//! - `segment_ended` d'un segment non final : quand la position écrite a
//!   dépassé sa fin de [`SEGMENT_END_LATENCY_MS`] (même marge de vidange).
//! - `stop` vide la file et libère le périphérique (le prochain `enqueue`
//!   rouvre un flux au format du nouveau premier segment).

use std::sync::mpsc::{self, RecvTimeoutError};
use std::thread;
use std::time::Duration;

use llm_voice_audio::{Clip, DrainStatus, PlaybackState, Player};
use tokio::sync::oneshot;

use crate::events::{self, EventBus, WireState};

pub const TICK: Duration = Duration::from_millis(100);

/// Marge appliquée à la fin d'un segment non final avant `segment_ended`,
/// alignée sur `DRAIN_MARGIN` de `llm-voice-audio` (300 ms).
pub const SEGMENT_END_LATENCY_MS: u64 = 300;

/// Erreur d'une commande, déjà exprimée avec un code du contrat.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{code} : {message}")]
pub struct EngineError {
    pub code: &'static str,
    pub message: String,
}

impl EngineError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub type Reply = oneshot::Sender<Result<(), EngineError>>;

pub enum Command {
    Enqueue {
        segment_id: String,
        clip: Clip,
        reply: Reply,
    },
    Play {
        segment_id: Option<String>,
        reply: Reply,
    },
    Pause(Reply),
    Resume(Reply),
    Stop(Reply),
    Seek {
        position_ms: u64,
        reply: Reply,
    },
    Shutdown,
}

/// Poignée côté serveur (clonable, `Send + Sync`).
#[derive(Clone)]
pub struct EngineHandle {
    tx: mpsc::Sender<Command>,
}

impl EngineHandle {
    /// Démarre le fil audio.
    pub fn spawn(events: EventBus) -> std::io::Result<Self> {
        let (tx, rx) = mpsc::channel();
        thread::Builder::new()
            .name("llm-voice-audio".into())
            .spawn(move || Engine::new(events).run(rx))?;
        Ok(Self { tx })
    }

    /// Envoie une commande et attend sa réponse.
    pub async fn call(&self, build: impl FnOnce(Reply) -> Command) -> Result<(), EngineError> {
        let (reply, rx) = oneshot::channel();
        self.tx
            .send(build(reply))
            .map_err(|_| EngineError::new("internal_error", "fil audio arrêté"))?;
        rx.await
            .map_err(|_| EngineError::new("internal_error", "fil audio sans réponse"))?
    }

    pub fn shutdown(&self) {
        let _ = self.tx.send(Command::Shutdown);
    }
}

#[derive(Debug, Clone)]
struct Segment {
    id: String,
    start_ms: u64,
    end_ms: u64,
}

struct Engine {
    player: Option<Player>,
    format: Option<(u32, u16)>,
    segments: Vec<Segment>,
    total_frames: u64,
    /// Premier segment dont `segment_started` n'a pas encore été émis.
    next_start: usize,
    /// Premier segment dont `segment_ended` n'a pas encore été émis.
    next_end: usize,
    underrun_emitted: bool,
    ended_emitted: bool,
    last_state: Option<WireState>,
    events: EventBus,
}

impl Engine {
    fn new(events: EventBus) -> Self {
        Self {
            player: None,
            format: None,
            segments: Vec::new(),
            total_frames: 0,
            next_start: 0,
            next_end: 0,
            underrun_emitted: false,
            ended_emitted: false,
            last_state: None,
            events,
        }
    }

    fn run(mut self, rx: mpsc::Receiver<Command>) {
        loop {
            match rx.recv_timeout(TICK) {
                Ok(Command::Shutdown) | Err(RecvTimeoutError::Disconnected) => break,
                Ok(cmd) => self.handle(cmd),
                Err(RecvTimeoutError::Timeout) => {}
            }
            self.tick();
        }
        self.player = None;
    }

    fn handle(&mut self, cmd: Command) {
        match cmd {
            Command::Enqueue {
                segment_id,
                clip,
                reply,
            } => {
                let _ = reply.send(self.enqueue(segment_id, clip));
            }
            Command::Play { segment_id, reply } => {
                let _ = reply.send(self.play(segment_id));
            }
            Command::Pause(reply) => {
                if let Some(p) = &self.player {
                    p.pause();
                }
                let _ = reply.send(Ok(()));
            }
            Command::Resume(reply) => {
                if let Some(p) = &self.player {
                    p.resume();
                }
                let _ = reply.send(Ok(()));
            }
            Command::Stop(reply) => {
                self.player = None;
                self.format = None;
                self.segments.clear();
                self.total_frames = 0;
                self.reset_cursor(0);
                let _ = reply.send(Ok(()));
            }
            Command::Seek { position_ms, reply } => {
                if let Some(p) = &self.player {
                    p.seek_ms(position_ms);
                    let pos = p.position_ms();
                    self.reset_cursor(pos);
                }
                let _ = reply.send(Ok(()));
            }
            Command::Shutdown => {}
        }
    }

    fn segment_index_at(&self, pos: u64) -> usize {
        self.segments
            .iter()
            .rposition(|s| s.start_ms <= pos)
            .unwrap_or(0)
    }

    /// Repositionne les curseurs d'événements après un saut (seek, play d'un
    /// segment, stop) : le segment courant sera de nouveau annoncé.
    fn reset_cursor(&mut self, pos: u64) {
        let idx = self.segment_index_at(pos);
        self.next_start = idx;
        self.next_end = idx;
        self.underrun_emitted = false;
        self.ended_emitted = false;
    }

    fn enqueue(&mut self, segment_id: String, clip: Clip) -> Result<(), EngineError> {
        if clip.channels == 0 || clip.sample_rate == 0 || clip.samples.is_empty() {
            return Err(EngineError::new(
                "unsupported_format",
                format!("{segment_id} : clip vide ou sans format"),
            ));
        }
        let clip_format = (clip.sample_rate, clip.channels);
        if let Some(format) = self.format {
            if format != clip_format {
                return Err(EngineError::new(
                    "unsupported_format",
                    format!(
                        "{segment_id} : {} Hz / {} canal(aux) différent du flux ouvert ({} Hz / {})",
                        clip_format.0, clip_format.1, format.0, format.1
                    ),
                ));
            }
        }
        let frames = (clip.samples.len() / clip.channels as usize) as u64;
        let rate = u64::from(clip.sample_rate);
        let start_ms = self.total_frames * 1000 / rate;
        let end_ms = (self.total_frames + frames) * 1000 / rate;

        match &self.player {
            None => {
                let player = Player::new(vec![clip]).map_err(|e| {
                    let message = format!("ouverture du périphérique audio impossible : {e}");
                    self.events.emit(&events::error(
                        "internal_error",
                        &message,
                        Some(&segment_id),
                    ));
                    EngineError::new("internal_error", message)
                })?;
                self.player = Some(player);
                self.format = Some(clip_format);
            }
            Some(player) => {
                let starved = player.state() == PlaybackState::Ended;
                player.push(clip);
                if starved {
                    // File à sec pendant la lecture (sous-alimentation) ou
                    // déjà terminée : le segment arrivé repart aussitôt.
                    player.play();
                    self.underrun_emitted = false;
                    self.ended_emitted = false;
                }
            }
        }
        self.total_frames += frames;
        self.segments.push(Segment {
            id: segment_id,
            start_ms,
            end_ms,
        });
        Ok(())
    }

    fn play(&mut self, segment_id: Option<String>) -> Result<(), EngineError> {
        let Some(player) = &self.player else {
            return Err(EngineError::new(
                "segment_not_found",
                "file vide : aucun segment à jouer",
            ));
        };
        let restart_at = match segment_id {
            Some(id) => {
                let Some(seg) = self.segments.iter().find(|s| s.id == id) else {
                    return Err(EngineError::new(
                        "segment_not_found",
                        format!("{id} n'est pas dans la file"),
                    ));
                };
                player.seek_ms(seg.start_ms);
                Some(player.position_ms())
            }
            None if player.state() == PlaybackState::Ended => {
                player.seek_ms(0);
                Some(0)
            }
            None => None,
        };
        player.play();
        if let Some(pos) = restart_at {
            self.reset_cursor(pos);
        }
        Ok(())
    }

    fn set_state(&mut self, state: WireState, pos: u64) {
        if self.last_state != Some(state) {
            self.last_state = Some(state);
            self.events.emit_state(&events::state(state, pos));
        }
    }

    fn tick(&mut self) {
        let Some(player) = &self.player else {
            self.set_state(WireState::Stopped, 0);
            return;
        };
        let pos = player.position_ms();
        let queue_state = player.state();
        let drain = player.drain_status();
        let total = player.total_duration_ms();
        let wire = match queue_state {
            PlaybackState::Stopped => WireState::Stopped,
            PlaybackState::Playing => WireState::Playing,
            PlaybackState::Paused => WireState::Paused,
            PlaybackState::Ended if drain == DrainStatus::Drained => WireState::Ended,
            // À sec mais pas encore vidé : le périphérique joue encore.
            PlaybackState::Ended => WireState::Playing,
        };

        if wire == WireState::Playing {
            while self.next_start < self.segments.len()
                && pos >= self.segments[self.next_start].start_ms
            {
                let seg = &self.segments[self.next_start];
                self.events
                    .emit(&events::segment_started(&seg.id, seg.start_ms));
                self.next_start += 1;
            }
        }
        let drained = wire == WireState::Ended;
        while self.next_end < self.next_start
            && (drained || pos >= self.segments[self.next_end].end_ms + SEGMENT_END_LATENCY_MS)
        {
            let seg = &self.segments[self.next_end];
            self.events
                .emit(&events::segment_ended(&seg.id, seg.end_ms));
            self.next_end += 1;
        }

        if queue_state == PlaybackState::Ended && !self.underrun_emitted {
            self.underrun_emitted = true;
            let last = self.segments.last().map(|s| s.id.as_str());
            self.events.emit(&events::underrun(pos, last));
        }

        if wire == WireState::Playing {
            let idx = self.segment_index_at(pos);
            if let Some(seg) = self.segments.get(idx) {
                self.events.emit(&events::position(&seg.id, pos));
            }
        }

        if drained && !self.ended_emitted {
            self.ended_emitted = true;
            eprintln!(
                "llm-voice-core : ended à {pos} ms, latence de sortie mesurée {:?}",
                player.output_latency()
            );
            self.events.emit(&events::ended(pos, total));
        }
        self.set_state(wire, pos);
    }
}
