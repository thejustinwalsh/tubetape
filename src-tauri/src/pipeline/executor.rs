use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use serde::Serialize;
use specta::Type;
use tauri::ipc::Channel;
use tokio::sync::mpsc;

use crate::audio;
use crate::beat_detection::{self, BeatInfo};
use crate::ffmpeg;
use crate::WaveformData;

use super::{FFmpegCommand, PipelineCommand, PipelineEvent, StageName, StageProgress};

/// Result of the complete pipeline execution
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PipelineResult {
    pub audio_path: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
}

/// Internal state of the pipeline state machine
#[derive(Debug)]
enum PipelineState {
    /// Initial state - about to request extraction
    Initial,
    /// Waiting for frontend to complete extraction via Pyodide
    AwaitingExtraction,
    /// Extraction done, running FFmpeg commands
    RunningFFmpeg,
    /// FFmpeg done, processing audio (waveform + beats in parallel)
    ProcessingAudio,
    /// All done
    Completed,
    /// Failed
    #[allow(dead_code)]
    Failed,
}

/// Shared progress state for thread-safe updates during parallel processing
struct SharedProgress {
    /// Progress as fixed-point integer (0-10000 = 0.00% - 100.00%)
    waveform_progress: AtomicU64,
    beat_progress: AtomicU64,
}

impl SharedProgress {
    fn new() -> Self {
        Self {
            waveform_progress: AtomicU64::new(0),
            beat_progress: AtomicU64::new(0),
        }
    }

    fn set_waveform(&self, percent: f64) {
        let value = (percent * 100.0).clamp(0.0, 10000.0) as u64;
        self.waveform_progress.store(value, Ordering::Relaxed);
    }

    fn set_beat(&self, percent: f64) {
        let value = (percent * 100.0).clamp(0.0, 10000.0) as u64;
        self.beat_progress.store(value, Ordering::Relaxed);
    }

    fn get_waveform(&self) -> f64 {
        self.waveform_progress.load(Ordering::Relaxed) as f64 / 100.0
    }

    fn get_beat(&self) -> f64 {
        self.beat_progress.load(Ordering::Relaxed) as f64 / 100.0
    }
}

/// Pipeline executor that orchestrates the entire fetch-convert-process flow.
///
/// The pipeline acts as a state machine that:
/// 1. Requests extraction from frontend (which runs Pyodide/yt-dlp)
/// 2. Receives progress updates and completion signals
/// 3. Runs FFmpeg commands for audio conversion
/// 4. Runs waveform generation and beat detection in parallel
/// 5. Reports unified progress throughout
pub struct PipelineExecutor {
    url: String,
    output_path: PathBuf,
    event_channel: Channel<PipelineEvent>,
    command_rx: mpsc::Receiver<PipelineCommand>,
    state: PipelineState,
    stage_progress: HashMap<StageName, f64>,
}

impl PipelineExecutor {
    /// Create a new pipeline executor.
    ///
    /// # Arguments
    /// * `url` - YouTube URL to extract audio from
    /// * `output_path` - Path where the final audio file should be saved
    /// * `event_channel` - Channel to send events to frontend
    /// * `command_rx` - Channel to receive commands from frontend
    pub fn new(
        url: String,
        output_path: PathBuf,
        event_channel: Channel<PipelineEvent>,
        command_rx: mpsc::Receiver<PipelineCommand>,
    ) -> Self {
        Self {
            url,
            output_path,
            event_channel,
            command_rx,
            state: PipelineState::Initial,
            stage_progress: HashMap::new(),
        }
    }

    /// Run the pipeline to completion.
    ///
    /// This is the main entry point that drives the state machine through all stages.
    pub async fn run(mut self) -> Result<PipelineResult, String> {
        // Emit started event
        self.emit(PipelineEvent::Started {
            url: self.url.clone(),
            output_path: self.output_path.to_string_lossy().to_string(),
            stages: StageName::all(),
        });

        // === STAGE: Initializing + Downloading + Converting (via Pyodide) ===
        self.state = PipelineState::AwaitingExtraction;

        // Request extraction from frontend
        self.emit_progress(StageName::Initializing, -1.0, "Extracting video info...");
        self.emit(PipelineEvent::RequestExtraction {
            url: self.url.clone(),
            output_path: self.output_path.to_string_lossy().to_string(),
        });

        // Wait for extraction to complete, processing commands as they arrive
        let (audio_path, ffmpeg_commands) = self.await_extraction().await?;

        // Mark extraction stages as complete
        self.mark_stage_complete(StageName::Initializing);
        self.mark_stage_complete(StageName::Downloading);

        // === STAGE: Converting (FFmpeg) ===
        self.state = PipelineState::RunningFFmpeg;

        if !ffmpeg_commands.is_empty() {
            self.emit_progress(StageName::Converting, -1.0, "Converting audio...");

            for cmd in &ffmpeg_commands {
                self.run_ffmpeg_command(cmd).await?;
            }
        }

        self.mark_stage_complete(StageName::Converting);

        // === STAGE: Waveform + BeatDetection (parallel) ===
        self.state = PipelineState::ProcessingAudio;

        let audio_path_buf = PathBuf::from(&audio_path);
        let (waveform_data, _beat_info) = self.run_processing_parallel(&audio_path_buf).await?;

        // === COMPLETE ===
        self.state = PipelineState::Completed;

        let result = PipelineResult {
            audio_path,
            duration_secs: waveform_data.duration_secs,
            sample_rate: waveform_data.sample_rate,
        };

        self.emit(PipelineEvent::Completed(result.clone()));

        Ok(result)
    }

    /// Wait for extraction to complete, processing incoming commands.
    async fn await_extraction(&mut self) -> Result<(String, Vec<FFmpegCommand>), String> {
        let mut in_download_phase = false;

        loop {
            match self.command_rx.recv().await {
                Some(PipelineCommand::DownloadProgress {
                    bytes_downloaded,
                    total_bytes,
                }) => {
                    // First download progress means we've moved from init to download
                    if !in_download_phase {
                        self.mark_stage_complete(StageName::Initializing);
                        in_download_phase = true;
                    }

                    let percent = total_bytes
                        .map(|t| (bytes_downloaded as f64 / t as f64) * 100.0)
                        .unwrap_or(-1.0);

                    let message = if let Some(total) = total_bytes {
                        format!(
                            "Downloading... ({:.1} MB / {:.1} MB)",
                            bytes_downloaded as f64 / 1_000_000.0,
                            total as f64 / 1_000_000.0
                        )
                    } else {
                        format!(
                            "Downloading... ({:.1} MB)",
                            bytes_downloaded as f64 / 1_000_000.0
                        )
                    };

                    self.emit_progress(StageName::Downloading, percent, &message);
                }

                Some(PipelineCommand::InitializingProgress { message }) => {
                    self.emit_progress(StageName::Initializing, -1.0, &message);
                }

                Some(PipelineCommand::ExtractionComplete {
                    audio_path,
                    ffmpeg_commands,
                }) => {
                    self.mark_stage_complete(StageName::Downloading);
                    return Ok((audio_path, ffmpeg_commands));
                }

                Some(PipelineCommand::ExtractionFailed { message }) => {
                    // Determine which stage failed based on whether we started downloading
                    let failed_stage = if in_download_phase {
                        StageName::Downloading
                    } else {
                        StageName::Initializing
                    };
                    return Err(self.fail(failed_stage, message));
                }

                None => {
                    return Err(self.fail(
                        StageName::Initializing,
                        "Command channel closed unexpectedly".to_string(),
                    ));
                }
            }
        }
    }

    /// Run a single FFmpeg command.
    async fn run_ffmpeg_command(&self, cmd: &FFmpegCommand) -> Result<(), String> {
        eprintln!("[pipeline] Running FFmpeg command: {} {:?}", cmd.command, cmd.args);

        let result = ffmpeg::dlopen_ffmpeg_internal(&cmd.command, cmd.args.clone())?;

        if result.exit_code != 0 {
            return Err(format!(
                "FFmpeg command failed with exit code {}: {}",
                result.exit_code,
                result.stderr.lines().take(5).collect::<Vec<_>>().join("\n")
            ));
        }

        Ok(())
    }

    /// Run waveform generation and beat detection in parallel.
    async fn run_processing_parallel(
        &mut self,
        audio_path: &PathBuf,
    ) -> Result<(WaveformData, BeatInfo), String> {
        let progress = Arc::new(SharedProgress::new());

        // Clone what we need for the parallel tasks
        let waveform_path = audio_path.clone();
        let beat_path = audio_path.clone();
        let waveform_channel = self.event_channel.clone();
        let beat_channel = self.event_channel.clone();
        let waveform_progress = Arc::clone(&progress);
        let beat_progress = Arc::clone(&progress);

        // Calculate base progress (sum of completed blocking stages)
        let base_progress = StageName::Initializing.weight()
            + StageName::Downloading.weight()
            + StageName::Converting.weight();

        // Run both stages in parallel using spawn_blocking for CPU-bound work
        let waveform_handle = tokio::task::spawn_blocking(move || {
            run_waveform_stage(waveform_path, waveform_channel, waveform_progress, base_progress)
        });

        let beat_handle = tokio::task::spawn_blocking(move || {
            run_beat_detection_stage(beat_path, beat_channel, beat_progress, base_progress)
        });

        // Wait for both to complete
        let (waveform_result, beat_result) = tokio::join!(waveform_handle, beat_handle);

        // Handle join errors
        let waveform_data = waveform_result
            .map_err(|e| format!("Waveform task panicked: {}", e))?
            .map_err(|e| {
                let _ = self.event_channel.send(PipelineEvent::Error {
                    stage: StageName::Waveform,
                    message: e.clone(),
                    recoverable: false,
                });
                e
            })?;

        let beat_info = beat_result
            .map_err(|e| format!("Beat detection task panicked: {}", e))?
            .map_err(|e| {
                let _ = self.event_channel.send(PipelineEvent::Error {
                    stage: StageName::BeatDetection,
                    message: e.clone(),
                    recoverable: false,
                });
                e
            })?;

        // Send completion events
        let _ = self.event_channel.send(PipelineEvent::WaveformComplete {
            peaks: waveform_data.peaks.clone(),
            duration_secs: waveform_data.duration_secs,
            sample_rate: waveform_data.sample_rate,
        });

        let _ = self
            .event_channel
            .send(PipelineEvent::BeatDetectionComplete {
                bpm: beat_info.bpm,
                bpm_confidence: beat_info.bpm_confidence,
                beats: beat_info.beats.clone(),
                onsets: beat_info.onsets.clone(),
            });

        self.mark_stage_complete(StageName::Waveform);
        self.mark_stage_complete(StageName::BeatDetection);

        Ok((waveform_data, beat_info))
    }

    /// Emit a progress event with calculated overall progress.
    fn emit_progress(&mut self, stage: StageName, stage_percent: f64, message: &str) {
        // Update stage progress (only if determinate)
        if stage_percent >= 0.0 {
            self.stage_progress
                .insert(stage.clone(), stage_percent.min(100.0));
        }

        let overall = self.calculate_overall_progress();

        let _ = self.event_channel.send(PipelineEvent::Progress(StageProgress {
            stage,
            stage_percent,
            overall_percent: overall,
            message: message.to_string(),
        }));
    }

    /// Calculate overall progress based on completed stages and current stage progress.
    fn calculate_overall_progress(&self) -> f64 {
        let total_weight: f64 = StageName::all().iter().map(|s| s.weight()).sum();
        let mut completed_weight = 0.0;

        for (stage, &progress) in &self.stage_progress {
            // Progress is 0-100, convert to 0-1 and multiply by weight
            completed_weight += (progress / 100.0) * stage.weight();
        }

        (completed_weight / total_weight) * 100.0
    }

    /// Mark a stage as 100% complete.
    fn mark_stage_complete(&mut self, stage: StageName) {
        self.stage_progress.insert(stage, 100.0);
    }

    /// Emit an error event and return the error message.
    fn fail(&self, stage: StageName, message: String) -> String {
        let _ = self.event_channel.send(PipelineEvent::Error {
            stage,
            message: message.clone(),
            recoverable: false,
        });
        message
    }

    /// Emit a pipeline event.
    fn emit(&self, event: PipelineEvent) {
        let _ = self.event_channel.send(event);
    }
}

/// Run waveform generation stage with progress reporting.
fn run_waveform_stage(
    audio_path: PathBuf,
    channel: Channel<PipelineEvent>,
    progress: Arc<SharedProgress>,
    base_progress: f64,
) -> Result<WaveformData, String> {
    // Get audio info first to estimate progress
    let (duration_secs, sample_rate) = audio::get_audio_info(&audio_path)?;
    let expected_peaks = audio::estimate_peak_count(duration_secs, sample_rate);

    let channel_clone = channel.clone();
    let progress_clone = Arc::clone(&progress);

    let mut peaks_received = 0usize;

    let waveform = audio::generate_waveform_peaks(&audio_path, move |peaks, offset| {
        // Send chunk event
        let _ = channel_clone.send(PipelineEvent::WaveformChunk {
            peaks: peaks.to_vec(),
            offset,
        });

        // Update progress
        peaks_received += peaks.len();
        let stage_percent = if expected_peaks > 0 {
            (peaks_received as f64 / expected_peaks as f64 * 100.0).min(100.0)
        } else {
            0.0
        };

        progress_clone.set_waveform(stage_percent);

        // Calculate overall progress
        // Waveform and BeatDetection run in parallel, so we need to combine them
        let waveform_contribution = (stage_percent / 100.0) * StageName::Waveform.weight();
        let beat_contribution = (progress_clone.get_beat() / 100.0) * StageName::BeatDetection.weight();
        let total_weight: f64 = StageName::all().iter().map(|s| s.weight()).sum();
        let overall = ((base_progress + waveform_contribution + beat_contribution) / total_weight) * 100.0;

        // Send progress event
        let _ = channel.send(PipelineEvent::Progress(StageProgress {
            stage: StageName::Waveform,
            stage_percent,
            overall_percent: overall,
            message: format!("Generating waveform ({:.0}%)", stage_percent),
        }));
    })?;

    // Mark as complete
    progress.set_waveform(100.0);

    Ok(waveform)
}

/// Run beat detection stage with progress reporting.
fn run_beat_detection_stage(
    audio_path: PathBuf,
    channel: Channel<PipelineEvent>,
    progress: Arc<SharedProgress>,
    base_progress: f64,
) -> Result<BeatInfo, String> {
    // Report starting
    let total_weight: f64 = StageName::all().iter().map(|s| s.weight()).sum();
    let overall = (base_progress / total_weight) * 100.0;

    let _ = channel.send(PipelineEvent::Progress(StageProgress {
        stage: StageName::BeatDetection,
        stage_percent: 0.0,
        overall_percent: overall,
        message: "Starting beat detection...".to_string(),
    }));

    progress.set_beat(10.0);

    // Run beat detection
    let beat_info = beat_detection::analyze_beats(&audio_path)?;

    // Mark as complete
    progress.set_beat(100.0);

    let waveform_contribution = (progress.get_waveform() / 100.0) * StageName::Waveform.weight();
    let beat_contribution = StageName::BeatDetection.weight();
    let final_overall = ((base_progress + waveform_contribution + beat_contribution) / total_weight) * 100.0;

    let _ = channel.send(PipelineEvent::Progress(StageProgress {
        stage: StageName::BeatDetection,
        stage_percent: 100.0,
        overall_percent: final_overall,
        message: format!("Beat detection complete: {:.1} BPM", beat_info.bpm),
    }));

    Ok(beat_info)
}

// ============================================================================
// Legacy support: Allow using PipelineExecutor for processing-only (no fetch)
// ============================================================================

impl PipelineExecutor {
    /// Create an executor for processing an existing audio file (no fetch/convert).
    /// This is for backwards compatibility with the existing `process_audio` command.
    pub fn for_existing_audio(
        audio_path: PathBuf,
        event_channel: Channel<PipelineEvent>,
    ) -> ProcessingOnlyExecutor {
        ProcessingOnlyExecutor {
            audio_path,
            event_channel,
        }
    }
}

/// Executor for processing an existing audio file (waveform + beats only).
/// Used for backwards compatibility when audio is already downloaded.
pub struct ProcessingOnlyExecutor {
    audio_path: PathBuf,
    event_channel: Channel<PipelineEvent>,
}

impl ProcessingOnlyExecutor {
    /// Run waveform and beat detection on an existing audio file.
    pub async fn execute(self) -> Result<PipelineResult, String> {
        let stages = vec![StageName::Waveform, StageName::BeatDetection];

        // Send started event
        let _ = self.event_channel.send(PipelineEvent::Started {
            url: String::new(),
            output_path: self.audio_path.to_string_lossy().to_string(),
            stages: stages.clone(),
        });

        let progress = Arc::new(SharedProgress::new());

        // Clone what we need for the parallel tasks
        let waveform_path = self.audio_path.clone();
        let beat_path = self.audio_path.clone();
        let waveform_channel = self.event_channel.clone();
        let beat_channel = self.event_channel.clone();
        let waveform_progress = Arc::clone(&progress);
        let beat_progress = Arc::clone(&progress);

        // For processing-only, base progress is 0 (no fetch stages)
        // But we need to adjust weights to only count waveform + beats
        let _base_progress = 0.0;

        // Run both stages in parallel
        let waveform_handle = tokio::task::spawn_blocking(move || {
            run_waveform_stage_processing_only(waveform_path, waveform_channel, waveform_progress)
        });

        let beat_handle = tokio::task::spawn_blocking(move || {
            run_beat_detection_stage_processing_only(beat_path, beat_channel, beat_progress)
        });

        // Wait for both
        let (waveform_result, beat_result) = tokio::join!(waveform_handle, beat_handle);

        let waveform_data = waveform_result
            .map_err(|e| format!("Waveform task panicked: {}", e))?
            .map_err(|e| {
                let _ = self.event_channel.send(PipelineEvent::Error {
                    stage: StageName::Waveform,
                    message: e.clone(),
                    recoverable: false,
                });
                e
            })?;

        let beat_info = beat_result
            .map_err(|e| format!("Beat detection task panicked: {}", e))?
            .map_err(|e| {
                let _ = self.event_channel.send(PipelineEvent::Error {
                    stage: StageName::BeatDetection,
                    message: e.clone(),
                    recoverable: false,
                });
                e
            })?;

        // Send completion events
        let _ = self.event_channel.send(PipelineEvent::WaveformComplete {
            peaks: waveform_data.peaks.clone(),
            duration_secs: waveform_data.duration_secs,
            sample_rate: waveform_data.sample_rate,
        });

        let _ = self
            .event_channel
            .send(PipelineEvent::BeatDetectionComplete {
                bpm: beat_info.bpm,
                bpm_confidence: beat_info.bpm_confidence,
                beats: beat_info.beats,
                onsets: beat_info.onsets,
            });

        let result = PipelineResult {
            audio_path: self.audio_path.to_string_lossy().to_string(),
            duration_secs: waveform_data.duration_secs,
            sample_rate: waveform_data.sample_rate,
        };

        let _ = self.event_channel.send(PipelineEvent::Completed(result.clone()));

        Ok(result)
    }
}

/// Waveform stage for processing-only mode (50% weight with beat detection)
fn run_waveform_stage_processing_only(
    audio_path: PathBuf,
    channel: Channel<PipelineEvent>,
    progress: Arc<SharedProgress>,
) -> Result<WaveformData, String> {
    let (duration_secs, sample_rate) = audio::get_audio_info(&audio_path)?;
    let expected_peaks = audio::estimate_peak_count(duration_secs, sample_rate);

    let channel_clone = channel.clone();
    let progress_clone = Arc::clone(&progress);

    let mut peaks_received = 0usize;

    let waveform = audio::generate_waveform_peaks(&audio_path, move |peaks, offset| {
        let _ = channel_clone.send(PipelineEvent::WaveformChunk {
            peaks: peaks.to_vec(),
            offset,
        });

        peaks_received += peaks.len();
        let stage_percent = if expected_peaks > 0 {
            (peaks_received as f64 / expected_peaks as f64 * 100.0).min(100.0)
        } else {
            0.0
        };

        progress_clone.set_waveform(stage_percent);

        // For processing-only, overall = (waveform + beat) / 2
        let overall = (stage_percent + progress_clone.get_beat()) / 2.0;

        let _ = channel.send(PipelineEvent::Progress(StageProgress {
            stage: StageName::Waveform,
            stage_percent,
            overall_percent: overall,
            message: format!("Generating waveform ({:.0}%)", stage_percent),
        }));
    })?;

    progress.set_waveform(100.0);
    Ok(waveform)
}

/// Beat detection stage for processing-only mode (50% weight with waveform)
fn run_beat_detection_stage_processing_only(
    audio_path: PathBuf,
    channel: Channel<PipelineEvent>,
    progress: Arc<SharedProgress>,
) -> Result<BeatInfo, String> {
    let overall = progress.get_waveform() / 2.0;

    let _ = channel.send(PipelineEvent::Progress(StageProgress {
        stage: StageName::BeatDetection,
        stage_percent: 0.0,
        overall_percent: overall,
        message: "Starting beat detection...".to_string(),
    }));

    progress.set_beat(10.0);

    let beat_info = beat_detection::analyze_beats(&audio_path)?;

    progress.set_beat(100.0);

    let final_overall = (progress.get_waveform() + 100.0) / 2.0;

    let _ = channel.send(PipelineEvent::Progress(StageProgress {
        stage: StageName::BeatDetection,
        stage_percent: 100.0,
        overall_percent: final_overall,
        message: format!("Beat detection complete: {:.1} BPM", beat_info.bpm),
    }));

    Ok(beat_info)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shared_progress() {
        let progress = SharedProgress::new();

        assert_eq!(progress.get_waveform(), 0.0);
        assert_eq!(progress.get_beat(), 0.0);

        progress.set_waveform(50.0);
        assert_eq!(progress.get_waveform(), 50.0);

        progress.set_beat(50.0);
        assert_eq!(progress.get_beat(), 50.0);

        progress.set_waveform(100.0);
        progress.set_beat(100.0);
        assert_eq!(progress.get_waveform(), 100.0);
        assert_eq!(progress.get_beat(), 100.0);
    }

    #[test]
    fn test_progress_clamping() {
        let progress = SharedProgress::new();

        progress.set_waveform(150.0);
        assert_eq!(progress.get_waveform(), 100.0);

        progress.set_beat(-10.0);
        assert_eq!(progress.get_beat(), 0.0);
    }

    #[test]
    fn test_stage_weights_sum_to_100() {
        let total: f64 = StageName::all().iter().map(|s| s.weight()).sum();
        assert!((total - 100.0).abs() < 0.001, "Stage weights should sum to 100, got {}", total);
    }

    #[test]
    fn test_blocking_stages() {
        assert!(StageName::Initializing.is_blocking());
        assert!(StageName::Downloading.is_blocking());
        assert!(StageName::Converting.is_blocking());
        assert!(!StageName::Waveform.is_blocking());
        assert!(!StageName::BeatDetection.is_blocking());
    }

    #[test]
    fn test_pipeline_result_serialization() {
        let result = PipelineResult {
            audio_path: "/path/to/audio.aac".to_string(),
            duration_secs: 120.5,
            sample_rate: 44100,
        };

        let json = serde_json::to_string(&result).unwrap();
        assert!(json.contains("\"audioPath\":\"/path/to/audio.aac\""));
        assert!(json.contains("\"durationSecs\":120.5"));
        assert!(json.contains("\"sampleRate\":44100"));
    }

    #[test]
    fn test_pipeline_event_serialization() {
        use super::super::PipelineEvent;

        // Test RequestExtraction event serialization
        let event = PipelineEvent::RequestExtraction {
            url: "https://youtube.com/watch?v=test".to_string(),
            output_path: "/path/to/output.aac".to_string(),
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"event\":\"requestExtraction\""));
        assert!(json.contains("\"outputPath\":\"/path/to/output.aac\""));
        assert!(json.contains("\"url\":\"https://youtube.com/watch?v=test\""));

        // Test WaveformComplete event serialization
        let event = PipelineEvent::WaveformComplete {
            peaks: vec![0.1, 0.2],
            duration_secs: 120.5,
            sample_rate: 44100,
        };

        let json = serde_json::to_string(&event).unwrap();
        assert!(json.contains("\"event\":\"waveformComplete\""));
        assert!(json.contains("\"durationSecs\":120.5"));
        assert!(json.contains("\"sampleRate\":44100"));
    }
}
