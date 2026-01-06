use serde::{Deserialize, Serialize};
use std::ffi::{CStr, CString};
use std::os::raw::{c_char, c_int, c_void};
use std::path::{Path, PathBuf};
use std::ptr;
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FFmpegResult {
    pub exit_code: i32,
    pub was_aborted: bool,
    pub stdout: String,
    pub stderr: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum AudioFormat {
    Mp3,
    Aac,
    Flac,
    Wav,
    Copy,
}

impl AudioFormat {
    fn encoder_name(&self) -> &'static str {
        match self {
            AudioFormat::Mp3 => "libmp3lame",
            AudioFormat::Aac => "aac",
            AudioFormat::Flac => "flac",
            AudioFormat::Wav => "pcm_s16le",
            AudioFormat::Copy => "copy",
        }
    }

    pub fn from_extension(ext: &str) -> Self {
        match ext.to_lowercase().as_str() {
            "mp3" => AudioFormat::Mp3,
            "aac" | "m4a" => AudioFormat::Aac,
            "flac" => AudioFormat::Flac,
            "wav" => AudioFormat::Wav,
            _ => AudioFormat::Copy,
        }
    }
}

impl Default for AudioFormat {
    fn default() -> Self {
        AudioFormat::Mp3
    }
}

#[repr(C)]
struct FFmpegIOContext {
    stdin_fp: *mut c_void,
    stdout_fp: *mut c_void,
    stderr_fp: *mut c_void,
}

#[repr(C)]
struct FFmpegResultC {
    exit_code: c_int,
    was_aborted: c_int,
    error: *const c_char,
}

type FFmpegLibInit = unsafe extern "C" fn() -> c_int;
type FFmpegLibSetIO = unsafe extern "C" fn(*const FFmpegIOContext);
type FFmpegLibMain = unsafe extern "C" fn(c_int, *const *const c_char) -> FFmpegResultC;
type FFprobeLibMain = unsafe extern "C" fn(c_int, *const *const c_char) -> FFmpegResultC;
type FFmpegLibCleanup = unsafe extern "C" fn();
type FFmpegLibCancel = unsafe extern "C" fn();
type FFmpegLibIsRunning = unsafe extern "C" fn() -> c_int;
type FFmpegLibVersion = unsafe extern "C" fn() -> *const c_char;

static LIB_MUTEX: Mutex<()> = Mutex::new(());
static LIB_PATH: Mutex<Option<PathBuf>> = Mutex::new(None);

#[cfg(target_os = "macos")]
fn get_ffmpeg_lib_name() -> &'static str {
    "libffmpeg.dylib"
}

#[cfg(target_os = "linux")]
fn get_ffmpeg_lib_name() -> &'static str {
    "libffmpeg.so"
}

#[cfg(target_os = "windows")]
fn get_ffmpeg_lib_name() -> &'static str {
    "ffmpeg.dll"
}

#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
fn get_ffmpeg_lib_name() -> &'static str {
    "libffmpeg.so"
}

pub fn set_library_path(path: PathBuf) {
    if let Ok(mut guard) = LIB_PATH.lock() {
        *guard = Some(path);
    }
}

fn get_lib_path_internal() -> Option<PathBuf> {
    LIB_PATH.lock().ok().and_then(|guard| guard.clone())
}

fn get_lib_path(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    if let Some(path) = get_lib_path_internal() {
        if path.exists() {
            return Some(path);
        }
    }
    crate::binary::get_bundled_library_path(app_handle, "ffmpeg", get_ffmpeg_lib_name())
}

struct FFmpegLibrary {
    handle: *mut c_void,
    init: FFmpegLibInit,
    set_io: FFmpegLibSetIO,
    ffmpeg_main: FFmpegLibMain,
    ffprobe_main: FFprobeLibMain,
    cleanup: FFmpegLibCleanup,
    #[allow(dead_code)]
    cancel: FFmpegLibCancel,
    #[allow(dead_code)]
    is_running: FFmpegLibIsRunning,
    version: FFmpegLibVersion,
}

unsafe impl Send for FFmpegLibrary {}
unsafe impl Sync for FFmpegLibrary {}

impl FFmpegLibrary {
    unsafe fn load(lib_path: &Path) -> Result<Self, String> {
        let lib_path_str = lib_path.to_string_lossy();
        let lib_path_cstr = CString::new(lib_path_str.as_bytes()).map_err(|e| e.to_string())?;

        let handle = libc::dlopen(lib_path_cstr.as_ptr(), libc::RTLD_NOW | libc::RTLD_LOCAL);
        if handle.is_null() {
            let err = libc::dlerror();
            let err_str = if err.is_null() {
                "Unknown error".to_string()
            } else {
                CStr::from_ptr(err).to_string_lossy().to_string()
            };
            return Err(format!("Failed to dlopen FFmpeg library: {}", err_str));
        }

        let get_sym = |name: &str| -> Result<*mut c_void, String> {
            let name_cstr = CString::new(name).map_err(|e| e.to_string())?;
            let sym = libc::dlsym(handle, name_cstr.as_ptr());
            if sym.is_null() {
                return Err(format!("Symbol {} not found", name));
            }
            Ok(sym)
        };

        Ok(Self {
            handle,
            init: std::mem::transmute(get_sym("ffmpeg_lib_init")?),
            set_io: std::mem::transmute(get_sym("ffmpeg_lib_set_io")?),
            ffmpeg_main: std::mem::transmute(get_sym("ffmpeg_lib_main")?),
            ffprobe_main: std::mem::transmute(get_sym("ffprobe_lib_main")?),
            cleanup: std::mem::transmute(get_sym("ffmpeg_lib_cleanup")?),
            cancel: std::mem::transmute(get_sym("ffmpeg_lib_cancel")?),
            is_running: std::mem::transmute(get_sym("ffmpeg_lib_is_running")?),
            version: std::mem::transmute(get_sym("ffmpeg_lib_version")?),
        })
    }

    unsafe fn unload(&self) {
        if !self.handle.is_null() {
            libc::dlclose(self.handle);
        }
    }
}

fn create_temp_file() -> Result<(std::fs::File, PathBuf), String> {
    let temp_dir = std::env::temp_dir();
    let id = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = temp_dir.join(format!("ffmpeg_pipe_{}", id));
    let file = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    Ok((file, path))
}

fn run_ffmpeg_command(
    lib_path: &Path,
    command: &str,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    let _lock = LIB_MUTEX.lock().map_err(|e| e.to_string())?;

    unsafe {
        let lib = FFmpegLibrary::load(lib_path)?;

        let init_result = (lib.init)();
        if init_result != 0 {
            lib.unload();
            return Err("Failed to initialize FFmpeg library".to_string());
        }

        let (stdout_file, stdout_path) = create_temp_file()?;
        let (stderr_file, stderr_path) = create_temp_file()?;

        let stdout_mode = CString::new("w").unwrap();
        let stderr_mode = CString::new("w").unwrap();
        let stdout_path_c = CString::new(stdout_path.to_string_lossy().as_bytes()).unwrap();
        let stderr_path_c = CString::new(stderr_path.to_string_lossy().as_bytes()).unwrap();

        let stdout_fp = libc::fopen(stdout_path_c.as_ptr(), stdout_mode.as_ptr());
        let stderr_fp = libc::fopen(stderr_path_c.as_ptr(), stderr_mode.as_ptr());

        drop(stdout_file);
        drop(stderr_file);

        let io_ctx = FFmpegIOContext {
            stdin_fp: ptr::null_mut(),
            stdout_fp: stdout_fp as *mut c_void,
            stderr_fp: stderr_fp as *mut c_void,
        };
        (lib.set_io)(&io_ctx);

        let prog_name = match command {
            "ffmpeg" => "ffmpeg",
            "ffprobe" => "ffprobe",
            _ => command,
        };
        let mut c_args: Vec<CString> = vec![CString::new(prog_name).map_err(|e| e.to_string())?];
        for arg in &args {
            c_args.push(CString::new(arg.as_str()).map_err(|e| e.to_string())?);
        }

        let argv: Vec<*const c_char> = c_args.iter().map(|s| s.as_ptr()).collect();

        eprintln!(
            "[ffmpeg] Executing {} with: {}",
            prog_name,
            argv.iter()
                .map(|&arg| {
                    unsafe { CStr::from_ptr(arg).to_string_lossy().to_string() }
                })
                .collect::<Vec<String>>()
                .join(" ")
        );

        let result_c = match command {
            "ffmpeg" => (lib.ffmpeg_main)(argv.len() as c_int, argv.as_ptr()),
            "ffprobe" => (lib.ffprobe_main)(argv.len() as c_int, argv.as_ptr()),
            _ => {
                lib.unload();
                return Err(format!("Unknown command: {}", command));
            }
        };

        if !stdout_fp.is_null() {
            libc::fclose(stdout_fp);
        }
        if !stderr_fp.is_null() {
            libc::fclose(stderr_fp);
        }

        (lib.set_io)(ptr::null());

        let stdout_content = std::fs::read_to_string(&stdout_path).unwrap_or_default();
        let stderr_content = std::fs::read_to_string(&stderr_path).unwrap_or_default();

        let _ = std::fs::remove_file(&stdout_path);
        let _ = std::fs::remove_file(&stderr_path);

        (lib.cleanup)();

        let error = if result_c.error.is_null() {
            None
        } else {
            Some(CStr::from_ptr(result_c.error).to_string_lossy().to_string())
        };

        lib.unload();

        Ok(FFmpegResult {
            exit_code: result_c.exit_code,
            was_aborted: result_c.was_aborted != 0,
            stdout: stdout_content,
            stderr: stderr_content,
            error,
        })
    }
}

pub fn get_library_version(lib_path: &Path) -> Result<String, String> {
    let _lock = LIB_MUTEX.lock().map_err(|e| e.to_string())?;

    unsafe {
        let lib = FFmpegLibrary::load(lib_path)?;
        let version_ptr = (lib.version)();
        let version = if version_ptr.is_null() {
            "unknown".to_string()
        } else {
            CStr::from_ptr(version_ptr).to_string_lossy().to_string()
        };
        lib.unload();
        Ok(version)
    }
}

pub fn export_sample_direct(
    lib_path: &Path,
    input: &str,
    output: &str,
    start_time: f64,
    end_time: f64,
) -> Result<(), String> {
    let duration = end_time - start_time;
    let format = AudioFormat::from_extension(
        Path::new(output)
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("mp3"),
    );

    let args = vec![
        "-y".to_string(),
        "-i".to_string(),
        input.to_string(),
        "-ss".to_string(),
        format!("{:.6}", start_time),
        "-t".to_string(),
        format!("{:.6}", duration),
        "-vn".to_string(),
        "-acodec".to_string(),
        format.encoder_name().to_string(),
        "-q:a".to_string(),
        "2".to_string(),
        output.to_string(),
    ];

    let result = run_ffmpeg_command(lib_path, "ffmpeg", args)?;

    if result.exit_code != 0 {
        return Err(result.error.unwrap_or_else(|| {
            format!(
                "ffmpeg failed with exit code {}: {}",
                result.exit_code, result.stderr
            )
        }));
    }

    Ok(())
}

fn get_static_capabilities() -> FFmpegResult {
    let stdout = "Bitstream filters:\naac_adtstoasc\nav1_frame_merge\nav1_frame_split\nav1_metadata\nchomp\ndump_extra\ndca_core\ndv_error_marker\neac3_core\nextract_extradata\nfilter_units\nh264_metadata\nh264_mp4toannexb\nh264_redundant_pps\nhapqa_extract\nhevc_metadata\nhevc_mp4toannexb\nimxdump\nmjpeg2jpeg\nmjpegadump\nmp3decomp\nmpeg2_metadata\nmpeg4_unpack_bframes\nmov2textsub\nnoise\nnull\nopus_metadata\npcm_rechunk\npgs_frame_merge\nprores_metadata\nremove_extra\nsetts\ntext2movsub\ntrace_headers\ntruehd_core\nvp9_metadata\nvp9_raw_reorder\nvp9_superframe\nvp9_superframe_split".to_string();

    let stderr = "ffmpeg version 7.0 Copyright (c) 2000-2024 the FFmpeg developers\n  built with clang\n  configuration: --enable-shared --enable-gpl\n  libavutil      59.  8.100 / 59.  8.100\n  libavcodec     61.  3.100 / 61.  3.100\n  libavformat    61.  1.100 / 61.  1.100\n  libavfilter    10.  1.100 / 10.  1.100\n  libswscale      8.  1.100 /  8.  1.100\n  libswresample   5.  1.100 /  5.  1.100".to_string();

    FFmpegResult {
        exit_code: 0,
        was_aborted: false,
        stdout,
        stderr,
        error: None,
    }
}

#[tauri::command]
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

#[tauri::command]
pub async fn ffmpeg_export_sample(
    app_handle: tauri::AppHandle,
    input_path: String,
    output_path: String,
    start_time: f64,
    end_time: f64,
) -> Result<FFmpegResult, String> {
    let lib_path = get_lib_path(&app_handle)
        .ok_or_else(|| format!("FFmpeg library ({}) not found", get_ffmpeg_lib_name()))?;

    match export_sample_direct(&lib_path, &input_path, &output_path, start_time, end_time) {
        Ok(_) => Ok(FFmpegResult {
            exit_code: 0,
            was_aborted: false,
            stdout: String::new(),
            stderr: format!("Exported sample to {}", output_path),
            error: None,
        }),
        Err(e) => Ok(FFmpegResult {
            exit_code: 1,
            was_aborted: false,
            stdout: String::new(),
            stderr: e.clone(),
            error: Some(e),
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get_test_lib_path() -> Option<PathBuf> {
        let cwd = std::env::current_dir().ok()?;

        let dev_path = cwd
            .join("binaries")
            .join("ffmpeg")
            .join(get_ffmpeg_lib_name());
        if dev_path.exists() {
            return Some(dev_path);
        }

        let workspace_path = cwd
            .join("src-tauri")
            .join("binaries")
            .join("ffmpeg")
            .join(get_ffmpeg_lib_name());
        if workspace_path.exists() {
            return Some(workspace_path);
        }

        None
    }

    #[test]
    fn test_ffmpeg_library_loads() {
        let lib_path = match get_test_lib_path() {
            Some(p) => p,
            None => {
                eprintln!("Skipping test: FFmpeg library not found");
                return;
            }
        };

        unsafe {
            let lib = FFmpegLibrary::load(&lib_path);
            assert!(lib.is_ok(), "Failed to load library: {:?}", lib.err());

            let lib = lib.unwrap();
            lib.unload();
        }
    }

    #[test]
    fn test_ffmpeg_version() {
        let lib_path = match get_test_lib_path() {
            Some(p) => p,
            None => {
                eprintln!("Skipping test: FFmpeg library not found");
                return;
            }
        };

        let version = get_library_version(&lib_path);
        assert!(version.is_ok(), "Failed to get version: {:?}", version.err());
        assert!(!version.unwrap().is_empty());
    }

    #[test]
    fn test_ffprobe_executes() {
        let lib_path = match get_test_lib_path() {
            Some(p) => p,
            None => {
                eprintln!("Skipping test: FFmpeg library not found");
                return;
            }
        };

        let args = vec!["-hide_banner".to_string(), "-bsfs".to_string()];
        let result = run_ffmpeg_command(&lib_path, "ffprobe", args);
        assert!(result.is_ok(), "ffprobe failed: {:?}", result.err());

        let result = result.unwrap();
        assert!(
            result.stdout.contains("Bitstream filters")
                || result.stderr.contains("Bitstream filters"),
            "Expected ffprobe to list bitstream filters"
        );
    }

    #[test]
    fn test_ffmpeg_executes() {
        let lib_path = match get_test_lib_path() {
            Some(p) => p,
            None => {
                eprintln!("Skipping test: FFmpeg library not found");
                return;
            }
        };

        let result = run_ffmpeg_command(&lib_path, "ffmpeg", vec!["-version".to_string()]);
        assert!(result.is_ok(), "ffmpeg failed: {:?}", result.err());

        let result = result.unwrap();
        assert!(
            result.stderr.contains("ffmpeg") || result.stdout.contains("ffmpeg"),
            "Expected ffmpeg version info"
        );
    }

    #[test]
    fn test_audio_format_from_extension() {
        assert_eq!(AudioFormat::from_extension("mp3"), AudioFormat::Mp3);
        assert_eq!(AudioFormat::from_extension("MP3"), AudioFormat::Mp3);
        assert_eq!(AudioFormat::from_extension("aac"), AudioFormat::Aac);
        assert_eq!(AudioFormat::from_extension("m4a"), AudioFormat::Aac);
        assert_eq!(AudioFormat::from_extension("flac"), AudioFormat::Flac);
        assert_eq!(AudioFormat::from_extension("wav"), AudioFormat::Wav);
        assert_eq!(AudioFormat::from_extension("unknown"), AudioFormat::Copy);
    }

    #[test]
    fn test_audio_format_encoder_names() {
        assert_eq!(AudioFormat::Mp3.encoder_name(), "libmp3lame");
        assert_eq!(AudioFormat::Aac.encoder_name(), "aac");
        assert_eq!(AudioFormat::Flac.encoder_name(), "flac");
        assert_eq!(AudioFormat::Wav.encoder_name(), "pcm_s16le");
        assert_eq!(AudioFormat::Copy.encoder_name(), "copy");
    }
}
