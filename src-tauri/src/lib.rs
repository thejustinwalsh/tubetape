mod audio;
mod beat_detection;
mod binary;
mod ffmpeg;
mod ffmpeg_runtime;
mod ffmpeg_shim;
mod http;
mod pipeline;
mod youtube;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{ipc::Channel, Manager};
use tauri_specta::{collect_commands, collect_events, Builder, Event};
use tokio::sync::{mpsc, Mutex as TokioMutex};

/// Global app notification event for typesafe event communication
#[derive(Clone, Serialize, Deserialize, Type, Event)]
#[serde(rename_all = "camelCase")]
pub struct AppNotification {
    pub level: NotificationLevel,
    pub message: String,
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum NotificationLevel {
    Info,
    Warning,
    Error,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub title: String,
    pub author_name: String,
    pub author_url: String,
    pub thumbnail_url: String,
    pub video_id: String,
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum ExtractionEvent {
    Started {
        #[serde(rename = "videoId")]
        video_id: String,
    },
    Progress {
        percent: f64,
        status: String,
    },
    AudioInfo {
        #[serde(rename = "sampleRate")]
        sample_rate: u32,
    },
    WaveformProgress {
        #[serde(rename = "totalPeaks")]
        total_peaks: usize,
    },
    WaveformChunk {
        peaks: Vec<f32>,
        offset: usize,
    },
    BeatInfo {
        bpm: f32,
        #[serde(rename = "bpmConfidence")]
        bpm_confidence: f32,
        beats: Vec<f64>,
        onsets: Vec<f64>,
    },
    Completed {
        #[serde(rename = "audioPath")]
        audio_path: String,
        #[serde(rename = "durationSecs")]
        duration_secs: f64,
    },
    Error {
        message: String,
    },
}

#[derive(Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct WaveformData {
    pub peaks: Vec<f32>,
    pub duration_secs: f64,
    pub sample_rate: u32,
}

#[tauri::command]
#[specta::specta]
fn validate_youtube_url(url: &str) -> Result<String, String> {
    youtube::extract_video_id(url).ok_or_else(|| "Invalid YouTube URL".to_string())
}

#[tauri::command]
#[specta::specta]
async fn fetch_video_metadata(url: &str) -> Result<VideoMetadata, String> {
    youtube::fetch_oembed_metadata(url).await
}

#[tauri::command]
#[specta::specta]
async fn extract_audio(
    app: tauri::AppHandle,
    url: String,
    on_event: Channel<ExtractionEvent>,
) -> Result<String, String> {
    let video_id =
        youtube::extract_video_id(&url).ok_or_else(|| "Invalid YouTube URL".to_string())?;

    println!("[tubetape] Starting extraction for video: {}", video_id);

    let output_dir = get_audio_output_dir(&app)?;
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    let output_path = output_dir.join(format!("{}.mp3", video_id));
    println!("[tubetape] Output path: {:?}", output_path);

    let _ = on_event.send(ExtractionEvent::Started {
        video_id: video_id.clone(),
    });

    let qjs_path = match binary::ensure_qjs_binary(app.clone()).await {
        Ok(path) => {
            println!("[tubetape] QuickJS available at: {:?}", path);
            Some(path)
        }
        Err(e) => {
            println!("[tubetape] QuickJS not available: {}, continuing without it", e);
            None
        }
    };

    if let Err(e) = youtube::download_audio(&url, &output_path, qjs_path, |progress, status| {
        let _ = on_event.send(ExtractionEvent::Progress {
            percent: progress,
            status: status.to_string(),
        });
    })
    .await
    {
        println!("[tubetape] Download error: {}", e);
        let _ = on_event.send(ExtractionEvent::Error { message: e.clone() });
        return Err(e);
    }

    println!(
        "[tubetape] Download complete, checking file exists: {}",
        output_path.exists()
    );

    let (duration_secs, sample_rate) = audio::get_audio_info(&output_path)?;
    let expected_peaks = audio::estimate_peak_count(duration_secs, sample_rate);
    
    println!(
        "[tubetape] Audio info: {} seconds, {} Hz sample rate, expecting ~{} peaks",
        duration_secs, sample_rate, expected_peaks
    );

    let _ = on_event.send(ExtractionEvent::Progress {
        percent: 0.0,
        status: "Generating waveform...".to_string(),
    });

    let _ = on_event.send(ExtractionEvent::AudioInfo { sample_rate });
    let _ = on_event.send(ExtractionEvent::WaveformProgress {
        total_peaks: expected_peaks,
    });

    let on_event_clone = on_event.clone();
    let waveform = match audio::generate_waveform_peaks(&output_path, move |peaks, offset| {
        if let Err(e) = on_event_clone.send(ExtractionEvent::WaveformChunk {
            peaks: peaks.to_vec(),
            offset,
        }) {
            eprintln!("[tubetape] Failed to send waveform chunk event: {}", e);
        }
    }) {
        Ok(w) => {
            println!(
                "[tubetape] Waveform generated: {} peaks, {} seconds",
                w.peaks.len(),
                w.duration_secs
            );

            w
        }
        Err(e) => {
            println!("[tubetape] Waveform error: {}", e);
            let _ = on_event.send(ExtractionEvent::Error { message: e.clone() });
            return Err(e);
        }
    };

    // Beat detection
    let _ = on_event.send(ExtractionEvent::Progress {
        percent: 0.0,
        status: "Analyzing beats and tempo...".to_string(),
    });

    match beat_detection::analyze_beats(&output_path) {
        Ok(beat_info) => {
            println!(
                "[tubetape] Beat analysis complete: {:.1} BPM (confidence: {:.2}), {} beats, {} onsets",
                beat_info.bpm,
                beat_info.bpm_confidence,
                beat_info.beats.len(),
                beat_info.onsets.len()
            );
            let _ = on_event.send(ExtractionEvent::BeatInfo {
                bpm: beat_info.bpm,
                bpm_confidence: beat_info.bpm_confidence,
                beats: beat_info.beats,
                onsets: beat_info.onsets,
            });
        }
        Err(e) => {
            // Beat detection failure is non-fatal, log and continue
            eprintln!("[tubetape] Beat detection failed (non-fatal): {}", e);
        }
    }

    let audio_path_str = output_path.to_string_lossy().to_string();
    println!(
        "[tubetape] Sending completed event with path: {}",
        audio_path_str
    );

    let _ = on_event.send(ExtractionEvent::Completed {
        audio_path: audio_path_str.clone(),
        duration_secs: waveform.duration_secs,
    });

    println!("[tubetape] Extraction complete!");
    Ok(audio_path_str)
}

#[tauri::command]
#[specta::specta]
async fn get_waveform(audio_path: String) -> Result<WaveformData, String> {
    let path = std::path::PathBuf::from(&audio_path);
    audio::generate_waveform_peaks(&path, |_, _| {})
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum WaveformEvent {
    Started {
        #[serde(rename = "audioPath")]
        audio_path: String,
    },
    AudioInfo {
        #[serde(rename = "sampleRate")]
        sample_rate: u32,
        #[serde(rename = "durationSecs")]
        duration_secs: f64,
    },
    Progress {
        #[serde(rename = "totalPeaks")]
        total_peaks: usize,
    },
    Chunk {
        peaks: Vec<f32>,
        offset: usize,
    },
    Completed {
        peaks: Vec<f32>,
        #[serde(rename = "durationSecs")]
        duration_secs: f64,
    },
    Error {
        message: String,
    },
}

#[tauri::command]
#[specta::specta]
async fn generate_waveform_stream(
    audio_path: String,
    on_event: Channel<WaveformEvent>,
) -> Result<WaveformData, String> {
    let path = std::path::PathBuf::from(&audio_path);
    
    let _ = on_event.send(WaveformEvent::Started {
        audio_path: audio_path.clone(),
    });

    let (duration_secs, sample_rate) = audio::get_audio_info(&path)?;
    let expected_peaks = audio::estimate_peak_count(duration_secs, sample_rate);

    let _ = on_event.send(WaveformEvent::AudioInfo {
        sample_rate,
        duration_secs,
    });
    
    let _ = on_event.send(WaveformEvent::Progress {
        total_peaks: expected_peaks,
    });

    let on_event_clone = on_event.clone();
    let waveform = audio::generate_waveform_peaks(&path, move |peaks, offset| {
        let _ = on_event_clone.send(WaveformEvent::Chunk {
            peaks: peaks.to_vec(),
            offset,
        });
    })?;

    let _ = on_event.send(WaveformEvent::Completed {
        peaks: waveform.peaks.clone(),
        duration_secs: waveform.duration_secs,
    });

    Ok(waveform)
}

#[tauri::command]
#[specta::specta]
async fn check_cached_audio(
    app: tauri::AppHandle,
    video_id: String,
) -> Result<Option<CachedAudioInfo>, String> {
    let output_dir = get_audio_output_dir(&app)?;
    
    for ext in ["aac", "m4a", "mp3"] {
        let audio_path = output_dir.join(format!("{}.{}", video_id, ext));
        if audio_path.exists() {
            let (duration_secs, sample_rate) = audio::get_audio_info(&audio_path)?;
            return Ok(Some(CachedAudioInfo {
                audio_path: audio_path.to_string_lossy().to_string(),
                duration_secs,
                sample_rate,
            }));
        }
    }
    
    Ok(None)
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CachedAudioInfo {
    pub audio_path: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
}

#[tauri::command]
#[specta::specta]
async fn export_sample(
    _app: tauri::AppHandle,
    source_path: String,
    output_path: String,
    start_time: f64,
    end_time: f64,
) -> Result<String, String> {
    let source = std::path::PathBuf::from(&source_path);
    let output = std::path::PathBuf::from(&output_path);
    ffmpeg_runtime::export_sample(&source, &output, start_time, end_time)?;
    Ok(output_path)
}

fn get_audio_output_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("audio"))
        .map_err(|e| format!("Failed to get app data directory: {}", e))
}

#[tauri::command]
#[specta::specta]
async fn analyze_audio_beats(audio_path: String) -> Result<beat_detection::BeatInfo, String> {
    let path = std::path::PathBuf::from(&audio_path);
    beat_detection::analyze_beats(&path)
}

/// Process an existing audio file (waveform + beat detection).
/// Used when audio is already downloaded (e.g., from cache).
#[tauri::command]
#[specta::specta]
async fn process_audio(
    audio_path: String,
    on_event: Channel<pipeline::PipelineEvent>,
) -> Result<pipeline::PipelineResult, String> {
    let path = std::path::PathBuf::from(&audio_path);
    let executor = pipeline::PipelineExecutor::for_existing_audio(path, on_event);
    executor.execute().await
}

// ============================================================================
// Unified Pipeline Commands
// ============================================================================

/// State wrapper for the pipeline command sender.
/// This allows the frontend to send commands to a running pipeline.
struct PipelineCommandSender {
    sender: TokioMutex<Option<mpsc::Sender<pipeline::PipelineCommand>>>,
}

impl PipelineCommandSender {
    fn new() -> Self {
        Self {
            sender: TokioMutex::new(None),
        }
    }
}

/// Start the unified pipeline for fetching and processing audio.
///
/// This command:
/// 1. Emits `RequestExtraction` for the frontend to run Pyodide/yt-dlp
/// 2. Waits for extraction progress/completion via `pipeline_notify`
/// 3. Runs FFmpeg commands for audio conversion
/// 4. Runs waveform + beat detection in parallel
/// 5. Reports unified progress throughout
#[tauri::command]
#[specta::specta]
async fn run_pipeline(
    app: tauri::AppHandle,
    url: String,
    on_event: Channel<pipeline::PipelineEvent>,
    state: tauri::State<'_, PipelineCommandSender>,
) -> Result<pipeline::PipelineResult, String> {
    let video_id =
        youtube::extract_video_id(&url).ok_or_else(|| "Invalid YouTube URL".to_string())?;

    let output_dir = get_audio_output_dir(&app)?;
    std::fs::create_dir_all(&output_dir)
        .map_err(|e| format!("Failed to create output directory: {}", e))?;

    let output_path = output_dir.join(format!("{}.aac", video_id));

    println!(
        "[pipeline] Starting pipeline for {} -> {:?}",
        video_id, output_path
    );

    // Create command channel for frontend → pipeline communication
    let (command_tx, command_rx) = mpsc::channel::<pipeline::PipelineCommand>(32);

    // Store sender in state so frontend can send commands via pipeline_notify
    {
        let mut sender_guard = state.sender.lock().await;
        *sender_guard = Some(command_tx);
    }

    // Create and run the pipeline
    let executor = pipeline::PipelineExecutor::new(url, output_path, on_event, command_rx);

    let result = executor.run().await;

    // Clear the sender when done
    {
        let mut sender_guard = state.sender.lock().await;
        *sender_guard = None;
    }

    result
}

/// Send a command to the running pipeline.
///
/// Used by the frontend to:
/// - Report extraction progress (`DownloadProgress`)
/// - Signal extraction completion (`ExtractionComplete`)
/// - Signal extraction failure (`ExtractionFailed`)
#[tauri::command]
#[specta::specta]
async fn pipeline_notify(
    state: tauri::State<'_, PipelineCommandSender>,
    command: pipeline::PipelineCommand,
) -> Result<(), String> {
    let sender_guard = state.sender.lock().await;

    if let Some(sender) = sender_guard.as_ref() {
        sender
            .send(command)
            .await
            .map_err(|e| format!("Failed to send pipeline command: {}", e))
    } else {
        Err("No pipeline is currently running".to_string())
    }
}

#[derive(Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AppStats {
    pub cache_size_mb: f64,
    pub memory_usage_mb: f64,
}

use std::sync::Mutex;
use sysinfo::{Pid, System};

struct AppStatsState {
    system: Mutex<System>,
}

#[tauri::command]
#[specta::specta]
async fn get_app_stats(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppStatsState>,
) -> Result<AppStats, String> {
    // Get cache size
    let output_dir = get_audio_output_dir(&app)?;
    let mut total_size: u64 = 0;

    if output_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&output_dir) {
            for entry in entries {
                if let Ok(entry) = entry {
                    if let Ok(metadata) = entry.metadata() {
                        if metadata.is_file() {
                            total_size += metadata.len();
                        }
                    }
                }
            }
        }
    }

    // Get memory usage using persistent system state
    let mut sys = state.system.lock().map_err(|e| e.to_string())?;
    sys.refresh_memory();
    sys.refresh_processes();

    let pid = Pid::from(std::process::id() as usize);
    let memory_usage = if let Some(process) = sys.process(pid) {
        process.memory()
    } else {
        0
    };

    Ok(AppStats {
        cache_size_mb: total_size as f64 / 1024.0 / 1024.0,
        memory_usage_mb: memory_usage as f64 / 1024.0 / 1024.0,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            validate_youtube_url,
            fetch_video_metadata,
            extract_audio,
            get_waveform,
            generate_waveform_stream,
            export_sample,
            check_cached_audio,
            get_app_stats,
            analyze_audio_beats,
            process_audio,
            run_pipeline,
            pipeline_notify,
            binary::get_qjs_status,
            binary::get_ffmpeg_status,
            http::http_request,
            http::download_to_file,
            http::download_to_file_with_progress,
            ffmpeg::dlopen_ffmpeg,
            ffmpeg::ffprobe_capabilities,
        ])
        .events(collect_events![AppNotification]);

    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default()
                .bigint(specta_typescript::BigIntExportBehavior::Number),
            "../src/bindings.ts",
        )
        .expect("Failed to export TypeScript bindings");

    tauri::Builder::default()
        .manage(AppStatsState {
            system: Mutex::new(System::new_all()),
        })
        .manage(PipelineCommandSender::new())
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);

            if let Some(lib_path) = binary::get_ffmpeg_library_path(app.handle()) {
                println!("[tubetape] FFmpeg library found: {:?}", lib_path);
                if let Some(lib_dir) = lib_path.parent() {
                    ffmpeg_runtime::set_library_directory(lib_dir.to_path_buf());
                }
            } else {
                eprintln!("[tubetape] WARNING: FFmpeg library not found - audio export will fail");
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
