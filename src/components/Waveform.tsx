import { useEffect, useRef, useState, useCallback } from "react";
import { readFile } from "@tauri-apps/plugin-fs";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, { type Region } from "wavesurfer.js/dist/plugins/regions.js";
import { RegionPlayer } from "../lib/audioEngine";
import type { AudioInfo } from "../types";

export interface RegionSelection {
  start: number;
  end: number;
}

interface WaveformProps {
  audioPath: string | null;
  durationSecs: number;
  audioInfo: AudioInfo;
  isStreaming?: boolean;
  onRegionSelect?: (region: RegionSelection | null) => void;
  onClipSample?: (region: RegionSelection) => void;
  onAudioBufferReady?: (buffer: AudioBuffer) => void;
}

function Waveform({ audioPath, durationSecs, audioInfo, isStreaming, onRegionSelect, onClipSample, onAudioBufferReady }: WaveformProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<RegionsPlugin | null>(null);
  const activeRegionRef = useRef<Region | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const loadingRef = useRef<string | null>(null);
  const regionPlayerRef = useRef<RegionPlayer | null>(null);
  const audioBufferRef = useRef<AudioBuffer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [isRegionPlaying, setIsRegionPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(durationSecs || 0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<RegionSelection | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const regions = RegionsPlugin.create();
    regionsRef.current = regions;

    const containerHeight = containerRef.current.clientHeight || 100;
    
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "#38bdf8",
      progressColor: "#ff006e",
      cursorColor: "#00f5ff",
      cursorWidth: 1,
      barWidth: 1,
      barGap: 1,
      barRadius: 0,
      height: containerHeight,
      normalize: true,
      backend: 'WebAudio',
      sampleRate: audioInfo.sampleRate,
      plugins: [regions],
    });

    wavesurferRef.current = ws;

    regions.enableDragSelection({
      color: "rgba(0, 245, 255, 0.2)",
    });

    regions.on("region-created", (region) => {
      if (activeRegionRef.current && activeRegionRef.current !== region) {
        activeRegionRef.current.remove();
      }
      activeRegionRef.current = region;
      const selection = { start: region.start, end: region.end };
      setSelectedRegion(selection);
      onRegionSelect?.(selection);
    });

    regions.on("region-updated", (region) => {
      const selection = { start: region.start, end: region.end };
      setSelectedRegion(selection);
      onRegionSelect?.(selection);
    });

    regions.on("region-clicked", (_region, e) => {
      e.stopPropagation();
    });

    ws.on("click", () => {
      if (regionPlayerRef.current?.isPlaying) {
        regionPlayerRef.current.stop();
        setIsRegionPlaying(false);
      }
      if (activeRegionRef.current) {
        activeRegionRef.current.remove();
        activeRegionRef.current = null;
        setSelectedRegion(null);
        onRegionSelect?.(null);
      }
    });

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));
    ws.on("timeupdate", (time) => setCurrentTime(time));
    ws.on("ready", () => {
      setDuration(ws.getDuration());
      setIsLoading(false);
      const decodedData = ws.getDecodedData();
      if (decodedData) {
        audioBufferRef.current = decodedData;
        onAudioBufferReady?.(decodedData);
      }
    });
    ws.on("error", (err) => {
      const errStr = String(err);
      if (errStr.includes("Abort")) {
        return;
      }
      console.error("WaveSurfer error:", err);
      setError(errStr);
      setIsLoading(false);
    });

    return () => {
      ws.destroy();
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
      }
    };
  }, [audioInfo.sampleRate, onRegionSelect]);

  useEffect(() => {
    const player = new RegionPlayer();
    player.init(audioInfo.sampleRate).catch(console.error);
    regionPlayerRef.current = player;

    return () => {
      player.destroy();
      regionPlayerRef.current = null;
    };
  }, [audioInfo.sampleRate]);

  useEffect(() => {
    if (!wavesurferRef.current || !audioPath) return;

    const currentLoadId = audioPath;
    loadingRef.current = currentLoadId;

    const loadAudio = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const fileData = await readFile(audioPath);
        
        if (loadingRef.current !== currentLoadId) {
          return;
        }
        
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        
        const blob = new Blob([fileData], { type: "audio/mpeg" });
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;
        
        await wavesurferRef.current?.load(blobUrl);
      } catch (err) {
        if (loadingRef.current !== currentLoadId) {
          return;
        }
        const errStr = String(err);
        if (errStr.includes("Abort")) {
          return;
        }
        console.error("Failed to load audio:", err);
        setError(errStr);
        setIsLoading(false);
      }
    };

    loadAudio();
  }, [audioPath]);

  useEffect(() => {
    if (durationSecs && durationSecs > 0) {
      setDuration(durationSecs);
    }
  }, [durationSecs]);

  const togglePlayPause = useCallback(() => {
    const ws = wavesurferRef.current;
    const player = regionPlayerRef.current;
    const buffer = audioBufferRef.current;
    if (!ws) return;

    if (isRegionPlaying && player) {
      player.stop();
      setIsRegionPlaying(false);
      return;
    }

    if (ws.isPlaying()) {
      ws.pause();
      return;
    }

    const region = activeRegionRef.current;
    if (region && player && buffer) {
      player.playRegion(
        buffer,
        region.start,
        region.end,
        isLooping,
        () => {
          setIsRegionPlaying(false);
          ws.setTime(region.start);
        },
        (progress) => {
          const time = region.start + progress * (region.end - region.start);
          ws.setTime(time);
          setCurrentTime(time);
        }
      );
      setIsRegionPlaying(true);
    } else {
      ws.play();
    }
  }, [isLooping, isRegionPlaying]);

  const toggleLoop = useCallback(() => {
    setIsLooping((prev) => !prev);
  }, []);

  const handleClipSample = useCallback(() => {
    if (selectedRegion && onClipSample) {
      onClipSample(selectedRegion);
    }
  }, [selectedRegion, onClipSample]);

  const clearRegion = useCallback(() => {
    if (regionPlayerRef.current?.isPlaying) {
      regionPlayerRef.current.stop();
      setIsRegionPlaying(false);
    }
    if (activeRegionRef.current) {
      activeRegionRef.current.remove();
      activeRegionRef.current = null;
    }
    setSelectedRegion(null);
    onRegionSelect?.(null);
  }, [onRegionSelect]);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  return (
    <div className="h-full flex flex-col bg-retro-dark rounded border border-retro-surface-light">
      <div className="flex-none flex items-center gap-2 px-3 py-2 border-b border-retro-surface-light bg-retro-surface">
        <button
          onClick={togglePlayPause}
          disabled={!audioPath || isLoading}
          className="w-8 h-8 flex items-center justify-center bg-retro-surface-light hover:bg-neon-pink/20 border border-retro-surface-light hover:border-neon-pink rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {(isPlaying || isRegionPlaying) ? (
            <svg className="w-3 h-3 text-cyber-100" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-3 h-3 text-cyber-100 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        <div className="font-mono text-xs text-cyber-100 tabular-nums">
          <span className="text-neon-cyan">{formatTime(currentTime)}</span>
          <span className="text-cyber-600 mx-1">/</span>
          <span className="text-cyber-400">{formatTime(duration)}</span>
        </div>

        <div className="flex-1" />

        {selectedRegion && (
          <div className="flex items-center gap-2">
            <div className="font-mono text-xs text-cyber-400">
              <span className="text-acid-green">{formatTime(selectedRegion.start)}</span>
              <span className="mx-1">→</span>
              <span className="text-acid-green">{formatTime(selectedRegion.end)}</span>
              <span className="ml-2 text-cyber-600">
                ({formatTime(selectedRegion.end - selectedRegion.start)})
              </span>
            </div>

            <button
              onClick={toggleLoop}
              title="Loop Region"
              className={`w-8 h-8 flex items-center justify-center border rounded transition-colors ${
                isLooping
                  ? "bg-acid-green/20 border-acid-green text-acid-green"
                  : "bg-retro-surface-light border-retro-surface-light hover:border-cyber-400 text-cyber-400"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M4 12a8 8 0 018-8 8 8 0 018 8v2m-4-4l4 4 4-4M20 12a8 8 0 01-8 8 8 8 0 01-8-8v-2m4 4l-4-4-4 4" />
              </svg>
            </button>

            <button
              onClick={handleClipSample}
              disabled={!onClipSample}
              title="Clip Selection"
              className="w-8 h-8 flex items-center justify-center bg-neon-pink/10 hover:bg-neon-pink/20 active:bg-neon-pink/30 border border-neon-pink/30 hover:border-neon-pink/50 active:border-neon-pink text-neon-pink rounded transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M19 12H5M15 6l-3 3 3 3M9 18l3-3-3-3" />
                <rect x="2" y="4" width="20" height="16" rx="2" strokeWidth="1.5" strokeDasharray="2 2" />
              </svg>
            </button>

            <button
              onClick={clearRegion}
              title="Clear Selection"
              className="w-8 h-8 flex items-center justify-center bg-retro-surface-light hover:bg-red-500/20 border border-retro-surface-light hover:border-red-500 text-cyber-400 hover:text-red-400 rounded transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="square" d="M6 6l12 12M6 18L18 6" />
                <rect x="3" y="3" width="18" height="18" strokeWidth="1.5" className="opacity-50" />
              </svg>
            </button>
          </div>
        )}

        {isStreaming && (
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 bg-acid-green rounded-full animate-pulse" />
            <span className="text-acid-green text-xs uppercase tracking-wide">Processing</span>
          </div>
        )}

        {isLoading && !isStreaming && (
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 border border-neon-cyan border-t-transparent rounded-full animate-spin" />
            <span className="text-cyber-400 text-xs">Loading</span>
          </div>
        )}
      </div>

      <div className="flex-1 relative min-h-0 overflow-hidden">
        <div className="absolute inset-0 flex pointer-events-none">
          {[...Array(20)].map((_, i) => (
            <div key={i} className="flex-1 border-r border-retro-surface-light/30 last:border-r-0" />
          ))}
        </div>
        
        <div
          ref={containerRef}
          className="absolute left-2 right-2 top-2 bottom-2"
        />

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-retro-dark/90">
            <p className="text-neon-pink text-sm">{error}</p>
          </div>
        )}

        {!audioPath && !isLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-cyber-600 text-sm">Drag on the waveform to select a region</p>
          </div>
        )}
      </div>

      <div className="flex-none h-6 px-3 border-t border-retro-surface-light bg-retro-surface flex items-center justify-between text-cyber-600 text-xs">
        <span>{audioPath?.split("/").pop() || "No file"}</span>
        <span>Drag to select region</span>
      </div>
    </div>
  );
}

export default Waveform;
