use lazy_static::lazy_static;
use regex::Regex;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::VideoMetadata;

lazy_static! {
    static ref YOUTUBE_URL_REGEX: Regex = Regex::new(
        r"(?:youtube\.com/(?:watch\?v=|embed/|v/|shorts/)|youtu\.be/)([a-zA-Z0-9_-]{11})"
    )
    .unwrap();
    static ref PROGRESS_REGEX: Regex = Regex::new(r"\[download\]\s+(\d+(?:\.\d+)?)").unwrap();
}

pub fn extract_video_id(url: &str) -> Option<String> {
    YOUTUBE_URL_REGEX
        .captures(url)
        .and_then(|caps| caps.get(1))
        .map(|m| m.as_str().to_string())
}

pub async fn fetch_oembed_metadata(url: &str) -> Result<VideoMetadata, String> {
    let video_id = extract_video_id(url).ok_or_else(|| "Invalid YouTube URL".to_string())?;

    let oembed_url = format!(
        "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v={}&format=json",
        video_id
    );

    let response: serde_json::Value = reqwest::get(&oembed_url)
        .await
        .map_err(|e| format!("Failed to fetch metadata: {}", e))?
        .json()
        .await
        .map_err(|e| format!("Failed to parse metadata: {}", e))?;

    let thumbnail_url = response["thumbnail_url"]
        .as_str()
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("https://img.youtube.com/vi/{}/hqdefault.jpg", video_id));

    Ok(VideoMetadata {
        title: response["title"].as_str().unwrap_or("Unknown").to_string(),
        author_name: response["author_name"]
            .as_str()
            .unwrap_or("Unknown")
            .to_string(),
        author_url: response["author_url"].as_str().unwrap_or("").to_string(),
        thumbnail_url,
        video_id,
    })
}

pub async fn download_audio<F>(
    url: &str,
    output_path: &Path,
    deno_path: Option<PathBuf>,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(f64, &str),
{
    let yt_dlp = find_yt_dlp()?;

    let output_dir = output_path
        .parent()
        .ok_or_else(|| "Invalid output path".to_string())?;
    let stem = output_path
        .file_stem()
        .and_then(|s| s.to_str())
        .ok_or_else(|| "Invalid output filename".to_string())?;

    let template = output_dir.join(format!("{}.%(ext)s", stem));
    let template_str = template.to_string_lossy().to_string();

    let mut cmd = Command::new(&yt_dlp);
    cmd.arg("-x")
        .arg("--audio-format")
        .arg("mp3")
        .arg("--audio-quality")
        .arg("0")
        .arg("-o")
        .arg(&template_str)
        .arg("--newline")
        .arg("--no-playlist")
        .arg("--progress")
        .arg("--socket-timeout")
        .arg("30");

    // Add deno executable if provided
    if let Some(deno) = deno_path {
        let deno_str = deno.to_string_lossy().to_string();
        eprintln!("[tubetape] Using deno runtime: {}", deno_str);
        // yt-dlp expects a JS runtime, using bundled deno, see yt-dlp's --js-runtimes option.
        cmd.arg("--js-runtimes")
            .arg(format!("deno:{}", deno_str));
    }

    let mut child = cmd
        .arg(url)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn yt-dlp: {}", e))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture stderr".to_string())?;

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();

    on_progress(0.0, "Starting download...");

    let mut stdout_done = false;
    let mut stderr_done = false;
    let mut stderr_output = Vec::new();

    while !stdout_done || !stderr_done {
        tokio::select! {
            line = stdout_reader.next_line(), if !stdout_done => {
                match line {
                    Ok(Some(text)) => {
                        eprintln!("[tubetape] stdout: {}", text);
                        if let Some(caps) = PROGRESS_REGEX.captures(&text) {
                            if let Some(pct) = caps.get(1) {
                                if let Ok(percent) = pct.as_str().parse::<f64>() {
                                    on_progress(percent, "Downloading...");
                                }
                            }
                        }
                    }
                    Ok(None) => stdout_done = true,
                    Err(_) => stdout_done = true,
                }
            }
            line = stderr_reader.next_line(), if !stderr_done => {
                match line {
                    Ok(Some(text)) => {
                        eprintln!("[tubetape] stderr: {}", text);
                        stderr_output.push(text.clone());
                        if let Some(caps) = PROGRESS_REGEX.captures(&text) {
                            if let Some(pct) = caps.get(1) {
                                if let Ok(percent) = pct.as_str().parse::<f64>() {
                                    on_progress(percent, "Downloading...");
                                }
                            }
                        } else if text.contains("[ExtractAudio]") {
                            on_progress(95.0, "Extracting audio...");
                        }
                    }
                    Ok(None) => stderr_done = true,
                    Err(_) => stderr_done = true,
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed to wait for yt-dlp: {}", e))?;

    if !status.success() {
        eprintln!("[tubetape] yt-dlp failed with status: {}", status);
        
        // Find relevant error messages from stderr
        let error_hints: Vec<_> = stderr_output.iter()
            .filter(|line| {
                line.contains("ERROR") || 
                line.contains("error") ||
                line.contains("WARNING") ||
                line.contains("unavailable") ||
                line.contains("unable") ||
                line.contains("failed") ||
                line.contains("Sign in")
            })
            .cloned()
            .collect();
        
        let error_msg = if !error_hints.is_empty() {
            format!(
                "yt-dlp failed (exit code: {}). Error details:\n{}",
                status.code().unwrap_or(-1),
                error_hints.join("\n")
            )
        } else {
            format!(
                "yt-dlp failed (exit code: {}). No specific error found in output.\n\nFull stderr:\n{}",
                status.code().unwrap_or(-1),
                stderr_output.join("\n")
            )
        };
        
        return Err(error_msg);
    }

    eprintln!("[tubetape] yt-dlp completed successfully");

    let expected_mp3 = output_dir.join(format!("{}.mp3", stem));
    if expected_mp3.exists() {
        if expected_mp3 != output_path {
            std::fs::rename(&expected_mp3, output_path)
                .map_err(|e| format!("Failed to rename output: {}", e))?;
        }
        return Ok(());
    }

    for entry in std::fs::read_dir(output_dir)
        .map_err(|e| format!("Failed to read output directory: {}", e))?
    {
        if let Ok(entry) = entry {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with(stem) && name.ends_with(".mp3") {
                    std::fs::rename(&path, output_path)
                        .map_err(|e| format!("Failed to rename output: {}", e))?;
                    return Ok(());
                }
            }
        }
    }

    Err(format!(
        "Output file not found after extraction. Expected: {}",
        expected_mp3.display()
    ))
}

fn find_yt_dlp() -> Result<String, String> {
    let candidates = [
        "yt-dlp",
        "/opt/homebrew/bin/yt-dlp",
        "/usr/local/bin/yt-dlp",
    ];

    for candidate in candidates {
        if std::process::Command::new(candidate)
            .arg("--version")
            .output()
            .is_ok()
        {
            return Ok(candidate.to_string());
        }
    }

    Err("yt-dlp not found. Please install it: brew install yt-dlp".to_string())
}
