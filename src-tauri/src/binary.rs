use std::path::PathBuf;
use tauri::Manager;

#[cfg(target_os = "macos")]
const FFMPEG_LIB_NAME: &str = "libffmpeg.dylib";
#[cfg(target_os = "linux")]
const FFMPEG_LIB_NAME: &str = "libffmpeg.so";
#[cfg(target_os = "windows")]
const FFMPEG_LIB_NAME: &str = "ffmpeg.dll";

pub fn setup_ffmpeg_library_path(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    let lib_path = get_bundled_library_path(app_handle, "ffmpeg", FFMPEG_LIB_NAME)?;
    let lib_dir = lib_path.parent()?;

    #[cfg(target_os = "macos")]
    {
        let current = std::env::var("DYLD_LIBRARY_PATH").unwrap_or_default();
        let lib_dir_str = lib_dir.to_string_lossy();
        let new_path = if current.is_empty() {
            lib_dir_str.to_string()
        } else {
            format!("{}:{}", lib_dir_str, current)
        };
        std::env::set_var("DYLD_LIBRARY_PATH", &new_path);
        eprintln!("[tubetape] Set DYLD_LIBRARY_PATH to include: {}", lib_dir_str);
    }

    #[cfg(target_os = "linux")]
    {
        let current = std::env::var("LD_LIBRARY_PATH").unwrap_or_default();
        let lib_dir_str = lib_dir.to_string_lossy();
        let new_path = if current.is_empty() {
            lib_dir_str.to_string()
        } else {
            format!("{}:{}", lib_dir_str, current)
        };
        std::env::set_var("LD_LIBRARY_PATH", &new_path);
        eprintln!("[tubetape] Set LD_LIBRARY_PATH to include: {}", lib_dir_str);
    }

    #[cfg(target_os = "windows")]
    {
        let current = std::env::var("PATH").unwrap_or_default();
        let lib_dir_str = lib_dir.to_string_lossy();
        let new_path = format!("{};{}", lib_dir_str, current);
        std::env::set_var("PATH", &new_path);
        eprintln!("[tubetape] Added to PATH: {}", lib_dir_str);
    }

    Some(lib_path)
}

pub fn get_ffmpeg_library_path(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    get_bundled_library_path(app_handle, "ffmpeg", FFMPEG_LIB_NAME)
}

pub fn get_bundled_binary_path(
    app_handle: &tauri::AppHandle,
    binary_dir: &str,
    binary_name: &str,
) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let exe_suffix = ".exe";
    #[cfg(not(target_os = "windows"))]
    let exe_suffix = "";

    let exe_name = format!("{}{}", binary_name, exe_suffix);

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let binary_path = resource_dir
            .join("binaries")
            .join(binary_dir)
            .join(&exe_name);
        if binary_path.exists() {
            eprintln!(
                "[tubetape] Found bundled {} at: {:?}",
                binary_name, binary_path
            );
            return Some(binary_path);
        }
    }

    #[cfg(debug_assertions)]
    {
        if let Ok(app_dir) = app_handle.path().app_data_dir() {
            if let Some(parent) = app_dir.parent() {
                if let Some(project_root) = parent.parent() {
                    let dev_path = project_root
                        .join("src-tauri")
                        .join("binaries")
                        .join(binary_dir)
                        .join(&exe_name);
                    if dev_path.exists() {
                        let canonical = std::fs::canonicalize(&dev_path).unwrap_or(dev_path);
                        eprintln!("[tubetape] Found dev {} at: {:?}", binary_name, canonical);
                        return Some(canonical);
                    }
                }
            }
        }

        let cwd_path = std::env::current_dir()
            .ok()?
            .join("src-tauri")
            .join("binaries")
            .join(binary_dir)
            .join(&exe_name);
        if cwd_path.exists() {
            let canonical = std::fs::canonicalize(&cwd_path).unwrap_or(cwd_path);
            eprintln!(
                "[tubetape] Found dev {} via cwd: {:?}",
                binary_name, canonical
            );
            return Some(canonical);
        }
    }

    eprintln!("[tubetape] No {} binary found", binary_name);
    None
}

pub fn get_bundled_qjs_path(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    get_bundled_binary_path(app_handle, "qjs", "qjs")
}

pub fn get_bundled_library_path(
    app_handle: &tauri::AppHandle,
    lib_dir: &str,
    lib_name: &str,
) -> Option<PathBuf> {
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let lib_path = resource_dir
            .join("binaries")
            .join(lib_dir)
            .join(lib_name);
        if lib_path.exists() {
            eprintln!("[tubetape] Found bundled {} at: {:?}", lib_name, lib_path);
            return Some(lib_path);
        }
    }

    #[cfg(debug_assertions)]
    {
        if let Ok(app_dir) = app_handle.path().app_data_dir() {
            if let Some(parent) = app_dir.parent() {
                if let Some(project_root) = parent.parent() {
                    let dev_path = project_root
                        .join("src-tauri")
                        .join("binaries")
                        .join(lib_dir)
                        .join(lib_name);
                    if dev_path.exists() {
                        let canonical = std::fs::canonicalize(&dev_path).unwrap_or(dev_path);
                        eprintln!("[tubetape] Found dev {} at: {:?}", lib_name, canonical);
                        return Some(canonical);
                    }
                }
            }
        }

        let cwd_path = std::env::current_dir()
            .ok()?
            .join("src-tauri")
            .join("binaries")
            .join(lib_dir)
            .join(lib_name);
        if cwd_path.exists() {
            let canonical = std::fs::canonicalize(&cwd_path).unwrap_or(cwd_path);
            eprintln!("[tubetape] Found dev {} via cwd: {:?}", lib_name, canonical);
            return Some(canonical);
        }
    }

    eprintln!("[tubetape] No {} library found", lib_name);
    None
}

pub async fn ensure_qjs_binary(app_handle: tauri::AppHandle) -> Result<PathBuf, String> {
    get_bundled_qjs_path(&app_handle).ok_or_else(|| {
        "QuickJS binary is missing. Expected a bundled qjs executable in the application's \
         resources under 'binaries/qjs' directory. Please reinstall the application or ensure \
         the QuickJS binary is packaged correctly."
            .to_string()
    })
}

#[tauri::command]
pub async fn get_qjs_status(app_handle: tauri::AppHandle) -> Result<String, String> {
    if let Some(bundled) = get_bundled_qjs_path(&app_handle) {
        Ok(format!("bundled: {}", bundled.display()))
    } else {
        Ok("not found".to_string())
    }
}

#[tauri::command]
pub async fn get_ffmpeg_status(app_handle: tauri::AppHandle) -> Result<String, String> {
    let mut status = Vec::new();

    if let Some(lib_path) = get_ffmpeg_library_path(&app_handle) {
        status.push(format!("bundled_library: {}", lib_path.display()));
        if lib_path.exists() {
            status.push("bundled_exists: true".to_string());
        } else {
            status.push("bundled_exists: false".to_string());
        }
    } else {
        status.push("bundled_library: not found".to_string());
    }

    #[cfg(target_os = "macos")]
    if let Ok(dyld_path) = std::env::var("DYLD_LIBRARY_PATH") {
        status.push(format!("DYLD_LIBRARY_PATH: {}", dyld_path));
    }

    #[cfg(target_os = "linux")]
    if let Ok(ld_path) = std::env::var("LD_LIBRARY_PATH") {
        status.push(format!("LD_LIBRARY_PATH: {}", ld_path));
    }

    Ok(status.join("\n"))
}
