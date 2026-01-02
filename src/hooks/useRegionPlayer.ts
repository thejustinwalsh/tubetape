import { useRef, useState, useCallback, useEffect } from "react";
import { RegionPlayer } from "../lib/audioEngine";

export function useRegionPlayer({ sampleRate }: { sampleRate: number }) {
  const playerRef = useRef<RegionPlayer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    playerRef.current = new RegionPlayer();
    playerRef.current.init(sampleRate);

    return () => {
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [sampleRate]);

  const playRegion = useCallback(
    (buffer: AudioBuffer, startTime: number, endTime: number, loop: boolean) => {
      if (!playerRef.current) return;
      
      setProgress(0);
      playerRef.current.playRegion(
        buffer,
        startTime,
        endTime,
        loop,
        () => {
          setIsPlaying(false);
          setProgress(0);
        },
        (p) => {
          setProgress(p);
        }
      );
      setIsPlaying(true);
    },
    []
  );

  const stop = useCallback(() => {
    playerRef.current?.stop();
    setIsPlaying(false);
    setProgress(0);
  }, []);

  const toggle = useCallback(
    (buffer: AudioBuffer, startTime: number, endTime: number, loop: boolean) => {
      if (isPlaying) {
        stop();
      } else {
        playRegion(buffer, startTime, endTime, loop);
      }
    },
    [isPlaying, playRegion, stop]
  );

  return { isPlaying, progress, playRegion, stop, toggle };
}
