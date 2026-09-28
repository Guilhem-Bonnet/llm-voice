//! File de pistes et position, indépendante de tout périphérique audio.
//!
//! Toute la logique testée par `cargo test` (sans carte son) vit ici : le
//! module `player` ne fait que brancher cette file sur un flux `cpal`.

/// Un clip décodé : échantillons entrelacés (mono ou stéréo), prêts à être
/// envoyés au périphérique de sortie.
#[derive(Debug, Clone)]
pub struct Clip {
    pub samples: Vec<i16>,
    pub sample_rate: u32,
    pub channels: u16,
}

impl Clip {
    /// Nombre de trames (échantillons par canal), indépendant du nombre de
    /// canaux.
    fn frame_count(&self) -> usize {
        if self.channels == 0 {
            0
        } else {
            self.samples.len() / self.channels as usize
        }
    }

    /// Durée du clip en millisecondes.
    pub fn duration_ms(&self) -> u64 {
        if self.sample_rate == 0 {
            return 0;
        }
        (self.frame_count() as u64 * 1000) / self.sample_rate as u64
    }
}

/// État de lecture de la file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum PlaybackState {
    /// Rien n'a encore été joué, ou la file est vide.
    #[default]
    Stopped,
    /// Lecture en cours.
    Playing,
    /// Lecture suspendue ; la position est conservée.
    Paused,
    /// Tous les clips ont été consommés.
    Ended,
}

/// File de clips enchaînés sans blanc : les échantillons d'un clip au
/// suivant se succèdent directement, sans silence inséré entre eux.
///
/// La position est un compteur de trames absolu depuis le début de la file
/// (toutes les pistes ont ici le même taux d'échantillonnage : c'est le cas
/// des sorties Piper utilisées par le spike ; un remuxage serait nécessaire
/// pour mélanger des taux différents, hors de ce spike).
#[derive(Debug, Default)]
pub struct TrackQueue {
    clips: Vec<Clip>,
    /// Position de lecture, en trames, depuis le début du premier clip.
    position_frames: u64,
    state: PlaybackState,
}

impl TrackQueue {
    pub fn new(clips: Vec<Clip>) -> Self {
        Self {
            clips,
            position_frames: 0,
            state: PlaybackState::Stopped,
        }
    }

    pub fn state(&self) -> PlaybackState {
        self.state
    }

    /// Taux d'échantillonnage de la file (celui du premier clip), 0 si vide.
    fn sample_rate(&self) -> u32 {
        self.clips.first().map(|c| c.sample_rate).unwrap_or(0)
    }

    fn total_frames(&self) -> u64 {
        self.clips.iter().map(|c| c.frame_count() as u64).sum()
    }

    /// Durée totale de la file, en millisecondes.
    pub fn total_duration_ms(&self) -> u64 {
        let rate = self.sample_rate();
        if rate == 0 {
            return 0;
        }
        (self.total_frames() * 1000) / rate as u64
    }

    /// Position de lecture actuelle, en millisecondes absolues depuis le
    /// début de la file.
    pub fn position_ms(&self) -> u64 {
        let rate = self.sample_rate();
        if rate == 0 {
            return 0;
        }
        (self.position_frames * 1000) / rate as u64
    }

    pub fn play(&mut self) {
        if self.clips.is_empty() {
            self.state = PlaybackState::Stopped;
            return;
        }
        if self.state != PlaybackState::Ended {
            self.state = PlaybackState::Playing;
        }
    }

    pub fn pause(&mut self) {
        if self.state == PlaybackState::Playing {
            self.state = PlaybackState::Paused;
        }
    }

    pub fn resume(&mut self) {
        if self.state == PlaybackState::Paused {
            self.state = PlaybackState::Playing;
        }
    }

    pub fn stop(&mut self) {
        self.position_frames = 0;
        self.state = PlaybackState::Stopped;
    }

    /// Positionne la lecture à une position absolue en millisecondes,
    /// bornée à la durée totale de la file.
    pub fn seek_ms(&mut self, position_ms: u64) {
        let rate = self.sample_rate();
        if rate == 0 {
            return;
        }
        let target_frames = (position_ms * rate as u64) / 1000;
        self.position_frames = target_frames.min(self.total_frames());
        if self.state == PlaybackState::Ended && self.position_frames < self.total_frames() {
            self.state = PlaybackState::Paused;
        }
    }

    /// Retourne l'échantillon entrelacé courant et avance la position d'une
    /// trame ; `None` si la file est en pause, arrêtée ou terminée.
    fn next_frame(&mut self) -> Option<&[i16]> {
        if self.state != PlaybackState::Playing {
            return None;
        }
        let channels = self.clips.first().map(|c| c.channels).unwrap_or(0) as usize;
        if channels == 0 {
            return None;
        }
        let mut remaining = self.position_frames;
        for clip in &self.clips {
            let clip_frames = clip.frame_count() as u64;
            if remaining < clip_frames {
                let start = (remaining as usize) * channels;
                self.position_frames += 1;
                return Some(&clip.samples[start..start + channels]);
            }
            remaining -= clip_frames;
        }
        self.state = PlaybackState::Ended;
        None
    }

    /// Remplit `out` (échantillons entrelacés, silence = 0) avec la suite de
    /// la file ; retourne le nombre de trames effectivement écrites (les
    /// trames restantes de `out` sont laissées à 0, sous-alimentation ou fin
    /// de file).
    pub fn fill(&mut self, out: &mut [i16], channels: u16) -> usize {
        let channels = channels as usize;
        if channels == 0 || !out.len().is_multiple_of(channels) {
            return 0;
        }
        let frame_slots = out.len() / channels;
        let mut written = 0;
        for slot in 0..frame_slots {
            match self.next_frame() {
                Some(frame) => {
                    let start = slot * channels;
                    out[start..start + channels].copy_from_slice(frame);
                    written += 1;
                }
                None => break,
            }
        }
        written
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(seconds: u32, value: i16) -> Clip {
        let sample_rate = 1_000; // 1 kHz pour des calculs de test lisibles
        let frames = sample_rate * seconds;
        Clip {
            samples: vec![value; frames as usize], // mono
            sample_rate,
            channels: 1,
        }
    }

    #[test]
    fn empty_queue_reports_stopped_and_zero_duration() {
        let q = TrackQueue::new(vec![]);
        assert_eq!(q.state(), PlaybackState::Stopped);
        assert_eq!(q.total_duration_ms(), 0);
        assert_eq!(q.position_ms(), 0);
    }

    #[test]
    fn concatenates_clips_without_gap() {
        let mut q = TrackQueue::new(vec![clip(1, 1), clip(1, 2)]);
        assert_eq!(q.total_duration_ms(), 2000);
        q.play();

        let mut out = vec![0i16; 500]; // 500 trames mono
        let written = q.fill(&mut out, 1);
        assert_eq!(written, 500);
        assert!(out.iter().all(|&s| s == 1));
        assert_eq!(q.position_ms(), 500);

        // Traverse la jonction entre les deux clips sans blanc : les 500
        // dernières trames du premier clip puis les 500 premières du second,
        // aucun zéro inséré entre les deux.
        let mut out2 = vec![0i16; 1000];
        let written2 = q.fill(&mut out2, 1);
        assert_eq!(written2, 1000);
        assert_eq!(&out2[..500], &vec![1i16; 500][..]);
        assert_eq!(&out2[500..], &vec![2i16; 500][..]);
        assert_eq!(q.position_ms(), 1500);
    }

    #[test]
    fn pause_freezes_position_and_resume_continues() {
        let mut q = TrackQueue::new(vec![clip(2, 7)]);
        q.play();
        let mut out = vec![0i16; 300];
        q.fill(&mut out, 1);
        assert_eq!(q.position_ms(), 300);

        q.pause();
        assert_eq!(q.state(), PlaybackState::Paused);
        let mut silence_probe = vec![9i16; 100];
        let written = q.fill(&mut silence_probe, 1);
        assert_eq!(written, 0, "rien n'est consommé pendant la pause");
        assert_eq!(q.position_ms(), 300, "la position ne bouge pas en pause");

        q.resume();
        let mut out2 = vec![0i16; 200];
        let written2 = q.fill(&mut out2, 1);
        assert_eq!(written2, 200);
        assert!(out2.iter().all(|&s| s == 7));
        assert_eq!(q.position_ms(), 500);
    }

    #[test]
    fn reaches_ended_state_after_last_frame() {
        let mut q = TrackQueue::new(vec![clip(1, 3)]);
        q.play();
        let mut out = vec![0i16; 2000]; // plus long que le clip (1000 trames)
        let written = q.fill(&mut out, 1);
        assert_eq!(written, 1000);
        assert_eq!(q.state(), PlaybackState::Ended);
        assert_eq!(q.position_ms(), 1000);
    }

    #[test]
    fn seek_moves_absolute_position() {
        let mut q = TrackQueue::new(vec![clip(1, 1), clip(1, 2)]);
        q.seek_ms(1200);
        q.play();
        let mut out = vec![0i16; 100];
        q.fill(&mut out, 1);
        assert!(
            out.iter().all(|&s| s == 2),
            "seek doit tomber dans le 2e clip"
        );
        assert_eq!(q.position_ms(), 1300);
    }

    #[test]
    fn seek_past_end_clamps_and_reports_full_duration() {
        let mut q = TrackQueue::new(vec![clip(1, 1)]);
        q.seek_ms(5_000);
        assert_eq!(q.position_ms(), 1000);
    }
}
