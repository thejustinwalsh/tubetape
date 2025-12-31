export interface VideoMetadata {
  title: string;
  authorName: string;
  authorUrl: string;
  thumbnailUrl: string;
  videoId: string;
}

export type ExtractionEvent =
  | { event: "started"; data: { video_id: string } }
  | { event: "progress"; data: { percent: number; status: string } }
  | { event: "audioInfo"; data: { sample_rate: number } }
  | { event: "waveformProgress"; data: { total_peaks: number } }
  | { event: "waveformChunk"; data: { peaks: number[]; offset: number } }
  | { event: "completed"; data: { audio_path: string; duration_secs: number } }
  | { event: "error"; data: { message: string } };

export interface AudioInfo {
  sampleRate: number;
  durationSecs: number;
}

export interface WaveformData {
  peaks: number[];
  durationSecs: number;
  sampleRate: number;
}

export type AppState = "idle" | "loading-metadata" | "extracting" | "ready" | "error";

export interface CachedAudioInfo {
  audioPath: string;
  durationSecs: number;
  sampleRate: number;
}

export interface Project {
  videoId: string;
  title: string;
  audioPath: string;
  authorName: string;
  authorUrl: string;
}
