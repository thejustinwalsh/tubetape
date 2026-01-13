use serde::{Deserialize, Serialize};
use specta::Type;

#[derive(Debug, Serialize, Deserialize, Clone, Type)]
#[serde(rename_all = "camelCase")]
pub struct FFmpegResult {
    pub exit_code: i32,
    pub was_aborted: bool,
    pub stdout: String,
    pub stderr: String,
    pub error: Option<String>,
}

/// Internal FFmpeg execution (not a Tauri command).
/// Used by the pipeline executor to run FFmpeg commands synchronously.
pub fn dlopen_ffmpeg_internal(command: &str, args: Vec<String>) -> Result<FFmpegResult, String> {
    let result = match command {
        "ffprobe" => crate::ffmpeg_shim::execute_ffprobe(&args),
        "ffmpeg" => crate::ffmpeg_shim::execute_ffmpeg(&args),
        _ => return Err(format!("Unknown command: {}", command)),
    };

    let error = if result.exit_code != 0 {
        Some(result.stderr.clone())
    } else {
        None
    };

    Ok(FFmpegResult {
        exit_code: result.exit_code,
        was_aborted: false,
        stdout: result.stdout,
        stderr: result.stderr,
        error,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn ffprobe_capabilities(_app_handle: tauri::AppHandle) -> Result<FFmpegResult, String> {
    let result = crate::ffmpeg_shim::execute_ffprobe(&["-bsfs".to_string()]);
    Ok(FFmpegResult {
        exit_code: result.exit_code,
        was_aborted: false,
        stdout: result.stdout,
        stderr: result.stderr,
        error: None,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn dlopen_ffmpeg(
    _app_handle: tauri::AppHandle,
    command: String,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    let result = match command.as_str() {
        "ffprobe" => crate::ffmpeg_shim::execute_ffprobe(&args),
        "ffmpeg" => crate::ffmpeg_shim::execute_ffmpeg(&args),
        _ => return Err(format!("Unknown command: {}", command)),
    };

    let error = if result.exit_code != 0 {
        Some(result.stderr.clone())
    } else {
        None
    };
    Ok(FFmpegResult {
        exit_code: result.exit_code,
        was_aborted: false,
        stdout: result.stdout,
        stderr: result.stderr,
        error,
    })
}
