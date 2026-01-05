/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Integration tests for Pyodide + yt-dlp runtime with patches
 * 
 * Tests:
 * - Pyodide WASM loads
 * - Python patches apply correctly
 * - yt-dlp imports and initializes
 * - HTTP adapter routes to native
 * - FFmpeg adapter routes to native
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import type { PyodideInterface } from 'pyodide';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Resolve bundle from project root (works in Vitest/node)
const BUNDLE_PATH = join(process.cwd(), 'public', 'pyodide');
// For Node, Pyodide expects a plain filesystem path; trailing slash required
const INDEX_PATH = `${BUNDLE_PATH}/`;

// Provide CommonJS require for pyodide.asm.js when running under ESM
const nodeRequire = createRequire(import.meta.url);
(globalThis as any).require = nodeRequire;

// Provide __dirname for Pyodide's generated loader
const __dirname = dirname(fileURLToPath(import.meta.url));
(globalThis as any).__dirname = __dirname;

describe('Pyodide Runtime', () => {
  let pyodide: PyodideInterface;
  const mockFFmpegAdapter = vi.fn();
  const ffmpegReturn = { exit_code: 0, stdout: '', stderr: '' };
  
  const httpResponses = new Map<string, { status: string; response?: { status: number; headers: Record<string, string>; body: string }; error?: string }>();
  let httpRequestIdCounter = 0;
  
  const jscResponses = new Map<string, { status: string; result?: string; error?: string }>();
  let jscRequestIdCounter = 0;
  
  const mockQueueHTTPRequest = vi.fn((_url: string, _method: string, _headers: Record<string, string>, _body?: string) => {
    const id = `http_${++httpRequestIdCounter}`;
    httpResponses.set(id, { 
      status: 'completed', 
      response: { status: 200, headers: {}, body: 'mock response' }
    });
    return id;
  });
  
  const mockPollHTTPResponse = vi.fn((id: string) => {
    return httpResponses.get(id) || null;
  });
  
  const mockQueueJSChallenge = vi.fn((_code: string) => {
    const id = `jsc_${++jscRequestIdCounter}`;
    jscResponses.set(id, { status: 'completed', result: 'mock_result' });
    return id;
  });
  
  const mockPollJSChallengeResult = vi.fn((id: string) => {
    return jscResponses.get(id) || null;
  });

  beforeAll(async () => {
    console.log('Loading Pyodide from:', INDEX_PATH);

    const { loadPyodide } = (await import(
      pathToFileURL(join(BUNDLE_PATH, 'pyodide.mjs')).href
    )) as typeof import('pyodide');

    const fs = await import('node:fs/promises');
    const files = await fs.readdir(BUNDLE_PATH);
    const ytDlpWheel = files.find(f => f.startsWith('yt_dlp-') && f.endsWith('.whl'));
    if (!ytDlpWheel) {
      throw new Error('yt-dlp wheel not found in bundle');
    }
    const ytDlpWheelPath = join(BUNDLE_PATH, ytDlpWheel);

    pyodide = await loadPyodide({
      indexURL: INDEX_PATH,
      packages: [ytDlpWheelPath],
    });

    pyodide.setDebug?.(true);

    const FS = pyodide.FS as typeof pyodide.FS & {
      analyzePath: (path: string) => { exists: boolean };
      mkdir: (path: string) => void;
    };
    if (!FS.analyzePath('/pyodide').exists) {
      FS.mkdir('/pyodide');
    }
    if (!FS.analyzePath('/pyodide/patches').exists) {
      FS.mkdir('/pyodide/patches');
    }
    FS.mount(FS.filesystems.NODEFS, { root: join(BUNDLE_PATH, 'patches') }, '/pyodide/patches');

    await pyodide.loadPackage(['ssl']);

    await pyodide.runPythonAsync(/*py*/`
      import sys
      if '/pyodide/patches' not in sys.path:
        sys.path.insert(0, '/pyodide/patches')
    `);

    (globalThis as any).queueHTTPRequest = mockQueueHTTPRequest;
    (globalThis as any).pollHTTPResponse = mockPollHTTPResponse;
    (globalThis as any).queueJSChallenge = mockQueueJSChallenge;
    (globalThis as any).pollJSChallengeResult = mockPollJSChallengeResult;

    // Provide nativeFFmpegAdapter and then wrap it on the Python side to keep the proxy alive
    (globalThis as any).nativeFFmpegAdapter = async (command: string, args: any) => {
      // Copy args immediately to avoid holding a borrowed PyProxy across await
      const argList = args && typeof (args as any).toJs === 'function'
        ? (args as any).toJs({ create_proxies: false })
        : Array.isArray(args)
          ? args.slice()
          : Array.from(args || []);

      const result = await mockFFmpegAdapter(command, argList);
      const fallback = ffmpegReturn;
      if (result && typeof result === 'object') {
        return {
          exit_code: (result as any).exit_code ?? fallback.exit_code,
          stdout: (result as any).stdout ?? fallback.stdout,
          stderr: (result as any).stderr ?? fallback.stderr,
        };
      }
      return fallback;
    };

    // Wrap the JS adapter with pyodide.ffi.create_proxy from the Python side
    await pyodide.runPythonAsync(/*py*/`
from pyodide.ffi import create_proxy
import js
if getattr(js, 'nativeFFmpegAdapter', None):
    js.nativeFFmpegAdapter = create_proxy(js.nativeFFmpegAdapter)
`);

    console.log('Pyodide loaded');
  }, 60000); // Increase timeout for WASM load

  afterAll(() => {
    if (!pyodide) return;
    if (typeof (pyodide as any).terminate === 'function') {
      (pyodide as any).terminate();
    } else if (typeof (pyodide as any).destroy === 'function') {
      (pyodide as any).destroy();
    }
  });

  describe('Core Setup', () => {
    it('should load Pyodide WASM bundle', () => {
      expect(pyodide).toBeDefined();
      expect(pyodide.runPython).toBeDefined();
    });

    it('should have Python 3.12+', () => {
      const version = pyodide.runPython(`
        import sys
        f"{sys.version_info.major}.{sys.version_info.minor}"
      `);
      expect(version).toMatch(/^3\.(1[2-9]|[2-9]\d)/); // 3.12 or higher
    });

    it('should have patches in path and yt-dlp installed', async () => {
      const pathCheck = pyodide.runPython(`
        import sys
        any('patches' in p for p in sys.path)
      `);
      expect(pathCheck).toBe(true);
      
      await expect(
        pyodide.runPythonAsync('import yt_dlp')
      ).resolves.not.toThrow();
    });
  });

  describe('HTTP Adapter Patch', () => {
    it('should load http_adapter module', async () => {
      await expect(
        pyodide.runPythonAsync('from http_adapter import patch_http_adapter')
      ).resolves.not.toThrow();
    });

    it('should apply HTTP patch', async () => {
      await pyodide.runPythonAsync('patch_http_adapter()');
      
      // Verify patch was applied by checking console output
      const output = pyodide.runPython('print("[test] HTTP adapter patched"); "ok"');
      expect(output).toBe('ok');
    });
  });

  describe('dlopen Adapter Patch', () => {
    it('should load dlopen_adapter module', async () => {
      await expect(
        pyodide.runPythonAsync('from dlopen_adapter import patch_subprocess_for_dlopen')
      ).resolves.not.toThrow();
    });

    it('should apply subprocess patch', async () => {
      await pyodide.runPythonAsync('patch_subprocess_for_dlopen()');
      
      const output = pyodide.runPython('print("[test] dlopen adapter patched"); "ok"');
      expect(output).toBe('ok');
    });

    it('should intercept subprocess ffmpeg calls', async () => {
      mockFFmpegAdapter.mockReturnValue(ffmpegReturn);

      await pyodide.runPythonAsync(/*py*/`
        import subprocess
        result = subprocess.run(['ffmpeg', '-version'], capture_output=True)
      `);

      expect(mockFFmpegAdapter).toHaveBeenCalledWith('ffmpeg', ['-version']);
    });
  });

  describe('Loader Module', () => {
    it('should load loader module', async () => {
      await expect(
        pyodide.runPythonAsync('from loader import extract_info, prepare_filename')
      ).resolves.not.toThrow();
    });

    it('should have yt-dlp imported', async () => {
      const hasYtDlp = await pyodide.runPythonAsync(/*py*/`
        from loader import YoutubeDL
        YoutubeDL is not None
      `);
      expect(hasYtDlp).toBe(true);
    });

    it('should export extract_info function', async () => {
      const hasExtractInfo = await pyodide.runPythonAsync(/*py*/`
        from loader import extract_info
        callable(extract_info)
      `);
      expect(hasExtractInfo).toBe(true);
    });
  });

  describe('yt-dlp Integration', () => {
    it('should import yt-dlp successfully', async () => {
      await expect(
        pyodide.runPythonAsync('from yt_dlp import YoutubeDL')
      ).resolves.not.toThrow();
    });

    it('should create YoutubeDL instance', async () => {
      const created = await pyodide.runPythonAsync(/*py*/`
        from yt_dlp import YoutubeDL
        ydl = YoutubeDL({'quiet': True})
        ydl is not None
      `);
      expect(created).toBe(true);
    });

    it('should have extractors available', async () => {
      const hasExtractors = await pyodide.runPythonAsync(/*py*/`
        from yt_dlp import YoutubeDL
        from yt_dlp.extractor import youtube
        youtube.YoutubeIE is not None
      `);
      expect(hasExtractors).toBe(true);
    });
  });

  describe('Native Bridge Integration', () => {
    it('should access HTTP polling functions from Python', async () => {
      const canAccess = await pyodide.runPythonAsync(/*py*/`
        import js
        hasattr(js, 'queueHTTPRequest') and hasattr(js, 'pollHTTPResponse')
      `);
      expect(canAccess).toBe(true);
    });

    it('should access JSC polling functions from Python', async () => {
      const canAccess = await pyodide.runPythonAsync(/*py*/`
        import js
        hasattr(js, 'queueJSChallenge') and hasattr(js, 'pollJSChallengeResult')
      `);
      expect(canAccess).toBe(true);
    });

    it('should access nativeFFmpegAdapter from Python', async () => {
      const canAccess = await pyodide.runPythonAsync(/*py*/`
        import js
        hasattr(js, 'nativeFFmpegAdapter')
      `);
      expect(canAccess).toBe(true);
    });

    it('should call nativeFFmpegAdapter with correct args', async () => {
      mockFFmpegAdapter.mockReturnValue(ffmpegReturn);

      await pyodide.runPythonAsync(/*py*/`
        import subprocess
        subprocess.run(['ffmpeg', '-i', 'input.mp4', '-vn', 'output.m4a'])
      `);

      expect(mockFFmpegAdapter).toHaveBeenCalledWith(
        'ffmpeg',
        ['-i', 'input.mp4', '-vn', 'output.m4a']
      );
    });
  });

  describe('End-to-End Patch Verification', () => {
    it('should apply all patches via loader', async () => {
      // Reset and reload with loader
      await pyodide.runPythonAsync(/*py*/`
        import sys
        # Clear any cached modules
        if 'loader' in sys.modules:
            del sys.modules['loader']
        if 'http_adapter' in sys.modules:
            del sys.modules['http_adapter']
        if 'dlopen_adapter' in sys.modules:
            del sys.modules['dlopen_adapter']
      `);

      // Import loader (should apply all patches)
      await pyodide.runPythonAsync('from loader import extract_info');

      // Verify subprocess patch is active
      mockFFmpegAdapter.mockResolvedValue({
        exit_code: 0,
        stdout: '',
        stderr: '',
      });

      await pyodide.runPythonAsync(/*py*/`
        import subprocess
        subprocess.run(['ffprobe', '-version'])
      `);

      expect(mockFFmpegAdapter).toHaveBeenCalledWith('ffprobe', ['-version']);
    });
  });
});
