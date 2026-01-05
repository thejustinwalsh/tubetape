# Phase 3.2 & 4 Implementation: dlopen FFmpeg Adapter

This document provides the exact code needed to implement the unified dlopen FFmpeg adapter.

---

## Phase 3.2: dlopen Adapter Patch (Python)

**File: `src/wasm/patches/dlopen_adapter.py`**

```python
"""
Patches subprocess calls to route ffmpeg through native dlopen adapter.

Design principle: yt-dlp remains the authoritative orchestrator.
This patch is a transparent proxy that routes all ffmpeg args as-is
to the native dlopen implementation. No hardcoding of ffmpeg args.
"""

from yt_dlp.utils import Popen
from js import nativeFFmpegAdapter
from pyodide.ffi import run_sync, to_js
import subprocess
import logging

logger = logging.getLogger('tubetape.dlopen_adapter')

def patched_popen_run(cls, args, **kwargs):
    """
    Intercept subprocess.Popen.run and route ffmpeg to native dlopen.
    
    Design: This is a TRANSPARENT PROXY
    - Input: subprocess.Popen.run(['ffmpeg', arg1, arg2, ...])
    - Action: Call native dlopen_ffmpeg(command, args)
    - Output: subprocess.CompletedProcess with exit code
    
    The native side will:
    1. Load ffmpeg via dlopen (works on all platforms)
    2. Call ffmpeg_main with all args as-is from yt-dlp
    3. Return exit code
    
    This approach:
    - Keeps yt-dlp as the authority (all args come from it)
    - Works uniformly across all platforms
    - No platform-specific subprocess vs dlopen branching needed
    """
    if not args:
        raise ValueError("No command provided")
    
    command = args[0]
    
    if command in ('ffmpeg', 'ffprobe'):
        logger.debug(f"Routing {command} to native dlopen: {args[1:]}")
        
        try:
            # Route to native dlopen adapter via Tauri invoke
            # Pass command name and all args exactly as yt-dlp specifies them
            result = run_sync(
                nativeFFmpegAdapter(
                    command,
                    to_js(list(args[1:]))  # All remaining args, unmodified
                )
            )
            
            # Convert result back to Python
            result_py = result.to_py()
            
            # Construct subprocess.CompletedProcess to return to yt-dlp
            return subprocess.CompletedProcess(
                args=args,
                returncode=result_py['exit_code'],
                stdout=result_py.get('stdout', b'') or b'',
                stderr=result_py.get('stderr', b'') or b''
            )
        
        except Exception as e:
            logger.error(f"Failed to invoke {command}: {e}")
            raise RuntimeError(f"Native {command} invocation failed: {e}")
    
    # Block other subprocess calls
    raise FileNotFoundError(
        f"Subprocess '{command}' is not available in WASM environment. "
        f"Only ffmpeg and ffprobe are supported via native adapter."
    )

# Apply patch
Popen.run = classmethod(patched_popen_run)

logger.info("dlopen adapter patch applied. ffmpeg/ffprobe calls will route to native implementation.")
```

---

## Phase 4: Unified dlopen FFmpeg Adapter (Rust)

**File: `src-tauri/src/ffmpeg_dlopen.rs`**

```rust
/// Unified dlopen-based ffmpeg adapter for all platforms.
/// 
/// This module bridges Pyodide/yt-dlp and native ffmpeg using dlopen.
/// 
/// Design principle: This is a TRANSPARENT PROXY
/// - yt-dlp passes all ffmpeg args exactly as it wants to invoke them
/// - This module loads the library and calls ffmpeg_main with those args
/// - No interpretation, no hardcoding, no modification of args
/// 
/// Supported platforms:
/// - macOS: dlopen("libffmpeg.dylib")
/// - Linux: dlopen("libffmpeg.so")  
/// - Windows: dlopen("libffmpeg.dll")
/// - iOS: dlopen("libffmpeg.dylib") - public API
/// - Android: dlopen("libffmpeg.so")

use serde::{Deserialize, Serialize};
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct FFmpegResult {
    pub exit_code: i32,
    pub stdout: String,   // May be empty if ffmpeg writes directly to files
    pub stderr: String,   // Captured error output (if any)
}

/// Main entry point: unified dlopen-based ffmpeg execution
/// 
/// # Arguments
/// * `command` - "ffmpeg" or "ffprobe"
/// * `args` - All arguments as specified by yt-dlp (unmodified)
/// 
/// # Returns
/// * `Ok(FFmpegResult)` - Contains exit code and captured output
/// * `Err(String)` - Error message describing the failure
/// 
/// # Example
/// ```
/// // yt-dlp specifies this command to extract audio
/// let result = dlopen_ffmpeg(
///     "ffmpeg".to_string(),
///     vec![
///         "-i".to_string(), "video.mp4".to_string(),
///         "-vn".to_string(),
///         "-acodec".to_string(), "aac".to_string(),
///         "-b:a".to_string(), "192k".to_string(),
///         "-ar".to_string(), "44100".to_string(),
///         "audio.m4a".to_string(),
///     ]
/// );
/// ```
#[tauri::command]
pub fn dlopen_ffmpeg(
    command: String,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    // Validate command
    if command != "ffmpeg" && command != "ffprobe" {
        return Err(format!(
            "Unsupported command: '{}'. Only 'ffmpeg' and 'ffprobe' are supported.",
            command
        ));
    }
    
    // Route to unified dlopen implementation
    run_ffmpeg_via_dlopen(&command, args)
}

/// Get the platform-specific ffmpeg library name
/// This is the ONLY place where platform differences are handled
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
    "libffmpeg.dll"
}

#[cfg(target_os = "ios")]
fn get_ffmpeg_lib_name() -> &'static str {
    "libffmpeg.dylib"
}

#[cfg(target_os = "android")]
fn get_ffmpeg_lib_name() -> &'static str {
    "libffmpeg.so"
}

/// Core dlopen implementation - IDENTICAL across all platforms
/// 
/// The only platform-specific part is `get_ffmpeg_lib_name()`.
/// Everything else is the same on macOS, Linux, Windows, iOS, and Android.
fn run_ffmpeg_via_dlopen(
    command: &str,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    unsafe {
        // Step 1: Load ffmpeg library
        let lib_name = get_ffmpeg_lib_name();
        let lib_cstr = CString::new(lib_name)
            .map_err(|e| format!("Invalid library name: {}", e))?;
        
        let lib = libc::dlopen(lib_cstr.as_ptr(), libc::RTLD_NOW);
        if lib.is_null() {
            let error = CStr::from_ptr(libc::dlerror());
            return Err(format!(
                "Failed to load '{}': {}",
                lib_name,
                error.to_string_lossy()
            ));
        }
        
        // Step 2: Get the main function (ffmpeg_main or ffprobe_main)
        let func_name = match command {
            "ffmpeg" => "ffmpeg_main",
            "ffprobe" => "ffprobe_main",
            _ => {
                libc::dlclose(lib);
                return Err("Invalid command".to_string());
            }
        };
        
        let func_cstr = CString::new(func_name)
            .map_err(|e| format!("Invalid function name: {}", e))?;
        
        let func_ptr = libc::dlsym(lib, func_cstr.as_ptr());
        if func_ptr.is_null() {
            libc::dlclose(lib);
            return Err(format!(
                "Function '{}' not found in '{}'. \
                 Is libffmpeg properly built with the expected symbols?",
                func_name, lib_name
            ));
        }
        
        // Step 3: Build argv array from command + args
        // argv[0] should be the command name (ffmpeg or ffprobe)
        // argv[1..] should be all remaining args exactly as yt-dlp specified them
        
        let mut c_args: Vec<CString> = vec![];
        
        // Add command name as argv[0]
        c_args.push(CString::new(command.as_bytes())
            .map_err(|e| format!("Invalid command string: {}", e))?);
        
        // Add all remaining args exactly as yt-dlp specified them
        // NO modification, NO interpretation, NO hardcoding
        for arg in args {
            c_args.push(CString::new(arg.as_bytes())
                .map_err(|e| format!("Invalid arg string: {}", e))?);
        }
        
        // Build argv pointer array for C code
        let argv: Vec<*const c_char> = c_args.iter()
            .map(|s| s.as_ptr())
            .collect();
        
        // Step 4: Call ffmpeg_main with all args from yt-dlp
        // Signature: int main(int argc, char *argv[])
        let ffmpeg_main: extern "C" fn(i32, *const *const c_char) -> i32 =
            std::mem::transmute(func_ptr);
        
        let exit_code = ffmpeg_main(argv.len() as i32, argv.as_ptr());
        
        // Step 5: Cleanup - close the library
        libc::dlclose(lib);
        
        // Step 6: Return result
        // Note: ffmpeg writes directly to stdout/stderr, not captured here
        // For real-time progress, would need to capture ffmpeg's output stream
        Ok(FFmpegResult {
            exit_code,
            stdout: String::new(),
            stderr: String::new(),
        })
    }
}
```

---

## Integration: Add to Tauri Command Handler

**File: `src-tauri/src/lib.rs`**

```rust
mod ffmpeg_dlopen;

// ... existing imports and setup ...

#[cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            // ... existing commands ...
            
            // Add this line:
            ffmpeg_dlopen::dlopen_ffmpeg,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

---

## TypeScript Bridge

**File: `src/wasm/worker/ffmpeg-dlopen-bridge.ts`**

```typescript
import { invoke } from '@tauri-apps/api/core';

export interface FFmpegResult {
  exit_code: number;
  stdout: string;  // May be empty if ffmpeg writes to files
  stderr: string;  // May be empty
}

/**
 * Execute ffmpeg natively via unified dlopen on all platforms.
 * 
 * This is a TRANSPARENT PROXY for yt-dlp's ffmpeg invocation:
 * - Passes all args exactly as yt-dlp specifies them
 * - Returns exit code back to yt-dlp
 * - Does NOT interpret or modify the args
 * 
 * Works identically across:
 * - macOS (dlopen libffmpeg.dylib)
 * - Linux (dlopen libffmpeg.so)
 * - Windows (dlopen libffmpeg.dll)
 * - iOS (dlopen libffmpeg.dylib via public API)
 * - Android (dlopen libffmpeg.so)
 */
export async function nativeFFmpegAdapter(
  command: 'ffmpeg' | 'ffprobe',
  args: string[]  // All args as-is from yt-dlp, unmodified
): Promise<FFmpegResult> {
  console.debug(`[ffmpeg-dlopen] Invoking ${command} with ${args.length} args`);
  
  const result = await invoke<FFmpegResult>('dlopen_ffmpeg', { command, args });
  
  console.debug(`[ffmpeg-dlopen] ${command} exited with code: ${result.exit_code}`);
  
  return result;
}

// Expose to global scope for Pyodide access
declare global {
  interface Window {
    nativeFFmpegAdapter: typeof nativeFFmpegAdapter;
  }
}

(self as any).nativeFFmpegAdapter = nativeFFmpegAdapter;
```

---

## Module Export

**File: `src/wasm/index.ts`**

Update to expose the dlopen adapter:

```typescript
// ... existing exports ...

export { nativeFFmpegAdapter } from './worker/ffmpeg-dlopen-bridge';
```

---

## How to Integrate Into Existing Plan

### Current State (Before Phase 4)
- Phase 0: ✅ Foundation (HTTP plugin config)
- Phase 1: ✅ HTTP Bridge (Rust + TypeScript)
- Phase 2: ✅ Pyodide Integration (Web Worker setup)
- Phase 3: ✅ yt-dlp Integration (HTTP + JS patches)
- Phase 3.2: ❌ subprocess Patch (needs update)
- Phase 4: ❌ FFmpeg Adapter (new dlopen implementation)

### Required Changes

1. **Phase 3.2 replacement:**
   - Delete: `src/wasm/patches/subprocess_patch.py`
   - Create: `src/wasm/patches/dlopen_adapter.py` (use code above)

2. **Phase 4 replacement:**
   - Delete: `src-tauri/src/ffmpeg_adapter.rs` (old platform-specific code)
   - Create: `src-tauri/src/ffmpeg_dlopen.rs` (use code above)
   - Update: `src-tauri/src/lib.rs` (add dlopen command to handler)
   - Create: `src/wasm/worker/ffmpeg-dlopen-bridge.ts` (use code above)

3. **Update `src-tauri/Cargo.toml`:**
   - No new dependencies needed (libc is already available)

---

## Testing

### Unit Test (Rust)
```rust
#[test]
fn test_get_ffmpeg_lib_name() {
    #[cfg(target_os = "macos")]
    assert_eq!(get_ffmpeg_lib_name(), "libffmpeg.dylib");
    
    #[cfg(target_os = "linux")]
    assert_eq!(get_ffmpeg_lib_name(), "libffmpeg.so");
    
    // ... etc for other platforms
}

#[test]
fn test_dlopen_ffmpeg_version() {
    // Test that we can load ffmpeg and query its version
    let result = dlopen_ffmpeg(
        "ffmpeg".to_string(),
        vec!["-version".to_string()]
    );
    
    assert!(result.is_ok());
    assert_eq!(result.unwrap().exit_code, 0);
}
```

### Integration Test (E2E)
```typescript
it('should extract audio using unified dlopen', async () => {
    // yt-dlp decides extraction strategy
    // Native dlopen adapter executes it transparently
    
    const videoPath = './test-video.mp4';
    const audioPath = './test-audio.m4a';
    
    const result = await nativeFFmpegAdapter('ffmpeg', [
        '-i', videoPath,
        '-vn',
        '-acodec', 'aac',
        '-b:a', '192k',
        audioPath
    ]);
    
    expect(result.exit_code).toBe(0);
    expect(await fileExists(audioPath)).toBe(true);
});
```

---

## Key Points

1. **Zero platform-specific logic** in the core implementation
2. **Transparent proxy** - no argument interpretation
3. **yt-dlp authority** - all decisions come from Python side
4. **Same code everywhere** - single `run_ffmpeg_via_dlopen()` works on all platforms
5. **Clean separation** - native side just executes, doesn't decide
