# Hybrid WASM + Native Implementation Plan

## Overview

This document outlines the phased implementation plan for Tubetape's **unified hybrid architecture**:

- **yt-dlp in WASM (Pyodide)** - Authoritative orchestrator, OTA-updatable
- **ffmpeg via dlopen (all platforms)** - Native performance, yt-dlp passes full args through bridge
- **WebView JS sandbox** - For nsig challenges (eliminates QuickJS)

### Key Design Principle

**yt-dlp remains the authority on ffmpeg invocation.** The native ffmpeg adapter is a transparent proxy that:
1. Receives the complete command + args from yt-dlp (running in Pyodide)
2. Routes them through native dlopen (same approach across all platforms)
3. Returns stdout/stderr/exit code back to yt-dlp
4. Requires NO hardcoded ffmpeg args on the native side

### Priority Order

| Phase | Component | Priority | Reason |
|-------|-----------|----------|--------|
| 1 | HTTP Bridge | HIGH | Foundation for all WASM network |
| 2 | Pyodide + yt-dlp | HIGH | Core value: OTA-updatable extraction |
| 3 | JS Sandbox (nsig) | HIGH | Required for YouTube downloads |
| 4 | dlopen FFmpeg Adapter | MEDIUM | Unified approach: all platforms use dlopen, no subprocess |
| 5 | OTA Update System | MEDIUM | Polish for production |

---

## Phase 0: Foundation (Week 1)

### 0.1 Install Dependencies

```bash
# Frontend dependencies - NO ffmpeg.wasm needed!
# ffmpeg stays native

# Rust dependencies (add to Cargo.toml)
# tauri-plugin-http = "2.5"  # Already have reqwest
```

### 0.2 Configure Tauri HTTP Plugin

**File: `src-tauri/Cargo.toml`**
```toml
[dependencies]
tauri-plugin-http = "2.5"
```

**File: `src-tauri/src/lib.rs`**
```rust
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        // ... existing plugins
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

**File: `src-tauri/capabilities/default.json`**
```json
{
  "permissions": [
    "http:default",
    {
      "identifier": "http:allow-fetch",
      "allow": [
        { "url": "https://*.youtube.com/*" },
        { "url": "https://*.googlevideo.com/*" },
        { "url": "https://*.ytimg.com/*" },
        { "url": "https://pypi.org/*" },
        { "url": "https://files.pythonhosted.org/*" },
        { "url": "https://cdn.jsdelivr.net/*" }
      ]
    }
  ]
}
```

### 0.3 Create WASM Asset Directory Structure

```
src/
├── wasm/
│   ├── pyodide/           # Pyodide runtime (downloaded)
│   ├── worker/            # Web Worker scripts
│   │   ├── main.worker.ts
│   │   ├── pyodide-loader.ts
│   │   ├── http-bridge.ts
│   │   └── js-sandbox.ts
│   ├── patches/           # Python patches for yt-dlp
│   │   ├── http_patch.py
│   │   └── subprocess_patch.py
│   └── index.ts           # Main WASM module exports
```

---

## Phase 1: HTTP Bridge (Week 1-2)

### Goal
Create a fetch polyfill that routes Pyodide HTTP requests through Tauri's native HTTP client.

### 1.1 Rust HTTP Command

**File: `src-tauri/src/http_bridge.rs`**
```rust
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpRequest {
    pub url: String,
    pub method: String,
    pub headers: HashMap<String, String>,
    pub body: Option<Vec<u8>>,
    pub timeout: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
}

#[tauri::command]
pub async fn http_fetch(request: HttpRequest) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(request.timeout.unwrap_or(30)))
        .build()
        .map_err(|e| e.to_string())?;

    let mut req_builder = match request.method.to_uppercase().as_str() {
        "GET" => client.get(&request.url),
        "POST" => client.post(&request.url),
        "PUT" => client.put(&request.url),
        "DELETE" => client.delete(&request.url),
        "HEAD" => client.head(&request.url),
        "PATCH" => client.patch(&request.url),
        _ => return Err(format!("Unsupported method: {}", request.method)),
    };

    for (key, value) in &request.headers {
        req_builder = req_builder.header(key, value);
    }

    if let Some(body) = request.body {
        req_builder = req_builder.body(body);
    }

    let response = req_builder.send().await.map_err(|e| e.to_string())?;

    let status = response.status().as_u16();
    let headers: HashMap<String, String> = response
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = response.bytes().await.map_err(|e| e.to_string())?.to_vec();

    Ok(HttpResponse { status, headers, body })
}
```

### 1.2 TypeScript Bridge

**File: `src/wasm/worker/http-bridge.ts`**
```typescript
import { invoke } from '@tauri-apps/api/core';

export interface HttpRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: Uint8Array;
  timeout?: number;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: Uint8Array;
}

export async function tauriFetch(request: HttpRequest): Promise<HttpResponse> {
  return await invoke('http_fetch', { request });
}

// Serialize for passing to Web Worker
export function serializeRequest(
  url: string,
  init?: RequestInit
): HttpRequest {
  const headers: Record<string, string> = {};
  if (init?.headers) {
    const h = new Headers(init.headers);
    h.forEach((value, key) => {
      headers[key] = value;
    });
  }

  let body: Uint8Array | undefined;
  if (init?.body) {
    if (init.body instanceof ArrayBuffer) {
      body = new Uint8Array(init.body);
    } else if (typeof init.body === 'string') {
      body = new TextEncoder().encode(init.body);
    }
  }

  return {
    url,
    method: init?.method || 'GET',
    headers,
    body,
    timeout: 30,
  };
}
```

### 1.3 Test HTTP Bridge

```typescript
// src/wasm/__tests__/http-bridge.spec.ts
import { describe, it, expect } from 'vitest';
import { tauriFetch, serializeRequest } from '../worker/http-bridge';

describe('HTTP Bridge', () => {
  it('should fetch YouTube oembed data', async () => {
    const request = serializeRequest(
      'https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=dQw4w9WgXcQ&format=json'
    );
    const response = await tauriFetch(request);
    
    expect(response.status).toBe(200);
    const data = JSON.parse(new TextDecoder().decode(response.body));
    expect(data.title).toBeDefined();
  });
});
```

---

## Phase 2: Pyodide Integration (Week 2-3)

### Goal
Load Pyodide in a Web Worker and establish communication channels.

### 2.1 Pyodide Loader

**File: `src/wasm/worker/pyodide-loader.ts`**
```typescript
declare const loadPyodide: any;

let pyodide: any = null;

export async function initPyodide(
  onProgress?: (message: string, percent: number) => void
): Promise<any> {
  if (pyodide) return pyodide;

  onProgress?.('Loading Pyodide runtime...', 0);

  // Import Pyodide from CDN or bundled
  importScripts('https://cdn.jsdelivr.net/pyodide/v0.26.4/full/pyodide.js');

  pyodide = await loadPyodide({
    indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/',
    stdout: (text: string) => console.log('[Python]', text),
    stderr: (text: string) => console.error('[Python]', text),
  });

  onProgress?.('Loading yt-dlp...', 30);

  // Install yt-dlp
  await pyodide.loadPackage('micropip');
  const micropip = pyodide.pyimport('micropip');
  await micropip.install('yt-dlp');

  onProgress?.('Patching HTTP...', 70);

  // Apply HTTP patches
  await applyHttpPatches(pyodide);

  onProgress?.('Ready!', 100);

  return pyodide;
}

async function applyHttpPatches(pyodide: any) {
  // Patch urllib to use our Tauri bridge
  await pyodide.runPythonAsync(`
import sys
from js import tauriFetch, Object
from pyodide.ffi import to_js

class TauriHTTPHandler:
    """Custom HTTP handler that routes through Tauri's native HTTP client."""
    
    @staticmethod
    async def fetch(url, method='GET', headers=None, body=None, timeout=30):
        request = {
            'url': url,
            'method': method,
            'headers': headers or {},
            'body': body,
            'timeout': timeout,
        }
        response = await tauriFetch(to_js(request, dict_converter=Object.fromEntries))
        return response.to_py()

# Store for later use
sys.modules['tauri_http'] = type(sys)('tauri_http')
sys.modules['tauri_http'].fetch = TauriHTTPHandler.fetch
  `);
}

export function getPyodide(): any {
  if (!pyodide) {
    throw new Error('Pyodide not initialized. Call initPyodide() first.');
  }
  return pyodide;
}
```

### 2.2 Web Worker Main

**File: `src/wasm/worker/main.worker.ts`**
```typescript
import { initPyodide, getPyodide } from './pyodide-loader';
import { tauriFetch, serializeRequest } from './http-bridge';

// Expose tauriFetch to Pyodide's JavaScript environment
(self as any).tauriFetch = async (request: any) => {
  // Convert from Pyodide proxy to plain object
  const plainRequest = {
    url: request.url,
    method: request.method,
    headers: Object.fromEntries(request.headers.entries?.() || []),
    body: request.body,
    timeout: request.timeout,
  };
  return await tauriFetch(plainRequest);
};

interface WorkerMessage {
  type: 'init' | 'extract_info' | 'download';
  id: string;
  payload?: any;
}

interface WorkerResponse {
  type: 'progress' | 'result' | 'error';
  id: string;
  payload: any;
}

function sendMessage(response: WorkerResponse) {
  self.postMessage(response);
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const { type, id, payload } = event.data;

  try {
    switch (type) {
      case 'init':
        await initPyodide((message, percent) => {
          sendMessage({ type: 'progress', id, payload: { message, percent } });
        });
        sendMessage({ type: 'result', id, payload: { success: true } });
        break;

      case 'extract_info':
        const info = await extractInfo(payload.url);
        sendMessage({ type: 'result', id, payload: info });
        break;

      case 'download':
        await downloadAudio(payload.url, payload.format, (progress) => {
          sendMessage({ type: 'progress', id, payload: progress });
        });
        sendMessage({ type: 'result', id, payload: { success: true } });
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    sendMessage({
      type: 'error',
      id,
      payload: { message: error instanceof Error ? error.message : String(error) },
    });
  }
};

async function extractInfo(url: string): Promise<any> {
  const pyodide = getPyodide();
  
  const result = await pyodide.runPythonAsync(`
import json
from yt_dlp import YoutubeDL

url = "${url}"

ydl_opts = {
    'quiet': True,
    'no_warnings': True,
    'extract_flat': False,
}

with YoutubeDL(ydl_opts) as ydl:
    info = ydl.extract_info(url, download=False)
    # Sanitize for JSON serialization
    info = ydl.sanitize_info(info)

json.dumps(info)
  `);
  
  return JSON.parse(result);
}

async function downloadAudio(
  url: string,
  format: string,
  onProgress: (progress: { percent: number; status: string }) => void
): Promise<Uint8Array> {
  const pyodide = getPyodide();
  
  // Implementation continues in Phase 3...
  throw new Error('Not implemented yet');
}
```

### 2.3 Worker Manager (Frontend)

**File: `src/wasm/index.ts`**
```typescript
type MessageHandler = (data: any) => void;

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  onProgress?: (progress: any) => void;
}

class PyodideWorkerManager {
  private worker: Worker | null = null;
  private pendingRequests = new Map<string, PendingRequest>();
  private messageId = 0;
  private initialized = false;

  async init(onProgress?: (message: string, percent: number) => void): Promise<void> {
    if (this.initialized) return;

    this.worker = new Worker(
      new URL('./worker/main.worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.onmessage = this.handleMessage.bind(this);

    await this.sendRequest('init', undefined, (progress) => {
      onProgress?.(progress.message, progress.percent);
    });

    this.initialized = true;
  }

  private handleMessage(event: MessageEvent) {
    const { type, id, payload } = event.data;
    const request = this.pendingRequests.get(id);

    if (!request) {
      console.warn('Received message for unknown request:', id);
      return;
    }

    switch (type) {
      case 'progress':
        request.onProgress?.(payload);
        break;
      case 'result':
        request.resolve(payload);
        this.pendingRequests.delete(id);
        break;
      case 'error':
        request.reject(new Error(payload.message));
        this.pendingRequests.delete(id);
        break;
    }
  }

  private sendRequest<T>(
    type: string,
    payload?: any,
    onProgress?: (progress: any) => void
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = `msg_${++this.messageId}`;
      this.pendingRequests.set(id, { resolve, reject, onProgress });
      this.worker?.postMessage({ type, id, payload });
    });
  }

  async extractInfo(url: string): Promise<any> {
    return this.sendRequest('extract_info', { url });
  }

  async downloadAudio(
    url: string,
    format: string,
    onProgress?: (progress: { percent: number; status: string }) => void
  ): Promise<Uint8Array> {
    return this.sendRequest('download', { url, format }, onProgress);
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.initialized = false;
  }
}

export const pyodideManager = new PyodideWorkerManager();
```

---

## Phase 3: yt-dlp Integration (Week 3-4)

### Goal
Patch yt-dlp to work within Pyodide environment.

### 3.1 HTTP Patch for yt-dlp

**File: `src/wasm/patches/http_patch.py`**
```python
"""
Patches yt-dlp's HTTP handling to use Tauri's native HTTP client.
This bypasses CORS restrictions in the WebView.
"""

import sys
from functools import wraps

def patch_urllib():
    """Patch urllib to use Tauri HTTP bridge."""
    import urllib.request
    from tauri_http import fetch
    from pyodide.ffi import run_sync
    
    class TauriHTTPHandler(urllib.request.BaseHandler):
        handler_order = 100  # High priority
        
        def http_open(self, req):
            return self._open(req)
        
        def https_open(self, req):
            return self._open(req)
        
        def _open(self, req):
            url = req.full_url
            method = req.get_method()
            headers = dict(req.headers)
            data = req.data
            
            # Call Tauri bridge synchronously
            response = run_sync(fetch(url, method, headers, data))
            
            # Create urllib-compatible response
            return urllib.request.addinfourl(
                fp=io.BytesIO(response['body']),
                headers=response['headers'],
                url=url,
                code=response['status']
            )
    
    # Install custom opener
    opener = urllib.request.build_opener(TauriHTTPHandler())
    urllib.request.install_opener(opener)

def patch_yt_dlp_networking():
    """Patch yt-dlp's internal networking."""
    try:
        from yt_dlp.networking import RequestHandler
        from yt_dlp.networking._helper import make_socks_proxy_opts
        
        # Override the request handler to use our bridge
        original_send = RequestHandler.send
        
        @wraps(original_send)
        def patched_send(self, request):
            # Route through Tauri for YouTube domains
            if any(domain in request.url for domain in [
                'youtube.com', 'googlevideo.com', 'ytimg.com', 'youtu.be'
            ]):
                return tauri_send(request)
            return original_send(self, request)
        
        RequestHandler.send = patched_send
        
    except ImportError:
        # Older yt-dlp version, use different patching strategy
        pass

# Apply patches when module loads
patch_urllib()
patch_yt_dlp_networking()
```

### 3.2 dlopen Adapter Patch (Native ffmpeg via Tauri)

**File: `src/wasm/patches/dlopen_adapter.py`**
```python
"""
Patches subprocess calls to route ffmpeg through native dlopen adapter.

Design principle: yt-dlp remains the authoritative orchestrator.
This patch is a transparent proxy that routes all ffmpeg args as-is
to the native dlopen implementation. No hardcoding of ffmpeg args.
"""

from yt_dlp.utils import Popen
from js import nativeFFmpegAdapter
from pyodide.ffi import run_sync, to_js
import subprocess

def patched_popen_run(cls, args, **kwargs):
    """
    Intercept subprocess.Popen.run and route ffmpeg to native dlopen.
    
    The native side will:
    1. Load ffmpeg via dlopen (works on all platforms: macOS, Linux, Windows, iOS, Android)
    2. Call ffmpeg_main with all args as-is from yt-dlp
    3. Return exit code and any output
    
    This approach:
    - Keeps yt-dlp as the authority (all args come from it)
    - Works uniformly across all platforms
    - No platform-specific subprocess vs dlopen branching needed
    """
    if not args:
        raise ValueError("No command provided")
    
    command = args[0]
    
    if command in ('ffmpeg', 'ffprobe'):
        # Route to native dlopen adapter via Tauri invoke
        # Pass command name and all args exactly as yt-dlp specifies them
        result = run_sync(
            nativeFFmpegAdapter(
                command,
                to_js(list(args[1:]))  # All remaining args, unmodified
            )
        )
        # Convert result back to Python and construct subprocess.CompletedProcess
        result_py = result.to_py()
        return subprocess.CompletedProcess(
            args=args,
            returncode=result_py['exit_code'],
            stdout=result_py.get('stdout', b''),
            stderr=result_py.get('stderr', b'')
        )
    
    # Block other subprocess calls
    raise FileNotFoundError(
        f"Subprocess '{command}' is not available in WASM environment. "
        f"Only ffmpeg and ffprobe are supported via native adapter."
    )

# Apply patch
Popen.run = classmethod(patched_popen_run)
```

### 3.3 JavaScript Challenge Handler

**File: `src/wasm/patches/jsc_handler.py`**
```python
"""
Custom JavaScript challenge handler that delegates to the host WebView.
"""

import importlib.util

# Only register if yt-dlp supports JSC providers
if importlib.util.find_spec("yt_dlp.extractor.youtube.jsc"):
    from yt_dlp.extractor.youtube.jsc.provider import (
        register_provider,
        register_preference,
    )
    from yt_dlp.extractor.youtube.jsc._builtin.deno import DenoJCP
    from js import executeJsChallenge
    from pyodide.ffi import run_sync

    @register_provider
    class TubetapeJCP(DenoJCP):
        """
        JavaScript Challenge Provider that uses the host WebView.
        
        This eliminates the need for QuickJS, Deno, or Node.js binaries.
        The host WebView executes the JavaScript and returns the result.
        """
        PROVIDER_NAME = 'tubetape'
        JS_RUNTIME_NAME = 'webview'

        def is_available(self) -> bool:
            # Always available since we're running in a WebView
            return True

        def _run_deno(self, stdin: str, options: dict) -> str:
            """
            Override Deno execution to use WebView.
            
            Args:
                stdin: JavaScript code to execute
                options: Execution options (ignored)
                
            Returns:
                Result of JavaScript execution as string
            """
            result = run_sync(executeJsChallenge(stdin))
            return str(result)

        def _npm_packages_cached(self, stdin: str) -> bool:
            # No npm caching needed for WebView execution
            return True

    @register_preference(TubetapeJCP)
    def preference(*_) -> int:
        # Highest priority - always prefer our handler
        return 999999999
else:
    print("[Tubetape] yt-dlp version does not support JSC providers")
```

---

## Phase 4: Native ffmpeg Adapter (Week 4-5)

### Goal
Create a unified ffmpeg adapter that uses native execution on all platforms:
- **Desktop (macOS/Windows/Linux)**: subprocess (existing approach)
- **iOS**: dlopen + FFI (iOS allows dlopen as public API)
- **Android**: subprocess or JNI

### 4.1 Native ffmpeg TypeScript Bridge

**File: `src/wasm/worker/native-ffmpeg-bridge.ts`**
```typescript
import { invoke } from '@tauri-apps/api/core';

export interface FFmpegResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  outputPath?: string;
}

/**
 * Execute ffmpeg natively via Tauri.
 * This is called from Pyodide when yt-dlp tries to run ffmpeg.
 */
export async function nativeFFmpeg(
  command: 'ffmpeg' | 'ffprobe',
  args: string[]
): Promise<FFmpegResult> {
  return await invoke('run_ffmpeg', { command, args });
}

/**
 * Download video to temp file and extract audio using native ffmpeg.
 * This is the main flow for audio extraction.
 */
export async function downloadAndExtractAudio(
  videoUrl: string,
  outputFormat: string = 'mp3',
  onProgress?: (percent: number, status: string) => void
): Promise<string> {
  // Step 1: Download video to temp file
  onProgress?.(0, 'Downloading video...');
  const tempVideoPath = await invoke<string>('download_to_temp', { 
    url: videoUrl 
  });
  
  // Step 2: Extract audio using native ffmpeg
  onProgress?.(50, 'Extracting audio...');
  const outputPath = await invoke<string>('extract_audio_native', {
    inputPath: tempVideoPath,
    outputFormat,
  });
  
  // Step 3: Cleanup temp video file
  await invoke('cleanup_temp', { path: tempVideoPath });
  
  onProgress?.(100, 'Complete');
  return outputPath;
}

// Expose to global scope for Pyodide access
(self as any).nativeFFmpeg = nativeFFmpeg;
(self as any).downloadAndExtractAudio = downloadAndExtractAudio;
```

### 4.2 Rust Native ffmpeg Adapter

**File: `src-tauri/src/ffmpeg_adapter.rs`**
```rust
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;
use tokio::fs;

#[derive(Debug, serde::Serialize)]
pub struct FFmpegResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub output_path: Option<String>,
}

/// Download a URL to a temporary file
#[tauri::command]
pub async fn download_to_temp(
    app: AppHandle,
    url: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();
    let response = client.get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    
    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    
    let temp_dir = app.path().temp_dir().map_err(|e| e.to_string())?;
    let temp_path = temp_dir.join(format!("tubetape_video_{}.tmp", uuid::Uuid::new_v4()));
    
    fs::write(&temp_path, &bytes).await.map_err(|e| e.to_string())?;
    
    Ok(temp_path.to_string_lossy().to_string())
}

/// Run ffmpeg natively - uses subprocess on desktop, dlopen on iOS
#[tauri::command]
pub async fn run_ffmpeg(
    command: String,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    #[cfg(target_os = "ios")]
    {
        run_ffmpeg_ios(command, args).await
    }
    
    #[cfg(not(target_os = "ios"))]
    {
        run_ffmpeg_subprocess(command, args).await
    }
}

#[cfg(not(target_os = "ios"))]
async fn run_ffmpeg_subprocess(
    command: String,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    use std::process::Command;
    
    let output = Command::new(&command)
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run {}: {}", command, e))?;
    
    Ok(FFmpegResult {
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        exit_code: output.status.code().unwrap_or(-1),
        output_path: None,
    })
}

#[cfg(target_os = "ios")]
async fn run_ffmpeg_ios(
    command: String,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    use std::ffi::{CStr, CString};
    use std::os::raw::c_char;
    
    // iOS: Use dlopen to load ffmpeg dylib
    unsafe {
        let lib_name = CString::new("libffmpeg.dylib").unwrap();
        let lib = libc::dlopen(lib_name.as_ptr(), libc::RTLD_NOW);
        
        if lib.is_null() {
            let error = CStr::from_ptr(libc::dlerror());
            return Err(format!("Failed to load ffmpeg: {:?}", error));
        }
        
        // Get ffmpeg_main function pointer
        let func_name = CString::new("ffmpeg_main").unwrap();
        let ffmpeg_main: extern "C" fn(i32, *const *const c_char) -> i32 = 
            std::mem::transmute(libc::dlsym(lib, func_name.as_ptr()));
        
        // Build args array
        let c_command = CString::new(command).unwrap();
        let c_args: Vec<CString> = args.iter()
            .map(|s| CString::new(s.as_str()).unwrap())
            .collect();
        
        let mut argv: Vec<*const c_char> = vec![c_command.as_ptr()];
        argv.extend(c_args.iter().map(|s| s.as_ptr()));
        
        let exit_code = ffmpeg_main(argv.len() as i32, argv.as_ptr());
        
        libc::dlclose(lib);
        
        Ok(FFmpegResult {
            stdout: String::new(),
            stderr: String::new(),
            exit_code,
            output_path: None,
        })
    }
}

/// Extract audio from video file using native ffmpeg
#[tauri::command]
pub async fn extract_audio_native(
    app: AppHandle,
    input_path: String,
    output_format: String,
) -> Result<String, String> {
    let temp_dir = app.path().temp_dir().map_err(|e| e.to_string())?;
    let output_path = temp_dir.join(format!(
        "tubetape_audio_{}.{}",
        uuid::Uuid::new_v4(),
        output_format
    ));
    
    let args = vec![
        "-i".to_string(), input_path,
        "-vn".to_string(),
        "-acodec".to_string(), 
        if output_format == "mp3" { "libmp3lame" } else { "aac" }.to_string(),
        "-b:a".to_string(), "192k".to_string(),
        "-ar".to_string(), "44100".to_string(),
        "-y".to_string(),  // Overwrite output
        output_path.to_string_lossy().to_string(),
    ];
    
    let result = run_ffmpeg("ffmpeg".to_string(), args).await?;
    
    if result.exit_code != 0 {
        return Err(format!("ffmpeg failed: {}", result.stderr));
    }
    
    Ok(output_path.to_string_lossy().to_string())
}

/// Cleanup temporary file
#[tauri::command]
pub async fn cleanup_temp(path: String) -> Result<(), String> {
    fs::remove_file(&path).await.map_err(|e| e.to_string())
}
```

---

## Phase 5: JS Sandbox (Week 5)

### Goal
Create a secure sandbox for executing YouTube's JavaScript challenges.

### 5.1 Sandbox Implementation

**File: `src/wasm/worker/js-sandbox.ts`**
```typescript
/**
 * Secure JavaScript sandbox for executing yt-dlp challenges.
 * Uses an iframe with restricted sandbox attributes.
 */

interface SandboxResult {
  success: boolean;
  result?: string;
  error?: string;
}

const SANDBOX_TIMEOUT = 5000; // 5 seconds max execution time

export async function executeJsChallenge(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('JavaScript execution timed out'));
    }, SANDBOX_TIMEOUT);

    // Create sandboxed iframe
    const iframe = document.createElement('iframe');
    iframe.sandbox.add('allow-scripts');
    iframe.style.display = 'none';
    document.body.appendChild(iframe);

    const cleanup = () => {
      clearTimeout(timeout);
      window.removeEventListener('message', handleMessage);
      document.body.removeChild(iframe);
    };

    const handleMessage = (event: MessageEvent<SandboxResult>) => {
      // Only accept messages from our iframe
      if (event.source !== iframe.contentWindow) return;

      cleanup();

      if (event.data.success) {
        resolve(event.data.result || '');
      } else {
        reject(new Error(event.data.error || 'Unknown sandbox error'));
      }
    };

    window.addEventListener('message', handleMessage);

    // Inject execution script into iframe
    const script = `
      <script>
        try {
          const result = (function() {
            ${code}
          })();
          parent.postMessage({ success: true, result: String(result) }, '*');
        } catch (error) {
          parent.postMessage({ 
            success: false, 
            error: error.message || String(error) 
          }, '*');
        }
      </script>
    `;

    iframe.srcdoc = script;
  });
}

// Expose to global scope for Pyodide access
(self as any).executeJsChallenge = executeJsChallenge;
```

---

## Phase 6: OTA Updates (Week 6)

### Goal
Enable over-the-air updates for WASM bundles on mobile.

### 6.1 Asset Version Manager

**File: `src/wasm/ota/version-manager.ts`**
```typescript
interface AssetManifest {
  version: string;
  timestamp: number;
  bundles: {
    name: string;
    url: string;
    hash: string;
    size: number;
  }[];
}

const MANIFEST_URL = 'https://updates.tubetape.app/manifest.json';
const CACHE_NAME = 'tubetape-wasm-assets';

export async function checkForUpdates(): Promise<boolean> {
  try {
    const response = await fetch(MANIFEST_URL);
    const manifest: AssetManifest = await response.json();
    
    const currentVersion = localStorage.getItem('tubetape_wasm_version');
    
    if (!currentVersion || manifest.version > currentVersion) {
      return true;
    }
    
    return false;
  } catch (error) {
    console.warn('Failed to check for updates:', error);
    return false;
  }
}

export async function downloadUpdates(
  onProgress?: (bundle: string, percent: number) => void
): Promise<void> {
  const response = await fetch(MANIFEST_URL);
  const manifest: AssetManifest = await response.json();
  
  const cache = await caches.open(CACHE_NAME);
  
  for (const bundle of manifest.bundles) {
    onProgress?.(bundle.name, 0);
    
    const bundleResponse = await fetch(bundle.url);
    const data = await bundleResponse.arrayBuffer();
    
    // Verify hash
    const hash = await crypto.subtle.digest('SHA-256', data);
    const hashHex = Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    if (hashHex !== bundle.hash) {
      throw new Error(`Hash mismatch for ${bundle.name}`);
    }
    
    // Cache the bundle
    await cache.put(bundle.url, new Response(data));
    
    onProgress?.(bundle.name, 100);
  }
  
  localStorage.setItem('tubetape_wasm_version', manifest.version);
}

export async function getCachedAsset(url: string): Promise<Response | null> {
  const cache = await caches.open(CACHE_NAME);
  return await cache.match(url);
}
```

---

## Testing Strategy

### Unit Tests
```typescript
// src/wasm/__tests__/http-bridge.spec.ts
// src/wasm/__tests__/pyodide-loader.spec.ts
// src/wasm/__tests__/ffmpeg-bridge.spec.ts
// src/wasm/__tests__/js-sandbox.spec.ts
```

### Integration Tests
```typescript
// src/wasm/__tests__/integration/youtube-extraction.spec.ts
describe('YouTube Extraction', () => {
  it('should extract video info', async () => {
    await pyodideManager.init();
    const info = await pyodideManager.extractInfo(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    );
    expect(info.title).toBeDefined();
    expect(info.formats).toBeInstanceOf(Array);
  });
});
```

### E2E Tests
```typescript
// e2e/wasm-extraction.spec.ts
test('full audio extraction flow', async ({ page }) => {
  await page.goto('/');
  await page.fill('[data-testid="url-input"]', 'https://youtu.be/dQw4w9WgXcQ');
  await page.click('[data-testid="extract-button"]');
  
  // Wait for extraction to complete
  await expect(page.locator('[data-testid="waveform"]')).toBeVisible({
    timeout: 60000
  });
});
```

---

## Rollout Strategy

### Stage 1: Desktop Beta
- Feature flag: `ENABLE_WASM_EXTRACTION`
- A/B test against binary extraction
- Monitor: bundle size, extraction time, success rate

### Stage 2: Mobile Alpha
- iOS TestFlight / Android Beta track
- Limited to new users
- Focus on stability and crash rates

### Stage 3: Full Release
- Remove feature flag
- Remove binary dependencies
- Update documentation

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Bundle size reduction | >50% | Compare WASM vs binary |
| Extraction success rate | >95% | Same as binary baseline |
| Time to first audio | <15s | P90 measurement |
| iOS/Android crash rate | <0.1% | Crash analytics |
| OTA update latency | <30s | Update download time |

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Pyodide loading slow | High | Progressive loading, caching |
| Memory issues on iOS | High | Chunked processing, limits |
| YouTube blocks WASM | Medium | Fallback to server proxy |
| ffmpeg.wasm performance | Medium | Mediabunny for common formats |
| OTA update failures | Low | Rollback mechanism, retry logic |

---

## Next Steps

1. **Week 1**: Complete Phase 0-1 (Foundation + HTTP Bridge)
2. **Week 2-3**: Complete Phase 2-3 (Pyodide + yt-dlp)
3. **Week 4-5**: Complete Phase 4-5 (FFmpeg + JS Sandbox)
4. **Week 6**: Complete Phase 6 (OTA Updates)
5. **Week 7-8**: Testing, optimization, and rollout
