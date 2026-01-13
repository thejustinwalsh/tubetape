# Pipeline Refactor: Unified Progress Tracking

## Overview

Refactor the `PipelineExecutor` to orchestrate the **entire** audio fetch-convert-process flow, providing a single 0-100% progress bar with weighted stages.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Rust PipelineExecutor (State Machine)               │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  States                                                             │   │
│  │  ───────────────────────────────────────────────────────────────── │   │
│  │  AwaitingExtraction ──► RunningFFmpeg ──► ProcessingAudio ──► Done  │   │
│  │         │                    │                  │              │    │   │
│  │         └────────────────────┴──────────────────┴────► Error ──┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  Emits: PipelineEvent (progress, requests, errors, completion)              │
│  Receives: PipelineCommand (extraction complete, download progress, error)  │
└─────────────────────────────────────────────────────────────────────────────┘
              │                                          ▲
              │ PipelineEvent::RequestExtraction         │ invoke("pipeline_notify")
              ▼                                          │
┌─────────────────────────────────────────────────────────────────────────────┐
│                            Frontend (Thin Proxy)                            │
│                                                                             │
│  - Listens for RequestExtraction, runs Pyodide                              │
│  - Forwards download progress to pipeline                                   │
│  - Updates UI from Progress events                                          │
└─────────────────────────────────────────────────────────────────────────────┘
              │                                          ▲
              │ pyodide.extractAudio()                   │ postMessage
              ▼                                          │
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Pyodide Worker (WASM)                              │
│                                                                             │
│  - yt-dlp info extraction (HTTP requests via Rust)                          │
│  - Format selection                                                         │
│  - Calls download_to_file_with_progress (streams progress)                  │
│  - FFmpeg command queuing                                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Stages & Weights

| Stage          | Weight | Blocking | Description                           |
|----------------|--------|----------|---------------------------------------|
| Initializing   | 5%     | Yes      | yt-dlp info extraction (indeterminate)|
| Downloading    | 40%    | Yes      | Audio stream download (byte progress) |
| Converting     | 10%    | Yes      | FFmpeg remux (indeterminate)          |
| Waveform       | 25%    | No       | Peak generation (chunk progress)      |
| BeatDetection  | 20%    | No       | Aubio analysis (indeterminate)        |

**Blocking** stages must complete before the next stage starts.
**Non-blocking** stages (Waveform + BeatDetection) run in parallel.

## Implementation Tasks

### 1. Extend `src-tauri/src/pipeline/mod.rs`

- [ ] Add new stages to `StageName` enum: `Initializing`, `Downloading`, `Converting`
- [ ] Add `weight()` and `is_blocking()` methods to `StageName`
- [ ] Add new `PipelineEvent` variants:
  - `RequestExtraction { url, output_path }` - asks frontend to run Pyodide
  - Update `Started` to include URL
  - Update `Completed` to include `audio_path`
- [ ] Add `PipelineCommand` enum for frontend → pipeline communication
- [ ] Add `FFmpegCommand` struct (or import from types)

### 2. Refactor `src-tauri/src/pipeline/executor.rs`

- [ ] Add `PipelineState` enum for state machine
- [ ] Refactor `PipelineExecutor` to:
  - Accept URL instead of audio_path
  - Hold `mpsc::Receiver<PipelineCommand>` for commands
  - Track progress per-stage in `HashMap<StageName, f64>`
- [ ] Implement state machine loop:
  - Emit `RequestExtraction`, wait for completion/failure
  - Run FFmpeg commands sequentially
  - Run waveform + beats in parallel (existing logic)
- [ ] Add `calculate_overall_progress()` using weights
- [ ] Add fail-fast error handling

### 3. Add `download_to_file_with_progress` to `src-tauri/src/http.rs`

- [ ] Add `DownloadProgress` struct
- [ ] Create new command that accepts `Channel<DownloadProgress>`
- [ ] Stream progress every 100KB or 500ms (throttled)
- [ ] Keep existing `download_to_file` for backwards compatibility

### 4. Update `src-tauri/src/lib.rs`

- [ ] Add `run_pipeline` command (replaces direct `process_audio` for new flow)
- [ ] Add `pipeline_notify` command for frontend → pipeline communication
- [ ] Add `PipelineCommandSender` state wrapper
- [ ] Keep existing commands for backwards compatibility during transition

### 5. Update Pyodide Worker `src/wasm/pyodide-worker.ts`

- [ ] Update `processDownloadQueue` to use `download_to_file_with_progress`
- [ ] Forward `DownloadProgress` to main thread via `postMessage`
- [ ] Add message type for download progress

### 6. Update Pyodide Client `src/wasm/pyodide-client.ts`

- [ ] Add `onDownloadProgress` callback to `extractAudio` options
- [ ] Handle `downloadProgress` messages from worker
- [ ] Forward progress to callback

### 7. Update Frontend `src/App.tsx`

- [ ] Replace `pyodide.extractAudio()` + `invoke("process_audio")` with single `invoke("run_pipeline")`
- [ ] Handle `RequestExtraction` event by running Pyodide
- [ ] Forward download progress via `invoke("pipeline_notify")`
- [ ] Notify extraction complete/failed via `invoke("pipeline_notify")`
- [ ] Simplify progress state (single source from pipeline)

### 8. Update Types `src/types.ts`

- [ ] Add/update `PipelineEvent` types to match Rust
- [ ] Add `PipelineCommand` type
- [ ] Add `DownloadProgress` type

## Event Flow

```
1. User submits URL
2. Frontend: invoke("run_pipeline", { url, channel })
3. Rust: PipelineExecutor starts, emits RequestExtraction
4. Frontend: receives RequestExtraction, calls pyodide.extractAudio()
5. Worker: yt-dlp extracts info (multiple HTTP requests)
6. Worker: calls download_to_file_with_progress
7. Rust http.rs: streams DownloadProgress to channel
8. Worker: forwards progress via postMessage
9. Frontend: receives progress, calls pipeline_notify(DownloadProgress)
10. Rust: PipelineExecutor receives command, updates progress, emits Progress event
11. Frontend: receives Progress event, updates UI
12. Worker: extraction complete
13. Frontend: calls pipeline_notify(ExtractionComplete)
14. Rust: PipelineExecutor runs FFmpeg commands
15. Rust: PipelineExecutor runs waveform + beats in parallel
16. Rust: emits WaveformChunk, WaveformComplete, BeatDetectionComplete
17. Rust: emits Completed
18. Frontend: receives Completed, updates UI to ready state
```

## Error Handling

- Any stage failure triggers `PipelineEvent::Error`
- Pipeline stops immediately (fail-fast)
- Frontend shows error dialog with stage context
- Future: `recoverable` flag for retry logic

## Testing Strategy

1. Unit test `calculate_overall_progress()` with various stage states
2. Unit test state machine transitions
3. Integration test: mock Pyodide extraction, verify progress flow
4. E2E test: full extraction with real YouTube URL

## Migration Path

1. Implement new pipeline alongside existing code
2. Add feature flag or separate command
3. Test thoroughly
4. Switch frontend to new flow
5. Remove old extraction code paths
