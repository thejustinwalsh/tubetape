# WASM Architecture Research Summary

**Date**: January 2026  
**Status**: Research Complete, Implementation Ready

---

## Executive Summary

This document summarizes the research findings for migrating Tubetape from native binaries to a hybrid WASM + Native architecture that enables:

1. **OTA updates** for yt-dlp (the frequently-changing component)
2. **Native performance** for ffmpeg (the stable, memory-intensive component)
3. **Cross-platform support** including iOS and Android
4. **Elimination of QuickJS** by using WebView for nsig challenges

---

## Key Findings

### The Hybrid Architecture is FEASIBLE

| Component | Approach | Feasibility | Evidence |
|-----------|----------|-------------|----------|
| **yt-dlp** | WASM (Pyodide) | Proven | dlPro browser extension runs yt-dlp in Pyodide |
| **HTTP requests** | Native (Tauri) | Ready | `tauri-plugin-http` bypasses CORS |
| **nsig challenges** | WebView JS | Proven | dlPro's `dlProJCP` delegates to host browser |
| **ffmpeg** | Native (dlopen on iOS) | Standard | iOS allows dlopen as public API |
| **OTA updates** | JS/WASM bundles | Allowed | Apple/Google permit interpretive code updates |

### Critical Insights

#### 1. dlPro is the Reference Implementation

The [dlPro browser extension](https://github.com/machineonamission/dlPro) proves yt-dlp can run in Pyodide:

- Uses `pyodide_http_fork` to patch urllib -> browser fetch
- Patches `Popen.run` to redirect subprocess calls -> ffmpeg.wasm
- Registers custom `dlProJCP` provider for nsig challenges via FFI
- Loads yt-dlp wheel directly from PyPI or bundled

**Key code patterns from dlPro:**

```python
# HTTP patching (dl.py)
import pyodide_http_fork as pyodide_http
pyodide_http.patch_ssl()
pyodide_http.patch_urllib()

# Subprocess patching for ffmpeg
def popen_run(cls, *args, **kwargs):
    if args[0][0] in ["ffmpeg", "ffprobe"]:
        return run_sync(ffmpegbridge(args[0][0], to_js(args[0][1:])))
    raise FileNotFoundError(f"Command not supported: {args}")

_utils.Popen.run = classmethod(popen_run)

# JS challenge handler
@register_provider
class dlProJCP(DenoJCP):
    def _run_deno(self, stdin, options) -> str:
        return run_sync(request_js(stdin))  # Delegate to host JS
```

#### 2. CORS Bypass Strategy

**dlPro's approach** (browser extension):
- Routes requests through content script -> XMLHttpRequest
- Extension context bypasses CORS

**Tauri's approach** (desktop/mobile app):
- Route through `reqwest` in Rust via `tauri.invoke()`
- Native HTTP client has no CORS restrictions
- Plugin available: `tauri-plugin-cors-fetch` (iOS/Android compatible)

**Limitation**: Streaming responses not fully supported in current plugins

#### 3. OTA Updates Reality

| Platform | Policy | What's Allowed |
|----------|--------|----------------|
| **iOS** | App Store 2.5.2 | JS/WASM that doesn't change "primary purpose" |
| **Android** | Play Store Malware Policy | Asset updates with proper disclosure |

**Available Solutions:**
- CrabNebula OTA (`@crabnebula/ota-updater`) - Paid, managed
- Inkibra OTA (`@inkibra/tauri-plugin-ota`) - iOS-specific, open source
- Custom implementation with signature verification

#### 4. ffmpeg Strategy - Native is Better

**Why NOT ffmpeg.wasm:**
- 25-30MB bundle size
- 0.04-0.08x native performance
- iOS Safari memory issues with large files
- No true streaming support

**Why Native ffmpeg:**
- Already bundled in current architecture
- Full native performance
- iOS allows dlopen for dynamic libraries
- Stable - doesn't need frequent updates

---

## Architecture Comparison

### Current Architecture (Desktop-Only)

```
┌─────────────────────────────────────────────────┐
│  Rust Backend                                    │
│  ┌───────────┐  ┌───────────┐  ┌─────────────┐  │
│  │  yt-dlp   │  │  ffmpeg   │  │  QuickJS    │  │
│  │ (binary)  │  │ (binary)  │  │  (binary)   │  │
│  └─────┬─────┘  └─────┬─────┘  └──────┬──────┘  │
│        └──────────────┴───────────────┘         │
│              [subprocess spawn]                  │
└─────────────────────────────────────────────────┘
```

**Problems:**
- iOS cannot spawn subprocesses
- Binaries require codesigning per platform
- No OTA updates for yt-dlp

### Proposed Hybrid Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Tauri Application                          │
├──────────────────────────────────────────────────────────────┤
│  Frontend (WebView)                                           │
│  ┌──────────────────────────────────────────────────────┐    │
│  │                    Web Worker                         │    │
│  │  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐  │    │
│  │  │  Pyodide    │  │ HTTP Bridge  │  │ JS Sandbox  │  │    │
│  │  │  (WASM)     │  │ -> Native    │  │ (nsig)      │  │    │
│  │  │             │  │              │  │             │  │    │
│  │  │  yt-dlp     │  │  Patches     │  │  WebView    │  │    │
│  │  │  (Python)   │◄─┤  urllib      │  │  eval()     │  │    │
│  │  └─────────────┘  └──────────────┘  └─────────────┘  │    │
│  └──────────────────────────────────────────────────────┘    │
│                           │                                   │
│                    [tauri.invoke]                             │
├──────────────────────────────────────────────────────────────┤
│  Rust Backend (Native)                                        │
│  ┌─────────────────┐  ┌─────────────────────────────────┐    │
│  │  HTTP Client    │  │  ffmpeg Adapter                  │    │
│  │  (reqwest)      │  │  - Desktop: subprocess           │    │
│  │  CORS-free      │  │  - iOS: dlopen + FFI             │    │
│  └─────────────────┘  │  - Android: JNI or subprocess    │    │
│                       └─────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
```

**Benefits:**
- yt-dlp in WASM = OTA updates possible
- ffmpeg native = full performance, no memory issues
- WebView nsig = no QuickJS binary needed
- Works on iOS/Android

---

## Bundle Size Analysis

| Component | Current (per platform) | Proposed (unified) |
|-----------|------------------------|-------------------|
| yt-dlp binary | ~20MB | N/A (WASM) |
| ffmpeg binary | ~80MB | ~80MB (native, shared) |
| QuickJS binary | ~2MB | N/A (WebView) |
| Pyodide core | N/A | ~15MB |
| yt-dlp wheel | N/A | ~8MB |
| **Total** | **~102MB** | **~23MB WASM + existing ffmpeg** |

---

## Platform Compatibility

| Feature | macOS | Windows | Linux | iOS | Android |
|---------|-------|---------|-------|-----|---------|
| Pyodide + yt-dlp | Y | Y | Y | Y | Y |
| Native HTTP | Y | Y | Y | Y | Y |
| WebView nsig | Y | Y | Y | Y | Y |
| Native ffmpeg | Y | Y | Y | Y (dlopen) | Y |
| OTA WASM updates | Y | Y | Y | Y* | Y* |

*Subject to app store policy compliance

---

## Data Flow

### Video Download Flow

```
1. User pastes YouTube URL
         │
         ▼
2. [WebView] Pyodide/yt-dlp extracts video info
         │ (uses native HTTP via bridge)
         ▼
3. [WebView] yt-dlp requests download URL
         │ (nsig challenge solved in WebView)
         ▼
4. [Native] Rust downloads video to temp file
         │ (reqwest, full speed, no CORS)
         ▼
5. [Native] ffmpeg extracts audio
         │ (subprocess or dlopen)
         ▼
6. [Native] Audio file saved/streamed to WebView
         │
         ▼
7. [WebView] Waveform rendered, samples created
```

---

## Risk Assessment

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Pyodide loading slow | Medium | Medium | Progressive loading, caching |
| YouTube blocks WASM | Low | Low | Same signatures as native yt-dlp |
| OTA policy rejection | Medium | Low | Asset-only updates, proper disclosure |
| ffmpeg dlopen fails iOS | High | Low | Fallback to server-side processing |
| Memory pressure mobile | Medium | Medium | Native ffmpeg avoids WASM heap |

---

## Implementation Priority

### Phase 1: Pyodide + yt-dlp (HIGHEST PRIORITY)
- Core value: OTA updates for YouTube compatibility
- Lowest risk: Proven by dlPro

### Phase 2: Native HTTP Bridge
- Routes Pyodide requests through Tauri
- Bypasses CORS restrictions

### Phase 3: WebView JS Sandbox
- Executes nsig challenges
- Eliminates QuickJS dependency

### Phase 4: Native ffmpeg Adapter
- Desktop: Use existing subprocess
- iOS: Implement dlopen adapter
- Android: Subprocess or JNI

### Phase 5: OTA Update System
- Version manifest
- Signature verification
- Rollback capability

---

## References

- [dlPro Source Code](https://github.com/machineonamission/dlPro)
- [Pyodide Documentation](https://pyodide.org/en/stable/)
- [pyodide-http](https://github.com/koenvo/pyodide-http)
- [tauri-plugin-cors-fetch](https://github.com/idootop/tauri-plugin-cors-fetch)
- [Tauri HTTP Plugin](https://v2.tauri.app/plugin/http-client/)
- [yt-dlp JS Challenges](https://github.com/yt-dlp/yt-dlp/issues/14404)
- [Apple App Store Guidelines 2.5.2](https://developer.apple.com/app-store/review/guidelines/)

---

## Next Steps

1. Update architecture docs for hybrid native+WASM approach
2. Implement Pyodide + yt-dlp POC with native HTTP bridge
3. Test nsig challenge handling via WebView
4. Implement native ffmpeg adapter (dlopen for iOS)
5. Build OTA update system for WASM bundles
