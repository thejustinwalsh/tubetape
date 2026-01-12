"""
Pyodide + yt-dlp pre-patched runtime loader.
Safari-compatible: uses synchronous adapters instead of run_sync.
yt-dlp is installed via wheel at Pyodide init time.
"""

import sys
import os

patches_dir = os.path.dirname(__file__)
if patches_dir not in sys.path:
    sys.path.insert(0, patches_dir)

from http_adapter import patch_http_adapter
from dlopen_adapter import patch_subprocess_for_dlopen
from jsc_provider import register_jsc_provider
from yt_dlp import YoutubeDL

print("[loader] Applying HTTP adapter patch...")
patch_http_adapter()

print("[loader] Applying dlopen adapter patch...")
patch_subprocess_for_dlopen()

print("[loader] Registering JS challenge provider...")
register_jsc_provider()

print("[loader] yt-dlp runtime ready!")

__all__ = ['YoutubeDL', 'extract_info', 'prepare_filename']


def extract_info(url, **opts):
    ydl_opts = {
        'quiet': opts.get('quiet', True),
        'no_warnings': opts.get('no_warnings', True),
    }
    
    if opts.get('download'):
        ydl_opts['format'] = opts.get('format', 'bestaudio/best')
        if 'outtmpl' in opts:
            ydl_opts['outtmpl'] = opts['outtmpl']
    
    with YoutubeDL(ydl_opts) as ydl:
        return ydl.extract_info(url, download=opts.get('download', False))


def prepare_filename(info_dict):
    with YoutubeDL({}) as ydl:
        return ydl.prepare_filename(info_dict)
