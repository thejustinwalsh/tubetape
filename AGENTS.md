# AGENTS.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Tubetape is a Tauri v2 desktop app for extracting audio from YouTube videos with DAW-like sample creation features. Users paste a YouTube URL, the app extracts audio, generates waveforms, detects BPM, and allows creating/exporting audio samples.

**Tech Stack:**
- Frontend: React 19, TypeScript 5.8, Vite 7, Tailwind CSS v4
- Backend: Rust (Tauri v2) with tauri-specta for type-safe bindings
- Audio Extraction: yt-dlp in Pyodide (WebAssembly) + FFmpeg via dlopen
- Audio Analysis: aubio for BPM, custom Rust pipeline for waveforms
- Storage: RxDB/IndexedDB for local data
- Package Manager: bun

## Build & Development Commands

```bash
# Install dependencies and build native libs
bun install
bun run build              # Builds yt-dlp wheels, FFmpeg libs, then frontend

# Development
bun run tauri dev          # Full app with hot reload
bun run dev                # Frontend only (port 1420)

# Tests
bun run test               # All tests (web + Rust)
bun run test:web           # Vitest (frontend)
bun run test:tauri         # cargo test (Rust)
cargo test test_name       # Single Rust test (from src-tauri/)
vitest run src/lib/db.spec.ts  # Single frontend test

# Rust-specific (from src-tauri/)
cargo build
cargo test
cargo test test_export_sample -- --nocapture  # With output
cargo clippy
cargo fmt

# Native dependency management
bun run build:ffmpeg       # Rebuild FFmpeg libs
bun run build:yt-dlp       # Rebuild Pyodide + yt-dlp wheels
bun run clean              # Clean native builds
```

## Architecture

### Rust Backend (src-tauri/src/)

The backend uses a **pipeline architecture** for audio processing:

```
Pipeline Stages (pipeline/mod.rs):
  Initializing → Downloading → Converting → Waveform → BeatDetection
```

**Key modules:**
- `lib.rs` - Tauri commands, type definitions, specta bindings
- `pipeline/` - Stage-based processing with progress tracking
- `ffmpeg_runtime.rs` - FFmpeg via dlopen (loads libav* at runtime, no CLI)
- `ffmpeg_shim.rs` - Parses ffmpeg CLI args → direct API calls
- `beat_detection.rs` - BPM analysis via aubio
- `audio.rs` - Waveform generation using symphonia
- `http.rs` - Native HTTP with progress streaming for downloads

**FFmpeg Integration:**
- Libraries loaded via `dlopen` from `src-tauri/binaries/ffmpeg/`
- `ffmpeg_runtime.rs` wraps 40+ FFmpeg C functions as Rust function pointers
- `ffmpeg_shim.rs` translates CLI-style commands to API calls
- Supports: audio remux (copy), transcode to MP3/AAC/FLAC/WAV, stream info
- MP3 encoding requires proper frame sizing (1152 samples for libmp3lame)

### Frontend (src/)

**Core files:**
- `App.tsx` - Main component, orchestrates extraction flow
- `bindings.ts` - Auto-generated type-safe Tauri commands (tauri-specta)
- `wasm/pyodide-worker.ts` - Web Worker running yt-dlp in Pyodide
- `wasm/pyodide-client.ts` - Main thread ↔ worker communication
- `lib/db.ts` - RxDB schema for projects/samples
- `lib/audioEngine.ts` - Web Audio API playback with looping
- `hooks/useRegionPlayer.ts` - Sample-accurate region playback

**Pyodide/yt-dlp Architecture:**
```
pyodide-worker.ts (Web Worker)
  ├─ Runs yt-dlp in WebAssembly Python
  ├─ HTTP requests routed through Tauri (CORS bypass)
  ├─ Downloads streamed directly to disk via Rust
  └─ FFmpeg commands queued, executed after yt-dlp completes
```

### Type-Safe IPC

Tauri commands use `tauri-specta` for automatic TypeScript bindings:
- Rust: `#[tauri::command] #[specta::specta]` decorators
- Frontend: Import from `src/bindings.ts` (auto-generated)
- Events use channels: `Channel<PipelineEvent>` for streaming progress

## Code Style

**TypeScript:**
- Strict mode enabled, no `any` or `@ts-ignore`
- Function components, hooks for state
- Import from `@tauri-apps/api` for Tauri APIs

**Rust:**
- Use `Result<T, String>` for fallible commands
- `cargo fmt` and `cargo clippy` before commits
- FFmpeg operations require proper resource cleanup (contexts, frames, packets)

**Tailwind CSS v4:**
- Uses `@theme` blocks for custom design tokens in `src/App.css`
- Retro 80s aesthetic with neon colors

## Important Implementation Details

**Audio Export (ffmpeg_runtime.rs:export_sample):**
- Encoder frame sizes matter: MP3 needs 1152 samples, FLAC needs 4608
- Always use `swr_convert` buffering for fixed-frame encoders
- Use `av_channel_layout_default()` not layout copy (libmp3lame requires native order)

**Pipeline Commands:**
- Frontend sends `PipelineCommand` to Rust via channels
- Rust sends `PipelineEvent` back for progress/results
- Extraction blocks until frontend's Pyodide worker completes

**Testing FFmpeg changes:**
- Use `cargo test test_export_sample` to verify audio export
- Test file: `vendor/lame-3.100/testcase.wav` (~0.56 seconds)
