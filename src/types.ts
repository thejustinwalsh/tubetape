// Re-export Rust types from auto-generated bindings
export type {
  VideoMetadata,
  BeatInfo,
  WaveformData,
  CachedAudioInfo,
  ExtractionEvent,
  PipelineEvent,
  PipelineCommand,
  PipelineResult,
  StageProgress,
  FFmpegCommand,
  StageName as PipelineStageName,
} from "./bindings";

// Frontend-only types (not from Rust)

/** UI state machine */
export type AppState = "idle" | "loading-metadata" | "extracting" | "ready" | "error";

/** Audio info subset used by components */
export interface AudioInfo {
  sampleRate: number;
  durationSecs: number;
}

/** Frontend project data model */
export interface Project {
  videoId: string;
  title: string;
  audioPath: string;
  authorName: string;
  authorUrl: string;
  beatInfo?: import("./bindings").BeatInfo;
}
