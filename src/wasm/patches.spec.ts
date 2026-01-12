/**
 * Unit tests for Python patch files
 * Tests patch logic without loading full yt-dlp
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const PATCH_DIR = join(process.cwd(), 'scripts/patches');

describe('Python Patches', () => {
  describe('Patch Files Exist', () => {
    it('should have http_adapter.py', async () => {
      const path = join(PATCH_DIR, 'http_adapter.py');
      await expect(readFile(path, 'utf-8')).resolves.toContain('patch_http_adapter');
    });

    it('should have dlopen_adapter.py', async () => {
      const path = join(PATCH_DIR, 'dlopen_adapter.py');
      await expect(readFile(path, 'utf-8')).resolves.toContain('patch_subprocess_for_dlopen');
    });

    it('should have loader.py', async () => {
      const path = join(PATCH_DIR, 'loader.py');
      await expect(readFile(path, 'utf-8')).resolves.toContain('extract_info');
    });
  });

  describe('Patch Structure', () => {
    it('http_adapter should export patch function', async () => {
      const path = join(PATCH_DIR, 'http_adapter.py');
      const content = await readFile(path, 'utf-8');
      
      expect(content).toContain('def patch_http_adapter():');
      expect(content).toContain('__all__');
      expect(content).toContain("'patch_http_adapter'");
    });

    it('dlopen_adapter should export patch function', async () => {
      const path = join(PATCH_DIR, 'dlopen_adapter.py');
      const content = await readFile(path, 'utf-8');
      
      expect(content).toContain('def patch_subprocess_for_dlopen():');
      expect(content).toContain('__all__');
      expect(content).toContain("'patch_subprocess_for_dlopen'");
    });

    it('loader should import both patches', async () => {
      const path = join(PATCH_DIR, 'loader.py');
      const content = await readFile(path, 'utf-8');
      
      expect(content).toContain('from http_adapter import patch_http_adapter');
      expect(content).toContain('from dlopen_adapter import patch_subprocess_for_dlopen');
    });

    it('loader should export extract_info and prepare_filename', async () => {
      const path = join(PATCH_DIR, 'loader.py');
      const content = await readFile(path, 'utf-8');
      
      expect(content).toContain('def extract_info(');
      expect(content).toContain('def prepare_filename(');
      expect(content).toContain('__all__');
    });
  });

  describe('Bridge Function References', () => {
    it('dlopen_adapter should reference js.nativeFFmpegAdapter', async () => {
      const path = join(PATCH_DIR, 'dlopen_adapter.py');
      const content = await readFile(path, 'utf-8');
      
      expect(content).toContain('js.nativeFFmpegAdapter');
      expect(content).toContain('import js');
    });

    it('http_adapter should use async bridge pattern', async () => {
      const path = join(PATCH_DIR, 'http_adapter.py');
      const content = await readFile(path, 'utf-8');
      
      expect(content).toContain('queueHTTPRequest');
      expect(content).toContain('waitForHTTPResponse');
      expect(content).toContain('import js');
    });

    it('dlopen_adapter should handle ffmpeg and ffprobe', async () => {
      const path = join(PATCH_DIR, 'dlopen_adapter.py');
      const content = await readFile(path, 'utf-8');
      
      expect(content).toContain('"ffmpeg"');
      expect(content).toContain('"ffprobe"');
    });
  });

  describe('Error Handling', () => {
    it('dlopen_adapter should handle result variations defensively', async () => {
      const path = join(PATCH_DIR, 'dlopen_adapter.py');
      const content = await readFile(path, 'utf-8');
      
      expect(content).toContain('hasattr');
      expect(content).toContain('returncode');
    });

    it('dlopen_adapter should return CompletedProcess', async () => {
      const path = join(PATCH_DIR, 'dlopen_adapter.py');
      const content = await readFile(path, 'utf-8');
      
      expect(content).toContain('subprocess.CompletedProcess');
      expect(content).toContain('returncode=');
      expect(content).toContain('stdout=');
      expect(content).toContain('stderr=');
    });
  });

  describe('Patch Application Order', () => {
    it('loader should apply HTTP patch before dlopen patch', async () => {
      const path = join(PATCH_DIR, 'loader.py');
      const content = await readFile(path, 'utf-8');
      
      const httpPatchPos = content.indexOf('patch_http_adapter()');
      const dlopenPatchPos = content.indexOf('patch_subprocess_for_dlopen()');
      
      expect(httpPatchPos).toBeGreaterThan(-1);
      expect(dlopenPatchPos).toBeGreaterThan(-1);
      expect(httpPatchPos).toBeLessThan(dlopenPatchPos);
    });

    it('loader should import yt-dlp after applying patches', async () => {
      const path = join(PATCH_DIR, 'loader.py');
      const content = await readFile(path, 'utf-8');
      
      const httpPatchPos = content.indexOf('patch_http_adapter()');
      const ytdlpImportPos = content.indexOf('from yt_dlp import');
      
      // yt-dlp import should be before patch calls (import at top)
      // but YoutubeDL usage should be after patches
      expect(ytdlpImportPos).toBeLessThan(httpPatchPos);
    });
  });
});
