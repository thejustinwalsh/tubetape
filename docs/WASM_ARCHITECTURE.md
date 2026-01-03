# Hybrid WASM + Native Cross-Platform Architecture

## Executive Summary

This document outlines a **hybrid architecture** for Tubetape that combines:

- **yt-dlp in WASM (Pyodide)** - Enables OTA updates for the frequently-changing component
- **ffmpeg as native binary** - Full performance, no WASM memory limitations
- **WebView-based nsig solving** - Eliminates QuickJS binary dependency

This approach enables:

1. **OTA updates** for yt-dlp without app store review (the component that changes constantly)
2. **Native performance** for ffmpeg (stable, memory-intensive operations)
3. **Cross-platform support** including iOS (via dlopen) and Android
4. **WebView-based nsig challenge solving** instead of bundled QuickJS

## Current Architecture (Desktop-Only)

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri Application                     │
├─────────────────────────────────────────────────────────┤
│  Frontend (React/TypeScript)                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  Waveform   │  │   Sample    │  │    Project      │  │
│  │  Renderer   │  │   Editor    │  │    Manager      │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
├─────────────────────────────────────────────────────────┤
│  Tauri Bridge (invoke)                                   │
├─────────────────────────────────────────────────────────┤
│  Rust Backend                                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  yt-dlp     │  │   ffmpeg    │  │    QuickJS      │  │
│  │  (binary)   │  │   (binary)  │  │    (binary)     │  │
│  └──────┬──────┘  └──────┬──────┘  └────────┬────────┘  │
│         │                │                   │           │
│         ▼                ▼                   ▼           │
│  [subprocess spawn] [subprocess spawn] [subprocess spawn]│
└─────────────────────────────────────────────────────────┘
```

### Current Limitations

| Issue | Impact |
|-------|--------|
| Binary codesigning | Requires APPLE_SIGNING_IDENTITY, notarization for macOS |
| iOS restrictions | Cannot spawn subprocesses; would need dylibs + dlopen |
| Android complexity | Native binaries require NDK compilation per architecture |
| OTA updates blocked | Binary changes require full app store review |
| Bundle size | Each binary adds 10-50MB per platform/arch |

---

## Proposed Hybrid Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Tauri Application                             │
├──────────────────────────────────────────────────────────────────────┤
│  Frontend (React/TypeScript)                                          │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │                        Web Worker                               │  │
│  │  ┌─────────────┐  ┌──────────────┐  ┌───────────────────────┐  │  │
│  │  │  Pyodide    │  │  HTTP Bridge │  │  JS Challenge Handler │  │  │
│  │  │  (WASM)     │  │  (patched)   │  │  (WebView sandbox)    │  │  │
│  │  │             │  │              │  │                       │  │  │
│  │  │  yt-dlp     │  │  Routes to   │  │  Solves nsig via      │  │  │
│  │  │  (Python)   │◄─┤  Native HTTP │  │  iframe eval()        │  │  │
│  │  │             │  │              │  │                       │  │  │
│  │  └─────────────┘  └──────────────┘  └───────────────────────┘  │  │
│  │         │                                                       │  │
│  │         │ Returns: video URL, metadata                          │  │
│  │         ▼                                                       │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                              │                                        │
│                       [tauri.invoke]                                  │
│                              ▼                                        │
├──────────────────────────────────────────────────────────────────────┤
│  Rust Backend (Native)                                                │
│  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────────┐  │
│  │  HTTP Client    │  │  Video Download │  │  ffmpeg Adapter      │  │
│  │  (reqwest)      │  │  to temp file   │  │                      │  │
│  │  CORS-free      │  │                 │  │  Desktop: subprocess │  │
│  └─────────────────┘  └─────────────────┘  │  iOS: dlopen + FFI   │  │
│                                            │  Android: subprocess │  │
│  ┌─────────────────────────────────────┐  └──────────────────────┘  │
│  │  OTA Asset Updater                   │                            │
│  │  (Pyodide + yt-dlp bundle updates)   │                            │
│  └─────────────────────────────────────┘                             │
└──────────────────────────────────────────────────────────────────────┘
```

### Why This Hybrid Approach?

| Component | In WASM? | Reason |
|-----------|----------|--------|
| **yt-dlp** | Yes | Needs frequent OTA updates due to YouTube anti-bot changes |
| **ffmpeg** | No | Stable, memory-intensive, benefits from native performance |
| **QuickJS** | Eliminated | WebView handles JS challenges directly |

**Key Benefits:**
- yt-dlp updates via OTA without app store review
- ffmpeg runs at native speed with no WASM memory limits
- iOS compatible via dlopen (public API)
- Smaller WASM bundle (~23MB vs ~48MB with ffmpeg.wasm)

---

## Component Deep Dive

### 1. Pyodide Runtime (Python in WASM)

**What it is**: CPython 3.12 compiled to WebAssembly via Emscripten

**Evidence**: The [dlPro browser extension](https://github.com/machineonamission/dlPro) successfully runs yt-dlp in the browser using Pyodide.

**Key Capabilities**:
- Full Python runtime (~15-20MB compressed)
- Loads pure Python wheels directly from PyPI
- FFI bridge for bidirectional JS ↔ Python communication
- Virtual filesystem for file I/O

**Limitations**:
- No subprocess spawning (must patch yt-dlp)
- No raw socket access (must use browser fetch)
- Memory constrained by WASM heap limits

**Integration Code** (from dlPro):
```javascript
pyodide = await loadPyodide({
    indexURL: "/libs/pyodide/",
    packages: ["https://files.pythonhosted.org/yt_dlp-xxx.whl"]
});

// Patch network and subprocess calls
await pyodide.runPythonAsync(`
    import pyodide_http_fork as pyodide_http
    pyodide_http.patch_ssl()
    pyodide_http.patch_urllib()
`);
```

### 2. HTTP Request Routing (CORS Bypass)

**The Problem**: Browser CORS policies block yt-dlp from making requests to YouTube.

**Solution Architecture**:

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  yt-dlp/urllib  │────►│  pyodide_http    │────►│  Tauri HTTP     │
│  (Python)       │     │  (patch layer)   │     │  (Native Rust)  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                │
                                ▼
                        ┌──────────────────┐
                        │  tauri.invoke()  │
                        │  "fetch_url"     │
                        └──────────────────┘
```

**How dlPro Does It** (browser extension context):
```javascript
// xmlproxy_worker.js - Route requests to content script
async function proxy_fetch(request) {
    response = promise_init()
    content_port.postMessage({"type": "request", "request": request});
    return await response.promise;
}

// xmlproxy_content.js - Use XMLHttpRequest (bypasses CORS in extensions)
function proxy_fetch(request) {
    let xhr = new XMLHttpRequest();
    xhr.responseType = "arraybuffer";
    xhr.open(method, url, true);
    xhr.send(body);
    // ... return response
}
```

**How We'll Do It** (Tauri context):

Using [`tauri-plugin-cors-fetch`](https://github.com/idootop/tauri-plugin-cors-fetch) or custom implementation:

```typescript
// frontend: Custom fetch that routes through Tauri
window.tauriFetch = async (url: string, options: RequestInit) => {
    return await invoke('http_fetch', {
        url,
        method: options.method || 'GET',
        headers: Object.fromEntries(new Headers(options.headers)),
        body: options.body
    });
};

// Register as Pyodide's fetch handler
pyodide.registerJsModule("tauri_http", {
    fetch: window.tauriFetch
});
```

```rust
// src-tauri/src/http.rs
#[tauri::command]
async fn http_fetch(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<Vec<u8>>
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::new();
    let mut req = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        // ...
    };
    
    for (key, value) in headers {
        req = req.header(&key, &value);
    }
    
    let response = req.send().await.map_err(|e| e.to_string())?;
    
    Ok(HttpResponse {
        status: response.status().as_u16(),
        headers: response.headers().iter().map(|(k, v)| 
            (k.to_string(), v.to_str().unwrap_or("").to_string())
        ).collect(),
        body: response.bytes().await.map_err(|e| e.to_string())?.to_vec()
    })
}
```

### 3. nsig Challenge Handler (WebView JS Execution)

**The Problem**: YouTube uses JavaScript challenges that must be executed to generate valid download URLs. Current yt-dlp requires QuickJS, Deno, or Node.js.

**Solution**: Use the host WebView to execute JavaScript instead of bundling a JS runtime.

**Evidence**: dlPro implements this via `dlProJCP` provider:

```python
# From dlPro's dl.py
@register_provider
class dlProJCP(DenoJCP):
    PROVIDER_NAME = 'dlPro'
    
    def is_available(self, /) -> bool:
        return True  # Always available in browser
    
    def _run_deno(self, stdin, options) -> str:
        # Delegate to host JavaScript environment
        res = run_sync(request_js(stdin))
        return res
```

**Our Implementation**:

```typescript
// frontend: JS sandbox for executing yt-dlp challenges
export async function executeJsChallenge(code: string): Promise<string> {
    // Create isolated iframe for sandboxed execution
    const iframe = document.createElement('iframe');
    iframe.sandbox.add('allow-scripts');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);
    
    try {
        // Execute in sandboxed context
        const result = iframe.contentWindow?.eval(code);
        return String(result);
    } finally {
        document.body.removeChild(iframe);
    }
}

// Register with Pyodide
pyodide.registerJsModule("js_sandbox", {
    execute: executeJsChallenge
});
```

```python
# Python plugin for yt-dlp
from yt_dlp.extractor.youtube.jsc.provider import register_provider
from js import js_sandbox
from pyodide.ffi import run_sync

@register_provider
class TubetapeJCP:
    PROVIDER_NAME = 'tubetape'
    
    def is_available(self):
        return True
    
    def solve_challenge(self, code):
        return run_sync(js_sandbox.execute(code))
```

### 4. Audio Processing (Native ffmpeg)

**Why Native Instead of WASM:**

| Aspect | ffmpeg.wasm | Native ffmpeg |
|--------|-------------|---------------|
| Bundle Size | 25-30MB | Already bundled |
| Performance | 0.04-0.08x native | Full native speed |
| Memory | WASM heap limited | Full system RAM |
| iOS Support | Safari memory issues | dlopen works |
| Streaming | Not supported | Full support |
| Update frequency | Rarely needs updates | Rarely needs updates |

**Recommendation**: Keep ffmpeg native, only move yt-dlp to WASM

**Platform-Specific Implementation:**

```rust
// src-tauri/src/ffmpeg_adapter.rs

#[cfg(target_os = "ios")]
mod ios {
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;
    
    // Load ffmpeg dylib via dlopen
    type FFmpegMain = unsafe extern "C" fn(argc: i32, argv: *const *const c_char) -> i32;
    
    pub fn run_ffmpeg(args: Vec<String>) -> Result<(), String> {
        unsafe {
            let lib = libc::dlopen(
                CString::new("libffmpeg.dylib").unwrap().as_ptr(),
                libc::RTLD_NOW
            );
            if lib.is_null() {
                return Err("Failed to load ffmpeg dylib".into());
            }
            
            let ffmpeg_main: FFmpegMain = std::mem::transmute(
                libc::dlsym(lib, CString::new("ffmpeg_main").unwrap().as_ptr())
            );
            
            // Convert args and call ffmpeg
            let c_args: Vec<CString> = args.iter()
                .map(|s| CString::new(s.as_str()).unwrap())
                .collect();
            let c_argv: Vec<*const c_char> = c_args.iter()
                .map(|s| s.as_ptr())
                .collect();
            
            let result = ffmpeg_main(c_argv.len() as i32, c_argv.as_ptr());
            libc::dlclose(lib);
            
            if result == 0 { Ok(()) } else { Err(format!("ffmpeg exited with {}", result)) }
        }
    }
}

#[cfg(not(target_os = "ios"))]
mod desktop {
    use std::process::Command;
    
    pub fn run_ffmpeg(args: Vec<String>) -> Result<(), String> {
        let status = Command::new("ffmpeg")
            .args(&args)
            .status()
            .map_err(|e| e.to_string())?;
        
        if status.success() { Ok(()) } else { Err("ffmpeg failed".into()) }
    }
}

#[tauri::command]
pub async fn extract_audio(
    video_path: String,
    output_path: String,
) -> Result<(), String> {
    let args = vec![
        "-i".to_string(), video_path,
        "-vn".to_string(),
        "-acodec".to_string(), "libmp3lame".to_string(),
        "-b:a".to_string(), "192k".to_string(),
        "-ar".to_string(), "44100".to_string(),
        output_path
    ];
    
    #[cfg(target_os = "ios")]
    ios::run_ffmpeg(args)?;
    
    #[cfg(not(target_os = "ios"))]
    desktop::run_ffmpeg(args)?;
    
    Ok(())
}
```

**Data Flow with Native ffmpeg:**

```
1. yt-dlp (WASM) extracts video URL
         │
         ▼
2. Native HTTP downloads video to temp file
         │
         ▼
3. Native ffmpeg extracts audio
         │ (subprocess on desktop, dlopen on iOS)
         ▼
4. Audio file returned to WebView
         │
         ▼
5. Waveform rendered, samples created
```

### 5. OTA Updates for Mobile

**App Store Policies**:

| Platform | Native Code | Interpretive Code (JS/WASM) |
|----------|-------------|----------------------------|
| iOS | Requires App Store review | Allowed if doesn't change "primary purpose" |
| Android | Requires Play Store review | Allowed (more permissive than iOS) |

**Solutions Available**:

1. **CrabNebula OTA** (`@crabnebula/ota-updater`)
   - Official Tauri partner solution
   - Managed cloud service
   - Supports web asset updates on mobile

2. **Inkibra OTA** (`@inkibra/tauri-plugin-ota`)
   - Open source
   - iOS-specific
   - Self-hostable

3. **Custom Implementation**
   - Download updated bundles to app cache
   - Load from cache instead of bundled assets
   - Verify integrity via checksums

**Implementation Strategy**:

```typescript
// Check for updates on app launch
async function checkForUpdates() {
    const manifest = await fetch('https://updates.tubetape.app/manifest.json');
    const { version, bundles } = await manifest.json();
    
    if (version > currentVersion) {
        for (const bundle of bundles) {
            const cached = await caches.open('tubetape-assets');
            const existing = await cached.match(bundle.url);
            
            if (!existing || existing.headers.get('etag') !== bundle.etag) {
                const response = await invoke('http_fetch', { url: bundle.url });
                await cached.put(bundle.url, new Response(response.body));
            }
        }
        
        // Reload with new assets
        location.reload();
    }
}
```

---

## Bundle Size Analysis

### Hybrid Approach (Recommended)

| Component | Size (compressed) | Location | Update Frequency |
|-----------|-------------------|----------|------------------|
| Pyodide core | ~15MB | WASM (OTA) | Rare |
| yt-dlp wheel | ~8MB | WASM (OTA) | Frequent |
| HTTP patches | ~50KB | WASM (OTA) | Rare |
| ffmpeg | ~80MB | Native | Never (stable) |
| **WASM Total** | **~23MB** | OTA-updatable | |
| **Native Total** | **~80MB** | App bundle | |

### Comparison with Current Approach

| Component | Current | Hybrid | Savings |
|-----------|---------|--------|---------|
| yt-dlp | 20MB native | 8MB WASM | OTA-updatable! |
| ffmpeg | 80MB native | 80MB native | Same |
| QuickJS | 2MB native | 0 (WebView) | -2MB |
| Pyodide | N/A | 15MB WASM | New |
| **Total** | **102MB** | **103MB** | Enables OTA |

**Key Insight**: Bundle size is similar, but the hybrid approach enables OTA updates for the frequently-changing yt-dlp component while keeping ffmpeg's native performance.

---

## Platform Compatibility Matrix

| Feature | macOS | Windows | Linux | iOS | Android |
|---------|-------|---------|-------|-----|---------|
| Pyodide + yt-dlp | ✅ | ✅ | ✅ | ✅ | ✅ |
| Native HTTP (CORS-free) | ✅ | ✅ | ✅ | ✅ | ✅ |
| WebView JS (nsig) | ✅ | ✅ | ✅ | ✅ | ✅ |
| Native ffmpeg | ✅ subprocess | ✅ subprocess | ✅ subprocess | ✅ dlopen | ✅ subprocess |
| OTA WASM updates | ✅ | ✅ | ✅ | ✅* | ✅* |

Legend: ✅ Full support | * Subject to app store policy compliance

**iOS Implementation Notes**:
- ffmpeg via dlopen: iOS allows dlopen as a public API
- Must bundle ffmpeg as a dynamic library (.dylib)
- No subprocess spawning allowed, but dlopen + FFI works
- Memory: Full system RAM available (no WASM heap limits)

---

## Security Considerations

### 1. JavaScript Sandbox
- Use `<iframe sandbox="allow-scripts">` for challenge execution
- Never eval() untrusted code in main context
- Implement timeout and memory limits

### 2. OTA Updates
- HTTPS only for bundle downloads
- SHA256 checksums for all assets
- Code signing for critical updates
- Rollback mechanism for failed updates

### 3. Network Requests
- Whitelist allowed domains in Tauri config
- No credential passthrough to arbitrary domains
- Rate limiting on native HTTP client

---

## References

- [dlPro Source Code](https://github.com/machineonamission/dlPro)
- [Pyodide Documentation](https://pyodide.org/en/stable/)
- [pyodide-http](https://github.com/koenvo/pyodide-http)
- [tauri-plugin-cors-fetch](https://github.com/idootop/tauri-plugin-cors-fetch)
- [ffmpeg.wasm](https://ffmpegwasm.netlify.app/)
- [Mediabunny](https://mediabunny.dev/)
- [CrabNebula OTA](https://www.npmjs.com/package/@crabnebula/ota-updater)
- [yt-dlp JS Challenges](https://github.com/yt-dlp/yt-dlp/issues/14404)
