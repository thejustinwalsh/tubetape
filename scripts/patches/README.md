# Python Patches for Pyodide Bundle

This directory contains Python patches that are applied to the yt-dlp runtime in Pyodide.

## Files

### `http_adapter.py`
**Purpose:** Intercepts HTTP requests from yt-dlp and routes them to the native Tauri HTTP client.

**Why:** Pyodide runs in a browser context with CORS restrictions. By routing requests through Tauri's native HTTP client, we bypass CORS and can fetch YouTube data without restrictions.

**How it works:**
1. Patches `yt_dlp.networking` to insert a custom `NativeRequestHandler`
2. When yt-dlp makes an HTTP request, it calls `js.nativeHTTPAdapter()`
3. The TypeScript worker receives the call and invokes Tauri's `http_request` command
4. Rust's reqwest makes the actual HTTP request (no CORS)
5. Response is returned to yt-dlp

### `dlopen_adapter.py`
**Purpose:** Intercepts subprocess calls to ffmpeg/ffprobe and routes them to the native dlopen adapter.

**Why:** Pyodide cannot spawn subprocesses. yt-dlp normally calls ffmpeg as a subprocess for audio extraction, which won't work in WASM.

**How it works:**
1. Patches `subprocess.Popen.run` to intercept calls to ffmpeg/ffprobe
2. When yt-dlp tries to run `subprocess.run(['ffmpeg', ...])`, it calls `js.nativeFFmpegAdapter()`
3. The TypeScript worker receives the call and invokes Tauri's `dlopen_ffmpeg` command
4. Rust loads libffmpeg.dylib via dlopen and calls `ffmpeg_main(argc, argv)`
5. Exit code and output are returned as a `subprocess.CompletedProcess` object

### `loader.py`
**Purpose:** Entry point that applies all patches and exports the yt-dlp interface.

**Why:** Instead of manually patching every time, we have a single loader that:
- Sets up Python paths
- Imports and applies all patches
- Exports a ready-to-use interface

**How it works:**
1. Adds patches and yt-dlp to `sys.path`
2. Imports `patch_http_adapter()` and `patch_subprocess_for_dlopen()`
3. Applies both patches
4. Exports convenience functions: `extract_info()`, `prepare_filename()`

## Usage

These files are automatically copied to `public/pyodide/patches/` by the bundle script.

At runtime, the Pyodide worker loads them:

```typescript
// In pyodide-worker.ts
await pyodide.runPythonAsync(`
  from loader import extract_info
  # yt-dlp is now patched and ready to use!
`);
```

## Maintenance

To modify how yt-dlp interacts with native code:

1. **Edit the appropriate patch file here** in `scripts/patches/`
2. Run `bun run bundle:yt-dlp` to copy updated patches to bundle
3. Test with `bun run tauri dev`

**Do not** edit patches in `public/pyodide/patches/` - those are generated files.

## Integration Points

### TypeScript Bridge Functions
These must be exposed on `globalThis` for Python to call:

```typescript
globalThis.nativeHTTPAdapter = async (url, options) => { ... }
globalThis.nativeFFmpegAdapter = async (command, args) => { ... }
```

### Tauri Commands
These must be registered in `src-tauri/src/lib.rs`:

```rust
.invoke_handler(tauri::generate_handler![
    http_request,      // For http_adapter.py
    dlopen_ffmpeg,     // For dlopen_adapter.py
    ...
])
```

## Testing

To verify patches work:

1. Bundle yt-dlp: `bun run bundle:yt-dlp`
2. Run dev mode: `bun run tauri dev`
3. Check console for patch confirmation:
   ```
   [http_adapter] Patched HTTP handler
   [dlopen_adapter] Patched subprocess for ffmpeg dlopen routing
   [loader] yt-dlp runtime ready!
   ```
4. Test video extraction - should work without errors
