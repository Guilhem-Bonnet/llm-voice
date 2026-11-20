//! Branchement de la `TrackQueue` sur un flux de sortie `cpal`.

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SampleRate, Stream, StreamConfig};

use crate::error::AudioError;
use crate::queue::{Clip, PlaybackState, TrackQueue};

/// Suivi de vidange partagé entre le callback audio et la boucle de
/// contrôle.
#[derive(Debug, Default)]
struct DrainTracker {
    /// Instant estimé où le périphérique aura joué le dernier échantillon
    /// écrit, posé au premier callback qui constate `Ended` ; `None` dès que
    /// la file n'est plus `Ended` (nouveau clip, `stop`, `seek`).
    drained_at: Option<Instant>,
    /// Dernière latence de sortie mesurée par `cpal` (instant de lecture
    /// prévu du tampon − instant du callback).
    latency: Option<Duration>,
}

/// Appelé depuis le callback temps réel juste après `fill` : ne doit jamais
/// bloquer (`try_lock`, silencieux si contesté — le callback suivant
/// rattrapera l'état). `written_frames` : trames réelles écrites dans ce
/// tampon (le reste est du silence) ; `latency` : délai avant que le début
/// de ce tampon sorte du périphérique, mesuré par `cpal`.
fn note_drain_transition(
    state: PlaybackState,
    written_frames: usize,
    sample_rate: u32,
    latency: Duration,
    tracker: &Mutex<DrainTracker>,
) {
    let Ok(mut t) = tracker.try_lock() else {
        return;
    };
    t.latency = Some(latency);
    match (state, t.drained_at) {
        (PlaybackState::Ended, None) => {
            let tail =
                Duration::from_secs_f64(written_frames as f64 / f64::from(sample_rate.max(1)));
            t.drained_at = Some(Instant::now() + latency + tail);
        }
        (PlaybackState::Ended, Some(_)) => {}
        (_, Some(_)) => t.drained_at = None,
        (_, None) => {}
    }
}

fn callback_latency(info: &cpal::OutputCallbackInfo) -> Duration {
    let ts = info.timestamp();
    ts.playback.duration_since(&ts.callback).unwrap_or_default()
}

/// Charge un fichier WAV en un `Clip` en mémoire (mono ou stéréo, PCM entier
/// ou flottant : `hound` convertit en `i16` à la lecture).
pub fn load_wav(path: &Path) -> Result<Clip, AudioError> {
    let reader = hound::WavReader::open(path).map_err(|source| AudioError::WavRead {
        path: path.to_path_buf(),
        source,
    })?;
    let spec = reader.spec();
    let samples: Result<Vec<i16>, hound::Error> = match spec.sample_format {
        hound::SampleFormat::Int if spec.bits_per_sample == 16 => {
            reader.into_samples::<i16>().collect()
        }
        hound::SampleFormat::Int => reader
            .into_samples::<i32>()
            .map(|s| s.map(|v| (v >> (spec.bits_per_sample - 16)) as i16))
            .collect(),
        hound::SampleFormat::Float => reader
            .into_samples::<f32>()
            .map(|s| s.map(|v| (v * i16::MAX as f32) as i16))
            .collect(),
    };
    let samples = samples.map_err(|source| AudioError::WavRead {
        path: path.to_path_buf(),
        source,
    })?;
    Ok(Clip {
        samples,
        sample_rate: spec.sample_rate,
        channels: spec.channels,
    })
}

/// Marge de sécurité ajoutée après l'instant de fin estimé par la latence
/// mesurée (`cpal::OutputCallbackInfo::timestamp`). Sans prise en compte de
/// la latence réelle, une marge fixe de 300 ms tronquait encore le dernier
/// mot via pipewire-alsa (GAO-core-rust-mi-001, banc prove.sh : « le dé… »),
/// comme au spike (GAO-spike-moteur-001, CL-004).
const DRAIN_MARGIN: Duration = Duration::from_millis(250);

/// Ce que le lecteur a constaté depuis la dernière consommation de la file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DrainStatus {
    /// La file joue, ou n'a jamais été à sec : rien à signaler.
    Playing,
    /// La file est à sec depuis moins de `DRAIN_MARGIN` : sous-alimentation
    /// en cours, peut encore se résoudre par un `push` (`underrun`).
    Starving,
    /// La file est à sec depuis au moins `DRAIN_MARGIN` sans qu'un nouveau
    /// clip soit arrivé entre-temps : fin confirmée, le périphérique a joué
    /// le dernier échantillon (`ended`).
    Drained,
}

/// Lecteur natif : possède la file et le flux `cpal` associé.
pub struct Player {
    queue: Arc<Mutex<TrackQueue>>,
    /// Horodatage du dernier passage à `Ended` constaté dans le callback
    /// audio, remis à `None` dès que la file quitte `Ended` (nouveau clip,
    /// `stop`, `seek`). Protégé séparément de `queue` : lu et écrit depuis le
    /// callback temps réel (jamais bloquant longtemps) et depuis les
    /// méthodes publiques.
    drain: Arc<Mutex<DrainTracker>>,
    channels: u16,
    _stream: Stream,
}

impl Player {
    /// Construit le lecteur sur le périphérique de sortie par défaut et
    /// démarre le flux (silencieux tant que rien n'est joué : `fill` écrit
    /// des zéros hors lecture).
    ///
    /// Le flux est ouvert avec le nombre de canaux et le taux
    /// d'échantillonnage du premier clip de la file plutôt qu'avec la
    /// configuration par défaut du périphérique : la config par défaut
    /// négocie parfois un nombre de canaux différent de celui du WAV
    /// (observé : sortie stéréo par défaut pour un WAV mono Piper), ce qui
    /// fait paniquer le callback (`copy_from_slice` de tailles différentes)
    /// puis le greffon ALSA de `cpal` à la fermeture du flux (assertion
    /// interne à `cpal-0.15.3`, `host/alsa/mod.rs:143`). Le format
    /// d'échantillon (`i16`/`f32`) reste celui du périphérique.
    pub fn new(clips: Vec<Clip>) -> Result<Self, AudioError> {
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or(AudioError::NoOutputDevice)?;
        let default_config = device.default_output_config()?;
        let sample_format = default_config.sample_format();

        let (channels, sample_rate) = clips
            .first()
            .map(|c| (c.channels, c.sample_rate))
            .unwrap_or_else(|| (default_config.channels(), default_config.sample_rate().0));

        let config = StreamConfig {
            channels,
            sample_rate: SampleRate(sample_rate),
            buffer_size: cpal::BufferSize::Default,
        };

        let queue = Arc::new(Mutex::new(TrackQueue::new(clips)));
        let stream_queue = Arc::clone(&queue);
        let drain = Arc::new(Mutex::new(DrainTracker::default()));
        let stream_drain = Arc::clone(&drain);
        let stream_drain_f32 = Arc::clone(&drain);

        let err_fn = |err| eprintln!("erreur de flux audio cpal: {err}");

        let stream = match sample_format {
            SampleFormat::I16 => device.build_output_stream(
                &config,
                move |data: &mut [i16], info: &cpal::OutputCallbackInfo| {
                    let mut q = stream_queue.lock().expect("mutex de file empoisonné");
                    let written = q.fill(data, channels);
                    note_drain_transition(
                        q.state(),
                        written,
                        sample_rate,
                        callback_latency(info),
                        &stream_drain,
                    );
                    for sample in &mut data[written * channels as usize..] {
                        *sample = 0;
                    }
                },
                err_fn,
                None,
            )?,
            SampleFormat::F32 => device.build_output_stream(
                &config,
                move |data: &mut [f32], info: &cpal::OutputCallbackInfo| {
                    let mut scratch = vec![0i16; data.len()];
                    let mut q = stream_queue.lock().expect("mutex de file empoisonné");
                    let written = q.fill(&mut scratch, channels);
                    note_drain_transition(
                        q.state(),
                        written,
                        sample_rate,
                        callback_latency(info),
                        &stream_drain_f32,
                    );
                    for (out, sample) in data.iter_mut().zip(scratch.iter()) {
                        *out = *sample as f32 / i16::MAX as f32;
                    }
                },
                err_fn,
                None,
            )?,
            other => {
                eprintln!("format d'échantillon non géré par le spike : {other:?}");
                return Err(AudioError::UnsupportedSampleFormat);
            }
        };

        stream.play()?;

        Ok(Self {
            queue,
            drain,
            channels,
            _stream: stream,
        })
    }

    /// Verrouille la file ; le mutex n'est empoisonné que si le callback
    /// `cpal` a paniqué, ce qui laisserait de toute façon le flux dans un
    /// état incohérent — l'`expect` reflète un bug irrécupérable, jamais un
    /// chemin d'exécution normal.
    fn lock(&self) -> std::sync::MutexGuard<'_, TrackQueue> {
        self.queue.lock().expect("mutex de file empoisonné")
    }

    pub fn play(&self) {
        self.lock().play();
    }

    pub fn pause(&self) {
        self.lock().pause();
    }

    pub fn resume(&self) {
        self.lock().resume();
    }

    pub fn stop(&self) {
        self.lock().stop();
        self.clear_drain_marker();
    }

    pub fn seek_ms(&self, position_ms: u64) {
        self.lock().seek_ms(position_ms);
        self.clear_drain_marker();
    }

    /// Ajoute un clip à la fin de la file (`enqueue`) sans interrompre une
    /// lecture en cours ; voir `TrackQueue::push`.
    pub fn push(&self, clip: Clip) {
        self.lock().push(clip);
        self.clear_drain_marker();
    }

    fn clear_drain_marker(&self) {
        self.drain
            .lock()
            .expect("mutex de vidange empoisonné")
            .drained_at = None;
    }

    /// Constat de drainage : distingue une sous-alimentation (`Starving` :
    /// file à sec, le périphérique joue encore la fin du tampon ou la marge
    /// n'est pas écoulée) d'une fin confirmée (`Drained` : l'instant estimé
    /// de sortie du dernier échantillon + `DRAIN_MARGIN` est passé —
    /// GAO-spike-moteur-001, CL-004). À appeler depuis la boucle de contrôle.
    pub fn drain_status(&self) -> DrainStatus {
        let drained_at = self
            .drain
            .lock()
            .expect("mutex de vidange empoisonné")
            .drained_at;
        match drained_at {
            None => DrainStatus::Playing,
            Some(at) if Instant::now() >= at + DRAIN_MARGIN => DrainStatus::Drained,
            Some(_) => DrainStatus::Starving,
        }
    }

    /// Dernière latence de sortie mesurée par `cpal` (diagnostic).
    pub fn output_latency(&self) -> Option<Duration> {
        self.drain.lock().ok().and_then(|t| t.latency)
    }

    pub fn position_ms(&self) -> u64 {
        self.lock().position_ms()
    }

    pub fn total_duration_ms(&self) -> u64 {
        self.lock().total_duration_ms()
    }

    pub fn state(&self) -> PlaybackState {
        self.lock().state()
    }

    pub fn channels(&self) -> u16 {
        self.channels
    }
}
