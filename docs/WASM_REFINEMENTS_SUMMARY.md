# WASM Implementation Plan Refinements - Summary

## What Changed

The WASM implementation plan has been refined to use a **unified dlopen approach for ffmpeg across all platforms** with **yt-dlp as the authoritative orchestrator**. This document summarizes the key improvements.

---

## Before (Original Plan Issues)

### 1. Platform-Specific FFmpeg Logic
```rust
// Desktop: subprocess
#[cfg(not(target_os = "ios"))]
async fn run_ffmpeg_subprocess(...) { ... }

// iOS: dlopen  
#[cfg(target_os = "ios")]
async fn run_ffmpeg_ios(...) { ... }
```

**Problems:**
- Two different code paths = harder to test and maintain
- Risk of bugs that only appear on one platform
- More complex Tauri command handler
- Harder to add new platforms (Android) without more branching

### 2. Hardcoded FFmpeg Arguments
The native side was responsible for deciding HOW to extract audio:

```rust
let args = vec![
    "-i".to_string(), input_path,
    "-vn".to_string(),
    "-acodec".to_string(),
    "aac".to_string(),  // Hardcoded!
    "-b:a".to_string(), "192k".to_string(),  // Hardcoded!
    // ... more hardcoded args
];
let result = run_ffmpeg("ffmpeg".to_string(), args).await?;
```

**Problems:**
- Native code owns the extraction logic
- yt-dlp (in WASM) has no say in audio codec, bitrate, format
- Changes to extraction logic require code changes on native side
- Violates single responsibility principle

### 3. Unclear Division of Responsibilities
- yt-dlp decides WHAT to download
- Native code decides HOW to extract audio
- No clear orchestration

---

## After (Refined Plan Benefits)

### 1. Unified dlopen Across All Platforms

```rust
// Single implementation - works on all platforms
fn run_ffmpeg_via_dlopen(
    command: &str,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    unsafe {
        let lib_name = get_ffmpeg_lib_name();  // Only platform-specific part
        let lib = libc::dlopen(lib_cstr.as_ptr(), libc::RTLD_NOW);
        
        // ... load ffmpeg_main function ...
        
        let exit_code = ffmpeg_main(argv.len() as i32, argv.as_ptr());
        
        Ok(FFmpegResult {
            exit_code,
            stdout: String::new(),
            stderr: String::new(),
        })
    }
}

#[cfg(target_os = "macos")]
fn get_ffmpeg_lib_name() -> &'static str { "libffmpeg.dylib" }

#[cfg(target_os = "linux")]
fn get_ffmpeg_lib_name() -> &'static str { "libffmpeg.so" }

// ... etc for other platforms
```

**Benefits:**
- ✅ Single code path for all platforms
- ✅ Only platform difference: library name (not implementation logic)
- ✅ Easy to add new platforms (just add `#[cfg]` block for lib name)
- ✅ Same test covers all platforms

### 2. yt-dlp is the Authoritative Orchestrator

```python
# Python side (Pyodide)
def patched_popen_run(cls, args, **kwargs):
    """
    yt-dlp calls subprocess.Popen.run(['ffmpeg', '-i', 'video.mp4', ...])
    The args include ALL decisions made by yt-dlp:
    - Input source
    - Codecs
    - Bitrate
    - Quality
    - Post-processing
    """
    if args[0] in ('ffmpeg', 'ffprobe'):
        result = run_sync(nativeFFmpegAdapter(args[0], args[1:]))
        # Pass through exactly as yt-dlp specified
        return subprocess.CompletedProcess(
            args=args,
            returncode=result['exit_code'],
            stdout=result.get('stdout', b''),
            stderr=result.get('stderr', b'')
        )
```

**Benefits:**
- ✅ yt-dlp owns the extraction logic (where it belongs)
- ✅ Native side is a transparent proxy (no business logic)
- ✅ Changes to extraction strategy = just change yt-dlp code
- ✅ Clear responsibility: Pyodide makes decisions, native executes them

### 3. Transparent Proxy Pattern

```
yt-dlp: "Run ffmpeg with these args: ['-i', 'video.mp4', '-vn', '-acodec', 'aac', ...]"
        ↓
Native adapter: "Load library, get function pointer, call ffmpeg_main(argc, argv)"
        ↓
Return: { exit_code: 0 }
        ↓
yt-dlp: "Process output file, update metadata"
```

**Benefits:**
- ✅ Native side has no understanding of ffmpeg arguments
- ✅ Native side doesn't need to know about audio codecs, bitrates, etc.
- ✅ yt-dlp can change extraction strategy without touching native code
- ✅ Clean separation of concerns

---

## Comparison Table

| Aspect | Before | After |
|--------|--------|-------|
| **Code paths** | 2+ (desktop subprocess, iOS dlopen, Android?) | 1 (dlopen everywhere) |
| **Responsibility** | Split: yt-dlp + native both make decisions | Clear: yt-dlp decides, native executes |
| **Hardcoded args** | Yes (on native side) | No (transparent proxy) |
| **Testing** | Test each platform separately | Test once, works everywhere |
| **Adding new platform** | Add new #[cfg] branch with new implementation | Add new #[cfg] block with lib name |
| **Maintenance** | Multiple code paths to keep in sync | Single implementation to maintain |
| **Flexibility** | Native side limits extraction options | yt-dlp can use any extraction strategy |

---

## Implementation Structure

### TypeScript/Pyodide (src/wasm/worker/)
1. `ffmpeg-dlopen-bridge.ts` - Bridge to native dlopen adapter
2. `dlopen_adapter.py` - Patches yt-dlp subprocess calls
   - Intercepts: `subprocess.Popen.run(['ffmpeg', ...])`
   - Routes to: `nativeFFmpegAdapter(command, args)`
   - Returns: `subprocess.CompletedProcess` with exit code

### Rust/Tauri (src-tauri/src/)
1. `ffmpeg_dlopen.rs` - Unified dlopen implementation
   - `dlopen_ffmpeg(command, args)` - Main entry point
   - `get_ffmpeg_lib_name()` - Platform-specific library name only
   - `run_ffmpeg_via_dlopen()` - Core logic (identical across all platforms)

---

## Migration from Old to New

1. **Phase 3.2:** Replace `subprocess_patch.py` with `dlopen_adapter.py`
   - Same interface: patches `Popen.run`
   - New behavior: transparent proxy to native dlopen

2. **Phase 4:** Replace all platform-specific ffmpeg implementations with unified dlopen
   - Remove: `run_ffmpeg_subprocess()` (desktop)
   - Remove: `run_ffmpeg_ios()` (iOS)
   - Remove: `extract_audio_native()` (with hardcoded args)
   - Add: `run_ffmpeg_via_dlopen()` (all platforms)

3. **No changes needed** to:
   - HTTP bridge (Phase 1)
   - Pyodide loader (Phase 2)
   - JS sandbox (Phase 5)
   - OTA updates (Phase 6)

---

## Testing Simplification

**Before:**
```
✓ Test subprocess (desktop)
✓ Test dlopen (iOS)
? Test Android (new implementation)
```

**After:**
```
✓ Test dlopen (all platforms at once)
✓ Verify library names are correct per platform
```

**Why it works:**
- Single implementation path = single test path
- Platforms only differ in library name, not logic
- If it works on one platform, it works on all (same code)

---

## Document Organization

1. **WASM_ARCHITECTURE.md** - Updated with dlopen note + link
2. **WASM_UNIFIED_DLOPEN_DESIGN.md** - New document (this design)
3. **WASM_IMPLEMENTATION_PLAN.md** - Partially updated (Phase 0-3 done, Phase 4 ready for update)

---

## Key Takeaway

The refined architecture follows these principles:

1. **Unified implementation** - Same code path on all platforms
2. **Clear responsibility** - yt-dlp owns decisions, native executes
3. **Transparent proxy** - Native adapter has no business logic
4. **Minimal branching** - Only platform-specific library names, not implementations
5. **Easy to maintain** - Single code path to test and debug

This is the architecture that emerged naturally when asking: **"What's the simplest way to let yt-dlp stay in control while using native ffmpeg?"** Answer: **A transparent proxy via dlopen.**
