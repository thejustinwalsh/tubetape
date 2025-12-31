import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { generatePeaks } from "../lib/audioEngine";
import { useRegionPlayer } from "../hooks/useRegionPlayer";

interface SampleWaveformProps {
  audioBuffer: AudioBuffer;
  startTime: number;
  endTime: number;
  name: string;
  onDelete?: () => void;
  onExport?: () => void;
  onRename?: (name: string) => void;
}

function SampleWaveform({
  audioBuffer,
  startTime,
  endTime,
  name,
  onDelete,
  onExport,
  onRename,
}: SampleWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isLooping, setIsLooping] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(name);
  const { isPlaying, progress, toggle, stop } = useRegionPlayer({ sampleRate: audioBuffer.sampleRate });

  const duration = endTime - startTime;

  const peaks = useMemo(() => {
    const sampleRate = audioBuffer.sampleRate;
    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.ceil(endTime * sampleRate);
    const length = endSample - startSample;

    const tempBuffer = new AudioContext().createBuffer(
      1,
      length,
      sampleRate
    );
    const src = audioBuffer.getChannelData(0);
    const dst = tempBuffer.getChannelData(0);
    dst.set(src.subarray(startSample, endSample));

    return generatePeaks(tempBuffer, 200);
  }, [audioBuffer, startTime, endTime]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const barWidth = width / peaks.length;
    const centerY = height / 2;
    const playheadX = progress * width;

    ctx.clearRect(0, 0, width, height);

    peaks.forEach((peak, i) => {
      const x = i * barWidth;
      const barHeight = peak * height * 0.8;
      const isPastPlayhead = x < playheadX;
      ctx.fillStyle = isPastPlayhead ? "#ff006e" : "#38bdf8";
      ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
    });

    if (isPlaying) {
      ctx.fillStyle = "#00f5ff";
      ctx.fillRect(playheadX - 1, 0, 2, height);
    }
  }, [peaks, isPlaying, progress]);

  const handlePlayPause = useCallback(() => {
    toggle(audioBuffer, startTime, endTime, isLooping);
  }, [audioBuffer, startTime, endTime, isLooping, toggle]);

  const handleLoopToggle = useCallback(() => {
    const newLoop = !isLooping;
    setIsLooping(newLoop);
    if (isPlaying) {
      stop();
      toggle(audioBuffer, startTime, endTime, newLoop);
    }
  }, [isLooping, isPlaying, stop, toggle, audioBuffer, startTime, endTime]);

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 100);
    return `${m}:${s.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const handleSaveName = () => {
    if (editName.trim() && onRename) {
      onRename(editName.trim());
    }
    setIsEditing(false);
  };

  return (
    <div className="bg-retro-surface border border-retro-surface-light rounded overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-retro-surface-light">
        <button
          onClick={handlePlayPause}
          className="w-7 h-7 flex items-center justify-center bg-retro-surface-light hover:bg-neon-pink/20 border border-retro-surface-light hover:border-neon-pink rounded transition-colors"
        >
          {isPlaying ? (
            <svg className="w-2.5 h-2.5 text-neon-pink" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          ) : (
            <svg className="w-2.5 h-2.5 text-cyber-100 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          )}
        </button>

        <button
          onClick={handleLoopToggle}
          title="Loop Sample"
          className={`w-7 h-7 flex items-center justify-center border rounded transition-colors ${
            isLooping
              ? "bg-acid-green/20 border-acid-green text-acid-green"
              : "bg-retro-surface-light border-retro-surface-light hover:border-cyber-400 text-cyber-500 hover:text-cyber-400"
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="square" strokeLinejoin="miter" d="M4 12a8 8 0 018-8 8 8 0 018 8v2m-4-4l4 4 4-4M20 12a8 8 0 01-8 8 8 8 0 01-8-8v-2m4 4l-4-4-4 4" />
          </svg>
        </button>

        <div className="flex-1 min-w-0">
          {isEditing ? (
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleSaveName}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveName();
                if (e.key === "Escape") setIsEditing(false);
              }}
              className="w-full px-2 py-0.5 bg-retro-dark border border-neon-cyan text-cyber-100 text-sm rounded focus:outline-none"
              autoFocus
            />
          ) : (
            <span
              onClick={() => setIsEditing(true)}
              className="text-cyber-100 text-sm font-medium truncate cursor-pointer hover:text-neon-cyan block"
            >
              {name}
            </span>
          )}
        </div>

        <span className="text-cyber-600 text-xs font-mono tabular-nums">
          {formatTime(duration)}
        </span>

        {onExport && (
          <button
            onClick={onExport}
            title="Export Sample"
            className="w-7 h-7 flex items-center justify-center bg-neon-pink/10 hover:bg-neon-pink/20 active:bg-neon-pink/30 border border-neon-pink/30 hover:border-neon-pink/50 active:border-neon-pink text-neon-pink rounded transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="square" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              <path d="M12 17h.01" strokeWidth="3" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {onDelete && (
          <button
            onClick={onDelete}
            title="Delete Sample"
            className="w-7 h-7 flex items-center justify-center bg-retro-surface-light hover:bg-red-500/20 border border-retro-surface-light hover:border-red-500 text-cyber-500 hover:text-red-400 rounded transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="square" strokeLinejoin="miter" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      <div className="h-16 bg-retro-dark">
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>

      <div className="px-3 py-1 text-cyber-600 text-xs flex justify-between border-t border-retro-surface-light">
        <span>
          {formatTime(startTime)} → {formatTime(endTime)}
        </span>
      </div>
    </div>
  );
}

export default SampleWaveform;
