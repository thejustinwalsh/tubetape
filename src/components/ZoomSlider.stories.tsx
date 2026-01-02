import type { Story } from "@ladle/react";
import { useState } from "react";
import ZoomSlider from "./ZoomSlider";

export const Default: Story = () => {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="p-8 min-h-screen bg-retro-darker">
      <div className="space-y-8">
        <h2 className="text-cyber-100 font-retro text-lg">Zoom Slider</h2>
        <div className="flex items-center gap-4">
          <ZoomSlider value={zoom} onChange={setZoom} />
        </div>
        <p className="text-cyber-400 text-sm">Current zoom: {Math.round(zoom * 10) / 10}x</p>
        <p className="text-cyber-600 text-xs">
          Drag freely - snaps when near power-of-2 stops (1x, 2x, 4x, 8x, 16x, 32x)
        </p>
      </div>
    </div>
  );
};

export const AllZoomLevels: Story = () => {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="p-8 min-h-screen bg-retro-darker">
      <div className="space-y-8">
        <h2 className="text-cyber-100 font-retro text-lg">All Zoom Levels (1x - 32x)</h2>
        <div className="flex items-center gap-4">
          <ZoomSlider value={zoom} onChange={setZoom} maxZoom={32} />
        </div>
        <div className="flex gap-2 flex-wrap">
          {[1, 2, 4, 8, 16, 32].map((level) => (
            <button
              key={level}
              onClick={() => setZoom(level)}
              className={`px-3 py-1 text-xs font-mono rounded border transition-colors ${
                zoom === level
                  ? "bg-neon-pink/20 border-neon-pink text-neon-pink"
                  : "bg-retro-surface border-retro-surface-light text-cyber-400 hover:border-cyber-500"
              }`}
            >
              {level}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export const CustomMaxZoom: Story = () => {
  const [zoom64, setZoom64] = useState(1);
  const [zoom8, setZoom8] = useState(1);
  return (
    <div className="p-8 min-h-screen bg-retro-darker">
      <div className="space-y-8">
        <h2 className="text-cyber-100 font-retro text-lg">Custom Max Zoom</h2>
        
        <div className="space-y-4">
          <div>
            <p className="text-cyber-500 text-xs mb-2">Max Zoom: 64x</p>
            <ZoomSlider value={zoom64} onChange={setZoom64} maxZoom={64} />
          </div>
          
          <div>
            <p className="text-cyber-500 text-xs mb-2">Max Zoom: 8x</p>
            <ZoomSlider value={zoom8} onChange={setZoom8} maxZoom={8} />
          </div>
        </div>
      </div>
    </div>
  );
};

export const Vertical: Story = () => {
  const [zoom, setZoom] = useState(4);
  return (
    <div className="p-8 min-h-screen bg-retro-darker">
      <div className="space-y-8">
        <h2 className="text-cyber-100 font-retro text-lg">Vertical Orientation</h2>
        <div className="flex gap-8">
          <div className="h-40 flex">
            <ZoomSlider value={zoom} onChange={setZoom} orientation="vertical" />
          </div>
          <div className="h-40 flex">
            <ZoomSlider value={zoom} onChange={setZoom} orientation="vertical" maxZoom={64} />
          </div>
        </div>
      </div>
    </div>
  );
};

export const Disabled: Story = () => (
  <div className="p-8 min-h-screen bg-retro-darker">
    <div className="space-y-8">
      <h2 className="text-cyber-100 font-retro text-lg">Disabled State</h2>
      <ZoomSlider value={8} onChange={() => {}} disabled />
    </div>
  </div>
);

export const CustomLabel: Story = () => {
  const [zoom, setZoom] = useState(2);
  return (
    <div className="p-8 min-h-screen bg-retro-darker">
      <div className="space-y-8">
        <h2 className="text-cyber-100 font-retro text-lg">Custom Labels</h2>
        <div className="space-y-4">
          <ZoomSlider value={zoom} onChange={setZoom} label="MAGNIFY" />
          <ZoomSlider value={zoom} onChange={setZoom} label="SCALE" />
          <ZoomSlider value={zoom} onChange={setZoom} label="×" />
        </div>
      </div>
    </div>
  );
};

export const InContext: Story = () => {
  const [zoom, setZoom] = useState(1);
  return (
    <div className="p-8 min-h-screen bg-retro-darker">
      <div className="space-y-4">
        <h2 className="text-cyber-100 font-retro text-lg">In Waveform Context</h2>
        
        {/* Simulated waveform footer */}
        <div className="bg-retro-dark rounded border border-retro-surface-light">
          {/* Simulated waveform area */}
          <div className="h-32 bg-retro-surface/30 flex items-center justify-center border-b border-retro-surface-light">
            <span className="text-cyber-600 text-sm">Waveform Display Area</span>
          </div>
          
          {/* Footer with zoom slider */}
          <div className="h-6 px-3 bg-retro-surface flex items-center justify-between">
            <span className="text-cyber-600 text-xs">audio_sample.mp3</span>
            <ZoomSlider value={zoom} onChange={setZoom} />
          </div>
        </div>
        
        <p className="text-cyber-400 text-xs">
          The zoom slider should be compact enough to fit in the waveform footer while remaining usable.
        </p>
      </div>
    </div>
  );
};

export const Interactive: Story = () => {
  const [zoom, setZoom] = useState(1);
  const [history, setHistory] = useState<number[]>([1]);

  const handleChange = (newZoom: number) => {
    setZoom(newZoom);
    // Only add to history if it's meaningfully different
    const rounded = Math.round(newZoom * 10) / 10;
    setHistory((prev) => {
      const lastRounded = Math.round(prev[prev.length - 1] * 10) / 10;
      if (rounded !== lastRounded) {
        return [...prev.slice(-9), newZoom];
      }
      return prev;
    });
  };

  return (
    <div className="p-8 min-h-screen bg-retro-darker">
      <div className="space-y-8">
        <h2 className="text-cyber-100 font-retro text-lg">Interactive Demo</h2>
        
        <div className="p-6 bg-retro-surface rounded border border-retro-surface-light">
          <ZoomSlider value={zoom} onChange={handleChange} />
        </div>

        <div className="space-y-2">
          <p className="text-cyber-500 text-xs uppercase tracking-wide">Zoom History (last 10 changes)</p>
          <div className="flex gap-1 flex-wrap">
            {history.map((z, i) => (
              <span
                key={i}
                className={`px-2 py-0.5 text-xs font-mono rounded ${
                  i === history.length - 1
                    ? "bg-neon-cyan/20 text-neon-cyan"
                    : "bg-retro-surface-light text-cyber-500"
                }`}
              >
                {Math.round(z * 10) / 10}x
              </span>
            ))}
          </div>
        </div>

        <div className="text-cyber-400 text-xs space-y-1">
          <p>• Drag freely for smooth zooming - updates in real-time</p>
          <p>• &quot;Magnetic&quot; snap when near power-of-2 stops (1x, 2x, 4x...)</p>
          <p>• Click anywhere on track to jump to that zoom level</p>
          <p>• Keyboard: arrows step through stops, Home/End for min/max</p>
        </div>
      </div>
    </div>
  );
};
