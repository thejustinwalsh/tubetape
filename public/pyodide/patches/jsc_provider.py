"""
JavaScript Challenge Provider for yt-dlp in Pyodide.
Routes JS execution to native QuickJS via async bridge (Safari-compatible).
"""

import importlib.util
import asyncio
import js

_queue_js_challenge = getattr(js, 'queueJSChallenge', None)
_wait_for_js_challenge = getattr(js, 'waitForJSChallenge', None)


async def execute_js_challenge_async(code):
    if _queue_js_challenge is None or _wait_for_js_challenge is None:
        raise RuntimeError("JS challenge async functions not available")
    
    challenge_id = _queue_js_challenge(code)
    result = await _wait_for_js_challenge(challenge_id)
    
    if result.status == 'error':
        raise RuntimeError(f"JS challenge failed: {result.error}")
    return result.result if hasattr(result, 'result') else str(result)


def execute_js_challenge_sync(code):
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(execute_js_challenge_async(code))


def register_jsc_provider():
    if _queue_js_challenge is None:
        print("[jsc_provider] queueJSChallenge not available")
        return False
    
    if not importlib.util.find_spec("yt_dlp.extractor.youtube.jsc"):
        print("[jsc_provider] yt-dlp version doesn't support JS challenges")
        return False
    
    try:
        from yt_dlp.extractor.youtube.jsc.provider import (
            register_provider,
            register_preference,
        )
        from yt_dlp.extractor.youtube.jsc._builtin.deno import DenoJCP
        
        @register_provider
        class TubetapeJCP(DenoJCP):
            PROVIDER_NAME = 'Tubetape'
            JS_RUNTIME_NAME = 'Tubetape'
            
            def is_available(self):
                return _queue_js_challenge is not None
            
            def _run_deno(self, stdin, options):
                print("[jsc_provider] Executing JS challenge via async bridge...")
                result = execute_js_challenge_sync(stdin)
                print("[jsc_provider] JS challenge completed")
                return result
            
            def _npm_packages_cached(self, stdin):
                return False
        
        @register_preference(TubetapeJCP)
        def preference(*_):
            return 99999999999
        
        print("[jsc_provider] Registered Tubetape JS challenge provider")
        return True
        
    except Exception as e:
        print(f"[jsc_provider] Failed to register: {e}")
        return False


__all__ = ['register_jsc_provider', 'execute_js_challenge_async', 'execute_js_challenge_sync']
