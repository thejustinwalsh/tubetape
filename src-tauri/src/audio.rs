use std::path::Path;
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::WaveformData;

const SAMPLES_PER_PEAK: usize = 256;
const CHUNK_SIZE: usize = 1000;

pub fn estimate_peak_count(duration_secs: f64, sample_rate: u32) -> usize {
    let total_samples = (duration_secs * sample_rate as f64) as usize;
    (total_samples / SAMPLES_PER_PEAK) + 1 // +1 for rounding
}

pub fn get_audio_info(audio_path: &Path) -> Result<(f64, u32), String> {
    let file =
        std::fs::File::open(audio_path).map_err(|e| format!("Failed to open audio file: {}", e))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = audio_path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| format!("Failed to probe audio format: {}", e))?;

    let format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| "No audio track found".to_string())?;

    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "Unknown sample rate".to_string())?;

    let duration_secs = if let Some(n_frames) = track.codec_params.n_frames {
        n_frames as f64 / sample_rate as f64
    } else {
        0.0
    };

    Ok((duration_secs, sample_rate))
}

pub fn generate_waveform_peaks<F>(
    audio_path: &Path,
    mut on_chunk: F,
) -> Result<WaveformData, String>
where
    F: FnMut(&[f32], usize),
{
    let file =
        std::fs::File::open(audio_path).map_err(|e| format!("Failed to open audio file: {}", e))?;

    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = audio_path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let format_opts = FormatOptions::default();
    let metadata_opts = MetadataOptions::default();

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &format_opts, &metadata_opts)
        .map_err(|e| format!("Failed to probe audio format: {}", e))?;

    let mut format = probed.format;

    let track = format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != symphonia::core::codecs::CODEC_TYPE_NULL)
        .ok_or_else(|| "No audio track found".to_string())?;

    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "Unknown sample rate".to_string())?;

    let decoder_opts = DecoderOptions::default();
    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &decoder_opts)
        .map_err(|e| format!("Failed to create decoder: {}", e))?;

    let track_id = track.id;

    let mut all_peaks: Vec<f32> = Vec::new();
    let mut sample_buffer: Option<SampleBuffer<f32>> = None;
    let mut accumulator: Vec<f32> = Vec::new();
    let mut total_samples: u64 = 0;
    let mut chunk_buffer: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref e))
                if e.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(e) => return Err(format!("Failed to read packet: {}", e)),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(_) => continue,
        };

        if sample_buffer.is_none() {
            let spec = *decoded.spec();
            let duration = decoded.capacity() as u64;
            sample_buffer = Some(SampleBuffer::new(duration, spec));
        }

        if let Some(ref mut buf) = sample_buffer {
            let channels = decoded.spec().channels.count();
            buf.copy_interleaved_ref(decoded);
            let samples = buf.samples();

            for chunk in samples.chunks(channels) {
                let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
                accumulator.push(mono.abs());
                total_samples += 1;

                if accumulator.len() >= SAMPLES_PER_PEAK {
                    let peak = accumulator.iter().cloned().fold(0.0f32, f32::max);
                    all_peaks.push(peak);
                    chunk_buffer.push(peak);
                    accumulator.clear();

                    if chunk_buffer.len() >= CHUNK_SIZE {
                        on_chunk(&chunk_buffer, all_peaks.len() - chunk_buffer.len());
                        chunk_buffer.clear();
                    }
                }
            }
        }
    }

    if !accumulator.is_empty() {
        let peak = accumulator.iter().cloned().fold(0.0f32, f32::max);
        all_peaks.push(peak);
        chunk_buffer.push(peak);
    }

    if !chunk_buffer.is_empty() {
        on_chunk(&chunk_buffer, all_peaks.len() - chunk_buffer.len());
    }

    let max_peak = all_peaks.iter().cloned().fold(0.0f32, f32::max);
    if max_peak > 0.0 {
        for peak in &mut all_peaks {
            *peak /= max_peak;
        }
    }

    let duration_secs = total_samples as f64 / sample_rate as f64;

    Ok(WaveformData {
        peaks: all_peaks,
        duration_secs,
        sample_rate,
    })
}
