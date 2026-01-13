import { useState, useCallback, useEffect } from "react";
import { Channel } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import "./App.css";

import ProjectCombobox from "./components/ProjectCombobox";
import CassetteTape from "./components/CassetteTape";
import VideoUnfurl from "./components/VideoUnfurl";
import Waveform from "./components/Waveform";
import SampleWaveform from "./components/SampleWaveform";
import ErrorDialog from "./components/ErrorDialog";
import { getDatabase, generateSampleId, type SampleDocType, type TubetapeDatabase } from "./lib/db";
import type { AppState, Project, AudioInfo } from "./types";
import { commands, type VideoMetadata, type BeatInfo, type PipelineEvent, type PipelineCommand } from "./bindings";
import { useAppStats } from "./hooks/useAppStats";
import { usePyodide } from "./hooks/usePyodide";

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
  const [beatInfo, setBeatInfo] = useState<BeatInfo | null>(null);

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

  /**
   * Parse download size string like "12.3 MB" to bytes
   */
  const parseDownloadSize = useCallback((sizeStr: string): number => {
    const match = sizeStr.match(/^([\d.]+)\s*(MB|KB|GB|B)?$/i);
    if (!match) return 0;
    const value = parseFloat(match[1]);
    const unit = (match[2] || 'B').toUpperCase();
    switch (unit) {
      case 'GB': return value * 1_000_000_000;
      case 'MB': return value * 1_000_000;
      case 'KB': return value * 1_000;
      default: return value;
    }
  }, []);

  /**
   * Run Pyodide extraction and report progress back to the pipeline.
   * Called when pipeline emits RequestExtraction event.
   */
  const runExtraction = useCallback(async (url: string, outputPath: string): Promise<void> => {
    // Ensure Pyodide is initialized
    if (pyodide.status === 'idle' || pyodide.status === 'error') {
      await pyodide.initialize();
    }

    // Run extraction with progress forwarding
    const result = await pyodide.extractAudio(url, outputPath, {
      onProgress: async (extractProgress) => {
        // Forward progress to pipeline based on phase
        if (extractProgress.phase === 'error') {
          // Errors will be caught and sent as ExtractionFailed
          throw new Error(extractProgress.message);
        }
      },
      onDownloadProgress: async (downloadProgress) => {
        // Forward download progress to pipeline
        try {
          // Convert to integers - Rust expects u64
          const bytesDownloaded = Math.floor(parseDownloadSize(downloadProgress.downloaded));
          const totalBytes = downloadProgress.total !== 'unknown'
            ? Math.floor(parseDownloadSize(downloadProgress.total))
            : null;

          const command: PipelineCommand = {
            command: "downloadProgress",
            data: { bytesDownloaded, totalBytes }
          };
          await commands.pipelineNotify(command);
        } catch (e) {
          // Ignore errors forwarding progress - pipeline may have completed
          console.debug('[App] Failed to forward download progress:', e);
        }
      }
    });

    // Notify pipeline that extraction completed
    const ffmpegCommands = Array.isArray(result.ffmpegCommands) ? result.ffmpegCommands : [];
    const completeCommand: PipelineCommand = {
      command: "extractionComplete",
      data: {
        audioPath: outputPath,
        ffmpegCommands: ffmpegCommands.map(cmd => ({
          id: cmd.id,
          command: cmd.command,
          args: cmd.args,
          inputPath: cmd.inputPath,
          outputPath: cmd.outputPath,
          status: cmd.status
        }))
      }
    };
    await commands.pipelineNotify(completeCommand);
  }, [pyodide, parseDownloadSize]);

  const handleUrlSubmit = useCallback(async (url: string) => {
    setError(null);
    setAppState("loading-metadata");
    setAudioPath(null);
    setDuration(0);
    setSamples([]);
    setSelectedRegion(null);
    setAudioBuffer(null);
    setBeatInfo(null);

    try {
      // Fetch metadata first (quick operation)
      const metadataResult = await commands.fetchVideoMetadata(url);
      if (metadataResult.status === "error") throw new Error(metadataResult.error);
      const videoMetadata = metadataResult.data;
      setMetadata(videoMetadata);
      setAppState("extracting");
      setProgress({ percent: 0, status: "Starting..." });

      // Create pipeline event channel
      const pipelineChannel = new Channel<PipelineEvent>();

      pipelineChannel.onmessage = async (event) => {
        switch (event.event) {
          case "started":
            console.log('[Pipeline] Started:', event.data.stages);
            break;

          case "requestExtraction":
            // Pipeline is asking us to run Pyodide extraction
            console.log('[Pipeline] Extraction requested for:', event.data.url);
            try {
              await runExtraction(event.data.url, event.data.outputPath);
            } catch (err) {
              // Notify pipeline of failure
              const failCommand: PipelineCommand = {
                command: "extractionFailed",
                data: { message: err instanceof Error ? err.message : String(err) }
              };
              await commands.pipelineNotify(failCommand);
            }
            break;

          case "progress":
            setProgress({
              percent: event.data.overallPercent,
              status: event.data.message
            });
            break;

          case "waveformComplete":
            // Audio path is set from completed event, just update duration/info here
            setDuration(event.data.durationSecs);
            setAudioInfo({
              sampleRate: event.data.sampleRate,
              durationSecs: event.data.durationSecs,
            });
            break;

          case "beatDetectionComplete":
            console.log('[Pipeline] Beat analysis complete:', event.data);
            setBeatInfo(event.data);
            break;

          case "completed":
            console.log('[Pipeline] Completed:', event.data);
            setAudioPath(event.data.audioPath);
            setProgress(null);
            setAppState("ready");
            refetchStats();
            break;

          case "error":
            console.error('[Pipeline] Error:', event.data);
            setError(`${event.data.stage}: ${event.data.message}`);
            setAppState("error");
            break;
        }
      };

      // Start the unified pipeline - it will emit RequestExtraction for us to handle
      await commands.runPipeline(url, pipelineChannel);

    } catch (err) {
      console.error('[App] Pipeline failed:', err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage);
      setAppState("error");
    }
  }, [refetchStats, runExtraction]);

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
    setBeatInfo(null);
  }, []);

  const handleSelectProject = useCallback(async (project: Project) => {
    setError(null);
    setAppState("loading-metadata");
    setAudioPath(null);
    setDuration(0);
    setSamples([]);
    setSelectedRegion(null);
    setAudioBuffer(null);
    setBeatInfo(null);

    try {
      const cachedResult = await commands.checkCachedAudio(project.videoId);
      if (cachedResult.status === "error") throw new Error(cachedResult.error);
      const cachedAudio = cachedResult.data;

      if (cachedAudio) {
        setMetadata({
          title: project.title,
          authorName: project.authorName,
          authorUrl: project.authorUrl,
          thumbnailUrl: `https://img.youtube.com/vi/${project.videoId}/mqdefault.jpg`,
          videoId: project.videoId,
        });
        setCurrentProject(project);
        setAppState("extracting");
        setProgress({ percent: 0, status: "Processing audio..." });

        // Run pipeline for cached audio (waveform + beat detection in parallel)
        const pipelineChannel = new Channel<PipelineEvent>();

        pipelineChannel.onmessage = (event) => {
          switch (event.event) {
            case "progress": {
              const displayPercent = event.data.overallPercent;
              setProgress({ percent: displayPercent, status: "Processing audio..." });
            } break;
            case "waveformComplete":
              setAudioPath(cachedAudio.audioPath);
              setDuration(event.data.durationSecs);
              setAudioInfo({
                sampleRate: event.data.sampleRate,
                durationSecs: event.data.durationSecs,
              });
              break;
            case "beatDetectionComplete":
              console.log('[App] Beat analysis complete:', event.data);
              setBeatInfo(event.data);
              break;
            case "completed":
              setProgress(null);
              setAppState("ready");
              break;
            case "error":
              setError(`${event.data.stage}: ${event.data.message}`);
              setAppState("error");
              break;
          }
        };

        await commands.processAudio(cachedAudio.audioPath, pipelineChannel);
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

      const result = await commands.exportSample(sample.sourceAudioPath, savePath, sample.startTime, sample.endTime);
      if (result.status === "error") throw new Error(result.error);
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
                          {progress.percent < 0 ? (
                            <div className="h-full w-1/3 bg-neon-cyan animate-pulse-slide" />
                          ) : (
                            <div
                              className="h-full bg-neon-cyan transition-all duration-300"
                              style={{ width: `${progress.percent}%` }}
                            />
                          )}
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

        {appState === "error" && error && (
          <ErrorDialog error={error} onDismiss={handleReset} />
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
          {beatInfo && (
            <>
              <span className="mx-2">•</span>
              <span className="text-neon-cyan">
                {beatInfo.bpm.toFixed(1)} BPM
                {beatInfo.bpmConfidence > 0 && (
                  <span className="text-cyber-600 ml-1">
                    ({(beatInfo.bpmConfidence * 100).toFixed(0)}%)
                  </span>
                )}
              </span>
            </>
          )}
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
