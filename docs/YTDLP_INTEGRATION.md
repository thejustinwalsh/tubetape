# yt-dlp Binary Integration Strategy

## Overview

Tubetape needs to fetch and execute yt-dlp without requiring users to have it installed locally. This document outlines the strategy for distributing and managing the binary within the Tauri application.

## Current Challenge

**yt-dlp** uses dynamic EJS templates for constructing download URLs, which means:
- URLs aren't static and can't be hardcoded
- Some platform-specific binary selection is needed
- Version updates require re-evaluation of templates

See: [yt-dlp EJS Wiki](https://github.com/yt-dlp/yt-dlp/wiki/EJS)

## Implementation Strategy

### 1. Binary Fetching Approach

#### Option A: Static Release Download (Recommended)
- Monitor GitHub releases for yt-dlp
- Create a mapping of latest stable releases per platform
- Download directly from GitHub releases (no EJS needed initially)
- Fallback to GitHub API for release metadata

**Advantages:**
- Simple, deterministic downloads
- No runtime template processing required initially
- Works offline once cached

**Disadvantages:**
- Manual version updates
- Doesn't handle dynamic URLs if yt-dlp changes their release strategy

#### Option B: EJS Template Processing
- Bundle Deno or Node.js runtime for EJS evaluation
- Download and parse yt-dlp's release configuration
- Dynamically construct URLs using EJS templates
- More complex but future-proof

**Advantages:**
- Future-proof against release strategy changes
- Automatically handles platform detection

**Disadvantages:**
- Requires bundling a JS runtime
- Increased binary size
- More complex initialization

### 2. Binary Management Architecture

```
app_cache/
├── binaries/
│   ├── yt-dlp/
│   │   ├── latest
│   │   ├── 2024.01.00/
│   │   │   ├── macos-arm64
│   │   │   ├── macos-x86-64
│   │   │   ├── windows-x86-64
│   │   │   └── linux-x86-64
│   │   └── checksums.json
│   └── deno/ (if needed)
└── metadata.json
```

### 3. Rust Backend Implementation

#### Command: `fetch_yt_dlp_binary`

```rust
#[tauri::command]
async fn fetch_yt_dlp_binary(
    app_handle: tauri::AppHandle,
    force_update: Option<bool>,
) -> Result<PathBuf, String> {
    // 1. Check cache for latest version
    // 2. If cache miss or force_update=true, fetch latest
    // 3. Verify checksum
    // 4. Make executable (chmod +x on Unix)
    // 5. Return path to binary
}
```

#### Command: `execute_yt_dlp`

```rust
#[tauri::command]
async fn execute_yt_dlp(
    url: String,
    args: Vec<String>,
) -> Result<String, String> {
    // 1. Ensure binary exists (fetch if needed)
    // 2. Execute with provided arguments
    // 3. Stream output to frontend
    // 4. Handle errors and signals
}
```

### 4. Platform-Specific Binary Paths

**macOS:**
- ARM64: `yt-dlp_macos` or `yt-dlp_macos_arm64`
- x86-64: `yt-dlp_macos`

**Windows:**
- x86-64: `yt-dlp.exe`

**Linux:**
- x86-64: `yt-dlp`

### 5. Security Considerations

1. **Checksum Verification:** Always verify SHA256 checksums from official GitHub releases
2. **HTTPS Only:** Enforce HTTPS downloads
3. **Binary Signing:** Consider code signing for distribution (especially on macOS)
4. **Sandboxing:** Run yt-dlp in isolated subprocess with minimal permissions
5. **Network Access:** Only allow yt-dlp to access YouTube domains

### 6. Caching Strategy

```typescript
interface BinaryMetadata {
  version: string;
  platform: string;
  arch: string;
  sha256: string;
  downloadedAt: number;
  lastUsed: number;
  size: number;
}
```

**Cache Cleanup:**
- Keep last 3 versions (fallback if latest has issues)
- Delete unused binaries after 30 days
- Compress old versions

### 7. Frontend Integration

```typescript
// Example fetch and status updates
async function extractAudioWithProgress(url: string) {
  try {
    // 1. Trigger binary fetch
    const binaryPath = await invoke('fetch_yt_dlp_binary', {
      force_update: false,
    });
    
    // 2. Show progress as audio extracts
    const result = await invoke('execute_yt_dlp', {
      url,
      args: ['-x', '--audio-format', 'wav'],
    });
    
    return result;
  } catch (error) {
    // Handle network errors, permission issues, etc.
  }
}
```

## Implementation Phases

### Phase 1: Static Binary Distribution (MVP)
- [ ] Identify latest stable yt-dlp version per platform
- [ ] Implement `fetch_yt_dlp_binary` with static URLs
- [ ] Add checksum verification
- [ ] Implement basic caching
- [ ] Test on all three platforms

### Phase 2: Enhanced Error Handling
- [ ] Implement automatic fallback to older cached versions
- [ ] Add network retry logic with exponential backoff
- [ ] Better error messages for user
- [ ] Cache corruption detection and recovery

### Phase 3: Dynamic Template Processing (Optional)
- [ ] Evaluate Deno for EJS processing
- [ ] Implement template-based URL construction
- [ ] Auto-detection of latest release
- [ ] Periodic background updates

### Phase 4: Distribution & Signing
- [ ] Code sign binaries for macOS
- [ ] Create signed installer for Windows
- [ ] Linux package management integration

## Testing Checklist

- [ ] Binary downloads correctly on all platforms
- [ ] Checksum verification works and detects corrupted files
- [ ] Cached binary is reused on subsequent calls
- [ ] Permissions are correct (executable on Unix)
- [ ] Network errors are handled gracefully
- [ ] App works offline with cached binary
- [ ] Old cached versions are cleaned up properly
- [ ] URL extraction from YouTube works with fetched binary

## References

- [yt-dlp GitHub](https://github.com/yt-dlp/yt-dlp)
- [yt-dlp EJS Wiki](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
- [yt-dlp Releases](https://github.com/yt-dlp/yt-dlp/releases)
- [Tauri File System API](https://tauri.app/v2/api/fs/)
- [Tauri HTTP API](https://tauri.app/v2/api/http/)
