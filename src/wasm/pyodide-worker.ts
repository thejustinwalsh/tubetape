/**
 * Pyodide Web Worker
 * 
 * ARCHITECTURE (Safari-compatible, no JSPI/run_sync):
 * 
 * HTTP Requests (metadata, etc):
 * 1. Python calls queueHTTPRequest() - returns request ID immediately
 * 2. JS processes queue async via Tauri HTTP
 * 3. Python calls pollHTTPResponse(id) - returns result when ready
 * 
 * Downloads (video/audio streams):
 * 1. Python calls queueDownload() - returns download ID immediately  
 * 2. Native Tauri downloads directly to disk
 * 3. Python calls pollDownloadStatus(id) - returns completion status
 * 4. File exists on disk when done
 * 
 * FFmpeg (conversion):
 * 1. Python calls nativeFFmpegAdapter() - queues command, returns fake success
 * 2. After yt-dlp completes, JS executes FFmpeg on native side
 * 3. Output file exists on disk when done
 */

import type { PyodideInterface } from 'pyodide';

// ============================================================================
// Tauri IPC via Main Thread (workers can't call invoke directly)
// ============================================================================

interface TauriResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

const pendingTauriCalls = new Map<string, {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}>();
let tauriCallIdCounter = 0;

function invokeTauri<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = `tauri_${++tauriCallIdCounter}`;
    pendingTauriCalls.set(id, { 
      resolve: resolve as (data: unknown) => void, 
      reject 
    });
    
    self.postMessage({
      type: 'tauri_invoke',
      id,
      command,
      args
    });
  });
}

function handleTauriResponse(response: TauriResponse): void {
  const pending = pendingTauriCalls.get(response.id);
  if (!pending) return;
  
  pendingTauriCalls.delete(response.id);
  
  if (response.success) {
    pending.resolve(response.data);
  } else {
    pending.reject(new Error(response.error || 'Tauri call failed'));
  }
}

let pyodide: PyodideInterface | null = null;
let isInitialized = false;
let verboseMode = false;

// ============================================================================
// Stdout/Stderr Streaming for Real-time Progress
// ============================================================================

type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'progress';

interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: number;
  source: 'stdout' | 'stderr' | 'yt-dlp';
}

interface DownloadProgress {
  percent: number;
  downloaded: string;
  total: string;
  speed: string;
  eta: string;
}

const logBuffer: LogMessage[] = [];
let stdoutBuffer: number[] = [];
let stderrBuffer: number[] = [];
const decoder = new TextDecoder('utf-8');
const lineDelimiters = [0x0a, 0x0d]; // \n and \r

function parseYtDlpProgress(line: string): DownloadProgress | null {
  // Parse: [download]  50.0% of 10.00MiB at 1.00MiB/s ETA 00:05
  const progressMatch = line.match(/\[download\]\s+(\d+\.?\d*)%\s+of\s+~?([\d.]+\w+)\s+at\s+([\d.]+\w+\/s)(?:\s+ETA\s+(\S+))?/);
  if (progressMatch) {
    return {
      percent: parseFloat(progressMatch[1]),
      downloaded: '',
      total: progressMatch[2],
      speed: progressMatch[3],
      eta: progressMatch[4] || 'unknown'
    };
  }
  
  // Parse: [download] Destination: /path/to/file
  // Parse: [download] 100% of 10.00MiB in 00:05
  const completeMatch = line.match(/\[download\]\s+100%\s+of\s+([\d.]+\w+)/);
  if (completeMatch) {
    return {
      percent: 100,
      downloaded: completeMatch[1],
      total: completeMatch[1],
      speed: '',
      eta: '00:00'
    };
  }
  
  return null;
}

function determineLogLevel(line: string): LogLevel {
  if (line.includes('[download]') && line.includes('%')) return 'progress';
  if (line.includes('ERROR') || line.includes('Error')) return 'error';
  if (line.includes('WARNING') || line.includes('Warning')) return 'warning';
  if (line.includes('[debug]') || line.startsWith('DEBUG')) return 'debug';
  return 'info';
}

function processOutputLine(line: string, source: 'stdout' | 'stderr'): void {
  if (!line.trim()) return;
  
  const level = source === 'stderr' ? 'error' : determineLogLevel(line);
  
  const logEntry: LogMessage = {
    level,
    message: line,
    timestamp: Date.now(),
    source: line.includes('[') ? 'yt-dlp' : source
  };
  
  logBuffer.push(logEntry);
  
  if (logBuffer.length > 1000) {
    logBuffer.shift();
  }
  
  if (verboseMode || level === 'error' || level === 'warning' || level === 'progress') {
    console.log(`[pyodide-${source}]`, line);
  }
  
  const progress = parseYtDlpProgress(line);
  if (progress) {
    self.postMessage({
      type: 'progress',
      data: progress
    });
  }
  
  self.postMessage({
    type: 'log',
    data: logEntry
  });
}

function createStdoutHandler(): { raw: (byte: number) => void } {
  return {
    raw: (byte: number) => {
      if (lineDelimiters.includes(byte)) {
        if (stdoutBuffer.length > 0) {
          const line = decoder.decode(new Uint8Array(stdoutBuffer));
          processOutputLine(line, 'stdout');
          stdoutBuffer = [];
        }
      } else {
        stdoutBuffer.push(byte);
      }
    }
  };
}

function createStderrHandler(): { raw: (byte: number) => void } {
  return {
    raw: (byte: number) => {
      if (lineDelimiters.includes(byte)) {
        if (stderrBuffer.length > 0) {
          const line = decoder.decode(new Uint8Array(stderrBuffer));
          processOutputLine(line, 'stderr');
          stderrBuffer = [];
        }
      } else {
        stderrBuffer.push(byte);
      }
    }
  };
}

function getLogBuffer(): LogMessage[] {
  return [...logBuffer];
}

function clearLogBuffer(): void {
  logBuffer.length = 0;
}

function setVerboseMode(enabled: boolean): void {
  verboseMode = enabled;
  console.log(`[pyodide-worker] Verbose mode ${enabled ? 'enabled' : 'disabled'}`);
}

// ============================================================================
// FFmpeg Capabilities Cache
// ============================================================================

interface FFmpegCapabilities {
  version: string;
  bitstreamFilters: string[];
  configuration: string;
}

let ffmpegCapabilities: FFmpegCapabilities | null = null;

const STATIC_FFMPEG_CAPABILITIES: FFmpegCapabilities = {
  version: 'ffmpeg version 5.1.4 Copyright (c) 2000-2023 the FFmpeg developers',
  bitstreamFilters: [
    'aac_adtstoasc', 'av1_frame_merge', 'av1_frame_split', 'av1_metadata',
    'chomp', 'dump_extra', 'dca_core', 'dv_error_marker', 'eac3_core',
    'extract_extradata', 'filter_units', 'h264_metadata', 'h264_mp4toannexb',
    'h264_redundant_pps', 'hapqa_extract', 'hevc_metadata', 'hevc_mp4toannexb',
    'imxdump', 'mjpeg2jpeg', 'mjpegadump', 'mp3decomp', 'mpeg2_metadata',
    'mpeg4_unpack_bframes', 'mov2textsub', 'noise', 'null', 'opus_metadata',
    'pcm_rechunk', 'pgs_frame_merge', 'prores_metadata', 'remove_extra',
    'setts', 'text2movsub', 'trace_headers', 'truehd_core', 'vp9_metadata',
    'vp9_raw_reorder', 'vp9_superframe', 'vp9_superframe_split'
  ],
  configuration: '--target-os=none --arch=x86_32 --enable-cross-compile'
};

async function initFFmpegCapabilities(): Promise<void> {
  if (ffmpegCapabilities) return;
  
  try {
    const result = await invokeTauri<{ exitCode: number; stdout: string; stderr: string }>('ffprobe_capabilities');
    if (result.exitCode === 0) {
      ffmpegCapabilities = parseFFmpegCapabilities(result.stdout, result.stderr);
      console.log('[pyodide-worker] FFmpeg capabilities loaded from native');
      return;
    }
  } catch {
    // Fall back to static
  }
  
  ffmpegCapabilities = STATIC_FFMPEG_CAPABILITIES;
  console.log('[pyodide-worker] Using static FFmpeg capabilities');
}

function parseFFmpegCapabilities(stdout: string, stderr: string): FFmpegCapabilities {
  const filters = stdout.split('\n').filter(line => line.trim() && !line.startsWith('Bitstream'));
  const versionMatch = stderr.match(/ffmpeg version ([^\n]+)/);
  const configMatch = stderr.match(/configuration: ([^\n]+)/);
  
  return {
    version: versionMatch ? versionMatch[1] : STATIC_FFMPEG_CAPABILITIES.version,
    bitstreamFilters: filters.length > 0 ? filters : STATIC_FFMPEG_CAPABILITIES.bitstreamFilters,
    configuration: configMatch ? configMatch[1] : STATIC_FFMPEG_CAPABILITIES.configuration
  };
}

// ============================================================================
// HTTP Request Queue (Polling Pattern)
// ============================================================================

interface QueuedHTTPRequest {
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string | null;
  status: 'pending' | 'processing' | 'completed' | 'error';
  response?: {
    status: number;
    headers: Record<string, string>;
    body: string;
  };
  error?: string;
  queuedAt: number;
  lastActivity: number;
  timeoutMs: number;
}

interface QueuedDownload {
  id: string;
  url: string;
  outputPath: string;
  headers: Record<string, string>;
  status: 'pending' | 'processing' | 'completed' | 'error';
  bytesDownloaded?: number;
  totalBytes?: number;
  error?: string;
  queuedAt: number;
  lastActivity: number;
  timeoutMs: number;
}

const httpRequestQueue: Map<string, QueuedHTTPRequest> = new Map();
let httpRequestIdCounter = 0;
let httpProcessingPromise: Promise<void> | null = null;

function toPlainObject(obj: unknown): Record<string, string> {
  if (!obj) return {};
  if (typeof obj !== 'object') return {};
  
  const result: Record<string, string> = {};
  const source = (obj as { toJs?: () => Record<string, string> }).toJs?.() ?? obj;
  
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    result[String(key)] = String(value);
  }
  return result;
}

function toPlainValue(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  if (typeof val === 'string') return val;
  if ((val as { toJs?: () => unknown }).toJs) {
    const converted = (val as { toJs: () => unknown }).toJs();
    return typeof converted === 'string' ? converted : JSON.stringify(converted);
  }
  if (typeof val === 'object') {
    return JSON.stringify(val);
  }
  return String(val);
}

function queueHTTPRequest(
  url: string, 
  method: string, 
  headers: unknown,
  body?: unknown
): string {
  const id = `http_${++httpRequestIdCounter}`;
  const plainHeaders = toPlainObject(headers);
  const plainBody = toPlainValue(body);
  
  httpRequestQueue.set(id, {
    id,
    url,
    method,
    headers: plainHeaders,
    body: plainBody,
    status: 'pending',
    queuedAt: Date.now(),
    lastActivity: Date.now(),
    timeoutMs: 5 * 60 * 1000, // 5 minutes
  });
  
  console.log(`[pyodide-worker] Queued HTTP ${method} ${url.slice(0, 60)}... (${id})`);
  
  // Trigger async processing (non-blocking)
  triggerHTTPProcessing();
  
  return id;
}

/**
 * Poll for HTTP response.
 * Called synchronously from Python, returns response or null if not ready.
 */
function pollHTTPResponse(id: string): QueuedHTTPRequest | null {
  const request = httpRequestQueue.get(id);
  if (!request) {
    console.warn(`[pyodide-worker] pollHTTPResponse: request ${id} not found`);
    return null;
  }
  
  if (request.status === 'completed' || request.status === 'error') {
    httpRequestQueue.delete(id);
    console.log(`[pyodide-worker] pollHTTPResponse(${id}): returning ${request.status} response`);
    return request;
  }
  
  return null;
}

/**
 * Returns a Promise that resolves when the HTTP request completes.
 * Uses setTimeout-based polling so JavaScript event loop can process the request.
 * Python awaits this Promise directly.
 */
function waitForHTTPResponse(id: string): Promise<QueuedHTTPRequest> {
  return new Promise((resolve, reject) => {
    const pollInterval = 100;
    const maxWaitMs = 5 * 60 * 1000;
    const startTime = Date.now();
    
    function checkResult() {
      const request = httpRequestQueue.get(id);
      
      if (!request) {
        reject(new Error(`Request ${id} not found`));
        return;
      }
      
      if (request.status === 'completed') {
        httpRequestQueue.delete(id);
        console.log(`[pyodide-worker] waitForHTTPResponse(${id}): completed`);
        resolve(request);
        return;
      }
      
      if (request.status === 'error') {
        httpRequestQueue.delete(id);
        console.log(`[pyodide-worker] waitForHTTPResponse(${id}): error`);
        resolve(request);
        return;
      }
      
      if (Date.now() - startTime > maxWaitMs) {
        request.status = 'error';
        request.error = 'Request timed out';
        httpRequestQueue.delete(id);
        resolve(request);
        return;
      }
      
      setTimeout(checkResult, pollInterval);
    }
    
    setTimeout(checkResult, pollInterval);
  });
}

/**
 * Check if an HTTP request is still pending.
 */
function isHTTPRequestPending(id: string): boolean {
  const request = httpRequestQueue.get(id);
  return request ? (request.status === 'pending' || request.status === 'processing') : false;
}

/**
 * Trigger async HTTP processing (non-blocking).
 * Uses setTimeout to ensure the async work can interleave with Python's blocking.
 */
function triggerHTTPProcessing(): void {
  if (httpProcessingPromise) {
    if (verboseMode) console.log('[pyodide-worker] HTTP processing already in progress');
    return;
  }
  
  if (verboseMode) console.log('[pyodide-worker] Scheduling HTTP queue processing...');
  
  setTimeout(() => {
    if (verboseMode) console.log('[pyodide-worker] Starting HTTP queue processing...');
    httpProcessingPromise = processHTTPQueue().finally(() => {
      if (verboseMode) console.log('[pyodide-worker] HTTP queue processing finished');
      httpProcessingPromise = null;
    });
  }, 0);
}

/**
 * Process all pending HTTP requests via Tauri.
 */
async function processHTTPQueue(): Promise<void> {
  const pending = Array.from(httpRequestQueue.values()).filter(r => r.status === 'pending');
  console.log(`[pyodide-worker] Processing ${pending.length} pending HTTP requests`);
  
  for (const request of pending) {
    request.status = 'processing';
    request.lastActivity = Date.now();
    
    if (verboseMode) console.log(`[pyodide-worker] Invoking Tauri http_request for ${request.id}: ${request.url.slice(0, 60)}...`);
    
    try {
      const response = await invokeTauri<{
        status: number;
        headers: Record<string, string>;
        body: string;
      }>('http_request', {
        url: request.url,
        method: request.method,
        headers: request.headers,
        body: request.body,
      });
      
      console.log(`[pyodide-worker] HTTP request ${request.id} completed with status ${response.status}`);
      request.status = 'completed';
      request.response = response;
    } catch (error) {
      console.error(`[pyodide-worker] HTTP request ${request.id} failed:`, error);
      request.status = 'error';
      request.error = error instanceof Error ? error.message : String(error);
    }
  }
}

// ============================================================================
// Download Queue (Native Download to Disk)
// ============================================================================

interface QueuedDownload {
  id: string;
  url: string;
  outputPath: string;
  headers: Record<string, string>;
  status: 'pending' | 'processing' | 'completed' | 'error';
  bytesDownloaded?: number;
  totalBytes?: number;
  error?: string;
}

const downloadQueue: Map<string, QueuedDownload> = new Map();
let downloadIdCounter = 0;
let downloadProcessingPromise: Promise<void> | null = null;
let timeoutCheckInterval: number | null = null;

function queueDownload(
  url: string,
  outputPath: string,
  headers: unknown
): string {
  const id = `dl_${++downloadIdCounter}`;
  const plainHeaders = toPlainObject(headers);
  
  downloadQueue.set(id, {
    id,
    url,
    outputPath,
    headers: plainHeaders,
    status: 'pending',
    queuedAt: Date.now(),
    lastActivity: Date.now(),
    timeoutMs: 10 * 60 * 1000, // 10 minutes for downloads
  });
  
  console.log(`[pyodide-worker] Queued download ${url.slice(0, 60)}... -> ${outputPath} (${id})`);
  
  triggerDownloadProcessing();
  
  return id;
}

/**
 * Poll for download status.
 */
function pollDownloadStatus(id: string): QueuedDownload | null {
  const download = downloadQueue.get(id);
  if (!download) return null;
  
  if (download.status === 'completed' || download.status === 'error') {
    downloadQueue.delete(id);
    return download;
  }
  
  return null;
}

/**
 * Check if download is still in progress.
 */
function isDownloadPending(id: string): boolean {
  const download = downloadQueue.get(id);
  return download ? (download.status === 'pending' || download.status === 'processing') : false;
}

/**
 * Returns a Promise that resolves when the download completes.
 * Python awaits this Promise directly via Pyodide's async bridge.
 */
function waitForDownload(id: string): Promise<QueuedDownload> {
  return new Promise((resolve, reject) => {
    const pollInterval = 100;
    const maxWaitMs = 10 * 60 * 1000; // 10 minutes for downloads
    const startTime = Date.now();
    
    function checkResult() {
      const download = downloadQueue.get(id);
      
      if (!download) {
        reject(new Error(`Download ${id} not found`));
        return;
      }
      
      if (download.status === 'completed') {
        downloadQueue.delete(id);
        console.log(`[pyodide-worker] waitForDownload(${id}): completed`);
        resolve(download);
        return;
      }
      
      if (download.status === 'error') {
        downloadQueue.delete(id);
        console.log(`[pyodide-worker] waitForDownload(${id}): error`);
        resolve(download);
        return;
      }
      
      if (Date.now() - startTime > maxWaitMs) {
        download.status = 'error';
        download.error = 'Download timed out';
        downloadQueue.delete(id);
        resolve(download);
        return;
      }
      
      setTimeout(checkResult, pollInterval);
    }
    
    setTimeout(checkResult, pollInterval);
  });
}

function triggerDownloadProcessing(): void {
  if (downloadProcessingPromise) return;
  
  downloadProcessingPromise = processDownloadQueue().finally(() => {
    downloadProcessingPromise = null;
  });
}

async function processDownloadQueue(): Promise<void> {
  const pending = Array.from(downloadQueue.values()).filter(d => d.status === 'pending');
  
  for (const download of pending) {
    download.status = 'processing';
    download.lastActivity = Date.now();
    
    try {
      await invokeTauri('download_to_file', {
        url: download.url,
        outputPath: download.outputPath,
        headers: download.headers,
      });
      
      download.status = 'completed';
    } catch (error) {
      download.status = 'error';
      download.error = error instanceof Error ? error.message : String(error);
    }
  }
}

// ============================================================================
// JS Challenge Queue (Polling Pattern)
// ============================================================================

interface QueuedJSChallenge {
  id: string;
  code: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  result?: string;
  error?: string;
  queuedAt: number;
  lastActivity: number;
  timeoutMs: number;
}

const jsChallengeQueue: Map<string, QueuedJSChallenge> = new Map();
let jsChallengeIdCounter = 0;
let jsChallengeProcessingPromise: Promise<void> | null = null;

function queueJSChallenge(code: string): string {
  const id = `jsc_${++jsChallengeIdCounter}`;
  
  jsChallengeQueue.set(id, {
    id,
    code,
    status: 'pending',
    queuedAt: Date.now(),
    lastActivity: Date.now(),
    timeoutMs: 2 * 60 * 1000,
  });
  
  console.log(`[pyodide-worker] Queued JS challenge ${id} (${code.length} chars)`);
  triggerJSChallengeProcessing();
  
  return id;
}

function pollJSChallengeResult(id: string): QueuedJSChallenge | null {
  const challenge = jsChallengeQueue.get(id);
  if (!challenge) {
    return null;
  }
  
  if (challenge.status === 'completed' || challenge.status === 'error') {
    jsChallengeQueue.delete(id);
    return challenge;
  }
  
  return null;
}

function isJSChallengePending(id: string): boolean {
  const challenge = jsChallengeQueue.get(id);
  return challenge ? (challenge.status === 'pending' || challenge.status === 'processing') : false;
}

function waitForJSChallenge(id: string): Promise<QueuedJSChallenge> {
  return new Promise((resolve, reject) => {
    const pollInterval = 50;
    const maxWaitMs = 2 * 60 * 1000;
    const startTime = Date.now();
    
    function checkResult() {
      const challenge = jsChallengeQueue.get(id);
      
      if (!challenge) {
        reject(new Error(`JS challenge ${id} not found`));
        return;
      }
      
      if (challenge.status === 'completed' || challenge.status === 'error') {
        jsChallengeQueue.delete(id);
        resolve(challenge);
        return;
      }
      
      if (Date.now() - startTime > maxWaitMs) {
        challenge.status = 'error';
        challenge.error = 'JS challenge timed out';
        jsChallengeQueue.delete(id);
        resolve(challenge);
        return;
      }
      
      setTimeout(checkResult, pollInterval);
    }
    
    setTimeout(checkResult, pollInterval);
  });
}

function triggerJSChallengeProcessing(): void {
  if (jsChallengeProcessingPromise) return;
  
  jsChallengeProcessingPromise = processJSChallengeQueue().finally(() => {
    jsChallengeProcessingPromise = null;
  });
}

async function executeJSInSandbox(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const requestId = `jsc_exec_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    
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
    
    self.postMessage({
      type: 'js_sandbox_execute',
      id: requestId,
      code: code
    });
    
    setTimeout(() => {
      self.removeEventListener('message', handler);
      reject(new Error('JS sandbox execution timed out'));
    }, 60000);
  });
}

async function processJSChallengeQueue(): Promise<void> {
  const pending = Array.from(jsChallengeQueue.values()).filter(c => c.status === 'pending');
  
  for (const challenge of pending) {
    challenge.status = 'processing';
    challenge.lastActivity = Date.now();
    
    try {
      console.log(`[pyodide-worker] Executing JS challenge ${challenge.id} in sandbox...`);
      const result = await executeJSInSandbox(challenge.code);
      
      challenge.status = 'completed';
      challenge.result = result;
      
      if (verboseMode) {
        const lines = result.split('\n');
        const lastLine = lines[lines.length - 1] || lines[lines.length - 2] || '';
        const hasError = result.toLowerCase().includes('error') || result.toLowerCase().includes('exception');
        console.log(`[JSC RESULT] Challenge ${challenge.id}:`);
        console.log(`[JSC RESULT]   Total lines: ${lines.length}, Total chars: ${result.length}`);
        console.log(`[JSC RESULT]   Last line (likely the actual result): "${lastLine.slice(0, 500)}"`);
        console.log(`[JSC RESULT]   Contains error keywords: ${hasError}`);
      }
    } catch (error) {
      challenge.status = 'error';
      challenge.error = error instanceof Error ? error.message : String(error);
      console.error(`[pyodide-worker] JS challenge ${challenge.id} failed:`, error);
    }
  }
}

// ============================================================================
// Timeout Checking
// ============================================================================

/**
 * Check for timed-out requests and mark them as error
 */
function checkTimeouts(): void {
  const now = Date.now();
  
  // Check HTTP requests
  for (const request of httpRequestQueue.values()) {
    if ((request.status === 'pending' || request.status === 'processing') && 
        (now - request.lastActivity) > request.timeoutMs) {
      request.status = 'error';
      request.error = `Request timed out after ${request.timeoutMs}ms`;
      console.warn(`[pyodide-worker] HTTP request ${request.id} timed out`);
    }
  }
  
  // Check downloads
  for (const download of downloadQueue.values()) {
    if ((download.status === 'pending' || download.status === 'processing') && 
        (now - download.lastActivity) > download.timeoutMs) {
      download.status = 'error';
      download.error = `Download timed out after ${download.timeoutMs}ms`;
      console.warn(`[pyodide-worker] Download ${download.id} timed out`);
    }
  }
  
  // Check JS challenges
  for (const challenge of jsChallengeQueue.values()) {
    if ((challenge.status === 'pending' || challenge.status === 'processing') && 
        (now - challenge.lastActivity) > challenge.timeoutMs) {
      challenge.status = 'error';
      challenge.error = `JS challenge timed out after ${challenge.timeoutMs}ms`;
      console.warn(`[pyodide-worker] JS challenge ${challenge.id} timed out`);
    }
  }
}

/**
 * Start periodic timeout checking
 */
function startTimeoutChecking(): void {
  if (timeoutCheckInterval) return; // Already started
  
  timeoutCheckInterval = self.setInterval(checkTimeouts, 30 * 1000); // Check every 30 seconds
  console.log('[pyodide-worker] Started timeout checking');
}

// ============================================================================
// FFmpeg Command Queue
// ============================================================================

export interface FFmpegCommand {
  id: string;
  command: 'ffmpeg' | 'ffprobe';
  args: string[];
  inputPath?: string;
  outputPath?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: { exitCode: number; stdout: string; stderr: string };
  error?: string;
}

const ffmpegCommandQueue: FFmpegCommand[] = [];
let commandIdCounter = 0;

function queueFFmpegCommand(command: 'ffmpeg' | 'ffprobe', args: string[]): FFmpegCommand {
  const id = `ffmpeg_${++commandIdCounter}`;
  
  let outputPath: string | undefined;
  let inputPath: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-i' && i + 1 < args.length) {
      inputPath = args[i + 1];
    }
    if (i === args.length - 1 && !args[i].startsWith('-')) {
      outputPath = args[i];
    }
    if (args[i] === '-y' && i + 1 < args.length && !args[i + 1].startsWith('-')) {
      outputPath = args[i + 1];
    }
  }
  
  const cmd: FFmpegCommand = {
    id,
    command,
    args,
    inputPath,
    outputPath,
    status: 'pending'
  };
  
  ffmpegCommandQueue.push(cmd);
  console.log(`[pyodide-worker] Queued ${command} command ${id}`);
  
  return cmd;
}

async function executeQueuedFFmpegCommands(): Promise<FFmpegCommand[]> {
  const pendingCommands = ffmpegCommandQueue.filter(cmd => cmd.status === 'pending');
  
  for (const cmd of pendingCommands) {
    cmd.status = 'running';
    console.log(`[pyodide-worker] Executing ${cmd.command} command ${cmd.id}`);
    if (verboseMode) console.log(`[pyodide-worker] FFmpeg args:`, cmd.args);
    
    try {
      const result = await invokeTauri<{ exitCode: number; stdout: string; stderr: string }>(
        'dlopen_ffmpeg',
        { command: cmd.command, args: cmd.args }
      );

      console.log(`[pyodide-worker] FFmpeg exit code: ${result.exitCode}`);
      if (verboseMode && result.stdout) console.log(`[pyodide-worker] FFmpeg stdout:`, result.stdout.slice(0, 500));
      if (verboseMode && result.stderr) console.log(`[pyodide-worker] FFmpeg stderr:`, result.stderr.slice(0, 1000));

      cmd.status = result.exitCode === 0 ? 'completed' : 'error';
      cmd.result = result;

      if (result.exitCode !== 0) {
        cmd.error = result.stderr || `FFmpeg exited with code ${result.exitCode}`;
      }
    } catch (error) {
      cmd.status = 'error';
      cmd.error = error instanceof Error ? error.message : String(error);
      console.error(`[pyodide-worker] FFmpeg error:`, cmd.error);
    }
  }
  
  return pendingCommands;
}

function getQueuedCommands(): FFmpegCommand[] {
  return [...ffmpegCommandQueue];
}

function clearCompletedCommands(): void {
  const toRemove = ffmpegCommandQueue.filter(cmd => 
    cmd.status === 'completed' || cmd.status === 'error'
  );
  for (const cmd of toRemove) {
    const idx = ffmpegCommandQueue.indexOf(cmd);
    if (idx >= 0) ffmpegCommandQueue.splice(idx, 1);
  }
}

// ============================================================================
// FFmpeg Adapter (Sync Return, Queues Work)
// ============================================================================

function nativeFFmpegAdapter(
  command: string, 
  args: unknown
): { exit_code: number; stdout: Uint8Array; stderr: Uint8Array } {
  let plainArgs: string[];
  if (args && typeof (args as { toJs?: () => unknown }).toJs === 'function') {
    const converted = (args as { toJs: () => unknown }).toJs();
    plainArgs = Array.isArray(converted) ? converted.map(String) : [];
  } else if (Array.isArray(args)) {
    plainArgs = args.map(String);
  } else {
    plainArgs = [];
  }
  
  if (verboseMode) console.log(`[pyodide-worker] FFmpeg ${command} sync hijack:`, plainArgs.length, 'args');

  if (command === 'ffprobe' && plainArgs.length > 0 && plainArgs[0] === '-bsfs') {
    const caps = ffmpegCapabilities || STATIC_FFMPEG_CAPABILITIES;
    const stdout = caps.bitstreamFilters.join('\n');
    const stderr = `${caps.version}\n  configuration: ${caps.configuration}`;
    
    return {
      exit_code: 0,
      stdout: new TextEncoder().encode(stdout),
      stderr: new TextEncoder().encode(stderr)
    };
  }

  if (plainArgs.includes('-version')) {
    const caps = ffmpegCapabilities || STATIC_FFMPEG_CAPABILITIES;
    return {
      exit_code: 0,
      stdout: new TextEncoder().encode(caps.version),
      stderr: new Uint8Array()
    };
  }

  const cmd = queueFFmpegCommand(command as 'ffmpeg' | 'ffprobe', plainArgs);
  
  let fakeStdout = '';
  if (cmd.outputPath) {
    fakeStdout = `Output file: ${cmd.outputPath}\n`;
  }
  
  return {
    exit_code: 0,
    stdout: new TextEncoder().encode(fakeStdout),
    stderr: new Uint8Array()
  };
}

// ============================================================================
// Worker Message Handling
// ============================================================================

interface WorkerMessage {
  id: string;
  type: 'init' | 'extract_info' | 'extract_audio' | 'execute_ffmpeg' | 'get_ffmpeg_queue' | 'set_verbose';
  payload?: unknown;
}

interface WorkerResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

async function findYtDlpWheel(): Promise<string> {
  const baseUrl = new URL('/pyodide/', self.location.origin).href;
  
  try {
    const pypiResponse = await fetch('https://pypi.org/pypi/yt-dlp/json');
    if (pypiResponse.ok) {
      const data = await pypiResponse.json() as { 
        info?: { version?: string };
        urls?: Array<{ packagetype: string; url: string }>;
      };
      const latestVersion = data.info?.version?.split('.').map(Number) || [0, 0, 0];
      const bundledVersion = [2025, 10, 22];
      
      if (latestVersion[0] > bundledVersion[0] || 
          latestVersion[1] > bundledVersion[1] || 
          latestVersion[2] > bundledVersion[2]) {
        const wheelInfo = data.urls?.find(u => u.packagetype === 'bdist_wheel');
        if (wheelInfo) {
          console.log('[pyodide-worker] Using latest yt-dlp from PyPI:', data.info?.version);
          return wheelInfo.url;
        }
      }
    }
  } catch {
    console.log('[pyodide-worker] PyPI check failed, using bundled wheel');
  }
  
  const response = await fetch(baseUrl);
  const html = await response.text();
  const wheelMatch = html.match(/yt_dlp-[\d.]+-py3-none-any\.whl/);
  const wheelName = wheelMatch ? wheelMatch[0] : 'yt_dlp-2025.10.22-py3-none-any.whl';
  
  console.log('[pyodide-worker] Using bundled wheel:', wheelName);
  return `${baseUrl}${wheelName}`;
}

async function loadOpenSSL(pyodideInstance: PyodideInterface): Promise<void> {
  const baseUrl = new URL('/pyodide/', self.location.origin).href;
  
  pyodideInstance.FS.mkdirTree('/usr/lib');
  
  await Promise.all(
    ['libcrypto.so', 'libssl.so'].map(async (file) => {
      const url = `${baseUrl}openssl-1.1.1w/${file}`;
      const response = await fetch(url);
      if (response.ok) {
        const data = new Uint8Array(await response.arrayBuffer());
        pyodideInstance.FS.writeFile(`/usr/lib/${file}`, data);
      }
    })
  );
  
  await pyodideInstance.loadPackage(`${baseUrl}ssl-1.0.0-cp312-cp312-pyodide_2024_0_wasm32.whl`);
  console.log('[pyodide-worker] OpenSSL + SSL loaded');
}

async function loadPythonPatches(pyodideInstance: PyodideInterface): Promise<void> {
  const baseUrl = new URL('/pyodide/patches/', self.location.origin).href;
  const patchFiles = ['jsc_provider.py', 'http_adapter.py', 'dlopen_adapter.py', 'loader.py'];
  
  pyodideInstance.FS.mkdirTree('/pyodide/patches');
  
  await Promise.all(
    patchFiles.map(async (file) => {
      const url = `${baseUrl}${file}`;
      const response = await fetch(url);
      if (response.ok) {
        const text = await response.text();
        pyodideInstance.FS.writeFile(`/pyodide/patches/${file}`, text);
        console.log(`[pyodide-worker] Loaded patch: ${file}`);
      } else {
        console.warn(`[pyodide-worker] Failed to load patch: ${file}`);
      }
    })
  );
  
  console.log('[pyodide-worker] Python patches loaded into VFS');
}

async function initPyodide() {
  if (isInitialized) return;

  console.log('[pyodide-worker] Initializing...');

  try {
    await initFFmpegCapabilities();

    const pyodideUrl = new URL('/pyodide/pyodide.mjs', self.location.origin).href;
    const indexURL = new URL('/pyodide/', self.location.origin).href;
    
    console.log('[pyodide-worker] Loading Pyodide from:', pyodideUrl);

    const { loadPyodide } = await import(/* @vite-ignore */ pyodideUrl);
    
    const ytDlpWheelUrl = await findYtDlpWheel();
    
    pyodide = await loadPyodide({ 
      indexURL,
      packages: [ytDlpWheelUrl]
    });

    console.log('[pyodide-worker] Pyodide + yt-dlp loaded');
    
    pyodide!.setStdout(createStdoutHandler());
    pyodide!.setStderr(createStderrHandler());
    console.log('[pyodide-worker] Stdout/stderr streaming enabled');
    
    await loadOpenSSL(pyodide!);
    await loadPythonPatches(pyodide!);

    await pyodide!.runPythonAsync(/*py*/`
import sys
sys.path.insert(0, '/pyodide/patches')
print(f"[pyodide] Python {sys.version}")
`);

    console.log('[pyodide-worker] Setting up patches...');
    
    await pyodide!.runPythonAsync(/*py*/`
import js
import io
import subprocess
from yt_dlp import YoutubeDL
from yt_dlp.networking.common import Response, Request
from yt_dlp.networking.exceptions import RequestError
from yt_dlp.extractor.common import InfoExtractor

print("[pyodide] Patching yt-dlp for async HTTP (exception-based yielding)...")

# =============================================================================
# HTTP Response Cache - stores responses for retry pattern
# =============================================================================

_http_cache = {}
_download_cache = {}

# =============================================================================
# Exception for signaling HTTP needed
# =============================================================================

class _HTTPNeeded(Exception):
    def __init__(self, url, method, headers, data, cache_key):
        self.url = url
        self.method = method
        self.headers = headers
        self.data = data
        self.cache_key = cache_key
        super().__init__(f"HTTP request needed: {method} {url[:60]}...")

class _DownloadNeeded(Exception):
    def __init__(self, url, output_path, headers, cache_key):
        self.url = url
        self.output_path = output_path
        self.headers = headers
        self.cache_key = cache_key
        super().__init__(f"Download needed: {url[:60]}...")

# =============================================================================
# Patched urlopen - uses cache or raises exception
# =============================================================================

_original_urlopen = YoutubeDL.urlopen

# URL patterns that should use URL-only cache matching (for pre-fetched resources)
_URL_ONLY_CACHE_PATTERNS = [
    'github.com/yt-dlp/ejs/releases/download/',
]

def _cached_urlopen(self, req):
    if isinstance(req, str):
        req = Request(req)
    
    url = req.url
    method = getattr(req, 'method', None) or 'GET'
    headers = dict(getattr(req, 'headers', {}) or {})
    data = getattr(req, 'data', None)
    
    cache_key = (url, method, str(sorted(headers.items())), str(data)[:100] if data else None)
    
    # Check exact cache key match first
    if cache_key in _http_cache:
        cached = _http_cache[cache_key]
        print(f"[yt-dlp] Cache hit: {method} {url[:60]}...")
        return Response(
            io.BytesIO(cached['body']),
            url,
            cached['headers'],
            status=cached['status']
        )
    
    # For pre-fetched resources (like EJS scripts), try URL-only matching
    # This handles cases where headers differ between pre-fetch and actual request
    for pattern in _URL_ONLY_CACHE_PATTERNS:
        if pattern in url:
            for cached_key, cached in _http_cache.items():
                if cached_key[0] == url and cached_key[1] == method:
                    print(f"[yt-dlp] Cache hit (URL match): {method} {url[:60]}...")
                    return Response(
                        io.BytesIO(cached['body']),
                        url,
                        cached['headers'],
                        status=cached['status']
                    )
            break
    
    print(f"[yt-dlp] Cache miss, need HTTP: {method} {url[:60]}...")
    raise _HTTPNeeded(url, method, headers, data, cache_key)

YoutubeDL.urlopen = _cached_urlopen

# =============================================================================
# Async HTTP function - does actual request
# =============================================================================

async def _do_http_async(url, method, headers, data):
    headers = headers or {}
    request_id = js.queueHTTPRequest(url, method, headers, data)
    result = await js.waitForHTTPResponse(request_id)
    
    if result.status == 'error':
        raise RequestError(f"HTTP request failed: {result.error}")
    
    response_headers = result.response.headers
    if hasattr(response_headers, 'to_py'):
        response_headers = response_headers.to_py()
    
    body_data = result.response.body
    if isinstance(body_data, str):
        body_data = body_data.encode('utf-8')
    elif hasattr(body_data, 'to_py'):
        body_data = bytes(body_data.to_py())
    elif not isinstance(body_data, bytes):
        body_data = bytes(body_data) if body_data else b''
    
    return {
        'status': result.response.status,
        'headers': dict(response_headers) if response_headers else {},
        'body': body_data
    }

async def _do_download_async(url, output_path, headers):
    headers = headers or {}
    download_id = js.queueDownload(url, output_path, headers)
    result = await js.waitForDownload(download_id)
    
    if result.status == 'error':
        raise Exception(f"Download failed: {result.error}")
    return output_path

# =============================================================================
# FFmpeg Adapter (Sync - queues work for later execution)
# =============================================================================

_original_subprocess_run = subprocess.run

def _patched_subprocess_run(args, **kwargs):
    if isinstance(args, (list, tuple)) and args and args[0] in ("ffmpeg", "ffprobe"):
        command = args[0]
        ffmpeg_args = list(args[1:])
        print(f"[pyodide] FFmpeg intercepted: {command} with {len(ffmpeg_args)} args")
        
        result = js.nativeFFmpegAdapter(command, ffmpeg_args)
        
        exit_code = result.exit_code if hasattr(result, 'exit_code') else 0
        stdout = bytes(result.stdout) if hasattr(result, 'stdout') and result.stdout else b""
        stderr = bytes(result.stderr) if hasattr(result, 'stderr') and result.stderr else b""
        
        return subprocess.CompletedProcess(
            args=args,
            returncode=exit_code,
            stdout=stdout,
            stderr=stderr
        )
    
    return _original_subprocess_run(args, **kwargs)

subprocess.run = _patched_subprocess_run

from yt_dlp.utils import _utils

_original_popen_run = _utils.Popen.run

@classmethod  
def _patched_popen_run(cls, *args, **kwargs):
    if args and args[0] and args[0][0] in ("ffmpeg", "ffprobe"):
        command = args[0][0]
        ffmpeg_args = list(args[0][1:])
        print(f"[pyodide] Popen.run intercepted: {command}")
        
        result = js.nativeFFmpegAdapter(command, ffmpeg_args)
        exit_code = result.exit_code if hasattr(result, 'exit_code') else 0
        stdout = bytes(result.stdout) if hasattr(result, 'stdout') and result.stdout else b""
        stderr = bytes(result.stderr) if hasattr(result, 'stderr') and result.stderr else b""
        
        return [stdout, stderr, exit_code]
    
    return _original_popen_run(*args, **kwargs)

_utils.Popen.run = _patched_popen_run

# =============================================================================
# JSC (JavaScript Challenge) Provider - exception-based pattern
# =============================================================================

_jsc_cache = {}

class _JSCNeeded(BaseException):
    def __init__(self, code, cache_key):
        self.code = code
        self.cache_key = cache_key
        super().__init__(f"JSC challenge needed")

import importlib.util
if importlib.util.find_spec("yt_dlp.extractor.youtube.jsc"):
    print("[pyodide] Registering JSC provider...")
    from yt_dlp.extractor.youtube.jsc.provider import register_provider, register_preference
    from yt_dlp.extractor.youtube.jsc._builtin.deno import DenoJCP

    @register_provider
    class TubetapeJCP(DenoJCP):
        PROVIDER_NAME = 'Tubetape'
        JS_RUNTIME_NAME = 'Tubetape'

        def is_available(self):
            return True

        def _run_deno(self, stdin, options):
            cache_key = hash(stdin[:500])
            if cache_key in _jsc_cache:
                print("[JSC] Cache hit")
                return _jsc_cache[cache_key]
            print("[JSC] Need to execute challenge...")
            raise _JSCNeeded(stdin, cache_key)

        def _npm_packages_cached(self, stdin):
            return False

    @register_preference(TubetapeJCP)
    def jsc_preference(*_):
        return 99999999999

    print("[pyodide] JSC provider registered")
else:
    print("[pyodide] yt-dlp version doesn't support JSC")

async def _do_jsc_async(code):
    challenge_id = js.queueJSChallenge(code)
    result = await js.waitForJSChallenge(challenge_id)
    if result.status == 'error':
        raise Exception(f"JSC failed: {result.error}")
    return result.result if hasattr(result, 'result') else str(result)

# =============================================================================
# EJS Script Pre-fetching (required before extraction to avoid sync HTTP issues)
# =============================================================================

# EJS script version - update this when yt-dlp updates its EJS dependency
_EJS_VERSION = '0.3.2'
_EJS_REPOSITORY = 'yt-dlp/ejs'
_EJS_SCRIPTS = [
    'yt.solver.lib.min.js',
    'yt.solver.core.min.js',
]

async def prefetch_ejs_scripts():
    """Pre-fetch EJS challenge solver scripts so they're cached before extraction."""
    global _http_cache
    
    for script_name in _EJS_SCRIPTS:
        url = f'https://github.com/{_EJS_REPOSITORY}/releases/download/{_EJS_VERSION}/{script_name}'
        cache_key = (url, 'GET', str(sorted({}.items())), None)
        
        if cache_key in _http_cache:
            print(f"[yt-dlp] EJS script already cached: {script_name}")
            continue
        
        print(f"[yt-dlp] Pre-fetching EJS script: {script_name}")
        try:
            response = await _do_http_async(url, 'GET', {}, None)
            _http_cache[cache_key] = response
            print(f"[yt-dlp] EJS script cached: {script_name} ({len(response.get('body', b''))} bytes)")
        except Exception as e:
            print(f"[yt-dlp] Warning: Failed to pre-fetch {script_name}: {e}")

# =============================================================================
# Async extraction with exception-based HTTP/JSC yielding
# =============================================================================

async def extract_info_async(url, opts=None):
    global _http_cache, _jsc_cache
    _http_cache.clear()
    _jsc_cache.clear()
    
    # Pre-fetch EJS scripts before extraction to avoid sync HTTP issues in JSC provider
    await prefetch_ejs_scripts()
    
    opts = opts or {}
    ydl_opts = {
        'quiet': opts.get('quiet', True),
        'no_warnings': opts.get('no_warnings', True),
        'extract_flat': opts.get('extract_flat', False),
        'noplaylist': opts.get('noplaylist', True),
        'socket_timeout': opts.get('socket_timeout', 30),
        'remote_components': ['ejs:github', 'ejs:npm'],  # Enable EJS script downloads for JSC
    }
    
    max_iterations = 100
    iteration = 0
    
    while iteration < max_iterations:
        iteration += 1
        ydl = YoutubeDL(ydl_opts)
        
        try:
            result = ydl.extract_info(url, download=False)
            ydl.close()
            return result
        except _HTTPNeeded as e:
            ydl.close()
            print(f"[yt-dlp] Fetching: {e.method} {e.url[:60]}... (iteration {iteration})")
            response = await _do_http_async(e.url, e.method, e.headers, e.data)
            _http_cache[e.cache_key] = response
        except _JSCNeeded as e:
            ydl.close()
            print(f"[yt-dlp] Executing JSC... (iteration {iteration})")
            result = await _do_jsc_async(e.code)
            _jsc_cache[e.cache_key] = result
        except Exception as ex:
            ydl.close()
            raise
    
    raise Exception(f"Too many iterations ({max_iterations}), possible loop")

async def extract_audio_async(url, output_path, opts=None):
    global _http_cache, _download_cache, _jsc_cache
    _http_cache.clear()
    _download_cache.clear()
    _jsc_cache.clear()
    
    # Pre-fetch EJS scripts before extraction to avoid sync HTTP issues in JSC provider
    await prefetch_ejs_scripts()
    
    opts = opts or {}
    ydl_opts = {
        'format': opts.get('format', 'bestaudio/best'),
        'outtmpl': output_path,
        'quiet': opts.get('quiet', False),
        'no_warnings': opts.get('no_warnings', False),
        'noplaylist': opts.get('noplaylist', True),
        'socket_timeout': opts.get('socket_timeout', 30),
        'remote_components': ['ejs:github', 'ejs:npm'],  # Enable EJS script downloads for JSC
    }
    
    max_iterations = 100
    iteration = 0
    result = None
    
    while iteration < max_iterations:
        iteration += 1
        ydl = YoutubeDL(ydl_opts)
        
        try:
            result = ydl.extract_info(url, download=False)
            ydl.close()
            break
        except _HTTPNeeded as e:
            ydl.close()
            print(f"[yt-dlp] Fetching: {e.method} {e.url[:60]}... (iteration {iteration})")
            response = await _do_http_async(e.url, e.method, e.headers, e.data)
            _http_cache[e.cache_key] = response
        except _JSCNeeded as e:
            ydl.close()
            print(f"[yt-dlp] Executing JSC... (iteration {iteration})")
            jsc_result = await _do_jsc_async(e.code)
            _jsc_cache[e.cache_key] = jsc_result
        except Exception as ex:
            ydl.close()
            raise
    
    if result is None:
        raise Exception(f"Too many iterations ({max_iterations}), possible loop")
    
    import os
    import subprocess
    
    output_dir = os.path.dirname(output_path)
    output_base = os.path.splitext(os.path.basename(output_path))[0]
    
    def is_hls_url(url):
        return 'manifest' in url or url.endswith('.m3u8') or 'hls' in url.lower()
    
    formats = result.get('formats', [])
    
    direct_audio = None
    hls_audio = None
    
    for f in formats:
        acodec = f.get('acodec', 'none')
        url = f.get('url', '')
        if acodec == 'none' or not url:
            continue
        
        abr = f.get('abr') or 0
        
        if is_hls_url(url):
            if hls_audio is None or abr > (hls_audio.get('abr') or 0):
                hls_audio = f
        else:
            if direct_audio is None or abr > (direct_audio.get('abr') or 0):
                direct_audio = f
    
    best_audio = direct_audio or hls_audio
    
    if not best_audio or not best_audio.get('url'):
        raise Exception("No audio format found in extraction result")
    
    audio_url = best_audio['url']
    audio_ext = best_audio.get('ext', 'webm')
    is_hls = is_hls_url(audio_url)
    
    print(f"[yt-dlp] Selected format: {best_audio.get('format_id')} ({audio_ext}, {'HLS' if is_hls else 'direct'})")
    
    output_aac = output_path.replace('.mp3', '.aac').replace('.m4a', '.aac')
    
    if is_hls:
        print(f"[yt-dlp] HLS stream detected, using FFmpeg to download...")
        print(f"[yt-dlp] Output path: {output_aac}")
        subprocess.run([
            'ffmpeg',
            '-i', audio_url,
            '-vn',
            '-c:a', 'copy',
            '-f', 'adts',
            '-y',
            output_aac
        ])
    else:
        audio_headers = best_audio.get('http_headers', {})
        temp_path = os.path.join(output_dir, f"{output_base}_raw.{audio_ext}")
        
        print(f"[yt-dlp] Downloading audio ({audio_ext}): {audio_url[:60]}...")
        await _do_download_async(audio_url, temp_path, audio_headers)
        print(f"[yt-dlp] Raw audio saved to: {temp_path}")
        
        print(f"[yt-dlp] Extracting audio: {temp_path} -> {output_aac}")
        subprocess.run([
            'ffmpeg',
            '-i', temp_path,
            '-vn',
            '-c:a', 'copy',
            '-f', 'adts',
            '-y',
            output_aac
        ])
    
    print(f"[yt-dlp] Audio saved to: {output_aac}")
    result['_output_path'] = output_aac
    return result

print("[pyodide] yt-dlp patched with exception-based async HTTP!")
`);

    isInitialized = true;
    console.log('[pyodide-worker] Initialization complete');

    // Start timeout checking for pending requests
    startTimeoutChecking();
  } catch (error) {
    console.error('[pyodide-worker] Initialization failed:', error);
    throw error;
  }
}

/**
 * Deeply convert a Pyodide proxy to a plain JS object.
 * Uses JSON round-trip to ensure no proxy objects remain (they can't be cloned for postMessage).
 */
function pyProxyToPlain(proxy: unknown): unknown {
  if (proxy === null || proxy === undefined) return proxy;
  
  // Check if it's a Pyodide proxy with toJs method
  const maybeProxy = proxy as { toJs?: (options?: { dict_converter?: unknown; create_proxies?: boolean }) => unknown };
  if (typeof maybeProxy.toJs === 'function') {
    try {
      // Convert with options to avoid creating new proxies
      const jsValue = maybeProxy.toJs({ dict_converter: Object.fromEntries, create_proxies: false });
      // JSON round-trip ensures all nested objects are plain
      return JSON.parse(JSON.stringify(jsValue));
    } catch {
      // If toJs fails, try JSON directly
      try {
        return JSON.parse(JSON.stringify(proxy));
      } catch {
        return null;
      }
    }
  }
  
  // Already a JS value, but might contain nested proxies
  try {
    return JSON.parse(JSON.stringify(proxy));
  } catch {
    return proxy;
  }
}

async function extractInfo(url: string): Promise<unknown> {
  if (!pyodide || !isInitialized) {
    throw new Error('Pyodide not initialized');
  }

  const parsedUrl = URL.parse(url);
  if (!parsedUrl) {
    throw new Error('Invalid URL');
  }

  console.log('[pyodide-worker] Extracting info for:', url);
  clearCompletedCommands();

  const escapedUrl = JSON.stringify(parsedUrl.href);

  const result = await pyodide!.runPythonAsync(/*py*/`
result = await extract_info_async(${escapedUrl})
result
`);

  return pyProxyToPlain(result);
}

async function extractAudio(
  url: string,
  outputPath: string
): Promise<{ info: unknown; ffmpegCommands: FFmpegCommand[] }> {
  if (!pyodide || !isInitialized) {
    throw new Error('Pyodide not initialized');
  }

  const parsedUrl = URL.parse(url);
  if (!parsedUrl) {
    throw new Error('Invalid URL');
  }

  console.log('[pyodide-worker] Extracting audio for:', url);
  console.log('[pyodide-worker] Output path:', outputPath);

  clearCompletedCommands();

  const escapedUrl = JSON.stringify(parsedUrl.href);
  const escapedOutput = JSON.stringify(outputPath);

  const result = await pyodide!.runPythonAsync(/*py*/`
result = await extract_audio_async(${escapedUrl}, ${escapedOutput})
result
`);

  return {
    info: pyProxyToPlain(result),
    ffmpegCommands: getQueuedCommands()
  };
}

async function handleMessage(event: MessageEvent<WorkerMessage>) {
  const { id, type, payload } = event.data;

  const response: WorkerResponse = {
    id,
    success: false,
  };

  try {
    switch (type) {
      case 'init':
        await initPyodide();
        response.success = true;
        response.data = { 
          initialized: true,
          ffmpegCapabilities: ffmpegCapabilities || STATIC_FFMPEG_CAPABILITIES
        };
        break;

      case 'extract_info': {
        const infoPayload = payload as { url: string };
        const infoResult = await extractInfo(infoPayload.url);
        response.success = true;
        response.data = infoResult;
      } break;

      case 'extract_audio': {
        const audioPayload = payload as { url: string; outputPath: string };
        const audioResult = await extractAudio(audioPayload.url, audioPayload.outputPath);
        response.success = true;
        response.data = audioResult;
      } break;

      case 'execute_ffmpeg': {
        const commands = await executeQueuedFFmpegCommands();
        response.success = true;
        response.data = { commands };
      } break;

      case 'get_ffmpeg_queue': {
        response.success = true;
        response.data = { commands: getQueuedCommands() };
      } break;

      case 'set_verbose': {
        const verbosePayload = payload as { enabled: boolean; clearBuffer?: boolean };
        setVerboseMode(verbosePayload.enabled);
        if (verbosePayload.clearBuffer) {
          clearLogBuffer();
        }
        response.success = true;
        response.data = { 
          verbose: verbosePayload.enabled,
          logBuffer: verbosePayload.enabled ? getLogBuffer() : []
        };
      } break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    console.error('[pyodide-worker] Command failed:', type, error);
    response.success = false;
    response.error = error instanceof Error ? error.message : String(error);
  }

  self.postMessage(response);
}

// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.queueHTTPRequest = queueHTTPRequest;
// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.pollHTTPResponse = pollHTTPResponse;
// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.waitForHTTPResponse = waitForHTTPResponse;
// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.isHTTPRequestPending = isHTTPRequestPending;
// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.queueDownload = queueDownload;
// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.pollDownloadStatus = pollDownloadStatus;
// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.isDownloadPending = isDownloadPending;
// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.waitForDownload = waitForDownload;
// @ts-expect-error - Attaching to globalThis for Python bridge  
globalThis.nativeFFmpegAdapter = nativeFFmpegAdapter;
// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.queueJSChallenge = queueJSChallenge;
// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.pollJSChallengeResult = pollJSChallengeResult;
// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.isJSChallengePending = isJSChallengePending;
// @ts-expect-error - Attaching to globalThis for Python bridge
globalThis.waitForJSChallenge = waitForJSChallenge;

self.addEventListener('message', (event) => {
  const data = event.data;

  if (data.type === 'tauri_response') {
    handleTauriResponse(data as TauriResponse);
    return;
  }

  if (data.type === 'js_sandbox_result') {
    return;
  }

  // downloadProgress messages are informational - they update download state in the queue
  // but don't require a response back to the client
  if (data.type === 'downloadProgress') {
    // Update download progress in the queue if we have a matching download
    const progress = data.data as { bytesDownloaded: number; totalBytes: number | null; percent: number };
    for (const download of downloadQueue.values()) {
      if (download.status === 'processing') {
        download.bytesDownloaded = progress.bytesDownloaded;
        download.totalBytes = progress.totalBytes ?? undefined;
        download.lastActivity = Date.now();
      }
    }
    return;
  }

  handleMessage(event as MessageEvent<WorkerMessage>).catch((error) => {
    console.error('[pyodide-worker] Unhandled error:', error);
    self.postMessage({
      id: (event as MessageEvent<WorkerMessage>).data.id,
      success: false,
      error: String(error),
    });
  });
});

console.log('[pyodide-worker] Worker ready');
