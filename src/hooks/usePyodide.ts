import { useState, useCallback, useRef, useEffect } from 'react';
import { 
  getPyodideClient, 
  type PyodideClient, 
  type ExtractionProgress,
  type VideoInfo,
  type LogMessage,
  type DownloadProgress 
} from '../wasm/pyodide-client';

export type PyodideStatus = 'idle' | 'initializing' | 'ready' | 'error';

export interface ExtractAudioOptions {
  onProgress?: (progress: ExtractionProgress) => void;
  onLog?: (log: LogMessage) => void;
  onDownloadProgress?: (progress: DownloadProgress) => void;
}

export interface UsePyodideResult {
  status: PyodideStatus;
  error: string | null;
  initialize: () => Promise<void>;
  extractAudio: (
    url: string, 
    outputPath: string, 
    options?: ExtractAudioOptions
  ) => Promise<VideoInfo>;
  extractInfo: (url: string) => Promise<VideoInfo>;
  setVerbose: (enabled: boolean) => Promise<void>;
}

export function usePyodide(): UsePyodideResult {
  const [status, setStatus] = useState<PyodideStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const clientRef = useRef<PyodideClient | null>(null);
  const initPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    return () => {
      if (clientRef.current) {
        clientRef.current.destroy();
        clientRef.current = null;
      }
    };
  }, []);

  const initialize = useCallback(async () => {
    if (status === 'ready' || status === 'initializing') {
      if (initPromiseRef.current) {
        await initPromiseRef.current;
      }
      return;
    }

    setStatus('initializing');
    setError(null);

    const initPromise = (async () => {
      try {
        const client = getPyodideClient();
        await client.init();
        clientRef.current = client;
        
        if (import.meta.env.VITE_VERBOSE_LOGGING === 'true') {
          await client.setVerbose(true);
          console.log('[usePyodide] Verbose logging enabled via VITE_VERBOSE_LOGGING');
        }
        
        setStatus('ready');
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        setStatus('error');
        throw err;
      }
    })();

    initPromiseRef.current = initPromise;
    await initPromise;
  }, [status]);

  const extractAudio = useCallback(async (
    url: string,
    outputPath: string,
    options?: ExtractAudioOptions
  ): Promise<VideoInfo> => {
    if (status !== 'ready') {
      await initialize();
    }

    const client = clientRef.current;
    if (!client) {
      throw new Error('Pyodide client not initialized');
    }

    return client.extractAudio(url, outputPath, options);
  }, [status, initialize]);

  const extractInfo = useCallback(async (url: string): Promise<VideoInfo> => {
    if (status !== 'ready') {
      await initialize();
    }

    const client = clientRef.current;
    if (!client) {
      throw new Error('Pyodide client not initialized');
    }

    return client.extractInfo(url);
  }, [status, initialize]);

  const setVerbose = useCallback(async (enabled: boolean): Promise<void> => {
    if (status !== 'ready') {
      await initialize();
    }

    const client = clientRef.current;
    if (!client) {
      throw new Error('Pyodide client not initialized');
    }

    return client.setVerbose(enabled);
  }, [status, initialize]);

  return {
    status,
    error,
    initialize,
    extractAudio,
    extractInfo,
    setVerbose,
  };
}
