/**
 * Pyodide Client API
 * 
 * Provides a typed interface for communicating with the Pyodide worker.
 * 
 * ARCHITECTURE:
 * The extraction flow is two-phase for Safari compatibility:
 * 1. yt-dlp phase: Extract info, download streams (FFmpeg commands queued, not executed)
 * 2. FFmpeg phase: Execute queued commands on native side with progress reporting
 */

import { invoke } from '@tauri-apps/api/core';

interface WorkerMessage {
  id: string;
  type: 'init' | 'extract_info' | 'extract_audio' | 'execute_ffmpeg' | 'get_ffmpeg_queue' | 'set_verbose';
  payload?: unknown;
}



export type LogLevel = 'debug' | 'info' | 'warning' | 'error' | 'progress';

export interface LogMessage {
  level: LogLevel;
  message: string;
  timestamp: number;
  source: 'stdout' | 'stderr' | 'yt-dlp';
}

export interface DownloadProgress {
  percent: number;
  downloaded: string;
  total: string;
  speed: string;
  eta: string;
}

export interface FFmpegCapabilities {
  version: string;
  bitstreamFilters: string[];
  configuration: string;
}

export interface FFmpegCommand {
  id: string;
  command: 'ffmpeg' | 'ffprobe';
  args: string[];
  inputPath?: string;
  outputPath?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  result?: { exit_code: number; stdout: string; stderr: string };
  error?: string;
}

export interface VideoInfo {
  id: string;
  title: string;
  duration: number;
  uploader: string;
  thumbnail: string;
  formats: Array<{
    format_id: string;
    format_note: string;
    ext: string;
    acodec: string;
    vcodec: string;
    filesize: number | null;
  }>;
  [key: string]: unknown;
}

export interface ExtractionResult {
  info: VideoInfo;
  ffmpegCommands: FFmpegCommand[];
}

export interface InitResult {
  initialized: boolean;
  ffmpegCapabilities: FFmpegCapabilities;
}

export type ExtractionPhase = 
  | 'initializing'
  | 'extracting_info'
  | 'downloading'
  | 'converting'
  | 'completed'
  | 'error';

export interface ExtractionProgress {
  phase: ExtractionPhase;
  percent: number;
  message: string;
  currentCommand?: FFmpegCommand;
}

export class PyodideClient {
  private worker: Worker | null = null;
  private messageId = 0;
  private pendingMessages = new Map<string, {
    resolve: (data: unknown) => void;
    reject: (error: Error) => void;
    timeoutId: number;
  }>();
  private ffmpegCapabilities: FFmpegCapabilities | null = null;
  private logListeners = new Set<(log: LogMessage) => void>();
  private progressListeners = new Set<(progress: DownloadProgress) => void>();
  private verboseMode = false;

  /**
   * Initialize the Pyodide worker
   */
  async init(): Promise<FFmpegCapabilities> {
    if (this.worker) {
      console.log('[pyodide-client] Worker already initialized');
      return this.ffmpegCapabilities!;
    }

    console.log('[pyodide-client] Creating worker...');

    // Create worker (Vite will handle the Worker bundling)
    this.worker = new Worker(
      new URL('./pyodide-worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.worker.addEventListener('message', (event: MessageEvent) => {
      this.handleWorkerMessage(event.data);
    });

    // Setup error handler
    this.worker.addEventListener('error', (error) => {
      console.error('[pyodide-client] Worker error:', error);
    });

    // Initialize Pyodide in worker
    console.log('[pyodide-client] Initializing Pyodide...');
    const result = await this.sendMessage('init') as InitResult;
    this.ffmpegCapabilities = result.ffmpegCapabilities;
    console.log('[pyodide-client] Ready!');
    
    return this.ffmpegCapabilities;
  }

  /**
   * Get cached FFmpeg capabilities
   */
  getFFmpegCapabilities(): FFmpegCapabilities | null {
    return this.ffmpegCapabilities;
  }

  /**
   * Extract video metadata (no download)
   */
  async extractInfo(url: string): Promise<VideoInfo> {
    if (!this.worker) {
      throw new Error('Worker not initialized. Call init() first.');
    }

    console.log('[pyodide-client] Extracting info for:', url);
    const result = await this.sendMessage('extract_info', { url });
    return result as VideoInfo;
  }

  async extractAudio(
    url: string, 
    outputPath: string,
    options?: {
      onProgress?: (progress: ExtractionProgress) => void;
      onLog?: (log: LogMessage) => void;
      onDownloadProgress?: (progress: DownloadProgress) => void;
    }
  ): Promise<VideoInfo> {
    if (!this.worker) {
      throw new Error('Worker not initialized. Call init() first.');
    }

    const { onProgress, onLog, onDownloadProgress } = options ?? {};

    const unsubLog = onLog ? this.onLog(onLog) : undefined;
    const unsubProgress = onDownloadProgress ? this.onProgress(onDownloadProgress) : undefined;

    try {
      console.log('[pyodide-client] Extracting audio:', url, '->', outputPath);

      onProgress?.({
        phase: 'downloading',
        percent: 0,
        message: 'Starting download...'
      });

      const result = await this.sendMessage('extract_audio', { url, outputPath }) as ExtractionResult;
      
      console.log('[pyodide-client] yt-dlp phase complete. Queued FFmpeg commands:', result.ffmpegCommands.length);

      if (result.ffmpegCommands.length > 0) {
        onProgress?.({
          phase: 'converting',
          percent: 0,
          message: 'Converting audio...',
          currentCommand: result.ffmpegCommands[0]
        });

        const ffmpegResult = await this.sendMessage('execute_ffmpeg') as { commands: FFmpegCommand[] };
        
        const failedCommands = ffmpegResult.commands.filter(cmd => cmd.status === 'error');
        if (failedCommands.length > 0) {
          const errorMsg = failedCommands.map(cmd => cmd.error).join('; ');
          throw new Error(`FFmpeg conversion failed: ${errorMsg}`);
        }

        console.log('[pyodide-client] FFmpeg phase complete');
      }

      onProgress?.({
        phase: 'completed',
        percent: 100,
        message: 'Extraction complete!'
      });

      return result.info;
    } finally {
      unsubLog?.();
      unsubProgress?.();
    }
  }

  /**
   * Get currently queued FFmpeg commands
   */
  async getQueuedCommands(): Promise<FFmpegCommand[]> {
    if (!this.worker) {
      throw new Error('Worker not initialized. Call init() first.');
    }

    const result = await this.sendMessage('get_ffmpeg_queue') as { commands: FFmpegCommand[] };
    return result.commands;
  }

  /**
   * Execute all queued FFmpeg commands
   */
  async executeFFmpegCommands(): Promise<FFmpegCommand[]> {
    if (!this.worker) {
      throw new Error('Worker not initialized. Call init() first.');
    }

    const result = await this.sendMessage('execute_ffmpeg') as { commands: FFmpegCommand[] };
    return result.commands;
  }

  /**
   * Terminate the worker
   */
  destroy(): void {
    if (this.worker) {
      console.log('[pyodide-client] Terminating worker...');
      this.worker.terminate();
      this.worker = null;
    }

    // Reject all pending messages
    for (const [, { reject, timeoutId }] of this.pendingMessages) {
      clearTimeout(timeoutId);
      reject(new Error('Worker terminated'));
    }
    this.pendingMessages.clear();
  }

  /**
   * Send a message to the worker and wait for response
   */
  private sendMessage(type: WorkerMessage['type'], payload?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }

      const id = String(++this.messageId);
      const timeoutId = window.setTimeout(() => {
        if (this.pendingMessages.has(id)) {
          this.pendingMessages.delete(id);
          reject(new Error(`Message timeout: ${type}`));
        }
      }, 5 * 60 * 1000); // 5 minutes
      
      this.pendingMessages.set(id, { resolve, reject, timeoutId });

      const message: WorkerMessage = { id, type, payload };
      this.worker.postMessage(message);
    });
  }

  private handleWorkerMessage(data: unknown): void {
    const msg = data as { 
      type?: string; 
      id?: string; 
      data?: unknown; 
      success?: boolean; 
      error?: string;
      command?: string;
      args?: Record<string, unknown>;
      code?: string;
    };

    if (msg.type === 'tauri_invoke') {
      this.handleTauriInvoke(msg.id!, msg.command!, msg.args || {});
      return;
    }

    if (msg.type === 'js_sandbox_execute') {
      this.executeInSandbox(msg.id!, msg.code!);
      return;
    }

    if (msg.type === 'log') {
      const logData = msg.data as LogMessage;
      for (const listener of this.logListeners) {
        listener(logData);
      }
      return;
    }

    if (msg.type === 'progress') {
      const progressData = msg.data as DownloadProgress;
      for (const listener of this.progressListeners) {
        listener(progressData);
      }
      return;
    }

    if (msg.id) {
      const pending = this.pendingMessages.get(msg.id);
      if (!pending) {
        if (this.verboseMode) {
          console.warn('[pyodide-client] Received response for unknown message:', msg.id);
        }
        return;
      }

      this.pendingMessages.delete(msg.id);
      clearTimeout(pending.timeoutId);

      if (msg.success) {
        pending.resolve(msg.data);
      } else {
        console.error('[pyodide-client] Error from worker:', msg.error);
        pending.reject(new Error(msg.error || 'Unknown error'));
      }
    }
  }

  private async handleTauriInvoke(id: string, command: string, args: Record<string, unknown>): Promise<void> {
    if (!this.worker) return;
    
    try {
      const result = await invoke(command, args);
      this.worker.postMessage({
        type: 'tauri_response',
        id,
        success: true,
        data: result
      });
    } catch (error) {
      this.worker.postMessage({
        type: 'tauri_response',
        id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async executeInSandbox(id: string, code: string): Promise<void> {
    if (!this.worker) return;

    try {
      const result = await this.runCodeInSandboxedIframe(code);
      this.worker.postMessage({
        type: 'js_sandbox_result',
        id,
        success: true,
        result
      });
    } catch (error) {
      this.worker.postMessage({
        type: 'js_sandbox_result',
        id,
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private runCodeInSandboxedIframe(code: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const transformedCode = code.split("await import('npm:").join("await import('https://esm.sh/");
      
      const iframe = document.createElement('iframe');
      iframe.sandbox.add('allow-scripts');
      iframe.style.display = 'none';
      
      const channel = new MessageChannel();
      let resolved = false;
      
      const cleanup = () => {
        if (document.body.contains(iframe)) {
          iframe.remove();
        }
      };

      channel.port1.onmessage = (e: MessageEvent) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        if (e.data.error) {
          reject(new Error(e.data.error));
        } else {
          resolve(e.data.result);
        }
      };

      const readyHandler = (e: MessageEvent) => {
        if (e.data?.type === 'sandbox_ready' && e.source === iframe.contentWindow) {
          window.removeEventListener('message', readyHandler);
          iframe.contentWindow?.postMessage(transformedCode, '*', [channel.port2]);
        }
      };
      
      window.addEventListener('message', readyHandler);

      iframe.src = '/jsc-sandbox.html';
      document.body.appendChild(iframe);

      iframe.onerror = () => {
        if (resolved) return;
        resolved = true;
        window.removeEventListener('message', readyHandler);
        cleanup();
        reject(new Error('Failed to load sandbox iframe'));
      };

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          window.removeEventListener('message', readyHandler);
          cleanup();
          reject(new Error('Sandbox execution timed out'));
        }
      }, 60000);
    });
  }

  onLog(handler: (log: LogMessage) => void): () => void {
    this.logListeners.add(handler);
    return () => this.logListeners.delete(handler);
  }

  onProgress(handler: (progress: DownloadProgress) => void): () => void {
    this.progressListeners.add(handler);
    return () => this.progressListeners.delete(handler);
  }

  async setVerbose(enabled: boolean): Promise<void> {
    this.verboseMode = enabled;
    if (this.worker) {
      await this.sendMessage('set_verbose', { enabled });
    }
  }

  isVerbose(): boolean {
    return this.verboseMode;
  }
}

/**
 * Create a singleton instance
 */
let clientInstance: PyodideClient | null = null;

export function getPyodideClient(): PyodideClient {
  if (!clientInstance) {
    clientInstance = new PyodideClient();
  }
  return clientInstance;
}

/**
 * Reset the singleton (useful for testing)
 */
export function resetPyodideClient(): void {
  if (clientInstance) {
    clientInstance.destroy();
    clientInstance = null;
  }
}
