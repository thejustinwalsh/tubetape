
import type { Story } from "@ladle/react";
import Waveform from "./Waveform";
import type { AudioInfo } from "../types";

const mockAudioInfo: AudioInfo = {
  sampleRate: 44100,
  durationSecs: 180,
};

export const Loading: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="h-64">
      <Waveform 
        audioPath={null} 
        durationSecs={0} 
        audioInfo={mockAudioInfo} 
        isStreaming 
      />
    </div>
  </div>
);

export const Empty: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="h-64">
      <Waveform 
        audioPath={null} 
        durationSecs={0} 
        audioInfo={mockAudioInfo} 
      />
    </div>
  </div>
);

export const Loaded: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="h-64">
      <Waveform 
        audioPath="/mock/path/audio.mp3" 
        durationSecs={180} 
        audioInfo={mockAudioInfo}
        onRegionSelect={(region) => console.log("Region selected:", region)}
        onClipSample={(region) => console.log("Clip sample:", region)}
      />
    </div>
  </div>
);

