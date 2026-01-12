# Pyodide + yt-dlp Integration Guide

> **Audience**: New developers getting up to speed with Tubetape's audio extraction system

## TL;DR

Tubetape runs **yt-dlp inside a browser via WebAssembly (Pyodide)** so users don't need to install anything. This required solving three hard problems:

1. **CORS** - Browsers block YouTube requests → Route HTTP through native Rust
2. **Safari/No JSPI** - Can't use synchronous Python calls → Exception-based async yielding
3. **Subprocess spawning** - WASM can't spawn ffmpeg → Queue commands, execute natively

The result: A zero-config desktop app that extracts YouTube audio with no user setup.

---

## Table of Contents

1. [Why Pyodide?](#why-pyodide)
2. [Architecture Overview](#architecture-overview)
3. [The Three Hard Problems](#the-three-hard-problems)
4. [Data Flow Walkthrough](#data-flow-walkthrough)
5. [Key Files Reference](#key-files-reference)
6. [The Exception-Based Async Pattern](#the-exception-based-async-pattern)
7. [HTTP Request Flow](#http-request-flow)
8. [Download Flow](#download-flow)
9. [FFmpeg Integration](#ffmpeg-integration)
10. [JavaScript Challenge Solving](#javascript-challenge-solving)
11. [Worker-Client Communication](#worker-client-communication)
12. [Common Debugging](#common-debugging)

---

## Why Pyodide?

### The Problem

yt-dlp is a Python tool that:
- Needs frequent updates (YouTube changes anti-bot measures constantly)
- Requires ffmpeg for audio conversion
- Uses HTTP requests that browsers block due to CORS
- Spawns subprocesses (impossible in browsers)

### Traditional Solutions (All Bad)

| Approach | Problem |
|----------|---------|
| Ship yt-dlp binary | Users must configure PATH, codesigning hell on macOS |
| Require system Python | "Works on my machine" syndrome |
| Backend server | Privacy concerns, hosting costs, single point of failure |
| Ask users to install dependencies | Friction kills adoption |

### Our Solution: Pyodide

[Pyodide](https://pyodide.org/) compiles CPython to WebAssembly. We run the **entire Python interpreter** in the browser, including yt-dlp. Benefits:

- **Zero user setup** - Everything runs in the app
- **OTA updates** - Update yt-dlp without app store review
- **Privacy** - All processing happens locally
- **Cross-platform** - Same code works everywhere

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Tubetape Application                             │
├─────────────────────────────────────────────────────────────────────────┤
│  React Frontend                                                          │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │                        PyodideClient                                │ │
│  │                   (src/wasm/pyodide-client.ts)                      │ │
│  │  - Manages worker lifecycle                                         │ │
│  │  - Handles Tauri invoke bridging                                    │ │
│  │  - Progress/log event routing                                       │ │
│  └────────────────────────┬───────────────────────────────────────────┘ │
│                           │ postMessage                                  │
│  ┌────────────────────────▼───────────────────────────────────────────┐ │
│  │                     Web Worker                                      │ │
│  │               (src/wasm/pyodide-worker.ts)                          │ │
│  │                                                                     │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                 │ │
│  │  │  Pyodide    │  │  HTTP Queue │  │  FFmpeg     │                 │ │
│  │  │  (Python)   │  │  Manager    │  │  Queue      │                 │ │
│  │  │             │  │             │  │             │                 │ │
│  │  │  yt-dlp     │◄─┤  Async      │  │  Commands   │                 │ │
│  │  │  (patched)  │  │  Polling    │  │  Deferred   │                 │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                 │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                           │ tauri_invoke messages                        │
├───────────────────────────┼─────────────────────────────────────────────┤
│  Tauri Rust Backend       │                                              │
│  ┌────────────────────────▼───────────────────────────────────────────┐ │
│  │  http.rs              │  ffmpeg_dlopen.rs                          │ │
│  │  - http_request       │  - dlopen_ffmpeg                           │ │
│  │  - download_to_file   │  - execute_js_challenge                    │ │
│  │  (reqwest, no CORS)   │  (dlopen libffmpeg.dylib)                  │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## The Three Hard Problems

### Problem 1: CORS (Cross-Origin Resource Sharing)

**What**: Browsers block JavaScript from making HTTP requests to different domains (like youtube.com) unless the server explicitly allows it. YouTube doesn't.

**Why it matters**: yt-dlp needs to fetch video metadata, format lists, and download URLs from YouTube.

**Our solution**: Route ALL HTTP requests through native Rust code. The Rust HTTP client (reqwest) isn't subject to browser CORS restrictions.

```
Python (yt-dlp)  →  JavaScript Bridge  →  Tauri invoke  →  Rust (reqwest)  →  YouTube
                                                                              │
Python (yt-dlp)  ←  JavaScript Bridge  ←  Tauri response ←  Rust            ←─┘
```

### Problem 2: Safari Has No JSPI

**What**: JSPI (JavaScript Promise Integration) lets WebAssembly code call async JavaScript functions synchronously. Safari doesn't support it.

**Why it matters**: Pyodide has `run_sync()` that uses JSPI to block Python while JavaScript does async work. Without it, Python can't wait for HTTP responses.

**Our solution**: Exception-based async yielding pattern. Instead of blocking:

1. Python tries to make HTTP request
2. If response not cached → Python throws `_HTTPNeeded` exception
3. JavaScript catches exception, makes async request, caches response
4. JavaScript restarts Python from the beginning
5. Python finds cached response, continues execution

This is essentially manual cooperative multitasking.

### Problem 3: WASM Can't Spawn Subprocesses

**What**: WebAssembly runs in a sandbox with no access to the operating system. It cannot spawn child processes.

**Why it matters**: yt-dlp calls `subprocess.run(['ffmpeg', ...])` to convert audio formats.

**Our solution**: Two-phase execution:

1. **Phase 1 (Python)**: yt-dlp runs, ffmpeg calls are intercepted and queued (not executed)
2. **Phase 2 (Native)**: After Python completes, JavaScript sends queued commands to Rust, which executes ffmpeg via dlopen

```python
# Python thinks this works:
subprocess.run(['ffmpeg', '-i', 'input.webm', 'output.aac'])

# Actually happens:
# 1. Our patch intercepts the call
# 2. Command is queued: {command: 'ffmpeg', args: [...]}
# 3. Fake success returned to Python
# 4. After Python exits, Rust executes the real ffmpeg
```

---

## Data Flow Walkthrough

### Complete Audio Extraction Flow

```
User pastes YouTube URL
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 1. PyodideClient.extractAudio(url, outputPath)                  │
│    - Sends message to worker                                     │
│    - Sets up progress listeners                                  │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. Worker receives 'extract_audio' message                       │
│    - Calls Python: extract_audio_async(url, outputPath)          │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. Python yt-dlp starts extraction                               │
│    - First iteration: needs HTTP request                         │
│    - Throws _HTTPNeeded("https://youtube.com/watch?v=...")       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. JavaScript catches exception                                  │
│    - Queues HTTP request                                         │
│    - Calls Tauri: http_request(url, method, headers, body)       │
│    - Rust makes actual HTTP request                              │
│    - Caches response                                             │
│    - Restarts Python from beginning                              │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼ (repeat 10-50 times for all HTTP requests)
┌─────────────────────────────────────────────────────────────────┐
│ 5. Python eventually completes with video info                   │
│    - All HTTP requests satisfied from cache                      │
│    - FFmpeg commands queued (not executed yet)                   │
│    - Returns video metadata + FFmpeg queue                       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 6. JavaScript executes FFmpeg queue                              │
│    - For each command: Tauri invoke dlopen_ffmpeg                │
│    - Rust loads libffmpeg.dylib via dlopen                       │
│    - Calls ffmpeg_lib_main(argc, argv)                           │
│    - Captures stdout/stderr                                      │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│ 7. Audio file ready on disk                                      │
│    - Client notified of completion                               │
│    - Waveform rendered                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/wasm/pyodide-client.ts` | Main API for React components. Manages worker, handles Tauri bridging |
| `src/wasm/pyodide-worker.ts` | Web Worker that runs Pyodide. Contains HTTP/download/FFmpeg queues |
| `public/pyodide/patches/loader.py` | Python entry point, applies all patches |
| `public/pyodide/patches/http_adapter.py` | Patches yt-dlp HTTP to use our bridge |
| `public/pyodide/patches/dlopen_adapter.py` | Patches subprocess.run to intercept ffmpeg |
| `public/pyodide/patches/jsc_provider.py` | JS challenge solver routing to host WebView |
| `src-tauri/src/http.rs` | Rust HTTP client (reqwest), CORS-free |
| `src-tauri/src/ffmpeg_dlopen.rs` | Rust FFmpeg execution via dlopen |

---

## The Exception-Based Async Pattern

This is the core innovation that makes Safari work. Here's how it operates:

### In Python (pyodide-worker.ts, embedded Python)

```python
# Cache for completed HTTP responses
_http_cache = {}

# Custom exception to signal "need HTTP"
class _HTTPNeeded(Exception):
    def __init__(self, url, method, headers, data, cache_key):
        self.url = url
        self.cache_key = cache_key
        # ... store request details

# Patched urlopen - check cache or throw
def _cached_urlopen(self, req):
    cache_key = (url, method, headers_str, body_preview)
    
    # Cache hit → return cached response
    if cache_key in _http_cache:
        return Response(io.BytesIO(_http_cache[cache_key]['body']), ...)
    
    # Cache miss → throw exception
    raise _HTTPNeeded(url, method, headers, data, cache_key)

# Main extraction loop
async def extract_info_async(url):
    _http_cache.clear()  # Start fresh
    
    max_iterations = 100
    for iteration in range(max_iterations):
        try:
            # Try to extract (will throw if HTTP needed)
            result = YoutubeDL(opts).extract_info(url)
            return result  # Success!
            
        except _HTTPNeeded as e:
            # Make the HTTP request
            response = await _do_http_async(e.url, e.method, e.headers, e.data)
            # Cache it
            _http_cache[e.cache_key] = response
            # Loop continues, Python will retry from scratch
```

### Why This Works

1. **Pure Python code remains synchronous** - yt-dlp doesn't need modification
2. **Async happens in JavaScript** - `await js.waitForHTTPResponse()` works fine
3. **Progress via iteration** - Each loop adds one cached response
4. **Eventual completion** - After enough iterations, all requests are cached

### Trade-offs

| Pro | Con |
|-----|-----|
| Works on Safari | Restarts Python repeatedly (10-50+ times) |
| No JSPI dependency | Higher CPU usage |
| Clean separation | Can't show real-time progress during iteration |
| Deterministic | Slightly slower than native |

---

## HTTP Request Flow

### JavaScript Side (pyodide-worker.ts)

```typescript
// Queue for pending HTTP requests
const httpRequestQueue: Map<string, QueuedHTTPRequest> = new Map();

// Called from Python via js.queueHTTPRequest()
function queueHTTPRequest(url, method, headers, body): string {
    const id = `http_${++httpRequestIdCounter}`;
    
    httpRequestQueue.set(id, {
        id, url, method, headers, body,
        status: 'pending',
        queuedAt: Date.now()
    });
    
    // Trigger async processing (doesn't block)
    triggerHTTPProcessing();
    
    return id;  // Return immediately
}

// Process queue via Tauri
async function processHTTPQueue() {
    const pending = Array.from(httpRequestQueue.values())
        .filter(r => r.status === 'pending');
    
    for (const request of pending) {
        request.status = 'processing';
        
        // Call Rust
        const response = await invokeTauri('http_request', {
            url: request.url,
            method: request.method,
            headers: request.headers,
            body: request.body
        });
        
        request.status = 'completed';
        request.response = response;
    }
}

// Python calls this to wait for result
function waitForHTTPResponse(id): Promise<QueuedHTTPRequest> {
    return new Promise((resolve) => {
        function checkResult() {
            const request = httpRequestQueue.get(id);
            if (request?.status === 'completed' || request?.status === 'error') {
                resolve(request);
                return;
            }
            setTimeout(checkResult, 100);  // Poll
        }
        setTimeout(checkResult, 100);
    });
}
```

### Rust Side (http.rs)

```rust
#[tauri::command]
pub async fn http_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 ...")  // Spoof browser UA
        .build()?;
    
    let mut request = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        // ...
    };
    
    for (key, value) in headers {
        request = request.header(&key, &value);
    }
    
    let response = request.send().await?;
    
    Ok(HttpResponse {
        status: response.status().as_u16(),
        headers: /* extract headers */,
        body: response.text().await?
    })
}
```

---

## Download Flow

For large files (video/audio streams), we download directly to disk instead of passing through JavaScript:

```typescript
// Python calls js.queueDownload()
function queueDownload(url, outputPath, headers): string {
    const id = `dl_${++downloadIdCounter}`;
    
    downloadQueue.set(id, {
        id, url, outputPath, headers,
        status: 'pending'
    });
    
    triggerDownloadProcessing();
    return id;
}

// Rust writes directly to disk
#[tauri::command]
pub async fn download_to_file(
    url: String,
    output_path: String,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    let response = client.get(&url).send().await?;
    let bytes = response.bytes().await?;
    
    // Write to filesystem (no memory pressure)
    let mut file = tokio::fs::File::create(&output_path).await?;
    file.write_all(&bytes).await?;
    
    Ok(())
}
```

---

## FFmpeg Integration

### The Queue Approach

Since Python can't execute ffmpeg directly, we queue commands:

```typescript
// In pyodide-worker.ts
const ffmpegCommandQueue: FFmpegCommand[] = [];

// Called from Python's patched subprocess.run
function nativeFFmpegAdapter(command, args) {
    // Don't execute - just queue
    const cmd: FFmpegCommand = {
        id: `ffmpeg_${++commandIdCounter}`,
        command,  // 'ffmpeg' or 'ffprobe'
        args,
        status: 'pending'
    };
    
    ffmpegCommandQueue.push(cmd);
    
    // Return fake success to Python
    return {
        exit_code: 0,
        stdout: new Uint8Array(),
        stderr: new Uint8Array()
    };
}
```

### Execution Phase

After Python completes, we execute queued commands:

```typescript
async function executeQueuedFFmpegCommands() {
    for (const cmd of ffmpegCommandQueue.filter(c => c.status === 'pending')) {
        cmd.status = 'running';
        
        const result = await invokeTauri('dlopen_ffmpeg', {
            command: cmd.command,
            args: cmd.args
        });
        
        cmd.status = result.exit_code === 0 ? 'completed' : 'error';
        cmd.result = result;
    }
}
```

### Rust dlopen Execution (ffmpeg_dlopen.rs)

```rust
// Load FFmpeg as a dynamic library
unsafe fn load_ffmpeg(lib_path: &PathBuf) -> Result<FFmpegLibrary, String> {
    let handle = libc::dlopen(lib_path.as_ptr(), libc::RTLD_NOW);
    
    // Get function pointers
    let ffmpeg_main: FFmpegLibMain = transmute(
        libc::dlsym(handle, "ffmpeg_lib_main")
    );
    let ffprobe_main: FFprobeLibMain = transmute(
        libc::dlsym(handle, "ffprobe_lib_main")
    );
    
    Ok(FFmpegLibrary { handle, ffmpeg_main, ffprobe_main, ... })
}

#[tauri::command]
pub async fn dlopen_ffmpeg(
    command: String,
    args: Vec<String>,
) -> Result<FFmpegResult, String> {
    let lib = load_ffmpeg(&lib_path)?;
    
    // Convert args to C strings
    let c_args: Vec<CString> = args.iter()
        .map(|s| CString::new(s.as_str()).unwrap())
        .collect();
    let argv: Vec<*const c_char> = c_args.iter()
        .map(|s| s.as_ptr())
        .collect();
    
    // Call ffmpeg
    let result = match command.as_str() {
        "ffmpeg" => (lib.ffmpeg_main)(argv.len(), argv.as_ptr()),
        "ffprobe" => (lib.ffprobe_main)(argv.len(), argv.as_ptr()),
    };
    
    Ok(FFmpegResult {
        exit_code: result.exit_code,
        stdout: read_temp_file(stdout_path),
        stderr: read_temp_file(stderr_path)
    })
}
```

---

## JavaScript Challenge Solving

YouTube uses JavaScript "nsig" challenges to generate valid download URLs. These are obfuscated JavaScript functions that must be executed to decrypt URL signatures. Traditionally, yt-dlp requires a separate JS runtime like Deno, Node.js, or QuickJS.

### The Elegant Solution: Sandboxed Iframe Execution

Since Tubetape runs in Tauri with a WebView, we leverage the browser's JavaScript engine to execute challenges directly via a **sandboxed iframe**. **No separate JS runtime binary needed!**

This is a significant win:
- **Zero additional binaries** - No QuickJS/Deno/Node to bundle
- **Smaller app size** - Saves ~2-5MB per platform
- **No codesigning complexity** - One less binary to sign
- **Always up-to-date JS engine** - Uses system WebView (Safari/WebKit on macOS, WebView2 on Windows)
- **Security via sandbox** - Code runs in an isolated iframe with restrictive CSP

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│  Python (yt-dlp)                                                 │
│  - Encounters nsig challenge                                     │
│  - Throws _JSCNeeded(BaseException) with JavaScript code         │
│  - BaseException bypasses yt-dlp's internal error handlers       │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  JavaScript (pyodide-worker.ts)                                  │
│  - Catches _JSCNeeded in extraction loop                         │
│  - Queues challenge: queueJSChallenge(code)                      │
│  - Sends 'js_sandbox_execute' message to main thread             │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  PyodideClient (pyodide-client.ts - main thread)                 │
│  - Receives 'js_sandbox_execute' message                         │
│  - Calls runCodeInSandboxedIframe(code)                          │
│  - Transforms npm: imports to https://esm.sh/                    │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Sandboxed Iframe (/jsc-sandbox.html)                            │
│  - Loaded with sandbox="allow-scripts" (no same-origin)          │
│  - Restrictive CSP: only esm.sh for external imports             │
│  - Creates Blob URL from code, imports as ES module              │
│  - Captures console.log/warn/error output                        │
│  - Returns result via MessageChannel (port transfer)             │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  Worker receives result                                          │
│  - Result cached in _jsc_cache                                   │
│  - Extraction loop restarts                                      │
│  - _run_deno() finds cache hit, returns result                   │
│  - yt-dlp uses decrypted signature for full-speed downloads      │
└─────────────────────────────────────────────────────────────────┘
```

### Custom JS Challenge Provider

We register a custom provider that uses the exception-based pattern (same as HTTP). Note that `_JSCNeeded` extends `BaseException` instead of `Exception` to bypass yt-dlp's internal error handling:

```python
# In pyodide-worker.ts embedded Python
class _JSCNeeded(BaseException):  # BaseException, not Exception!
    def __init__(self, code, cache_key):
        self.code = code
        self.cache_key = cache_key
        super().__init__(f"JSC challenge needed")

@register_provider
class TubetapeJCP(DenoJCP):
    PROVIDER_NAME = 'Tubetape'
    JS_RUNTIME_NAME = 'Tubetape'
    
    def is_available(self):
        return True  # Always available - we ARE the browser!
    
    def _run_deno(self, stdin, options):
        # Check cache first (challenges are deterministic)
        cache_key = hash(stdin[:500])
        if cache_key in _jsc_cache:
            return _jsc_cache[cache_key]
        
        # Need to execute - throw BaseException for async handling
        raise _JSCNeeded(stdin, cache_key)

# Register with highest priority so yt-dlp uses us
@register_preference(TubetapeJCP)
def jsc_preference(*_):
    return 99999999999  # Always prefer our provider
```

### Sandbox Execution Flow

The worker queues challenges and communicates with the main thread:

```typescript
// Worker (pyodide-worker.ts) - queues and sends to main thread
async function executeJSInSandbox(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = `jsc_exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
    // Listen for result from main thread
    const handler = (event: MessageEvent) => {
      if (event.data?.type === 'js_sandbox_result' && event.data?.id === requestId) {
        self.removeEventListener('message', handler);
        if (event.data.success) {
          resolve(event.data.result);
        } else {
          reject(new Error(event.data.error));
        }
      }
    };
    
    self.addEventListener('message', handler);
    
    // Send code to main thread for sandboxed execution
    self.postMessage({
      type: 'js_sandbox_execute',
      id: requestId,
      code: code
    });
  });
}
```

The main thread creates a sandboxed iframe:

```typescript
// Client (pyodide-client.ts) - creates sandboxed iframe
private runCodeInSandboxedIframe(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Transform npm: imports to esm.sh CDN
    const transformedCode = code.split("await import('npm:").join("await import('https://esm.sh/");
    
    // Create sandboxed iframe (no same-origin access)
    const iframe = document.createElement('iframe');
    iframe.sandbox.add('allow-scripts');  // Only scripts, no DOM access
    iframe.style.display = 'none';
    
    // Use MessageChannel for secure communication
    const channel = new MessageChannel();
    
    channel.port1.onmessage = (e: MessageEvent) => {
      iframe.remove();
      if (e.data.error) {
        reject(new Error(e.data.error));
      } else {
        resolve(e.data.result);  // Console output captured as result
      }
    };

    // Wait for sandbox to be ready, then send code + port
    const readyHandler = (e: MessageEvent) => {
      if (e.data?.type === 'sandbox_ready' && e.source === iframe.contentWindow) {
        window.removeEventListener('message', readyHandler);
        iframe.contentWindow?.postMessage(transformedCode, '*', [channel.port2]);
      }
    };
    window.addEventListener('message', readyHandler);

    iframe.src = '/jsc-sandbox.html';
    document.body.appendChild(iframe);
  });
}
```

### The Sandbox HTML (jsc-sandbox.html)

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <!-- Restrictive CSP: only inline scripts and esm.sh for imports -->
  <meta http-equiv="Content-Security-Policy" 
        content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: https://esm.sh; connect-src https://esm.sh;">
</head>
<body>
<script type="module">
window.addEventListener('message', async (e) => {
  if (e.source !== window.parent) return;
  
  const port = e.ports[0];
  const code = e.data;
  const logs = [];
  
  // Capture all console output
  const capture = (...args) => logs.push(args.map(String).join(' '));
  console.log = capture;
  console.warn = capture;
  console.error = capture;
  
  try {
    // Execute as ES module via blob URL
    const blob = new Blob([code], { type: 'text/javascript' });
    const url = URL.createObjectURL(blob);
    await import(url);
    URL.revokeObjectURL(url);
    
    // Return captured console output (contains challenge result)
    port.postMessage({ result: logs.join('\n') });
  } catch (err) {
    port.postMessage({ error: err.message || String(err) });
  }
});

// Signal ready to parent
window.parent.postMessage({ type: 'sandbox_ready' }, '*');
</script>
</body>
</html>
```

### Why This Is Cool

Most applications that need to run arbitrary JavaScript ship a separate runtime:
- Electron apps bundle V8
- Native apps bundle QuickJS or Duktape
- CLI tools require Node.js installation

Tubetape gets JavaScript execution **for free** because we're already running inside a browser. The sandboxed iframe approach provides:

1. **Security** - Code runs in an isolated context with no access to the main app
2. **ES Module support** - Can `import()` from esm.sh CDN for npm packages
3. **Console capture** - Challenge results are output via `console.log()`
4. **No binary overhead** - Uses the system's WebView JS engine
5. **Full compatibility** - Works on all platforms (macOS Safari WebView, Windows WebView2, Linux WebKitGTK)

---

## Worker-Client Communication

### Message Types

```typescript
// Client → Worker
interface WorkerMessage {
    id: string;
    type: 'init' | 'extract_info' | 'extract_audio' | 'execute_ffmpeg' | 'set_verbose';
    payload?: unknown;
}

// Worker → Client (responses)
interface WorkerResponse {
    id: string;
    success: boolean;
    data?: unknown;
    error?: string;
}

// Worker → Client (events)
type WorkerEvent = 
    | { type: 'log', data: LogMessage }
    | { type: 'progress', data: DownloadProgress }
    | { type: 'tauri_invoke', id: string, command: string, args: object };
```

### Tauri Bridge

Workers can't call Tauri directly. We proxy through the main thread:

```typescript
// Worker sends request
self.postMessage({
    type: 'tauri_invoke',
    id: 'tauri_123',
    command: 'http_request',
    args: { url, method, headers, body }
});

// Client receives, calls Tauri, sends response
async function handleTauriInvoke(id, command, args) {
    const result = await invoke(command, args);
    worker.postMessage({
        type: 'tauri_response',
        id,
        success: true,
        data: result
    });
}

// Worker receives response
function handleTauriResponse(response) {
    const pending = pendingTauriCalls.get(response.id);
    pending.resolve(response.data);
}
```

---

## Common Debugging

### Console Log Prefixes

| Prefix | Source |
|--------|--------|
| `[pyodide-client]` | PyodideClient class (main thread) |
| `[pyodide-worker]` | Worker initialization and message handling |
| `[pyodide-stdout]` / `[pyodide-stderr]` | Python print output |
| `[yt-dlp]` | yt-dlp log messages |
| `[http_adapter]` | HTTP patch messages |
| `[dlopen_adapter]` | FFmpeg intercept messages |
| `[ffmpeg_dlopen]` | Rust FFmpeg execution |

### Common Issues

**"HTTP request failed: network error"**
- Check if Tauri http_request command is registered
- Check if URL is valid
- Check Rust logs for reqwest errors

**"Too many iterations (100)"**
- Infinite loop in HTTP caching
- Check if cache key is consistent between requests
- May indicate YouTube API change

**"FFmpeg library not found"**
- Check `src-tauri/binaries/ffmpeg/libffmpeg.dylib` exists
- Check library path resolution in Rust

**"Worker not initialized"**
- Call `client.init()` before other methods
- Check browser console for Pyodide loading errors

### Verbose Mode

```typescript
const client = getPyodideClient();
await client.setVerbose(true);  // Shows all HTTP requests and responses
```

---

## Summary

The Pyodide + yt-dlp integration is complex but achieves a simple goal: **zero-config audio extraction**. The key insights are:

1. **Route HTTP through native code** to bypass CORS
2. **Use exception-based async** to avoid JSPI dependency
3. **Queue FFmpeg commands** for post-Python execution
4. **Bridge worker ↔ Tauri** through message passing

This architecture adds complexity but delivers a dramatically better user experience compared to requiring users to install Python, yt-dlp, and ffmpeg manually.
