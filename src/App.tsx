import { useState, useCallback, useEffect } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { appDataDir, join } from "@tauri-apps/api/path";
import "./App.css";

import ProjectCombobox from "./components/ProjectCombobox";
import CassetteTape from "./components/CassetteTape";
import VideoUnfurl from "./components/VideoUnfurl";
import Waveform from "./components/Waveform";
import SampleWaveform from "./components/SampleWaveform";
import { getDatabase, generateSampleId, type SampleDocType, type TubetapeDatabase } from "./lib/db";
import type { VideoMetadata, AppState, Project, CachedAudioInfo, AudioInfo } from "./types";
import { useAppStats } from "./hooks/useAppStats";
import { usePyodide } from "./hooks/usePyodide";

interface WaveformEvent {
  event: "started" | "audioInfo" | "progress" | "chunk" | "completed" | "error";
  data: {
    audio_path?: string;
    sample_rate?: number;
    duration_secs?: number;
    total_peaks?: number;
    peaks?: number[];
    offset?: number;
    message?: string;
  };
}

function App() {
  const [appState, setAppState] = useState<AppState>("idle");
  const { stats, refetch: refetchStats } = useAppStats();
  const pyodide = usePyodide();
  const [metadata, setMetadata] = useState<VideoMetadata | null>(null);
  const [progress, setProgress] = useState<{ percent: number; status: string } | null>(null);
  const [audioPath, setAudioPath] = useState<string | null>(null);
  const [duration, setDuration] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [db, setDb] = useState<TubetapeDatabase | null>(null);
  const [samples, setSamples] = useState<SampleDocType[]>([]);
  const [selectedRegion, setSelectedRegion] = useState<{ start: number; end: number } | null>(null);
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentProject, setCurrentProject] = useState<Project | null>(null);
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);

  useEffect(() => {
    getDatabase().then(setDb);
  }, []);

  useEffect(() => {
    if (!db) return;

    const subscription = db.samples.find().$.subscribe((allSamples) => {
      const projectMap = new Map<string, Project>();
      for (const doc of allSamples) {
        const sample = doc.toJSON() as SampleDocType;
        if (!projectMap.has(sample.sourceVideoId)) {
          projectMap.set(sample.sourceVideoId, {
            videoId: sample.sourceVideoId,
            title: sample.sourceVideoTitle,
            audioPath: sample.sourceAudioPath,
            authorName: sample.sourceAuthorName ?? "",
            authorUrl: sample.sourceAuthorUrl ?? "",
          });
        }
      }
      setProjects(Array.from(projectMap.values()));
    });

    return () => subscription.unsubscribe();
  }, [db]);

  useEffect(() => {
    if (!db || !metadata) return;

    const query = db.samples.find({
      selector: { sourceVideoId: metadata.videoId },
      sort: [{ createdAt: "desc" }],
    });

    const subscription = query.$.subscribe((results) => {
      setSamples(results.map((doc) => doc.toJSON() as SampleDocType));
    });

    return () => subscription.unsubscribe();
  }, [db, metadata]);

  const handleUrlSubmit = useCallback(async (url: string) => {
    setError(null);
    setAppState("loading-metadata");
    setAudioPath(null);
    setDuration(0);
    setSamples([]);
    setSelectedRegion(null);
    setAudioBuffer(null);

    try {
      const videoMetadata = await invoke<VideoMetadata>("fetch_video_metadata", { url });
      setMetadata(videoMetadata);
      setAppState("extracting");

      if (pyodide.status === 'idle' || pyodide.status === 'error') {
        setProgress({ percent: 0, status: "Initializing Pyodide..." });
        await pyodide.initialize();
      }

      setProgress({ percent: 0, status: "Starting download..." });

      const dataDir = await appDataDir();
      const outputPath = await join(dataDir, "audio", `${videoMetadata.videoId}.aac`);

      await pyodide.extractAudio(url, outputPath, {
        onProgress: (extractProgress) => {
          switch (extractProgress.phase) {
            case 'initializing':
              setProgress({ percent: 0, status: "Initializing..." });
              break;
            case 'extracting_info':
              setProgress({ percent: 5, status: "Getting video info..." });
              break;
            case 'downloading':
              setProgress({ percent: Math.min(50, 10 + extractProgress.percent * 0.4), status: extractProgress.message });
              break;
            case 'converting':
              setProgress({ percent: Math.min(80, 50 + extractProgress.percent * 0.3), status: extractProgress.message });
              break;
            case 'completed':
              setProgress({ percent: 80, status: "Extraction complete" });
              break;
            case 'error':
              setError(extractProgress.message);
              setAppState("error");
              break;
          }
        },
        onDownloadProgress: (downloadProgress) => {
          setProgress({ 
            percent: Math.min(50, 10 + downloadProgress.percent * 0.4), 
            status: `Downloading: ${downloadProgress.percent.toFixed(1)}% at ${downloadProgress.speed}` 
          });
        }
      });

      setProgress({ percent: 85, status: "Generating waveform..." });

      const waveformChannel = new Channel<WaveformEvent>();
      let totalPeaks = 0;
      let peaksProcessed = 0;
      let audioSampleRate: number | null = null;
      let audioDuration: number | null = null;

      waveformChannel.onmessage = (event) => {
        switch (event.event) {
          case "started":
            setProgress({ percent: 85, status: "Starting waveform..." });
            break;
          case "audioInfo":
            audioSampleRate = event.data.sample_rate ?? null;
            audioDuration = event.data.duration_secs ?? null;
            break;
          case "progress":
            totalPeaks = event.data.total_peaks ?? 0;
            peaksProcessed = 0;
            break;
          case "chunk": {
            peaksProcessed += event.data.peaks?.length ?? 0;
            const percent = totalPeaks > 0 ? Math.min(98, 85 + (peaksProcessed / totalPeaks) * 15) : 85;
            setProgress({ percent, status: "Generating waveform..." });
          } break;
          case "completed":
            setAudioPath(outputPath);
            setDuration(audioDuration ?? event.data.duration_secs ?? 0);
            setAudioInfo({
              sampleRate: audioSampleRate ?? 44100,
              durationSecs: audioDuration ?? event.data.duration_secs ?? 0,
            });
            setProgress(null);
            setAppState("ready");
            refetchStats();
            break;
          case "error":
            setError(event.data.message ?? "Waveform generation failed");
            setAppState("error");
            break;
        }
      };

      await invoke("generate_waveform_stream", { audioPath: outputPath, onEvent: waveformChannel });
    } catch (err) {
      console.error('[App] Extraction failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setAppState("error");
    }
  }, [refetchStats, pyodide]);

  const handleReset = useCallback(() => {
    setAppState("idle");
    setMetadata(null);
    setProgress(null);
    setAudioPath(null);
    setDuration(0);
    setError(null);
    setSamples([]);
    setSelectedRegion(null);
    setAudioBuffer(null);
    setCurrentProject(null);
    setAudioInfo(null);
  }, []);

  const handleSelectProject = useCallback(async (project: Project) => {
    setError(null);
    setAppState("loading-metadata");
    setAudioPath(null);
    setDuration(0);
    setSamples([]);
    setSelectedRegion(null);
    setAudioBuffer(null);

    try {
      const cachedAudio = await invoke<CachedAudioInfo | null>("check_cached_audio", {
        videoId: project.videoId,
      });

      if (cachedAudio) {
        setMetadata({
          title: project.title,
          authorName: project.authorName,
          authorUrl: project.authorUrl,
          thumbnailUrl: `https://img.youtube.com/vi/${project.videoId}/mqdefault.jpg`,
          videoId: project.videoId,
        });
        setAudioPath(cachedAudio.audioPath);
        setDuration(cachedAudio.durationSecs);
        setAudioInfo({
          sampleRate: cachedAudio.sampleRate,
          durationSecs: cachedAudio.durationSecs,
        });
        setCurrentProject(project);
        setAppState("ready");
      } else {
        const url = `https://youtube.com/watch?v=${project.videoId}`;
        await handleUrlSubmit(url);
        setCurrentProject(project);
      }
    } catch (err) {
      console.error('[App] Project load failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setAppState("error");
    }
  }, [handleUrlSubmit]);

  const handleRegionSelect = useCallback((region: { start: number; end: number } | null) => {
    setSelectedRegion(region);
  }, []);

  const handleAudioBufferReady = useCallback((buffer: AudioBuffer) => {
    setAudioBuffer(buffer);
  }, []);

  const handleClipSample = useCallback(async (region: { start: number; end: number }) => {
    if (!db || !metadata || !audioPath) return;

    try {
      const existingSamples = await db.samples.find({
        selector: { sourceVideoId: metadata.videoId },
      }).exec();

      const sampleNumber = existingSamples.length + 1;
      const newSample: SampleDocType = {
        id: generateSampleId(),
        name: `Sample ${sampleNumber}`,
        sourceVideoId: metadata.videoId,
        sourceVideoTitle: metadata.title,
        sourceAuthorName: metadata.authorName,
        sourceAuthorUrl: metadata.authorUrl,
        sourceAudioPath: audioPath,
        startTime: region.start,
        endTime: region.end,
        duration: region.end - region.start,
        createdAt: Date.now(),
      };

      await db.samples.insert(newSample);
    } catch (err) {
      console.error("Failed to insert sample:", err);
    }
  }, [db, metadata, audioPath]);

  const handleDeleteSample = useCallback(async (id: string) => {
    if (!db) return;
    const doc = await db.samples.findOne(id).exec();
    if (doc) {
      await doc.remove();
    }
  }, [db]);

  const handleUpdateSampleName = useCallback(async (id: string, name: string) => {
    if (!db) return;
    const doc = await db.samples.findOne(id).exec();
    if (doc) {
      await doc.patch({ name });
    }
  }, [db]);

  const handleExportSample = useCallback(async (sample: SampleDocType) => {
    try {
      const savePath = await save({
        defaultPath: `${sample.name.replace(/[^a-zA-Z0-9]/g, "_")}.mp3`,
        filters: [{ name: "Audio", extensions: ["mp3"] }],
      });

      if (!savePath) return;

      await invoke("export_sample", {
        sourcePath: sample.sourceAudioPath,
        outputPath: savePath,
        startTime: sample.startTime,
        endTime: sample.endTime,
      });
    } catch (err) {
      console.error("Export failed:", err);
    }
  }, []);

  return (
    <div className="h-screen flex flex-col bg-retro-darker">
      <header className="flex-none h-12 bg-retro-dark border-b border-retro-surface-light flex items-center px-4 gap-4">
        <div className="flex gap-2">
          <div className="w-3 h-3 rounded-full bg-neon-pink" />
          <span className="font-family-display text-sm font-bold text-cyber-100 uppercase tracking-wider leading-none text-center">
            Tubetape
          </span>
        </div>

        <div className="flex-1 max-w-xl">
          {appState === "idle" && (
            <ProjectCombobox
              projects={projects}
              currentProject={null}
              onSubmitUrl={handleUrlSubmit}
              onSelectProject={handleSelectProject}
              onClose={handleReset}
              disabled={false}
            />
          )}
          {appState === "loading-metadata" && (
            <div className="flex items-center gap-2 text-cyber-400 text-xs">
              <div className="w-3 h-3 border border-neon-cyan border-t-transparent rounded-full animate-spin" />
              <span>Fetching...</span>
            </div>
          )}
          {appState === "extracting" && metadata && (
            <div className="flex items-center gap-2 text-cyber-400 text-xs">
              <div className="w-3 h-3 border border-acid-green border-t-transparent rounded-full animate-spin" />
              <span className="truncate">{metadata.title}</span>
            </div>
          )}
          {appState === "ready" && metadata && (
            <ProjectCombobox
              projects={projects}
              currentProject={currentProject ?? {
                videoId: metadata.videoId,
                title: metadata.title,
                audioPath: audioPath ?? "",
                authorName: metadata.authorName,
                authorUrl: metadata.authorUrl
              }}
              onSubmitUrl={handleUrlSubmit}
              onSelectProject={handleSelectProject}
              onClose={handleReset}
              disabled={false}
            />
          )}
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        {appState === "idle" && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-6xl mb-4 flex justify-center text-neon-cyan/80 drop-shadow-[0_0_15px_rgba(0,245,255,0.5)]">
                <CassetteTape className="w-24 h-24" />
              </div>
              <p className="text-cyber-500 text-sm uppercase tracking-widest">
                Paste a YouTube URL to begin
              </p>
            </div>
          </div>
        )}

        {appState === "loading-metadata" && (
          <div className="h-full flex items-center justify-center">
            <div className="text-center">
              <div className="text-6xl mb-4 flex justify-center text-neon-cyan/80 drop-shadow-[0_0_15px_rgba(0,245,255,0.5)]">
                <CassetteTape className="w-24 h-24" animated={true} />
              </div>
              <p className="text-cyber-500 text-sm uppercase tracking-widest animate-pulse">
                Recording...
              </p>
            </div>
          </div>
        )}

        {(appState === "extracting" || appState === "ready") && metadata && (
          <div className="h-full flex flex-col">
            <div className="flex-none border-b border-retro-surface-light">
              <VideoUnfurl
                metadata={metadata}
                progress={appState === "extracting" ? progress ?? undefined : undefined}
              />
            </div>

            <div className="flex-none p-4 border-b border-retro-surface-light bg-retro-dark/50">
              <div className="h-44">
                {audioPath && audioInfo ? (
                  <Waveform
                    audioPath={audioPath}
                    durationSecs={duration}
                    audioInfo={audioInfo}
                    isStreaming={appState === "extracting"}
                    onRegionSelect={handleRegionSelect}
                    onClipSample={handleClipSample}
                    onAudioBufferReady={handleAudioBufferReady}
                  />
                ) : (
                  <div className="h-full flex items-center justify-center bg-retro-dark rounded border border-retro-surface-light">
                    <div className="text-center">
                      <div className="w-8 h-8 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                      <p className="text-cyber-400 text-sm">
                        {progress?.status || "Processing..."}
                      </p>
                      {progress && (
                        <div className="mt-2 w-48 h-1 bg-retro-surface-light rounded-full overflow-hidden mx-auto">
                          <div
                            className="h-full bg-neon-cyan transition-all duration-300"
                            style={{ width: `${progress.percent}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              <h2 className="text-cyber-300 text-xs uppercase tracking-wider mb-3 font-medium">
                Samples ({samples.length})
              </h2>

              {samples.length === 0 ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-2 flex justify-center text-cyber-700">
                    <svg className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
                    </svg>
                  </div>
                  <p className="text-cyber-600 text-sm">No samples yet</p>
                  <p className="text-cyber-700 text-xs mt-1">Drag on the waveform above to create a selection, then click Clip</p>
                </div>
              ) : audioBuffer ? (
                <div className="space-y-3">
                  {samples.map((sample) => (
                    <SampleWaveform
                      key={sample.id}
                      audioBuffer={audioBuffer}
                      startTime={sample.startTime}
                      endTime={sample.endTime}
                      name={sample.name}
                      onDelete={() => handleDeleteSample(sample.id)}
                      onExport={() => handleExportSample(sample)}
                      onRename={(name) => handleUpdateSampleName(sample.id, name)}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="w-6 h-6 border border-neon-cyan border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-cyber-600 text-sm mt-2">Loading audio...</p>
                </div>
              )}
            </div>
          </div>
        )}

        {appState === "error" && (
          <div className="h-full flex items-center justify-center">
            <div className="bg-retro-surface border border-neon-pink/50 rounded p-6 max-w-sm">
              <p className="text-neon-pink text-sm font-medium mb-2">Error</p>
              <p className="text-cyber-300 text-sm mb-4">{error}</p>
              <button
                onClick={handleReset}
                className="w-full px-4 py-2 bg-retro-surface-light hover:bg-neon-pink/20 border border-neon-pink/50 text-neon-pink text-sm rounded transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </main>

      <footer className="flex-none h-6 bg-retro-dark border-t border-retro-surface-light flex items-center px-4 text-cyber-600 text-xs justify-between">
        <div className="flex items-center">
          <span>
            {appState === "idle" && "Waiting for connection"}
            {appState === "loading-metadata" && "Initializing tape..."}
            {appState === "extracting" && (progress?.status || "Recording inputs...")}
            {appState === "ready" && "Deck Ready"}
            {appState === "error" && "Malfunction detected"}
          </span>
          {selectedRegion && (
            <>
              <span className="mx-2">•</span>
              <span className="text-acid-green">
                Selection: {(selectedRegion.end - selectedRegion.start).toFixed(2)}s
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 font-mono text-[10px] opacity-70">
          {stats.memoryUsageMb !== null && (
            <span>MEM: {stats.memoryUsageMb}MB</span>
          )}
          <span>CACHE: {stats.cacheSizeMb.toFixed(1)}MB</span>
        </div>
      </footer>
    </div>
  );
}

export default App;
