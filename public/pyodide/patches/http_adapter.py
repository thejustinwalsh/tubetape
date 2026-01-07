"""
HTTP Adapter Patch for yt-dlp in Pyodide.
Routes HTTP requests through native Tauri HTTP client via async bridge (Safari-compatible).
"""

import io
import asyncio
import js
from yt_dlp.networking.common import RequestHandler, Response, register_rh, register_preference, _REQUEST_HANDLERS
from yt_dlp.networking.exceptions import RequestError

_queue_http_request = getattr(js, 'queueHTTPRequest', None)
_wait_for_http_response = getattr(js, 'waitForHTTPResponse', None)


async def http_request_async(url, method="GET", headers=None, body=None):
    if _queue_http_request is None or _wait_for_http_response is None:
        raise RequestError("HTTP async functions not available")
    
    headers = headers or {}
    request_id = _queue_http_request(url, method, headers, body)
    
    result = await _wait_for_http_response(request_id)
    
    if result.status == 'error':
        raise RequestError(f"HTTP request failed: {result.error}")
    
    response_headers = result.response.headers
    if hasattr(response_headers, 'to_py'):
        response_headers = response_headers.to_py()
    
    return {
        'status': result.response.status,
        'headers': dict(response_headers) if response_headers else {},
        'body': result.response.body
    }


def http_request_sync(url, method="GET", headers=None, body=None):
    loop = asyncio.get_event_loop()
    return loop.run_until_complete(http_request_async(url, method, headers, body))


class NativeRequestHandler(RequestHandler):
    RH_KEY = "Native"
    RH_NAME = "Native"
    _SUPPORTED_URL_SCHEMES = ("http", "https")
    _SUPPORTED_FEATURES = ()
    _SUPPORTED_PROXY_SCHEMES = ()

    def _check_extensions(self, extensions):
        pass

    def _send(self, request):
        headers = dict(getattr(request, "headers", {}) or {})
        body = getattr(request, "data", None)
        method = getattr(request, "method", None) or "GET"

        print(f"[http_adapter] NativeRequestHandler: {method} {request.url[:80]}...")
        result = http_request_sync(request.url, method, headers, body)

        status = result.get("status", 200)
        resp_headers = result.get("headers", {})
        resp_body = result.get("body", b"")
        
        if isinstance(resp_body, str):
            resp_body = resp_body.encode("utf-8")
        elif not isinstance(resp_body, bytes):
            resp_body = bytes(resp_body) if resp_body else b""

        return Response(io.BytesIO(resp_body), request.url, resp_headers, status=status)


def patch_http_adapter():
    if _queue_http_request is None:
        print("[http_adapter] HTTP async functions not available")
        return
    if 'Native' in _REQUEST_HANDLERS:
        return
    
    register_rh(NativeRequestHandler)
    
    @register_preference(NativeRequestHandler)
    def _native_preference(rh, request):
        return 1000000
    
    print("[http_adapter] Patched HTTP handler with async bridge")

__all__ = ['patch_http_adapter', 'http_request_async', 'http_request_sync']
