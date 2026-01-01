
import type { Story } from "@ladle/react";
import SampleWaveform from "./SampleWaveform";
import { createAudioBuffer } from "../test/helpers/audioBufferHelper";

const length = 44100 * 2;
const sampleRate = 44100;
const channelData = new Float32Array(length);
for (let i = 0; i < length; i++) {
  const t = i / sampleRate;
  const beat = Math.sin(t * Math.PI * 2 * 2);
  const noise = Math.random() * 0.5;
  channelData[i] = beat > 0.8 ? noise : noise * 0.1;
}

const mockBuffer = createAudioBuffer({ 
  length, 
  sampleRate, 
  channelData 
});

export const Default: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="max-w-xl mx-auto space-y-8">
      <h3 className="text-neon-cyan font-mono mb-4 uppercase tracking-widest">Sample Waveform</h3>
      <SampleWaveform
        name="Lo-Fi Snare"
        audioBuffer={mockBuffer}
        startTime={0.2}
        endTime={1.5}
        onDelete={() => console.log("Delete")}
        onExport={() => console.log("Export")}
        onRename={(name) => console.log("Rename:", name)}
      />
    </div>
  </div>
);

export const Short: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="max-w-xl mx-auto">
      <SampleWaveform
        name="Kick"
        audioBuffer={mockBuffer}
        startTime={0}
        endTime={0.3}
        onDelete={() => console.log("Delete")}
        onExport={() => console.log("Export")}
        onRename={(name) => console.log("Rename:", name)}
      />
    </div>
  </div>
);

export const Long: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="max-w-xl mx-auto">
      <SampleWaveform
        name="Ambient Pad Loop"
        audioBuffer={mockBuffer}
        startTime={0}
        endTime={2.0}
        onDelete={() => console.log("Delete")}
        onExport={() => console.log("Export")}
        onRename={(name) => console.log("Rename:", name)}
      />
    </div>
  </div>
);
