"""
dlopen Adapter Patch for yt-dlp in Pyodide.
Intercepts subprocess calls to ffmpeg/ffprobe and routes to native dlopen adapter.
Safari-compatible: uses synchronous JS adapter, no run_sync needed.
"""

import subprocess
import js

_native_ffmpeg_adapter = js.nativeFFmpegAdapter


def patch_subprocess_for_dlopen():
    """Patch subprocess.run to intercept ffmpeg/ffprobe calls."""

    original_run = subprocess.run

    def patched_run(args, **kwargs):
        if isinstance(args, (list, tuple)) and args and args[0] in ("ffmpeg", "ffprobe"):
            command = args[0]
            ffmpeg_args = list(args[1:])

            print(f"[dlopen_adapter] Intercepted {command} call with {len(ffmpeg_args)} args: {ffmpeg_args[:5]}")

            result = _native_ffmpeg_adapter(command, ffmpeg_args)
            
            exit_code = 0
            stdout = b""
            stderr = b""
            
            if result:
                if hasattr(result, 'exit_code'):
                    exit_code = result.exit_code
                elif hasattr(result, 'get'):
                    exit_code = result.get('exit_code', 0)
                    
                if hasattr(result, 'stdout'):
                    stdout = bytes(result.stdout) if result.stdout else b""
                elif hasattr(result, 'get'):
                    stdout = result.get('stdout', b"")
                    
                if hasattr(result, 'stderr'):
                    stderr = bytes(result.stderr) if result.stderr else b""
                elif hasattr(result, 'get'):
                    stderr = result.get('stderr', b"")
            
            return subprocess.CompletedProcess(
                args=args,
                returncode=exit_code,
                stdout=stdout,
                stderr=stderr
            )

        return original_run(args, **kwargs)

    subprocess.run = patched_run
    print("[dlopen_adapter] Patched subprocess.run for ffmpeg/ffprobe (sync mode)")

__all__ = ['patch_subprocess_for_dlopen']
