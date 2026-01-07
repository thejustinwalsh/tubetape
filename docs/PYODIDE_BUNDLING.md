# Pyodide + yt-dlp Bundling Strategy

## Overview

Instead of downloading Pyodide and yt-dlp at runtime and patching on-the-fly, we **pre-bundle everything at build time** and load the patched runtime from disk.

This approach:
- ✅ **Faster startup** - No downloads or runtime patching
- ✅ **Offline-first** - Works without internet connection
- ✅ **Deterministic** - Same bundle every time
- ✅ **Smaller footprint** - Only bundle what we need
- ✅ **Self-contained** - No external dependencies at runtime

---

## Architecture

### Build Time (bun script)

```
1. Download Pyodide distribution (with packages)
2. Download yt-dlp (as Python package)
3. Create patches directory with:
   - HTTP adapter (requests interceptor)
   - dlopen adapter (subprocess interceptor)
   - Any other runtime patches
4. Bundle everything into a single directory
5. Create a loader script that:
   - Initializes Pyodide
   - Installs yt-dlp
   - Applies all patches
   - Exports ready-to-use interface
```

### Runtime (Web Worker)

```
1. Load pre-bundled Pyodide from disk (via Tauri asset protocol)
2. Import pre-patched modules
3. Use yt-dlp immediately (no setup delay)
```

---

## Bundle Structure

```
public/pyodide/
├── pyodide.js              # Main Pyodide loader
├── pyodide.asm.js          # WebAssembly/asm.js runtime
├── pyodide.asm.wasm        # WebAssembly binary
├── packages.json           # Available packages metadata
├── packages/               # Python packages
│   ├── micropip-*.whl
│   ├── packaging-*.whl
│   ├── certifi-*.whl
│   └── ... (only what we need)
├── yt-dlp/                 # yt-dlp source
│   ├── yt_dlp/
│   │   ├── __init__.py
│   │   ├── YoutubeDL.py
│   │   └── ...
│   └── setup.py
└── patches/                # Pre-written patches
    ├── http_adapter.py     # HTTP interceptor
    ├── dlopen_adapter.py   # FFmpeg dlopen interceptor
    └── loader.py           # Applies all patches and exports API
```

---

## Build Script Design

### Script: `scripts/bundle-pyodide.ts`

```typescript
#!/usr/bin/env bun
import { mkdir, writeFile, copyFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { $ } from "bun";

interface PyodideConfig {
  version: string;
  packages: string[];  // e.g., ['micropip', 'packaging']
  ytDlpVersion: string;
}

async function downloadPyodide(version: string, targetDir: string) {
  // Download from GitHub releases or CDN
  // Extract only necessary files
}

async function downloadYtDlp(version: string, targetDir: string) {
  // Clone or download yt-dlp source
  // Could use GitHub API or pip download
}

async function createPatches(targetDir: string) {
  // Copy patches from src/wasm/patches/ to bundle
}

async function createLoader(targetDir: string) {
  // Generate loader.py that:
  // 1. Imports patches
  // 2. Applies them
  // 3. Exports yt-dlp interface
}

async function bundlePyodide(config: PyodideConfig) {
  const bundleDir = join(ROOT_DIR, "public/pyodide");
  
  await rm(bundleDir, { recursive: true, force: true });
  await mkdir(bundleDir, { recursive: true });
  
  await downloadPyodide(config.version, bundleDir);
  await downloadYtDlp(config.ytDlpVersion, join(bundleDir, "yt-dlp"));
  await createPatches(join(bundleDir, "patches"));
  await createLoader(bundleDir);
  
  console.log("✅ Pyodide bundle ready!");
}
```

---

## Loader Design

### File: `public/pyodide/patches/loader.py`

This is the **entry point** that runtime code will import.

```python
"""
Pyodide + yt-dlp pre-patched runtime loader.
This module applies all patches and exports a ready-to-use yt-dlp interface.
"""

import sys
import os

# Ensure patches directory is in path
patches_dir = os.path.join(os.path.dirname(__file__))
if patches_dir not in sys.path:
    sys.path.insert(0, patches_dir)

# Import patches
from http_adapter import patch_http_adapter
from dlopen_adapter import patch_subprocess_for_dlopen

# Import yt-dlp
from yt_dlp import YoutubeDL

# Apply patches
print("[loader] Applying HTTP adapter patch...")
patch_http_adapter()

print("[loader] Applying dlopen adapter patch...")
patch_subprocess_for_dlopen()

print("[loader] yt-dlp runtime ready!")

# Export interface
__all__ = ['YoutubeDL', 'extract_info', 'prepare_filename']

def extract_info(url: str, **opts):
    """Extract video metadata or download."""
    with YoutubeDL(opts) as ydl:
        return ydl.extract_info(url, download=opts.get('download', False))

def prepare_filename(info_dict):
    """Get the output filename for a video."""
    with YoutubeDL({}) as ydl:
        return ydl.prepare_filename(info_dict)
```

---

## Runtime Integration

### TypeScript: `src/wasm/worker/pyodide-worker.ts`

```typescript
import { loadPyodide, type PyodideInterface } from 'pyodide';

let pyodide: PyodideInterface | null = null;

async function initPyodide() {
  // Load from bundled assets (via Tauri convertFileSrc)
  const bundlePath = await convertFileSrc('/pyodide/pyodide.js');
  
  pyodide = await loadPyodide({
    indexURL: bundlePath,
  });
  
  // Install yt-dlp from bundle
  await pyodide.runPythonAsync(`
    import sys
    sys.path.insert(0, '/pyodide/yt-dlp')
  `);
  
  // Load pre-patched runtime
  await pyodide.runPythonAsync(`
    from patches.loader import extract_info, prepare_filename
  `);
  
  console.log('[pyodide-worker] Runtime initialized!');
}

// Export to global for Pyodide-side bridge functions
self.nativeHTTPAdapter = async (url: string, options: RequestInit) => {
  // Call Tauri HTTP client
  return await invoke('http_request', { url, options });
};

self.nativeFFmpegAdapter = async (command: string, args: string[]) => {
  // Call Tauri dlopen ffmpeg
  return await invoke('dlopen_ffmpeg', { command, args });
};
```

---

## Advantages Over Runtime Patching

| Aspect | Runtime Patching | Pre-bundled |
|--------|-----------------|-------------|
| Startup time | ~5-10s (download + patch) | ~500ms (load from disk) |
| Internet required | Yes (first run) | No |
| Reproducibility | Depends on CDN/network | Deterministic |
| Bundle size | Smaller initial | Larger (~30MB) |
| Complexity | Patch logic in runtime | Patch logic in build script |
| Debugging | Harder (runtime errors) | Easier (build-time validation) |
| OTA updates | Need to re-patch | Just swap bundle |

---

## Build Script Integration

### Add to `package.json`:

```json
{
  "scripts": {
    "bundle:pyodide": "bun run scripts/bundle-pyodide.ts",
    "build": "bun run bundle:pyodide && tsc && vite build"
  }
}
```

### Tauri Asset Protocol

Update `tauri.conf.json` to serve bundled Pyodide:

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

---

## Minimal Pyodide Packages

To keep bundle size down, only include packages yt-dlp actually needs:

**Core packages** (always needed):
- `micropip` - Package installer
- `packaging` - Version parsing
- `certifi` - SSL certificates

**yt-dlp dependencies** (check yt-dlp's requirements.txt):
- `brotli` - Decompression (optional but common)
- `websockets` - Live streams (optional)
- `mutagen` - Metadata (optional)

**Size estimate:**
- Pyodide core: ~6MB (pyodide.asm.wasm)
- Packages: ~2-5MB (depending on selection)
- yt-dlp: ~3MB (source)
- Patches: <100KB
- **Total: ~15-20MB** (reasonable for a desktop app)

---

## Testing the Bundle

### Build-time validation:

```typescript
// In bundle-pyodide.ts
async function validateBundle(bundleDir: string) {
  console.log('🔍 Validating bundle...');
  
  // Check Pyodide loads
  const pyodide = await loadPyodide({ indexURL: bundleDir });
  
  // Check yt-dlp imports
  await pyodide.runPythonAsync(`
    from yt_dlp import YoutubeDL
    print('[test] yt-dlp imported successfully')
  `);
  
  // Check patches applied
  await pyodide.runPythonAsync(`
    from patches.loader import extract_info
    print('[test] Patches loaded successfully')
  `);
  
  console.log('✅ Bundle validated!');
}
```

---

## Versioning Strategy

### Track versions in `package.json`:

```json
{
  "pyodideDeps": {
    "pyodide": "0.26.4",
    "yt-dlp": "2024.12.23"
  }
}
```

### Update script:

```bash
bun run scripts/bundle-pyodide.ts --update
```

This checks for newer versions and rebuilds bundle.

---

## Deployment Considerations

### Development vs Production

**Development:**
- Bundle from CDN (faster iteration)
- Hot reload patches

**Production:**
- Use pre-bundled assets
- Include bundle in Tauri binary
- Sign bundle (macOS/Windows)

### CI/CD Integration

```yaml
# .github/workflows/build.yml
- name: Bundle Pyodide
  run: bun run bundle:pyodide
  
- name: Build Tauri App
  run: bun run tauri build
```

---

## Migration from Runtime Patching

If you already have runtime patching code:

1. Move patch files from `src/wasm/patches/*.py` to `public/pyodide/patches/`
2. Create `loader.py` that imports and applies them
3. Update worker code to load from bundle instead of patching
4. Run `bun run bundle:pyodide`
5. Test with `bun run tauri dev`

---

## Next Steps

1. Implement `scripts/bundle-pyodide.ts`
2. Create `public/pyodide/patches/loader.py`
3. Update Tauri config for asset protocol
4. Modify worker to load from bundle
5. Test bundle in dev and prod modes

---

## FAQs

**Q: Why not use Pyodide CDN?**
A: Desktop apps should be self-contained. CDN requires internet and adds latency.

**Q: What about bundle size?**
A: ~15-20MB is acceptable for desktop apps. Tauri compresses well.

**Q: Can we still OTA update yt-dlp?**
A: Yes! Just swap the bundle directory with a new one. Pyodide itself can load from any path.

**Q: Do we bundle ffmpeg too?**
A: No. ffmpeg is a native binary (see dlopen approach in WASM_UNIFIED_DLOPEN_DESIGN.md).

**Q: What if yt-dlp needs a new dependency?**
A: Run `bun run bundle:pyodide --update` to rebuild with new deps.
