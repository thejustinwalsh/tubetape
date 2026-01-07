# Pyodide Runtime Build & Usage Guide

## Quick Start

```bash
# 1. Install dependencies (includes pyodide types)
bun install

# 2. Bundle Pyodide + yt-dlp (first time or after updates)
bun run bundle:pyodide

# 3. Run the app in development
bun run tauri dev

# 4. Build for production
bun run tauri build
```

---

## What Gets Bundled

When you run `bun run bundle:pyodide`, the script:

1. **Downloads Pyodide** (~6MB WASM runtime + core packages)
2. **Downloads yt-dlp** (~3MB Python source)
3. **Creates patches** (HTTP adapter, dlopen adapter, loader)
4. **Bundles to** `public/pyodide/` (~15-20MB total)

The bundle is then served as static assets by Tauri.

---

## Directory Structure After Bundling

```
public/pyodide/
├── pyodide.js              # Pyodide loader
├── pyodide.asm.js          # WebAssembly runtime
├── pyodide.asm.wasm        # Core WASM binary (~6MB)
├── packages.json           # Available packages metadata
├── packages/               # Python packages (.whl files)
│   ├── micropip-*.whl
│   ├── packaging-*.whl
│   └── ...
├── yt-dlp/                 # yt-dlp source
│   ├── yt_dlp/
│   │   ├── __init__.py
│   │   ├── YoutubeDL.py
│   │   ├── extractor/
│   │   └── ...
│   └── pyproject.toml
└── patches/                # Runtime patches
    ├── http_adapter.py     # Routes HTTP to Tauri
    ├── dlopen_adapter.py   # Routes ffmpeg to native dlopen
    └── loader.py           # Initialization script
```

---

## Using the Pyodide Client

### In React Components

```typescript
import { getPyodideClient } from '@/wasm/pyodide-client';

function MyComponent() {
  const [videoInfo, setVideoInfo] = useState(null);

  useEffect(() => {
    const client = getPyodideClient();
    
    // Initialize on mount
    client.init().then(() => {
      console.log('Pyodide ready!');
    });

    return () => {
      // Cleanup on unmount
      client.destroy();
    };
  }, []);

  const handleExtract = async (url: string) => {
    const client = getPyodideClient();
    
    // Extract video metadata
    const info = await client.extractInfo(url);
    setVideoInfo(info);
    
    console.log('Title:', info.title);
    console.log('Duration:', info.duration, 'seconds');
  };

  return (
    <div>
      <button onClick={() => handleExtract('https://youtube.com/watch?v=...')}>
        Extract Info
      </button>
    </div>
  );
}
```

### Extract Audio

```typescript
const client = getPyodideClient();

// Extract audio to specific path
const result = await client.extractAudio(
  'https://youtube.com/watch?v=...',
  '/path/to/output/audio.m4a'
);

console.log('Audio extracted!');
console.log('File:', result.requested_downloads[0].filepath);
```

---

## Build Scripts

### `bun run bundle:pyodide`

Creates the Pyodide bundle from versions specified in `package.json`:

```json
{
  "pyodideDeps": {
    "version": "0.27.4",
    "ytDlpVersion": "2025.01.02",
    "packages": ["micropip", "packaging", "certifi"]
  }
}
```

**Output:** Bundle created in `public/pyodide/`

### `bun run bundle:pyodide --update`

Downloads the **latest versions** of Pyodide and yt-dlp, updates `package.json`, and rebuilds bundle.

**Use this when:**
- You want the latest yt-dlp with new features/fixes
- Pyodide releases a new version
- You're setting up the project for the first time

---

## How It Works at Runtime

### 1. Worker Initialization

```typescript
// src/wasm/pyodide-worker.ts loads the bundle
const bundlePath = await convertFileSrc('/pyodide/pyodide.js');
pyodide = await loadPyodide({ indexURL: bundlePath });
```

### 2. Python Paths Setup

```python
import sys
sys.path.insert(0, '/pyodide/yt-dlp')
sys.path.insert(0, '/pyodide/patches')
```

### 3. Load Patched Runtime

```python
from loader import extract_info, prepare_filename
# Patches are automatically applied by loader.py
```

### 4. Bridge Functions Exposed

```typescript
// TypeScript → exposed to Python
globalThis.nativeHTTPAdapter = async (url, options) => { ... }
globalThis.nativeFFmpegAdapter = async (command, args) => { ... }
```

```python
# Python → calls TypeScript
import js
response = js.nativeHTTPAdapter(url, options)
```

---

## Patches Explained

### 1. HTTP Adapter (`http_adapter.py`)

**Problem:** Pyodide can't make HTTP requests directly (CORS, different origin)

**Solution:** Intercept yt-dlp's HTTP requests and route to Tauri's HTTP client

```python
# yt-dlp makes request
→ Intercepted by patch
→ Calls js.nativeHTTPAdapter(url, options)
→ TypeScript invokes Tauri command
→ Rust HTTP client makes request (no CORS)
→ Response returned to yt-dlp
```

### 2. dlopen Adapter (`dlopen_adapter.py`)

**Problem:** yt-dlp spawns ffmpeg as subprocess (doesn't work in WASM)

**Solution:** Intercept subprocess calls and route to native dlopen

```python
# yt-dlp calls subprocess.run(['ffmpeg', ...])
→ Intercepted by patch
→ Calls js.nativeFFmpegAdapter('ffmpeg', args)
→ TypeScript invokes Tauri command
→ Rust loads libffmpeg.dylib via dlopen
→ Calls ffmpeg_main(argc, argv)
→ Exit code returned to yt-dlp
```

### 3. Loader (`loader.py`)

**Purpose:** Single entry point that applies all patches and exports yt-dlp interface

```python
from loader import extract_info  # Ready to use, already patched!
```

---

## Tauri Integration Requirements

### 1. Asset Protocol (tauri.conf.json)

```json
{
  "tauri": {
    "security": {
      "assetProtocol": {
        "enable": true,
        "scope": ["**"]
      }
    }
  }
}
```

This allows the worker to load Pyodide from `public/pyodide/`.

### 2. HTTP Command (Rust)

```rust
#[tauri::command]
async fn http_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    // Use reqwest to make request
    // Return { status, headers, body }
}
```

### 3. dlopen FFmpeg Command (Rust)

```rust
#[tauri::command]
async fn dlopen_ffmpeg(
    command: String,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    // Load libffmpeg via dlopen
    // Call ffmpeg_main(argc, argv)
    // Return { exit_code, stdout, stderr }
}
```

See `docs/PHASE_4_IMPLEMENTATION.md` for full code.

---

## Version Updates

### Update yt-dlp to Latest

```bash
bun run bundle:pyodide --update
```

This will:
1. Fetch latest yt-dlp version from GitHub
2. Update `package.json` with new version
3. Rebuild bundle with latest code
4. Preserve existing patches

### Update Pyodide Core

Edit `package.json`:

```json
{
  "pyodideDeps": {
    "version": "0.28.0"  // Update this
  }
}
```

Then:

```bash
bun run bundle:pyodide --update
```

---

## Bundle Size Optimization

### Current Size (~15-20MB)

- Pyodide WASM: ~6MB
- Python stdlib: ~2MB  
- yt-dlp: ~3MB
- Packages: ~2-5MB

### Reduce Size

1. **Remove unused packages** from `pyodideDeps.packages`
2. **Strip yt-dlp extractors** you don't need (advanced)
3. **Compress with Brotli** (Tauri does this automatically)

### Size Isn't Critical

Desktop apps can be 50-100MB+. A 20MB bundle is reasonable for a self-contained yt-dlp runtime.

---

## Development Workflow

### First Time Setup

```bash
git clone <repo>
cd tubetape
bun install
bun run bundle:pyodide --update  # Get latest versions
bun run tauri dev
```

### Daily Development

```bash
# Bundle exists, just run
bun run tauri dev

# If yt-dlp needs update
bun run bundle:pyodide --update
```

### Production Build

```bash
# Bundle is automatically created by build script
bun run tauri build
```

The `build` script in `package.json` runs `bundle:pyodide` before TypeScript compilation.

---

## Testing

### Verify Bundle

```bash
bun run bundle:pyodide
ls -lh public/pyodide/

# Should show:
# pyodide.js
# pyodide.asm.wasm (~6MB)
# yt-dlp/ (directory)
# patches/ (directory)
```

### Test in Browser DevTools

```typescript
// In browser console after initializing worker
const client = getPyodideClient();
await client.init();
const info = await client.extractInfo('https://youtube.com/watch?v=dQw4w9WgXcQ');
console.log(info.title);  // "Never Gonna Give You Up"
```

### Test Patches

Check console logs:

```
[pyodide-worker] Initializing from bundle...
[pyodide] Python 3.12.x
[http_adapter] Patched HTTP handler
[dlopen_adapter] Patched subprocess for ffmpeg dlopen routing
[loader] yt-dlp runtime ready!
```

---

## Troubleshooting

### Bundle Script Fails

**Problem:** Download error or extraction fails

**Solution:**
- Check internet connection
- Verify GitHub API isn't rate-limited
- Try again with `--update` flag

### Worker Fails to Load

**Problem:** `Failed to load Pyodide`

**Solutions:**
- Check bundle exists: `ls public/pyodide/pyodide.js`
- Check Tauri asset protocol is enabled
- Check browser console for 404 errors
- Verify `convertFileSrc` is working

### Patches Not Applied

**Problem:** HTTP or ffmpeg calls fail

**Solutions:**
- Check `loader.py` is being imported
- Check bridge functions are exposed: `console.log(globalThis.nativeHTTPAdapter)`
- Check Tauri commands are registered

### yt-dlp Errors

**Problem:** Video extraction fails

**Solutions:**
- Check if URL is valid YouTube URL
- Check if yt-dlp version is recent (some extractors break)
- Update bundle: `bun run bundle:pyodide --update`
- Check yt-dlp GitHub issues for known problems

---

## CI/CD Integration

### GitHub Actions Example

```yaml
name: Build
on: [push]

jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Bun
        uses: oven-sh/setup-bun@v1
      
      - name: Install Dependencies
        run: bun install
      
      - name: Bundle Pyodide
        run: bun run bundle:pyodide
      
      - name: Build Tauri App
        run: bun run tauri build
      
      - name: Upload Bundle
        uses: actions/upload-artifact@v3
        with:
          name: tubetape-bundle
          path: src-tauri/target/release/bundle/
```

---

## Next Steps

1. ✅ Install dependencies: `bun install`
2. ✅ Create bundle: `bun run bundle:pyodide --update`
3. ⏳ Implement Tauri HTTP command (see WASM_IMPLEMENTATION_PLAN.md Phase 1)
4. ⏳ Implement Tauri dlopen command (see PHASE_4_IMPLEMENTATION.md)
5. ⏳ Test extraction in dev mode
6. ⏳ Build production bundle

---

## FAQs

**Q: Do I need to bundle every time I develop?**
A: No. Once bundled, it stays in `public/pyodide/` until you update.

**Q: Can I use yt-dlp from Python directly (not in WASM)?**
A: Yes, but you lose OTA updateability. WASM approach lets you update yt-dlp without rebuilding Tauri binary.

**Q: What if bundle is too big?**
A: 20MB is fine for desktop. If needed, you can lazy-load packages or strip unused extractors.

**Q: How do I debug Python code?**
A: Use `print()` statements - they appear in browser console. Or use Pyodide's Python debugger.

**Q: Can I add more Python packages?**
A: Yes! Add to `pyodideDeps.packages` in package.json and re-run bundle script.
