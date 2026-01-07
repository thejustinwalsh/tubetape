# Script Rename: bundle-pyodide → bundle-yt-dlp

## What Changed

The bundling script has been renamed to better reflect its purpose:

- **Old:** `bundle-pyodide.ts` / `bundle:pyodide`
- **New:** `bundle-yt-dlp.ts` / `bundle:yt-dlp`

## Why?

**yt-dlp is the focus** - Pyodide is just the means (WASM runtime) to run it.

The script bundles:
1. ✅ **yt-dlp** (the main package we need)
2. ✅ Pyodide (WASM runtime to execute yt-dlp)
3. ✅ Python patches (HTTP and ffmpeg adapters)

## New Commands

```bash
# Bundle yt-dlp (with Pyodide runtime)
bun run bundle:yt-dlp

# Update to latest versions
bun run bundle:yt-dlp:update
```

## What's Improved

### 1. Tries to use yt-dlp wheel from PyPI first

The script now attempts to download pre-built wheels:
```
https://files.pythonhosted.org/packages/py3/y/yt-dlp/yt_dlp-{version}-py3-none-any.whl
```

**Benefits:**
- Faster (pre-built, no compilation)
- Smaller (no build artifacts)
- More reliable (official PyPI distribution)

**Fallback:** If wheel not found, downloads source from GitHub

### 2. Better console output

```
🚀 Bundling yt-dlp with Pyodide runtime
   yt-dlp version: 2025.01.02
   Pyodide version: 0.27.4

✨ Done! yt-dlp bundle ready
   • yt-dlp 2025.01.02 (loaded via Pyodide)
   • Pyodide 0.27.4 WASM runtime
   • HTTP & ffmpeg adapters (routes to native)

🚀 Next: bun run tauri dev
```

### 3. Clarified purpose in package.json

```json
{
  "pyodideDeps": {
    "comment": "yt-dlp is the focus - Pyodide is just the WASM runtime to run it"
  }
}
```

## Migration

If you have documentation or scripts referencing the old name:

**Find and replace:**
- `bundle-pyodide` → `bundle-yt-dlp`
- `bundle:pyodide` → `bundle:yt-dlp`

**Files that reference this:**
- `package.json` ✅ (updated)
- `scripts/patches/README.md` ✅ (updated)
- Documentation in `docs/` (update as needed)

## Technical Details

### Bundle Structure (unchanged)

```
public/pyodide/
├── pyodide.js              # Pyodide loader
├── pyodide.asm.wasm        # WASM runtime
├── yt-dlp/                 # yt-dlp package (wheel or source)
│   └── yt_dlp/
└── patches/                # Native adapters
    ├── http_adapter.py
    ├── dlopen_adapter.py
    └── loader.py
```

### Loading Strategy

1. Pyodide WASM runtime loads from disk
2. yt-dlp installed via Pyodide's package system
3. Patches applied automatically via `loader.py`

### Wheel vs Source

**Wheel (preferred):**
- File: `yt_dlp-{version}-py3-none-any.whl`
- Extracted: `yt_dlp/` directory with compiled bytecode
- Faster to load

**Source (fallback):**
- File: `yt-dlp-{version}.tar.gz` from GitHub
- Extracted: Source files `.py`
- Works identically, slightly slower first import

## Summary

Same functionality, better naming:
- Script name reflects the actual goal (bundling yt-dlp)
- Tries wheel first (faster, official)
- Clearer console output
- Documentation updated

All existing bundles remain compatible - just re-run `bun run bundle:yt-dlp` to regenerate with the new script.
