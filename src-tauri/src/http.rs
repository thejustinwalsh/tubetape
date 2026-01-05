use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::error::Error;
use std::path::Path;
use tokio::io::AsyncWriteExt;

#[derive(Debug, Serialize, Deserialize)]
pub struct HttpResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// HTTP request command for Pyodide worker.
/// Routes HTTP requests through native Tauri HTTP client to bypass CORS.
#[tauri::command]
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

    // Send request
    let response = request
        .send()
        .await
        .map_err(|e| {
            eprintln!("[http] Request error details: {:?}", e);
            eprintln!("[http] Is timeout: {}", e.is_timeout());
            eprintln!("[http] Is connect: {}", e.is_connect());
            eprintln!("[http] Is request: {}", e.is_request());
            if let Some(source) = e.source() {
                eprintln!("[http] Source error: {:?}", source);
            }
            format!("HTTP request failed: {}", e)
        })?;

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
pub async fn download_to_file(
    url: String,
    output_path: String,
    headers: HashMap<String, String>,
) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let mut request = client.get(&url);

    for (key, value) in headers {
        request = request.header(&key, &value);
    }

    let response = request
        .send()
        .await
        .map_err(|e| format!("Download request failed: {}", e))?;

    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }

    let output = Path::new(&output_path);
    if let Some(parent) = output.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("Failed to create output directory: {}", e))?;
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response bytes: {}", e))?;

    let mut file = tokio::fs::File::create(&output_path)
        .await
        .map_err(|e| format!("Failed to create output file: {}", e))?;

    file.write_all(&bytes)
        .await
        .map_err(|e| format!("Failed to write to file: {}", e))?;

    file.flush()
        .await
        .map_err(|e| format!("Failed to flush file: {}", e))?;

    eprintln!("[http] Downloaded {} bytes to {}", bytes.len(), output_path);

    Ok(())
}
