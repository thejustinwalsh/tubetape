mod executor;

pub use executor::{PipelineExecutor, PipelineResult, ProcessingOnlyExecutor};

use serde::{Deserialize, Serialize};
use specta::Type;

/// Names of processing stages in the pipeline with associated weights
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, Type)]
#[serde(rename_all = "camelCase")]
pub enum StageName {
    /// yt-dlp info extraction (indeterminate progress)
    Initializing,
    /// Audio stream download (byte-level progress)
    Downloading,
    /// FFmpeg remux/convert (indeterminate progress)
    Converting,
    /// Waveform peak generation (chunk progress)
    Waveform,
    /// Beat/tempo analysis (indeterminate progress)
    BeatDetection,
}

impl StageName {
    /// Weight of this stage in overall progress calculation (should sum to 100)
    pub fn weight(&self) -> f64 {
        match self {
            StageName::Initializing => 5.0,
            StageName::Downloading => 40.0,
            StageName::Converting => 10.0,
            StageName::Waveform => 25.0,
            StageName::BeatDetection => 20.0,
        }
    }

    /// Whether this stage must complete before the next stage starts
    pub fn is_blocking(&self) -> bool {
        matches!(
            self,
            StageName::Initializing | StageName::Downloading | StageName::Converting
        )
    }

    /// All stages in execution order
    pub fn all() -> Vec<StageName> {
        vec![
            StageName::Initializing,
            StageName::Downloading,
            StageName::Converting,
            StageName::Waveform,
            StageName::BeatDetection,
        ]
    }
}

impl std::fmt::Display for StageName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            StageName::Initializing => write!(f, "Initializing"),
            StageName::Downloading => write!(f, "Downloading"),
            StageName::Converting => write!(f, "Converting"),
            StageName::Waveform => write!(f, "Waveform"),
            StageName::BeatDetection => write!(f, "Beat Detection"),
        }
    }
}

/// Progress information for a specific stage
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct StageProgress {
    pub stage: StageName,
    /// Progress within this stage (0-100, or -1 for indeterminate)
    pub stage_percent: f64,
    /// Overall pipeline progress (0-100)
    pub overall_percent: f64,
    pub message: String,
}

/// FFmpeg command queued by yt-dlp for later execution
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FFmpegCommand {
    pub id: String,
    pub command: String,
    pub args: Vec<String>,
    pub input_path: Option<String>,
    pub output_path: Option<String>,
    pub status: String,
}

/// Unified pipeline event enum for streaming progress and results
#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum PipelineEvent {
    /// Pipeline has started processing
    Started {
        url: String,
        #[serde(rename = "outputPath")]
        output_path: String,
        stages: Vec<StageName>,
    },

    /// Progress update from any stage
    Progress(StageProgress),

    /// Request frontend to run extraction via Pyodide worker
    /// Pipeline BLOCKS until it receives ExtractionComplete or ExtractionFailed
    RequestExtraction {
        url: String,
        #[serde(rename = "outputPath")]
        output_path: String,
    },

    /// Waveform chunk for progressive rendering
    WaveformChunk { peaks: Vec<f32>, offset: usize },

    /// Waveform generation completed
    WaveformComplete {
        peaks: Vec<f32>,
        #[serde(rename = "durationSecs")]
        duration_secs: f64,
        #[serde(rename = "sampleRate")]
        sample_rate: u32,
    },

    /// Beat detection completed
    BeatDetectionComplete {
        bpm: f32,
        #[serde(rename = "bpmConfidence")]
        bpm_confidence: f32,
        beats: Vec<f64>,
        onsets: Vec<f64>,
    },

    /// All stages completed successfully
    Completed(PipelineResult),

    /// A stage failed (fail-fast)
    Error {
        stage: StageName,
        message: String,
        /// Whether this error might be recoverable with retry
        recoverable: bool,
    },
}

/// Commands sent TO the pipeline FROM the frontend/worker
#[derive(Clone, Debug, Deserialize, Type)]
#[serde(rename_all = "camelCase", tag = "command", content = "data")]
pub enum PipelineCommand {
    /// Extraction phase completed successfully
    ExtractionComplete {
        #[serde(rename = "audioPath")]
        audio_path: String,
        #[serde(rename = "ffmpegCommands")]
        ffmpeg_commands: Vec<FFmpegCommand>,
    },

    /// Extraction phase failed
    ExtractionFailed { message: String },

    /// Download progress update (forwarded from http.rs via worker)
    DownloadProgress {
        #[serde(rename = "bytesDownloaded")]
        bytes_downloaded: u64,
        #[serde(rename = "totalBytes")]
        total_bytes: Option<u64>,
    },

    /// Initializing progress update (yt-dlp is working but no download yet)
    InitializingProgress { message: String },
}

/// Download progress information from http.rs
#[derive(Clone, Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub bytes_downloaded: u64,
    pub total_bytes: Option<u64>,
    pub percent: f64,
}
