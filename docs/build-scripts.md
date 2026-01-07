# Build Scripts

```
scripts/
├── fetch-github-source.ts      # GitHub source (SHA verified)
├── fetch-sourceforge-source.ts # SourceForge source (MD5 verified)
├── setup-ffmpeg.ts             # FFmpeg + LAME orchestrator
└── build-ffmpeg.ts             # FFmpeg + LAME build
```

## Source Integrity

All sources are checksum-verified before extraction:

| Source | Verification | Storage |
|--------|-------------|---------|
| GitHub | SHA commit hash | `package.json` binaryDeps.*.sha |
| SourceForge | MD5 (via API) | `package.json` binaryDeps.*.md5 |

```bash
# Update to latest versions (fetches new checksums)
bun run scripts/setup-ffmpeg.ts --update      # FFmpeg
bun run scripts/setup-ffmpeg.ts --update-lame # LAME
bun run scripts/setup-ffmpeg.ts --update-all  # Both
```

## Skip-if-Exists & Rebuild

Both setup scripts automatically skip if valid artifacts already exist:

```bash
bun run scripts/setup-ffmpeg.ts   # Skips if libs exist and pass verification
bun run scripts/setup-yt-dlp.ts   # Skips if bundle exists and SHA256 matches
```

To force a clean rebuild:

```bash
bun run scripts/setup-ffmpeg.ts --clean   # Remove FFmpeg libs and rebuild
bun run scripts/setup-yt-dlp.ts --clean   # Remove Pyodide bundle and rebuild
```

The `--clean` flag removes existing artifacts before building, useful when:
- Build artifacts are corrupted
- Switching between configurations
- Debugging build issues

## Why dlopen?

We use runtime dynamic loading (`dlopen`) for two reasons:

1. **iOS requirement** - iOS prohibits linking against dynamic libraries at build time. `dlopen` is a public API and the only supported method.

2. **LGPL compliance** - Allows users to replace bundled libraries with their own builds.

## Library Paths (rpath)

Libraries must find their dependencies at runtime. We use relative paths:

| Platform | Mechanism | Value |
|----------|-----------|-------|
| macOS | `@loader_path` | Libraries in same directory |
| Linux | `$ORIGIN` | Libraries in same directory |

The build script automatically fixes paths using `install_name_tool` (macOS) or `patchelf` (Linux) after copying libraries to `binaries/`.

Verify with:
```bash
# macOS - should show @loader_path for FFmpeg libs
otool -L src-tauri/binaries/ffmpeg/libavcodec.dylib

# Linux - should show $ORIGIN
readelf -d src-tauri/binaries/ffmpeg/libavcodec.so | grep RPATH
```

## Adding Dependencies

### GitHub Source

1. Add to `package.json`:
```json
"binaryDeps": {
  "mylib": {
    "type": "source",
    "repo": "owner/repo",
    "sha": ""
  }
}
```

2. Use `fetchGitHubSource()` in your setup script.

### SourceForge Source

1. Add to `package.json`:
```json
"binaryDeps": {
  "mylib": {
    "type": "sourceforge",
    "project": "projectname",
    "version": "",
    "md5": ""
  }
}
```

2. Use `fetchSourceForgeSource()` in your setup script.

### LGPL Dependencies

Requirements for any LGPL library:

1. **Build as shared library** - `.dylib` / `.so` / `.dll`
2. **Load via dlopen** - Use `libloading` crate in Rust
3. **Bundle in `binaries/`** - User-replaceable location
4. **Fix library paths** - Use `@loader_path` (macOS) or `$ORIGIN` (Linux)
5. **Track source** - Add to `package.json` binaryDeps

Static dependencies (like LAME → FFmpeg) are linked into the parent dylib, not the app binary.

## Build Outputs

| Dependency | Location | Type |
|------------|----------|------|
| FFmpeg | `src-tauri/binaries/ffmpeg/*.dylib` | Shared (dlopen) |
| LAME | Embedded in libavcodec | Static (internal) |
| QuickJS | `src-tauri/binaries/qjs/qjs` | Executable |

## Troubleshooting

**Build fails**: Use `--clean` to rebuild from scratch
```bash
bun run scripts/setup-ffmpeg.ts --clean
bun run scripts/setup-yt-dlp.ts --clean
```

**Checksum mismatch**: Re-fetch with `--update` flag

**Library not found at runtime**: Verify rpath with `otool -L` or `readelf -d`
