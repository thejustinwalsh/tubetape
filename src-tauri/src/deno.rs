use std::path::PathBuf;
use tauri::Manager;

/// Get the bundled deno path (works in both dev and production)
pub fn get_bundled_deno_path(app_handle: &tauri::AppHandle) -> Option<PathBuf> {
    #[cfg(target_os = "windows")]
    let exe_name = "deno.exe";
    #[cfg(not(target_os = "windows"))]
    let exe_name = "deno";

    // Production: only check resource directory
    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        let deno_path = resource_dir.join("binaries").join("deno").join(exe_name);
        if deno_path.exists() {
            eprintln!("[tubetape] Found bundled deno at: {:?}", deno_path);
            return Some(deno_path);
        }
    }

    // Dev mode only: check src-tauri directory
    #[cfg(debug_assertions)]
    {
        // Use app_data_dir to find project root in dev
        if let Ok(app_dir) = app_handle.path().app_data_dir() {
            if let Some(parent) = app_dir.parent() {
                if let Some(project_root) = parent.parent() {
                    let dev_path = project_root
                        .join("src-tauri")
                        .join("binaries")
                        .join("deno")
                        .join(exe_name);
                    if dev_path.exists() {
                        let canonical = std::fs::canonicalize(&dev_path).unwrap_or(dev_path);
                        eprintln!("[tubetape] Found dev deno at: {:?}", canonical);
                        return Some(canonical);
                    }
                }
            }
        }

        // Try current working directory as last resort in dev
        let cwd_path = std::env::current_dir()
            .ok()?
            .join("src-tauri")
            .join("binaries")
            .join("deno")
            .join(exe_name);
        if cwd_path.exists() {
            let canonical = std::fs::canonicalize(&cwd_path).unwrap_or(cwd_path);
            eprintln!("[tubetape] Found dev deno via cwd: {:?}", canonical);
            return Some(canonical);
        }
    }

    eprintln!("[tubetape] No deno binary found");
    None
}

/// Get the bundled deno binary
pub async fn ensure_deno_binary(
    app_handle: tauri::AppHandle,
) -> Result<PathBuf, String> {
    // Only use bundled deno - no fallbacks
    get_bundled_deno_path(&app_handle).ok_or_else(|| {
        "Deno binary is missing. Expected a bundled Deno executable in the application's resources under a 'binaries/deno' directory. Please reinstall the application or ensure the Deno binary is packaged correctly."
            .to_string()
    })
}

/// Tauri command to get deno status
#[tauri::command]
pub async fn get_deno_status(app_handle: tauri::AppHandle) -> Result<String, String> {
    if let Some(bundled) = get_bundled_deno_path(&app_handle) {
        Ok(format!("bundled: {}", bundled.display()))
    } else {
        Ok("not found".to_string())
    }
}
