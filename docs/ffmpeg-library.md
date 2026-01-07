# FFmpeg Library Integration

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ React Frontend                                                  │
│   URLInput → invoke("extract_audio", {url})                     │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Tauri IPC
┌─────────────────────▼───────────────────────────────────────────┐
│ Rust Backend (src-tauri/src/)                                   │
│   youtube.rs: #[tauri::command] extract_audio()                 │
│       └→ ffmpeg_dlopen.rs: run_ffmpeg_command()                 │
└─────────────────────┬───────────────────────────────────────────┘
                      │ dlopen / FFI
┌─────────────────────▼───────────────────────────────────────────┐
│ libffmpeg.dylib                                                 │
│   ffmpeg_lib.c  →  ffmpeg_main_internal() / ffprobe_main_internal()
│                    (patched FFmpeg with exit→longjmp)           │
└─────────────────────────────────────────────────────────────────┘
```

## Build Flow

```bash
bun run scripts/setup-ffmpeg.ts
```

1. **Fetch** - Downloads FFmpeg source from GitHub
2. **Patch** - Copies `ffmpeg_lib.c/h` to fftools, modifies `ffmpeg.c` and `ffprobe.c`:
   - Renames `main()` → `*_main_internal()`
   - Replaces `exit()` → `longjmp()` via `ffmpeg_lib_exit_handler()`
   - Injects cleanup functions to reset static globals
3. **Build** - Compiles FFmpeg as shared libs, links fftools into `libffmpeg.dylib`
4. **Output** - `src-tauri/binaries/ffmpeg/libffmpeg.dylib`

## Library Lifecycle

```
load (dlopen) → init → use (commands) → cleanup → unload (dlclose)
```

`run_ffmpeg_command()` handles the full cycle per invocation - no state persists.

## Safety Guarantees

| Operation | Safe | Behavior |
|-----------|------|----------|
| Double init | Yes | No-op (atomic guard) |
| Double cleanup | Yes | No-op (atomic guard) |
| Cleanup before init | Yes | Early return |
| Re-init after cleanup | Yes | Works (hot reload) |

## Why Cleanup Functions Exist

FFmpeg uses 50+ static globals that persist between calls. The build script injects:
- `ffmpeg_cleanup_internal()` - frees filtergraphs, files, hw devices
- `ffprobe_cleanup_internal()` - resets all `do_show_*` flags, frees buffers

Without these, second invocation crashes or produces wrong results.

## Key Files

| File | Purpose |
|------|---------|
| `src-tauri/src/ffmpeg_dlopen.rs` | Rust FFI bindings, `run_ffmpeg_command()` |
| `src-tauri/src/youtube.rs` | Tauri commands using FFmpeg |
| `scripts/patches/ffmpeg/fftools/ffmpeg_lib.c` | C wrapper (init/cleanup/main) |
| `scripts/build-ffmpeg.ts` | Build script, patching logic |

## C API

| Function | Purpose |
|----------|---------|
| `ffmpeg_lib_init()` | Initialize (idempotent) |
| `ffmpeg_lib_cleanup()` | Reset state (idempotent) |
| `ffmpeg_lib_main(argc, argv)` | Run ffmpeg command |
| `ffprobe_lib_main(argc, argv)` | Run ffprobe command |
| `ffmpeg_lib_set_io(ctx)` | Redirect stdio |
| `ffmpeg_lib_cancel()` | Request cancellation |
