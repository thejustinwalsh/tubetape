use serde::{Deserialize, Serialize};
use std::ffi::{CStr, CString};

use std::os::raw::{c_char, c_int, c_void};
use std::path::PathBuf;
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

#[cfg(target_os = "ios")]
fn get_ffmpeg_lib_name() -> &'static str {
    "libffmpeg.dylib"
}

#[cfg(target_os = "android")]
fn get_ffmpeg_lib_name() -> &'static str {
    "libffmpeg.so"
}

fn get_lib_path(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    crate::binary::get_bundled_library_path(app_handle, "ffmpeg", get_ffmpeg_lib_name())
}

fn get_static_capabilities() -> FFmpegResult {
    let stdout = "Bitstream filters:\naac_adtstoasc\nav1_frame_merge\nav1_frame_split\nav1_metadata\nchomp\ndump_extra\ndca_core\ndv_error_marker\neac3_core\nextract_extradata\nfilter_units\nh264_metadata\nh264_mp4toannexb\nh264_redundant_pps\nhapqa_extract\nhevc_metadata\nhevc_mp4toannexb\nimxdump\nmjpeg2jpeg\nmjpegadump\nmp3decomp\nmpeg2_metadata\nmpeg4_unpack_bframes\nmov2textsub\nnoise\nnull\nopus_metadata\npcm_rechunk\npgs_frame_merge\nprores_metadata\nremove_extra\nsetts\ntext2movsub\ntrace_headers\ntruehd_core\nvp9_metadata\nvp9_raw_reorder\nvp9_superframe\nvp9_superframe_split".to_string();

    let stderr = "ffmpeg version 5.1.4 Copyright (c) 2000-2023 the FFmpeg developers\n  built with clang\n  configuration: --enable-shared --enable-gpl\n  libavutil      57. 28.100 / 57. 28.100\n  libavcodec     59. 37.100 / 59. 37.100\n  libavformat    59. 27.100 / 59. 27.100\n  libavfilter     8. 44.100 /  8. 44.100\n  libswscale      6.  7.100 /  6.  7.100\n  libswresample   4.  7.100 /  4.  7.100".to_string();

    FFmpegResult {
        exit_code: 0,
        was_aborted: false,
        stdout,
        stderr,
        error: None,
    }
}

#[allow(dead_code)]
struct FFmpegLibrary {
    handle: *mut c_void,
    init: FFmpegLibInit,
    set_io: FFmpegLibSetIO,
    ffmpeg_main: FFmpegLibMain,
    ffprobe_main: FFprobeLibMain,
    cleanup: FFmpegLibCleanup,
    cancel: FFmpegLibCancel,
    is_running: FFmpegLibIsRunning,
    version: FFmpegLibVersion,
}

unsafe impl Send for FFmpegLibrary {}
unsafe impl Sync for FFmpegLibrary {}

impl FFmpegLibrary {
    unsafe fn load(lib_path: &PathBuf) -> Result<Self, String> {
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

fn run_ffmpeg_command_new_api(
    lib_path: &PathBuf,
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

        // Use the correct program name as argv[0]
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
            "[ffmpeg_dlopen] Executing {} with {} args via library API",
            prog_name,
            argv.len() - 1
        );

        let result_c = match command {
            "ffmpeg" => (lib.ffmpeg_main)(argv.len() as c_int, argv.as_ptr()),
            "ffprobe" => (lib.ffprobe_main)(argv.len() as c_int, argv.as_ptr()),
            _ => {
                lib.unload();
                return Err(format!("Only ffmpeg and ffprobe are supported via library API, not {}", command));
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

fn run_ffmpeg_command_legacy(
    lib_path: &PathBuf,
    command: &str,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    let lib_path_str = lib_path.to_string_lossy();
    let lib_path_cstr = CString::new(lib_path_str.as_bytes()).map_err(|e| e.to_string())?;

    unsafe {
        let lib = libc::dlopen(lib_path_cstr.as_ptr(), libc::RTLD_NOW);
        if lib.is_null() {
            let err = libc::dlerror();
            let err_str = if err.is_null() {
                "Unknown error".to_string()
            } else {
                CStr::from_ptr(err).to_string_lossy().to_string()
            };
            return Err(format!("Failed to dlopen FFmpeg library: {}", err_str));
        }

        let func_name = if command == "ffmpeg" {
            "ffmpeg_main"
        } else {
            "ffprobe_main"
        };
        let func_cstr = CString::new(func_name).map_err(|e| e.to_string())?;
        let func_ptr = libc::dlsym(lib, func_cstr.as_ptr());

        if func_ptr.is_null() {
            libc::dlclose(lib);
            return Err(format!("Function {} not found in library", func_name));
        }

        let main_func: extern "C" fn(c_int, *const *const c_char) -> c_int =
            std::mem::transmute(func_ptr);

        let mut c_args = vec![CString::new(command).map_err(|e| e.to_string())?];
        for arg in args {
            c_args.push(CString::new(arg).map_err(|e| e.to_string())?);
        }

        let argv: Vec<*const c_char> = c_args.iter().map(|s| s.as_ptr()).collect();

        eprintln!(
            "[ffmpeg_dlopen] Executing {} with {} args (legacy)",
            command,
            argv.len() - 1
        );

        let exit_code = main_func(argv.len() as c_int, argv.as_ptr());

        libc::dlclose(lib);

        Ok(FFmpegResult {
            exit_code: exit_code as i32,
            was_aborted: false,
            stdout: String::new(),
            stderr: String::new(),
            error: None,
        })
    }
}

fn run_ffmpeg_command(
    lib_path: &PathBuf,
    command: &str,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    match run_ffmpeg_command_new_api(lib_path, command, args.clone()) {
        Ok(result) => Ok(result),
        Err(e) => {
            eprintln!(
                "[ffmpeg_dlopen] New API failed ({}), falling back to legacy",
                e
            );
            run_ffmpeg_command_legacy(lib_path, command, args)
        }
    }
}

#[tauri::command]
pub async fn ffprobe_capabilities(app_handle: tauri::AppHandle) -> Result<FFmpegResult, String> {
    if let Some(lib_path) = get_lib_path(&app_handle) {
        match run_ffmpeg_command(&lib_path, "ffprobe", vec!["-bsfs".to_string()]) {
            Ok(result) => return Ok(result),
            Err(e) => {
                eprintln!("[ffmpeg_dlopen] Native ffprobe failed: {}, using static", e);
            }
        }
    }

    Ok(get_static_capabilities())
}

#[tauri::command]
pub async fn dlopen_ffmpeg(
    app_handle: tauri::AppHandle,
    command: String,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    let lib_path = get_lib_path(&app_handle)
        .ok_or_else(|| format!("FFmpeg library ({}) not found", get_ffmpeg_lib_name()))?;

    run_ffmpeg_command(&lib_path, &command, args)
}

#[allow(dead_code)]
#[tauri::command]
pub async fn ffmpeg_extract_audio(
    app_handle: tauri::AppHandle,
    input_path: String,
    output_path: String,
    format: Option<String>,
) -> Result<FFmpegResult, String> {
    let lib_path = get_lib_path(&app_handle)
        .ok_or_else(|| format!("FFmpeg library ({}) not found", get_ffmpeg_lib_name()))?;

    let audio_format = format.unwrap_or_else(|| "mp3".to_string());

    let args = vec![
        "-i".to_string(),
        input_path,
        "-vn".to_string(),
        "-acodec".to_string(),
        match audio_format.as_str() {
            "mp3" => "libmp3lame",
            "aac" => "aac",
            "flac" => "flac",
            "wav" => "pcm_s16le",
            "ogg" => "libvorbis",
            _ => "copy",
        }
        .to_string(),
        "-y".to_string(),
        output_path,
    ];

    run_ffmpeg_command(&lib_path, "ffmpeg", args)
}

#[allow(dead_code)]
#[tauri::command]
pub async fn ffprobe_get_duration(
    app_handle: tauri::AppHandle,
    input_path: String,
) -> Result<f64, String> {
    let lib_path = get_lib_path(&app_handle)
        .ok_or_else(|| format!("FFmpeg library ({}) not found", get_ffmpeg_lib_name()))?;

    let args = vec![
        "-v".to_string(),
        "error".to_string(),
        "-show_entries".to_string(),
        "format=duration".to_string(),
        "-of".to_string(),
        "default=noprint_wrappers=1:nokey=1".to_string(),
        input_path,
    ];

    let result = run_ffmpeg_command(&lib_path, "ffprobe", args)?;

    result
        .stdout
        .trim()
        .parse::<f64>()
        .map_err(|e| format!("Failed to parse duration: {}", e))
}

#[tauri::command]
pub async fn execute_js_challenge(
    app_handle: tauri::AppHandle,
    code: String,
) -> Result<String, String> {
    let qjs_path = crate::binary::ensure_qjs_binary(app_handle)
        .await
        .map_err(|e| format!("QuickJS not available: {}", e))?;

    let output = std::process::Command::new(&qjs_path)
        .arg("-e")
        .arg(&code)
        .output()
        .map_err(|e| format!("Failed to execute QuickJS: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("QuickJS execution failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    Ok(stdout.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn get_test_lib_path() -> Option<PathBuf> {
        let cwd = std::env::current_dir().ok()?;

        let dev_path = cwd.join("binaries").join("ffmpeg").join(get_ffmpeg_lib_name());
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

        unsafe {
            let lib = FFmpegLibrary::load(&lib_path).unwrap();

            let version_ptr = (lib.version)();
            assert!(!version_ptr.is_null());

            let version = CStr::from_ptr(version_ptr).to_string_lossy();
            assert!(!version.is_empty());

            lib.unload();
        }
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
        print!("ffprobe stdout: {}", result.stdout);
        print!("ffprobe stderr: {}", result.stderr);

        // Check for expected output markers
        assert!(
            result.stdout.contains("Bitstream filters") || result.stderr.contains("Bitstream filters"),
            "Expected ffprobe to list bitstream filters"
        );
        // Should not print ffmpeg banner
        assert!(
            !result.stdout.contains("ffmpeg version") && !result.stderr.contains("ffmpeg version"),
            "Should not print ffmpeg banner in ffprobe output"
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
}
