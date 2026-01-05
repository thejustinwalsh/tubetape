# Unified Dlopen FFmpeg Design for Tubetape WASM

## Overview

This document outlines the **refined unified ffmpeg architecture** for the Tubetape WASM implementation. Key changes from the original plan:

1. **All platforms use dlopen** - macOS, Linux, Windows, iOS, and Android all use the same dlopen approach (no platform-specific subprocess branching)
2. **yt-dlp is the authoritative orchestrator** - The native adapter is a transparent proxy that passes all ffmpeg args exactly as yt-dlp specifies them
3. **No hardcoded ffmpeg args** - The native side doesn't decide HOW to extract audio; yt-dlp does
4. **Single code path** - Simplifies testing, reduces bugs, and works uniformly across all platforms

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Tauri Application                             │
├──────────────────────────────────────────────────────────────────────┤
│  Frontend (WebView)                                                   │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │                    Web Worker                                 │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐         │    │
│  │  │  Pyodide    │  │ HTTP Bridge  │  │ JS Sandbox  │         │    │
│  │  │  (WASM)     │  │              │  │             │         │    │
│  │  │             │  │  Routes to   │  │  Solves     │         │    │
│  │  │  yt-dlp     │◄─┤  Native HTTP │  │  nsig via   │         │    │
│  │  │  (Python)   │  │              │  │  iframe     │         │    │
│  │  │             │  │  (reqwest)   │  │  eval()     │         │    │
│  │  │ AUTHORITY   │  │              │  │             │         │    │
│  │  │ on ffmpeg   │  └──────────────┘  └─────────────┘         │    │
│  │  │ invocation  │                                              │    │
│  │  └──────┬──────┘                                              │    │
│  │         │ ffmpeg args: ['-i', url, '-vn', '-acodec',         │    │
│  │         │                'aac', '-b:a', '192k', ...]         │    │
│  │         ▼                                                      │    │
│  └────────────────────────────────────────────────────────────┘     │
│                              │                                        │
│               ┌──────────────▼───────────────┐                      │
│               │  nativeFFmpegAdapter()       │                      │
│               │  Command: 'ffmpeg'           │                      │
│               │  Args: [all args from yt-dlp]                       │
│               └──────────────┬───────────────┘                      │
│                              │                                        │
├──────────────────────────────┼────────────────────────────────────┤
│  Rust Backend (Native)       │                                     │
│  ┌──────────────────────────▼──────────────────────────────────┐  │
│  │              dlopen_ffmpeg (Unified)                         │  │
│  │                                                               │  │
│  │  ┌──────────────────────────────────────────────┐           │  │
│  │  │ Platform-specific libname:                   │           │  │
│  │  │ - macOS: dlopen("libffmpeg.dylib")           │           │  │
│  │  │ - Linux: dlopen("libffmpeg.so")              │           │  │
│  │  │ - Windows: dlopen("libffmpeg.dll")           │           │  │
│  │  │ - iOS: dlopen("libffmpeg.dylib") [public API]│           │  │
│  │  │ - Android: dlopen("libffmpeg.so")            │           │  │
│  │  └──────────────────────────────────────────────┘           │  │
│  │                                                               │  │
│  │  ┌──────────────────────────────────────────────┐           │  │
│  │  │ Call ffmpeg_main(argc, argv[])               │           │  │
│  │  │ argv = [command, arg1, arg2, ...] from yt-dlp│           │  │
│  │  │ (NO modification, NO hardcoding)             │           │  │
│  │  └──────────────────────────────────────────────┘           │  │
│  │                                                               │  │
│  │  ┌──────────────────────────────────────────────┐           │  │
│  │  │ Return:                                      │           │  │
│  │  │ - exit_code: int                             │           │  │
│  │  │ - stdout: string (if captured)               │           │  │
│  │  │ - stderr: string (if captured)               │           │  │
│  │  └──────────────────────────────────────────────┘           │  │
│  └──────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

---

## Key Design Principles

### 1. Transparent Proxy Pattern

The native `dlopen_ffmpeg` command is a **transparent proxy**:

```
Input:  command='ffmpeg', args=['-i', 'video.mp4', '-vn', '-acodec', 'aac', '-b:a', '192k', 'audio.m4a']
        └─ All from yt-dlp
           
Processing:  dlopen("libffmpeg.dylib/so/dll")
             ffmpeg_main(argc, argv[])
             
Output: { exit_code: 0, stdout: "", stderr: "" }
        └─ Return to yt-dlp for post-processing
```

**No interpretation, no modification, no hardcoding.**

### 2. yt-dlp Remains Authority

yt-dlp decides:
- Which video format to download
- Which audio codec to use
- Audio bitrate
- Output format
- Post-processing options
- Retry logic

The native side only executes `ffmpeg_main` with the exact args yt-dlp specifies.

### 3. Single Code Path (All Platforms)

**Before (broken):**
```rust
#[cfg(target_os = "ios")]
fn run_ffmpeg_ios() { ... }

#[cfg(not(target_os = "ios"))]
fn run_ffmpeg_subprocess() { ... }  // Different logic!
```

**After (unified):**
```rust
fn run_ffmpeg_via_dlopen() {
    let lib_name = get_ffmpeg_lib_name();  // Platform-specific name only
    libc::dlopen(lib_name, ...)            // Same dlopen call everywhere
    ffmpeg_main(argc, argv)                // Same invocation everywhere
}
```

---

## Implementation Details

### TypeScript/Pyodide Side

**File: `src/wasm/worker/ffmpeg-dlopen-bridge.ts`**
```typescript
export async function nativeFFmpegAdapter(
  command: 'ffmpeg' | 'ffprobe',
  args: string[]  // All args as-is from yt-dlp, unmodified
): Promise<FFmpegResult> {
  return await invoke('dlopen_ffmpeg', { command, args });
}

// Patch yt-dlp subprocess calls
Popen.run = classmethod((cls, args, **kwargs) => {
  if args[0] in ('ffmpeg', 'ffprobe'):
    result = run_sync(nativeFFmpegAdapter(args[0], args[1:]))
    return subprocess.CompletedProcess(
      args=args,
      returncode=result['exit_code'],
      stdout=result.get('stdout', b''),
      stderr=result.get('stderr', b'')
    )
  raise FileNotFoundError(...)
})
```

### Rust Side

**File: `src-tauri/src/ffmpeg_dlopen.rs`**
```rust
/// Unified dlopen-based ffmpeg adapter for ALL platforms
#[tauri::command]
pub fn dlopen_ffmpeg(
    command: String,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    run_ffmpeg_via_dlopen(&command, args)
}

/// Platform-specific library name (only difference)
#[cfg(target_os = "macos")]
fn get_ffmpeg_lib_name() -> &'static str { "libffmpeg.dylib" }

#[cfg(target_os = "linux")]
fn get_ffmpeg_lib_name() -> &'static str { "libffmpeg.so" }

#[cfg(target_os = "windows")]
fn get_ffmpeg_lib_name() -> &'static str { "libffmpeg.dll" }

#[cfg(target_os = "ios")]
fn get_ffmpeg_lib_name() -> &'static str { "libffmpeg.dylib" }

#[cfg(target_os = "android")]
fn get_ffmpeg_lib_name() -> &'static str { "libffmpeg.so" }

/// Core dlopen implementation - IDENTICAL across all platforms
fn run_ffmpeg_via_dlopen(
    command: &str,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    unsafe {
        // Load library
        let lib_name = get_ffmpeg_lib_name();
        let lib_cstr = CString::new(lib_name)?;
        let lib = libc::dlopen(lib_cstr.as_ptr(), libc::RTLD_NOW);
        
        if lib.is_null() {
            return Err(format!("Failed to load {}: {}", lib_name, dlerror()));
        }
        
        // Get function pointer
        let func_name = if command == "ffmpeg" { "ffmpeg_main" } else { "ffprobe_main" };
        let func_cstr = CString::new(func_name)?;
        let func_ptr = libc::dlsym(lib, func_cstr.as_ptr());
        
        if func_ptr.is_null() {
            libc::dlclose(lib);
            return Err(format!("Function {} not found", func_name));
        }
        
        // Build argv from command + args (no modification)
        let ffmpeg_main: extern "C" fn(i32, *const *const c_char) -> i32 =
            std::mem::transmute(func_ptr);
        
        let mut c_args = vec![CString::new(command.as_bytes())?];
        for arg in args {
            c_args.push(CString::new(arg.as_bytes())?);
        }
        
        let argv: Vec<*const c_char> = c_args.iter().map(|s| s.as_ptr()).collect();
        
        // Call ffmpeg_main with args from yt-dlp
        let exit_code = ffmpeg_main(argv.len() as i32, argv.as_ptr());
        
        libc::dlclose(lib);
        
        Ok(FFmpegResult {
            exit_code,
            stdout: String::new(),
            stderr: String::new(),
        })
    }
}
```

---

## Advantages Over Platform-Specific Approaches

| Aspect | Platform-Specific (old) | Unified dlopen (new) |
|--------|------------------------|-----------------------|
| **Code paths** | 2 (subprocess on desktop, dlopen on iOS) | 1 (dlopen everywhere) |
| **Testing** | Test both paths separately | Test once, applies everywhere |
| **iOS compatibility** | Requires dlopen implementation | Native support |
| **arg handling** | May be hardcoded per platform | Transparent proxy to yt-dlp |
| **Maintenance** | Changes needed in multiple places | Single implementation |
| **Bug surface** | Larger (path-dependent bugs) | Smaller (consistent behavior) |
| **Future platforms** | Add new cfg blocks | Works automatically |

---

## Integration with Existing WASM Plan

This design fits seamlessly into the phased implementation:

- **Phase 1**: HTTP Bridge (unchanged)
- **Phase 2**: Pyodide Integration (unchanged)
- **Phase 3**: yt-dlp patches (unchanged, but uses new adapter)
- **Phase 4**: **dlopen FFmpeg Adapter** (this design)
  - TypeScript: `nativeFFmpegAdapter()` function
  - Rust: `dlopen_ffmpeg()` Tauri command
  - Single code path for all platforms
- **Phase 5**: JS Sandbox (unchanged)
- **Phase 6**: OTA Updates (unchanged)

---

## Backwards Compatibility

The new design is **fully compatible** with the existing HTTP bridge and Pyodide integration:

- Same `nativeFFmpegAdapter()` interface
- Same return format `{ exit_code, stdout, stderr }`
- Same patching approach in Python
- Just a more elegant native implementation

---

## Testing Strategy

### Unit Tests (Rust)
```rust
#[test]
fn test_dlopen_loads_ffmpeg() {
    let result = dlopen_ffmpeg("ffmpeg".to_string(), vec!["-version".to_string()]);
    assert!(result.is_ok());
    assert_eq!(result.unwrap().exit_code, 0);
}

#[test]
fn test_args_passed_unchanged() {
    // Args go in, args come out (no modification)
    let args = vec!["-i", "input.mp4", "-vn", "-acodec", "aac", "output.m4a"];
    // ... verify dlopen receives exact args
}
```

### Integration Tests (TypeScript/Rust)
```typescript
it('should extract audio with yt-dlp args', async () => {
    // yt-dlp specifies: extract to M4A @ 192kbps
    const result = await nativeFFmpegAdapter('ffmpeg', [
        '-i', videoUrl,
        '-vn',
        '-acodec', 'aac',
        '-b:a', '192k',
        '-ar', '44100',
        outputPath
    ]);
    
    expect(result.exit_code).toBe(0);
    // ... verify output file exists and is valid
});
```

### E2E Tests (Full Flow)
```typescript
it('should extract audio from YouTube video', async () => {
    // Pyodide/yt-dlp decides args -> dlopen executes -> audio extracted
    const audioUrl = await pyodideManager.downloadAudio(youtubeUrl, 'm4a');
    const audio = await readFile(audioUrl);
    expect(audio.length).toBeGreaterThan(0);
});
```

---

## Deployment Considerations

### Binary Distribution
The ffmpeg library must be included in the app bundle for each platform:
- macOS: `libffmpeg.dylib` in app resources
- Linux: `libffmpeg.so` in app resources or system LD_LIBRARY_PATH
- Windows: `libffmpeg.dll` in app directory
- iOS: `libffmpeg.dylib` bundled with app
- Android: `libffmpeg.so` in NDK build

### Library Naming
Use `get_ffmpeg_lib_name()` to handle platform-specific naming conventions.

### Fallback Strategy
If dlopen fails:
1. Check if library exists in expected location
2. Suggest user download ffmpeg separately
3. Log clear error message for debugging

---

## Migration Path (from current architecture)

1. **Keep existing native ffmpeg binary** for now
2. **Implement dlopen adapter** in parallel
3. **Switch Pyodide** to use new adapter
4. **Remove subprocess patch** complexity
5. **Remove platform-specific branching** in ffmpeg logic
6. **Simplify testing** to single code path

---

## Future Optimizations

1. **Streaming support**: Capture ffmpeg stdout/stderr in real-time for progress
2. **Process control**: Allow cancellation of long-running ffmpeg operations
3. **Multiple instances**: Run parallel ffmpeg operations if needed
4. **Performance monitoring**: Track dlopen/invocation timing

---

## Summary

This unified dlopen approach:
- ✅ Works on all platforms (macOS, Linux, Windows, iOS, Android)
- ✅ Keeps yt-dlp as the authority on ffmpeg invocation
- ✅ Simplifies code (single path, not platform-specific)
- ✅ Reduces bugs (less branching, consistent behavior)
- ✅ Easier to test (test once, works everywhere)
- ✅ Future-proof (new platforms automatically supported)

It's the "correct" architecture that the original plan was evolving toward.
