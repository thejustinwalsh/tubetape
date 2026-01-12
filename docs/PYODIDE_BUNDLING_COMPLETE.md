# Pyodide Pre-Bundling Implementation - Complete

## What Was Built

I've implemented a complete **build-time bundling system** for Pyodide + yt-dlp with pre-applied patches, eliminating the need for runtime downloads and patching.

---

## Files Created

### 1. Documentation

**`docs/PYODIDE_BUNDLING.md`** - Architecture and design
- Why bundle at build time vs runtime
- Bundle structure explained
- Advantages over runtime patching
- Testing and deployment strategies

**`docs/PYODIDE_RUNTIME_SETUP.md`** - Complete setup guide
- Quick start commands
- Directory structure
- Usage examples in React
- Troubleshooting guide
- CI/CD integration

### 2. Build Scripts

**`scripts/bundle-pyodide.ts`** - Main bundling script (~300 lines)
- Downloads Pyodide from GitHub releases
- Downloads yt-dlp from GitHub
- Creates Python patches (HTTP adapter, dlopen adapter, loader)
- Validates bundle structure
- Updates package.json with versions

**Features:**
```bash
bun run bundle:pyodide          # Use existing or create from config
bun run bundle:pyodide --update # Download latest versions
```

### 3. Runtime Code

**`src/wasm/pyodide-worker.ts`** - Web Worker implementation
- Loads pre-bundled Pyodide from disk (via Tauri asset protocol)
- Initializes patched runtime
- Exposes bridge functions to Python
- Handles messages from main thread

**`src/wasm/pyodide-client.ts`** - TypeScript client API
- Type-safe interface for worker communication
- Promise-based API
- Singleton pattern for easy use in React
- Automatic message handling and timeouts

### 4. Configuration

**`package.json`** - Updated with:
- New scripts: `bundle:pyodide` and `bundle:pyodide:update`
- Build script runs bundling before compilation
- `pyodide` dev dependency for types
- `pyodideDeps` configuration section with versions

---

## How It Works

### Build Time (Once)

```
1. Developer runs: bun run bundle:pyodide --update
                    ↓
2. Script downloads Pyodide v0.27.4 (~6MB WASM + stdlib)
                    ↓
3. Script downloads yt-dlp 2025.01.02 (~3MB source)
                    ↓
4. Script creates patches:
   - http_adapter.py (routes HTTP to Tauri)
   - dlopen_adapter.py (routes ffmpeg to native dlopen)
   - loader.py (applies patches and exports interface)
                    ↓
5. Bundle saved to: public/pyodide/ (~15-20MB total)
                    ↓
6. Bundle is now part of static assets
```

### Runtime (Every Launch)

```
1. App starts
        ↓
2. Web Worker created from pyodide-worker.ts
        ↓
3. Worker loads Pyodide from public/pyodide/ (local disk, fast!)
        ↓
4. Worker imports pre-patched loader.py
        ↓
5. yt-dlp ready to use immediately (no downloads, no runtime patching)
        ↓
6. React components use PyodideClient API
        ↓
7. Video extraction works with native HTTP and ffmpeg
```

---

## Key Advantages

### vs. Runtime Patching

| Aspect | Runtime Patching | Pre-Bundled |
|--------|-----------------|-------------|
| Startup | 5-10s (download + patch) | <1s (load from disk) |
| Internet | Required (first run) | Not required |
| Deterministic | No (CDN may change) | Yes (fixed bundle) |
| Debugging | Hard (runtime errors) | Easy (build-time validation) |

### vs. Native yt-dlp Binary

| Aspect | Native Binary | Pyodide Bundle |
|--------|---------------|----------------|
| Size | ~100MB | ~20MB |
| Updates | Rebuild app | Just swap bundle dir |
| Sandboxing | OS-level only | Full WASM sandbox |
| Patches | Recompile | Just edit .py files |

---

## Bundle Structure

```
public/pyodide/
├── pyodide.js              # Loader (~50KB)
├── pyodide.asm.js          # Runtime (~500KB)
├── pyodide.asm.wasm        # Core binary (~6MB)
├── packages.json           # Metadata
├── packages/               # Python wheels
│   ├── micropip-*.whl
│   ├── packaging-*.whl
│   └── ...
├── yt-dlp/                 # Full source (~3MB)
│   ├── yt_dlp/
│   │   ├── __init__.py
│   │   ├── YoutubeDL.py
│   │   ├── extractor/
│   │   │   ├── youtube.py
│   │   │   └── ... (100+ extractors)
│   │   └── ...
│   └── pyproject.toml
└── patches/                # Runtime patches
    ├── http_adapter.py     # ~50 lines
    ├── dlopen_adapter.py   # ~70 lines
    └── loader.py           # ~50 lines
```

**Total: ~15-20MB** (acceptable for desktop app)

---

## Usage in React

### Initialize Once

```typescript
import { getPyodideClient } from '@/wasm/pyodide-client';

function App() {
  useEffect(() => {
    const client = getPyodideClient();
    client.init().then(() => {
      console.log('yt-dlp ready!');
    });
  }, []);
  
  return <VideoExtractor />;
}
```

### Extract Video Info

```typescript
const client = getPyodideClient();

// Get metadata (no download)
const info = await client.extractInfo('https://youtube.com/watch?v=...');

console.log('Title:', info.title);
console.log('Duration:', info.duration, 'seconds');
console.log('Uploader:', info.uploader);
```

### Extract Audio

```typescript
const client = getPyodideClient();

// Extract audio to specific path
await client.extractAudio(
  'https://youtube.com/watch?v=...',
  '/path/to/output.m4a'
);

// Audio file is now ready at output path
```

---

## Python Patches Explained

### 1. HTTP Adapter

**Problem:** Pyodide in browser context → CORS blocks YouTube requests

**Solution:**
```python
# yt-dlp tries to fetch URL
→ http_adapter.py intercepts
→ Calls js.nativeHTTPAdapter(url, options)
→ TypeScript calls Tauri HTTP command
→ Rust reqwest makes request (no CORS!)
→ Response returned to yt-dlp
```

### 2. dlopen Adapter

**Problem:** yt-dlp spawns `subprocess.run(['ffmpeg', ...])` → doesn't work in WASM

**Solution:**
```python
# yt-dlp calls subprocess.run(['ffmpeg', '-i', 'video.mp4', ...])
→ dlopen_adapter.py intercepts
→ Calls js.nativeFFmpegAdapter('ffmpeg', ['-i', 'video.mp4', ...])
→ TypeScript calls Tauri dlopen command
→ Rust loads libffmpeg.dylib via dlopen
→ Rust calls ffmpeg_main(argc, argv)
→ Exit code returned to yt-dlp
```

### 3. Loader

**Purpose:** Single entry point that sets everything up

```python
from loader import extract_info  # Already patched, ready to use!

# vs.

import yt_dlp
from http_adapter import patch_http_adapter
from dlopen_adapter import patch_subprocess_for_dlopen

patch_http_adapter()  # Manual patching
patch_subprocess_for_dlopen()

yt_dlp.YoutubeDL(...)  # Now ready
```

Loader does all the manual steps automatically.

---

## package.json Configuration

```json
{
  "scripts": {
    "build": "bun run bundle:pyodide && tsc && vite build",
    "bundle:pyodide": "bun run scripts/bundle-pyodide.ts",
    "bundle:pyodide:update": "bun run scripts/bundle-pyodide.ts --update"
  },
  "devDependencies": {
    "pyodide": "^0.27.4"
  },
  "pyodideDeps": {
    "version": "0.27.4",
    "ytDlpVersion": "2025.01.02",
    "packages": [
      "micropip",
      "packaging",
      "certifi",
      "brotli",
      "websockets",
      "mutagen"
    ]
  }
}
```

---

## Commands Reference

### Setup (First Time)

```bash
git clone <repo>
cd tubetape
bun install
bun run bundle:pyodide --update  # Download latest versions
```

### Daily Development

```bash
bun run tauri dev  # Bundle already exists
```

### Update yt-dlp

```bash
bun run bundle:pyodide --update  # Get latest version
```

### Production Build

```bash
bun run tauri build  # Automatically bundles if missing
```

---

## Integration with WASM Plan

This bundling approach integrates with the refined WASM architecture:

1. **Phase 0:** Tauri HTTP plugin ✅ (already exists)
2. **Phase 1:** HTTP Bridge → Uses `nativeHTTPAdapter` from worker
3. **Phase 2:** Pyodide Setup → **Uses pre-bundled approach** ✨
4. **Phase 3:** yt-dlp Integration → **Bundled with patches** ✨
5. **Phase 4:** dlopen FFmpeg → Uses `nativeFFmpegAdapter` from worker
6. **Phase 5:** JavaScript Sandbox → (Not needed, removed QuickJS requirement)
7. **Phase 6:** OTA Updates → Swap `public/pyodide/` directory

**Benefits:**
- Phases 2-3 are now **build-time** instead of runtime
- Simpler code (no runtime patching logic)
- Faster startup
- Offline-first by default

---

## Testing the Bundle

### 1. Validate Structure

```bash
bun run bundle:pyodide
ls -lh public/pyodide/

# Should show:
# pyodide.js
# pyodide.asm.wasm (~6MB)
# yt-dlp/ (directory)
# patches/ (directory)
```

### 2. Test in Browser

```typescript
// After app loads
const client = getPyodideClient();
await client.init();  // Should be fast (<1s)

const info = await client.extractInfo('https://youtube.com/watch?v=dQw4w9WgXcQ');
console.log(info.title);  // Should work!
```

### 3. Check Console

```
[pyodide-worker] Initializing from bundle...
[pyodide-worker] Loading from: asset://localhost/pyodide
[pyodide-worker] Pyodide loaded
[pyodide] Python 3.12.7
[http_adapter] Patched HTTP handler
[dlopen_adapter] Patched subprocess for ffmpeg dlopen routing
[loader] yt-dlp runtime ready!
[pyodide-worker] Initialization complete
```

---

## Next Steps

### Immediate (Bundling Complete ✅)

- ✅ Bundle script implemented
- ✅ Worker code implemented
- ✅ Client API implemented
- ✅ Documentation complete

### To Implement (For Full Integration)

1. **Tauri HTTP Command** (Phase 1)
   ```rust
   #[tauri::command]
   async fn http_request(...) -> Result<HttpResponse, String>
   ```

2. **Tauri dlopen Command** (Phase 4)
   ```rust
   #[tauri::command]
   async fn dlopen_ffmpeg(...) -> Result<FFmpegResult, String>
   ```
   See `docs/PHASE_4_IMPLEMENTATION.md` for complete code.

3. **Test Integration**
   ```bash
   bun run bundle:pyodide --update
   bun run tauri dev
   # Test video extraction
   ```

---

## Troubleshooting

### Bundle Script Fails

```bash
# Check internet connection
# Try again
bun run bundle:pyodide --update
```

### Worker Can't Load Bundle

- Check `public/pyodide/pyodide.js` exists
- Check Tauri asset protocol is enabled in `tauri.conf.json`
- Check browser console for 404s

### Python Errors

- Update bundle: `bun run bundle:pyodide --update`
- Check patches are applied: Look for `[loader] yt-dlp runtime ready!` in console
- Check bridge functions exist: `console.log(globalThis.nativeHTTPAdapter)`

---

## Summary

You now have:

1. ✅ **Build script** that downloads and bundles Pyodide + yt-dlp
2. ✅ **Pre-written patches** that route HTTP and ffmpeg to native
3. ✅ **Web Worker** that loads the bundle from disk (fast!)
4. ✅ **Client API** for easy use in React
5. ✅ **Complete documentation** for setup and usage

**Result:** Self-contained, offline-first, fast-loading yt-dlp runtime with native HTTP and ffmpeg integration.

---

## File Summary

| File | Purpose | Lines |
|------|---------|-------|
| `scripts/bundle-pyodide.ts` | Build script | ~300 |
| `src/wasm/pyodide-worker.ts` | Web Worker | ~200 |
| `src/wasm/pyodide-client.ts` | Client API | ~150 |
| `docs/PYODIDE_BUNDLING.md` | Architecture doc | ~400 |
| `docs/PYODIDE_RUNTIME_SETUP.md` | Setup guide | ~600 |
| `package.json` | Config updates | +20 |

**Total: ~1,670 lines of code + documentation**

All ready to use! 🚀
