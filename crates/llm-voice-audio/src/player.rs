//! Branchement de la `TrackQueue` sur un flux de sortie `cpal`.

use std::path::Path;
use std::sync::{Arc, Mutex};

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, SampleRate, Stream, StreamConfig};

use crate::error::AudioError;
use crate::queue::{Clip, PlaybackState, TrackQueue};

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

/// Lecteur natif : possède la file et le flux `cpal` associé.
pub struct Player {
    queue: Arc<Mutex<TrackQueue>>,
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

        let err_fn = |err| eprintln!("erreur de flux audio cpal: {err}");

        let stream = match sample_format {
            SampleFormat::I16 => device.build_output_stream(
                &config,
                move |data: &mut [i16], _| {
                    let mut q = stream_queue.lock().expect("mutex de file empoisonné");
                    let written = q.fill(data, channels);
                    for sample in &mut data[written * channels as usize..] {
                        *sample = 0;
                    }
                },
                err_fn,
                None,
            )?,
            SampleFormat::F32 => device.build_output_stream(
                &config,
                move |data: &mut [f32], _| {
                    let mut scratch = vec![0i16; data.len()];
                    let mut q = stream_queue.lock().expect("mutex de file empoisonné");
                    q.fill(&mut scratch, channels);
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

    pub fn seek_ms(&self, position_ms: u64) {
        self.lock().seek_ms(position_ms);
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
