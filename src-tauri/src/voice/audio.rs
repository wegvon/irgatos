//! Sample math shared by the capture backends: the input meter and the WAV
//! a transcription service receives.

use std::time::{Duration, Instant};

/// Meter updates per second are capped; the UI animates between them.
const LEVEL_INTERVAL: Duration = Duration::from_millis(50);

/// Quieter than this reads as silence on the meter.
const FLOOR_DB: f32 = -55.0;

/// Transcription services cap uploads (OpenAI at 25 MB); ten minutes of
/// 16 kHz mono 16-bit audio is about 19 MB.
pub const RECORDING_LIMIT_SECONDS: usize = 600;

/// Speech models are trained on 16 kHz audio, and it keeps uploads small.
pub const UPLOAD_SAMPLE_RATE: u32 = 16_000;

/// Loudness of a block of samples from 0 (silence) to 1 (full scale), on a
/// decibel scale so normal speech lands mid-range rather than near zero.
pub fn level(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let energy = samples
        .iter()
        .map(|sample| f64::from(*sample) * f64::from(*sample))
        .sum::<f64>()
        / samples.len() as f64;
    let rms = energy.sqrt() as f32;
    if rms <= 0.0 {
        return 0.0;
    }
    ((20.0 * rms.log10() - FLOOR_DB) / -FLOOR_DB).clamp(0.0, 1.0)
}

/// Reports the loudest block seen since the last report, at most every
/// `LEVEL_INTERVAL`, so a short syllable is not lost between updates.
pub struct LevelMeter {
    last: Option<Instant>,
    peak: f32,
}

impl LevelMeter {
    pub fn new() -> Self {
        Self {
            last: None,
            peak: 0.0,
        }
    }

    pub fn push(&mut self, samples: &[f32], now: Instant) -> Option<f32> {
        self.peak = self.peak.max(level(samples));
        if self
            .last
            .is_some_and(|last| now.duration_since(last) < LEVEL_INTERVAL)
        {
            return None;
        }
        self.last = Some(now);
        Some(std::mem::take(&mut self.peak))
    }
}

/// Linear resampling. Speech survives it fine and it needs no filter tables.
pub fn resample(samples: &[f32], from: f64, to: f64) -> Vec<f32> {
    if samples.is_empty() || from <= 0.0 || to <= 0.0 || (from - to).abs() < f64::EPSILON {
        return samples.to_vec();
    }
    let ratio = from / to;
    let len = ((samples.len() as f64) / ratio).floor() as usize;
    (0..len)
        .map(|index| {
            let position = index as f64 * ratio;
            let base = position.floor() as usize;
            let next = (base + 1).min(samples.len() - 1);
            let fraction = (position - base as f64) as f32;
            samples[base] + (samples[next] - samples[base]) * fraction
        })
        .collect()
}

/// A mono 16-bit PCM WAV file.
pub fn wav(samples: &[f32], sample_rate: u32) -> Vec<u8> {
    let data_len = (samples.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for sample in samples {
        let value = (sample.clamp(-1.0, 1.0) * f32::from(i16::MAX)).round() as i16;
        out.extend_from_slice(&value.to_le_bytes());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn level_reads_silence_as_zero_and_full_scale_as_one() {
        assert_eq!(level(&[]), 0.0);
        assert_eq!(level(&[0.0; 256]), 0.0);
        assert_eq!(level(&[1.0, -1.0, 1.0, -1.0]), 1.0);
    }

    #[test]
    fn level_puts_conversational_speech_mid_scale() {
        // About -26 dBFS, a typical laptop-mic speaking level.
        let speech = [0.05_f32, -0.05, 0.05, -0.05];
        let value = level(&speech);
        assert!(value > 0.4 && value < 0.65, "{value}");
    }

    #[test]
    fn meter_reports_the_peak_once_per_interval() {
        let start = Instant::now();
        let mut meter = LevelMeter::new();
        assert_eq!(meter.push(&[1.0, -1.0], start), Some(1.0));
        assert_eq!(
            meter.push(&[0.5; 4], start + Duration::from_millis(10)),
            None
        );
        assert_eq!(
            meter.push(&[0.0; 4], start + Duration::from_millis(20)),
            None
        );
        let reported = meter
            .push(&[0.0; 4], start + Duration::from_millis(60))
            .unwrap();
        assert!(reported > 0.8, "the loud block is kept until reported");
        assert_eq!(
            meter.push(&[0.0; 4], start + Duration::from_millis(120)),
            Some(0.0)
        );
    }

    #[test]
    fn resample_keeps_duration_and_interpolates() {
        let input: Vec<f32> = (0..48).map(|index| index as f32).collect();
        let output = resample(&input, 48_000.0, 16_000.0);
        assert_eq!(output.len(), 16);
        assert_eq!(output[1], 3.0);
        assert_eq!(resample(&input, 16_000.0, 16_000.0), input);
        let up = resample(&[0.0, 1.0], 1.0, 2.0);
        assert_eq!(up, vec![0.0, 0.5, 1.0, 1.0]);
    }

    #[test]
    fn wav_writes_a_mono_pcm_header() {
        let bytes = wav(&[0.0, 1.0, -1.0, 2.0], 16_000);
        assert_eq!(&bytes[0..4], b"RIFF");
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 36 + 8);
        assert_eq!(&bytes[8..16], b"WAVEfmt ");
        assert_eq!(u16::from_le_bytes([bytes[22], bytes[23]]), 1, "irgat");
        assert_eq!(
            u32::from_le_bytes(bytes[24..28].try_into().unwrap()),
            16_000
        );
        assert_eq!(&bytes[36..40], b"data");
        let samples: Vec<i16> = bytes[44..]
            .chunks(2)
            .map(|pair| i16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        assert_eq!(samples, vec![0, i16::MAX, -i16::MAX, i16::MAX]);
    }
}
