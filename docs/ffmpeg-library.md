# FFmpeg Library Integration

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Pyodide Worker (src/wasm/pyodide-worker.ts)                     │
│   subprocess.run(['ffmpeg', ...]) intercepted                   │
│       └→ nativeFFmpegAdapter() → invokeTauri('dlopen_ffmpeg')   │
└─────────────────────┬───────────────────────────────────────────┘
                      │ Tauri IPC
┌─────────────────────▼───────────────────────────────────────────┐
│ Rust Backend (src-tauri/src/)                                   │
│   ffmpeg.rs: dlopen_ffmpeg() / ffprobe_capabilities()           │
│       └→ ffmpeg_shim.rs: execute_ffmpeg() / execute_ffprobe()   │
│           └→ ffmpeg_runtime.rs: FFmpegFunctions (direct API)    │
└─────────────────────┬───────────────────────────────────────────┘
                      │ dlopen / FFI
┌─────────────────────▼───────────────────────────────────────────┐
│ FFmpeg Shared Libraries                                         │
│   libavformat.dylib, libavcodec.dylib,                          │
│   libavutil.dylib, libswresample.dylib                          │
│   (standard FFmpeg build, no patching required)                 │
└─────────────────────────────────────────────────────────────────┘
```

## Build Flow

```bash
bun run scripts/setup-ffmpeg.ts
```

1. **Fetch** - Downloads FFmpeg and LAME sources
2. **Build LAME** - Compiles LAME as a static library with MP3 encoding support
3. **Build FFmpeg** - Compiles FFmpeg as shared libraries with LAME linked in:
   - `libavutil.dylib`
   - `libswresample.dylib`
   - `libavcodec.dylib`
   - `libavformat.dylib`
4. **Fix paths** - Updates library install names to use `@loader_path` (macOS) or `$ORIGIN` (Linux)
5. **Output** - `src-tauri/binaries/ffmpeg/`

## How It Works

Instead of patching FFmpeg's `main()` function, we use **dlopen** to load FFmpeg's shared libraries and call the C API functions directly:

### Library Loading (ffmpeg_runtime.rs)

```rust
// Load libraries in dependency order
let avutil = Library::new("libavutil.dylib")?;
let swresample = Library::new("libswresample.dylib")?;
let avcodec = Library::new("libavcodec.dylib")?;
let avformat = Library::new("libavformat.dylib")?;

// Get function pointers
let functions = FFmpegFunctions {
    avformat_open_input: *avformat.get(b"avformat_open_input\0")?,
    avcodec_find_encoder_by_name: *avcodec.get(b"avcodec_find_encoder_by_name\0")?,
    // ... 40+ more functions
};
```

### Command Shim (ffmpeg_shim.rs)

The shim parses FFmpeg-style command-line arguments and translates them to direct API calls:

```rust
// ffmpeg -i input.mp4 -vn -c:a copy output.aac
// becomes:
let cmd = FfmpegRemux {
    input: "input.mp4",
    output: "output.aac",
    audio_codec: AudioCodec::Copy,
    no_video: true,
    ...
};
// Then calls avformat_open_input(), av_read_frame(), etc.
```

### Supported Operations

| Operation | Implementation |
|-----------|----------------|
| Audio remux (copy) | Direct packet copying via av_read_frame/av_interleaved_write_frame |
| Audio transcode | Decode → resample → encode via avcodec/swresample APIs |
| ffprobe streams | avformat_open_input + avformat_find_stream_info |
| ffprobe -bsfs | Static capability list |

## Key Files

| File | Purpose |
|------|---------|
| `src-tauri/src/ffmpeg_runtime.rs` | dlopen loader, FFmpegFunctions struct, AudioFile reader, export_sample() |
| `src-tauri/src/ffmpeg_shim.rs` | CLI argument parser, remux/transcode logic |
| `src-tauri/src/ffmpeg.rs` | Tauri commands: dlopen_ffmpeg, ffprobe_capabilities |
| `scripts/build-ffmpeg.ts` | Build script (no patching, just configure/make) |
| `src/wasm/pyodide-worker.ts` | Intercepts subprocess.run(['ffmpeg', ...]) calls |

## Rust API

### FFmpegFunctions

All FFmpeg C API functions are accessed through the `FFmpegFunctions` struct:

```rust
let ff = get_ffmpeg()?;

// Open input file
let mut ctx: *mut AVFormatContext = null_mut();
(ff.avformat_open_input)(&mut ctx, path, null(), null_mut());

// Find audio stream
let stream_idx = (ff.av_find_best_stream)(ctx, AVMEDIA_TYPE_AUDIO, -1, -1, &mut decoder, 0);

// Read/write packets
while (ff.av_read_frame)(ctx, packet) >= 0 {
    (ff.av_interleaved_write_frame)(out_ctx, packet);
}
```

### High-Level Functions

| Function | Purpose |
|----------|---------|
| `get_ffmpeg()` | Get FFmpegFunctions (loads libraries on first call) |
| `ffmpeg_version()` | Get version string |
| `AudioFile::open(path)` | Open audio file, get metadata |
| `export_sample(input, output, start, end)` | Export audio segment with transcoding |

## Tauri Commands

| Command | Purpose |
|---------|---------|
| `dlopen_ffmpeg(command, args)` | Execute ffmpeg/ffprobe with CLI-style args |
| `ffprobe_capabilities()` | Get bitstream filter list and version |

## Why Direct API Instead of Patched Main

1. **No source patching** - Standard FFmpeg build, easier to update
2. **No longjmp hacks** - Clean error handling via return codes
3. **No static global issues** - Each operation is self-contained
4. **Better control** - Can intercept at any point, add progress callbacks
5. **Smaller binary** - Only link needed libraries, not full ffmpeg binary
