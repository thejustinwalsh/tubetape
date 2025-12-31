mod audio;
mod youtube;

use serde::{Deserialize, Serialize};
use std::process::Command;
use tauri::{ipc::Channel, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoMetadata {
    pub title: String,
    pub author_name: String,
    pub author_url: String,
    pub thumbnail_url: String,
    pub video_id: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
pub enum ExtractionEvent {
    Started {
        video_id: String,
    },
    Progress {
        percent: f64,
        status: String,
    },
    AudioInfo {
        sample_rate: u32,
    },
    WaveformProgress {
        total_peaks: usize,
    },
    WaveformChunk {
        peaks: Vec<f32>,
        offset: usize,
    },
    Completed {
        audio_path: String,
        duration_secs: f64,
    },
    Error {
        message: String,
    },
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformData {
    pub peaks: Vec<f32>,
    pub duration_secs: f64,
    pub sample_rate: u32,
}

#[tauri::command]
fn validate_youtube_url(url: &str) -> Result<String, String> {
    youtube::extract_video_id(url).ok_or_else(|| "Invalid YouTube URL".to_string())
}

#[tauri::command]
async fn fetch_video_metadata(url: &str) -> Result<VideoMetadata, String> {
    youtube::fetch_oembed_metadata(url).await
}

#[tauri::command]
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

    if let Err(e) = youtube::download_audio(&url, &output_path, |progress, status| {
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
async fn get_waveform(audio_path: String) -> Result<WaveformData, String> {
    let path = std::path::PathBuf::from(&audio_path);
    audio::generate_waveform_peaks(&path, |_, _| {})
}

#[tauri::command]
async fn check_cached_audio(
    app: tauri::AppHandle,
    video_id: String,
) -> Result<Option<CachedAudioInfo>, String> {
    let output_dir = get_audio_output_dir(&app)?;
    let audio_path = output_dir.join(format!("{}.mp3", video_id));

    if audio_path.exists() {
        let (duration_secs, sample_rate) = audio::get_audio_info(&audio_path)?;
        Ok(Some(CachedAudioInfo {
            audio_path: audio_path.to_string_lossy().to_string(),
            duration_secs,
            sample_rate,
        }))
    } else {
        Ok(None)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedAudioInfo {
    pub audio_path: String,
    pub duration_secs: f64,
    pub sample_rate: u32,
}

#[tauri::command]
async fn export_sample(
    source_path: String,
    output_path: String,
    start_time: f64,
    end_time: f64,
) -> Result<String, String> {
    let duration = end_time - start_time;

    let output = Command::new("ffmpeg")
        .args([
            "-y",
            "-i",
            &source_path,
            "-ss",
            &start_time.to_string(),
            "-t",
            &duration.to_string(),
            "-acodec",
            "libmp3lame",
            "-q:a",
            "2",
            &output_path,
        ])
        .output()
        .map_err(|e| format!("Failed to run ffmpeg: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffmpeg failed: {}", stderr));
    }

    Ok(output_path)
}

fn get_audio_output_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|p| p.join("audio"))
        .map_err(|e| format!("Failed to get app data directory: {}", e))
}

#[derive(Clone, Serialize)]
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
    tauri::Builder::default()
        .manage(AppStatsState {
            system: Mutex::new(System::new_all()),
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            validate_youtube_url,
            fetch_video_metadata,
            extract_audio,
            get_waveform,
            export_sample,
            check_cached_audio,
            get_app_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
