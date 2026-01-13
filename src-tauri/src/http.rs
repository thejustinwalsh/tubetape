use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::error::Error;
use std::path::Path;
use std::time::Instant;
use tauri::ipc::Channel;
use tokio::io::AsyncWriteExt;

use crate::pipeline::DownloadProgress;

#[derive(Debug, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// HTTP request command for Pyodide worker.
/// Routes HTTP requests through native Tauri HTTP client to bypass CORS.
#[tauri::command]
#[specta::specta]
pub async fn http_request(
    url: String,
    method: String,
    headers: HashMap<String, String>,
    body: Option<String>,
) -> Result<HttpResponse, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let method = method.to_uppercase();
    let mut request = match method.as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        "HEAD" => client.head(&url),
        "PATCH" => client.patch(&url),
        _ => return Err(format!("Unsupported HTTP method: {}", method)),
    };

    // Add headers
    for (key, value) in headers {
        request = request.header(&key, &value);
    }

    // Add body if present
    if let Some(body_content) = body {
        request = request.body(body_content);
    }

    eprintln!("[http] Sending {} request to: {}...", method, &url[..url.len().min(80)]);
    
    // Send request
    let response = request
        .send()
        .await
        .map_err(|e| {
            eprintln!("[http] Request FAILED: {:?}", e);
            eprintln!("[http] Is timeout: {}", e.is_timeout());
            eprintln!("[http] Is connect: {}", e.is_connect());
            eprintln!("[http] Is request: {}", e.is_request());
            if let Some(source) = e.source() {
                eprintln!("[http] Source error: {:?}", source);
            }
            format!("HTTP request failed: {}", e)
        })?;
    
    eprintln!("[http] Request succeeded with status: {}", response.status());

    let status = response.status().as_u16();
    
    // Extract headers
    let mut response_headers = HashMap::new();
    for (key, value) in response.headers() {
        if let Ok(v) = value.to_str() {
            response_headers.insert(key.to_string(), v.to_string());
        }
    }

    // Get body as text
    let body_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    Ok(HttpResponse {
        status,
        headers: response_headers,
        body: body_text,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn download_to_file(
    url: String,
    output_path: String,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut request = client.get(&url);

    for (key, value) in headers {
        request = request.header(&key, &value);
    }

    eprintln!("[http] Starting download from: {}...", &url[..url.len().min(80)]);

    let response = request
        .send()
        .await
        .map_err(|e| {
            eprintln!("[http] Download connection failed: {}", e);
            format!("Download request failed: {}", e)
        })?;

    eprintln!("[http] Got response status: {}", response.status());

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let total_size = response.content_length();
    eprintln!("[http] Content-Length: {:?}", total_size);

    let output = Path::new(&output_path);
    if let Some(parent) = output.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    let mut file = tokio::fs::File::create(&output_path)
        .await
        .map_err(|e| format!("Failed to create output file: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Failed to read chunk: {}", e))?;

        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write chunk: {}", e))?;

        downloaded += chunk.len() as u64;
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush file: {}", e))?;

    eprintln!("[http] Downloaded {} bytes to {}", downloaded, output_path);

    Ok(())
}

/// Download a file with progress reporting via channel.
/// Progress is throttled to avoid overwhelming the channel (every 100KB or 250ms).
#[tauri::command]
#[specta::specta]
pub async fn download_to_file_with_progress(
    url: String,
    output_path: String,
    headers: HashMap<String, String>,
    on_progress: Channel<DownloadProgress>,
) -> Result<(), String> {
    use futures_util::StreamExt;

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut request = client.get(&url);

    for (key, value) in headers {
        request = request.header(&key, &value);
    }

    eprintln!(
        "[http] Starting download with progress from: {}...",
        &url[..url.len().min(80)]
    );

    let response = request.send().await.map_err(|e| {
        eprintln!("[http] Download connection failed: {}", e);
        format!("Download request failed: {}", e)
    })?;

    eprintln!("[http] Got response status: {}", response.status());

    if !response.status().is_success() {
        return Err(format!(
            "Download failed with status: {}",
            response.status()
        ));
    }

    let total_bytes = response.content_length();
    eprintln!("[http] Content-Length: {:?}", total_bytes);

    let output = Path::new(&output_path);
    if let Some(parent) = output.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    let mut file = tokio::fs::File::create(&output_path)
        .await
        .map_err(|e| format!("Failed to create output file: {}", e))?;

    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    // Throttle progress updates to avoid overwhelming the channel
    let mut last_progress_time = Instant::now();
    let mut last_progress_bytes: u64 = 0;
    const PROGRESS_BYTE_THRESHOLD: u64 = 100_000; // 100KB
    const PROGRESS_TIME_THRESHOLD_MS: u128 = 250; // 250ms

    // Send initial progress
    let _ = on_progress.send(DownloadProgress {
        bytes_downloaded: 0,
        total_bytes,
        percent: 0.0,
    });

    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Failed to read chunk: {}", e))?;

        file.write_all(&chunk)
            .await
            .map_err(|e| format!("Failed to write chunk: {}", e))?;

        downloaded += chunk.len() as u64;

        // Emit progress (throttled)
        let now = Instant::now();
        let bytes_since_last = downloaded - last_progress_bytes;
        let time_since_last = now.duration_since(last_progress_time).as_millis();

        if bytes_since_last >= PROGRESS_BYTE_THRESHOLD
            || time_since_last >= PROGRESS_TIME_THRESHOLD_MS
        {
            let percent = total_bytes
                .map(|t| (downloaded as f64 / t as f64) * 100.0)
                .unwrap_or(-1.0);

            let _ = on_progress.send(DownloadProgress {
                bytes_downloaded: downloaded,
                total_bytes,
                percent,
            });

            last_progress_time = now;
            last_progress_bytes = downloaded;
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush file: {}", e))?;

    // Send final progress (100%)
    let _ = on_progress.send(DownloadProgress {
        bytes_downloaded: downloaded,
        total_bytes: Some(downloaded), // Use actual downloaded as total for final
        percent: 100.0,
    });

    eprintln!(
        "[http] Downloaded {} bytes to {} (with progress)",
        downloaded, output_path
    );

    Ok(())
}
