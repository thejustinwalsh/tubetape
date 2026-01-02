import { useRef, useCallback, useEffect, useState } from "react";

export interface ZoomSliderProps {
  /** Current zoom level (1 = 1x, 2 = 2x, etc.) */
  value: number;
  /** Callback when zoom level changes */
  onChange: (value: number) => void;
  /** Maximum zoom level (default: 32) */
  maxZoom?: number;
  /** Minimum zoom level (default: 1) */
  minZoom?: number;
  /** Whether the slider is disabled */
  disabled?: boolean;
  /** Label to show (default: "ZOOM") */
  label?: string;
  /** Orientation (default: horizontal) */
  orientation?: "horizontal" | "vertical";
}

/**
 * Get zoom stops as powers of 2 from min to max zoom
 */
function getZoomStops(minZoom: number, maxZoom: number): number[] {
  const stops: number[] = [];
  let stop = 1;
  while (stop <= maxZoom) {
    if (stop >= minZoom) {
      stops.push(stop);
    }
    stop *= 2;
  }
  // Ensure maxZoom is included if it's not a power of 2
  if (stops[stops.length - 1] !== maxZoom && maxZoom > stops[stops.length - 1]) {
    stops.push(maxZoom);
  }
  return stops;
}

/**
 * Convert a zoom value to a position (0-1) using logarithmic scale
 * This makes the stops evenly spaced visually
 */
function zoomToPosition(zoom: number, minZoom: number, maxZoom: number): number {
  const logMin = Math.log2(minZoom);
  const logMax = Math.log2(maxZoom);
  const logValue = Math.log2(Math.max(minZoom, Math.min(maxZoom, zoom)));
  return (logValue - logMin) / (logMax - logMin);
}

/**
 * Convert a position (0-1) to a zoom value using logarithmic scale
 */
function positionToZoom(position: number, minZoom: number, maxZoom: number): number {
  const logMin = Math.log2(minZoom);
  const logMax = Math.log2(maxZoom);
  const logValue = logMin + position * (logMax - logMin);
  return Math.pow(2, logValue);
}

/**
 * Find the nearest zoom stop and distance to it
 */
function findNearestStop(zoom: number, stops: number[]): { stop: number; distance: number } {
  let nearest = stops[0];
  let minDist = Math.abs(zoom - nearest);

  for (const stop of stops) {
    const dist = Math.abs(zoom - stop);
    if (dist < minDist) {
      minDist = dist;
      nearest = stop;
    }
  }

  return { stop: nearest, distance: minDist };
}

/** 
 * Snap threshold as a ratio of the zoom value 
 * E.g., 0.08 means snap when within 8% of a stop
 */
const SNAP_RATIO = 0.08;

function ZoomSlider({
  value,
  onChange,
  maxZoom = 32,
  minZoom = 1,
  disabled = false,
  label = "ZOOM",
  orientation = "horizontal",
}: ZoomSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const stops = getZoomStops(minZoom, maxZoom);
  const position = zoomToPosition(value, minZoom, maxZoom);

  const calculateZoomFromPosition = useCallback(
    (pos: number): number => {
      pos = Math.max(0, Math.min(1, pos));
      const rawZoom = positionToZoom(pos, minZoom, maxZoom);
      
      // Find nearest stop and check if we should snap
      const { stop, distance } = findNearestStop(rawZoom, stops);
      const snapThreshold = stop * SNAP_RATIO;
      
      if (distance < snapThreshold) {
        return stop;
      }
      
      return rawZoom;
    },
    [minZoom, maxZoom, stops]
  );

  const getPositionFromEvent = useCallback(
    (clientX: number, clientY: number): number => {
      if (!trackRef.current) return 0;
      
      const rect = trackRef.current.getBoundingClientRect();
      
      if (orientation === "vertical") {
        return 1 - (clientY - rect.top) / rect.height;
      } else {
        return (clientX - rect.left) / rect.width;
      }
    },
    [orientation]
  );

  const handleTrackClick = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      
      const pos = getPositionFromEvent(e.clientX, e.clientY);
      const zoom = calculateZoomFromPosition(pos);
      onChange(zoom);
    },
    [disabled, getPositionFromEvent, calculateZoomFromPosition, onChange]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      e.preventDefault();
      setIsDragging(true);
      
      const pos = getPositionFromEvent(e.clientX, e.clientY);
      const zoom = calculateZoomFromPosition(pos);
      onChange(zoom);
    },
    [disabled, getPositionFromEvent, calculateZoomFromPosition, onChange]
  );

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const pos = getPositionFromEvent(e.clientX, e.clientY);
      const zoom = calculateZoomFromPosition(pos);
      onChange(zoom);
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, getPositionFromEvent, calculateZoomFromPosition, onChange]);

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      // Find current stop index or nearest
      const { stop: nearestStop } = findNearestStop(value, stops);
      const currentIndex = stops.indexOf(nearestStop);
      let newIndex = currentIndex;

      switch (e.key) {
        case "ArrowRight":
        case "ArrowUp":
          newIndex = Math.min(currentIndex + 1, stops.length - 1);
          break;
        case "ArrowLeft":
        case "ArrowDown":
          newIndex = Math.max(currentIndex - 1, 0);
          break;
        case "Home":
          newIndex = 0;
          break;
        case "End":
          newIndex = stops.length - 1;
          break;
        default:
          return;
      }

      e.preventDefault();
      onChange(stops[newIndex]);
    },
    [disabled, value, stops, onChange]
  );

  const isHorizontal = orientation === "horizontal";

  // Format value for display - show 1 decimal for non-integers
  const displayValue = Number.isInteger(value) || value >= 10 
    ? Math.round(value) 
    : Math.round(value * 10) / 10;

  return (
    <div
      className={`flex items-center gap-1.5 select-none ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      } ${isHorizontal ? "flex-row" : "flex-col-reverse h-full"}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Label */}
      <span
        className={`text-[9px] font-pixel tracking-wider uppercase ${
          isDragging ? "text-neon-cyan" : "text-cyber-500"
        } transition-colors`}
      >
        {label}
      </span>

      {/* Track container */}
      <div
        ref={trackRef}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuenow={value}
        aria-valuemin={minZoom}
        aria-valuemax={maxZoom}
        aria-orientation={orientation}
        aria-disabled={disabled}
        onMouseDown={handleMouseDown}
        onClick={handleTrackClick}
        onKeyDown={handleKeyDown}
        className={`relative cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-neon-cyan ${
          isHorizontal ? "h-3 w-40" : "w-3 flex-1 min-h-20"
        }`}
      >
        {/* Layer 1: Track background (bottom) */}
        <div
          className={`absolute bg-retro-dark border border-retro-surface-light rounded-xs ${
            isHorizontal
              ? "top-1/2 -translate-y-1/2 left-0 right-0 h-1"
              : "left-1/2 -translate-x-1/2 top-0 bottom-0 w-1"
          }`}
        />

        {/* Layer 2: Notch marks (middle - in front of inactive track, behind active fill) */}
        {stops.map((stop) => {
          const stopPos = zoomToPosition(stop, minZoom, maxZoom);
          const isPastOrOn = value >= stop;

          return (
            <div
              key={stop}
              className={`absolute ${
                isHorizontal
                  ? "w-px h-full -translate-x-1/2 top-0"
                  : "h-px w-full translate-y-1/2 left-0"
              } ${
                isPastOrOn
                  ? "bg-neon-pink"
                  : "bg-neon-cyan/50"
              }`}
              style={
                isHorizontal
                  ? { left: `${stopPos * 100}%` }
                  : { bottom: `${stopPos * 100}%` }
              }
            />
          );
        })}

        {/* Layer 3: Active fill (top - covers notches as it fills) */}
        <div
          className={`absolute rounded-xs ${
            isHorizontal
              ? "top-1/2 -translate-y-1/2 left-0 h-1"
              : "left-1/2 -translate-x-1/2 bottom-0 w-1"
          } ${isDragging ? "bg-neon-cyan" : "bg-neon-cyan/70"}`}
          style={
            isHorizontal
              ? { width: `${position * 100}%` }
              : { height: `${position * 100}%` }
          }
        />

        {/* Layer 4: Thumb/handle (topmost) */}
        <div
          className={`absolute ${
            isHorizontal
              ? "top-0 bottom-0 -translate-x-1/2"
              : "left-0 right-0 translate-y-1/2"
          }`}
          style={
            isHorizontal
              ? { left: `${position * 100}%` }
              : { bottom: `${position * 100}%` }
          }
        >
          <div
            className={`h-full w-2 rounded-xs border transition-colors ${
              isDragging
                ? "bg-neon-pink border-neon-pink"
                : isHovered
                ? "bg-retro-surface border-neon-cyan"
                : "bg-retro-surface border-neon-cyan/60"
            }`}
          >
            {/* Inner detail - vertical line */}
            <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 flex justify-center">
              <div className={`w-px h-1.5 ${
                isDragging ? "bg-white/50" : "bg-neon-cyan/30"
              }`} />
            </div>
          </div>
        </div>
      </div>

      {/* Value display */}
      <span
        className={`text-[10px] font-mono tabular-nums min-w-7 text-right transition-colors ${
          isDragging ? "text-neon-pink" : "text-cyber-400"
        }`}
      >
        {displayValue}x
      </span>
    </div>
  );
}

export default ZoomSlider;
