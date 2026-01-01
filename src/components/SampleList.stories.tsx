
import type { Story } from "@ladle/react";
import SampleList from "./SampleList";
import type { SampleDocType } from "../lib/db";

const mockSamples: SampleDocType[] = [
  {
    id: "sample-1",
    name: "Classic Hook",
    sourceVideoId: "dQw4w9WgXcQ",
    sourceVideoTitle: "Rick Astley - Never Gonna Give You Up",
    sourceAudioPath: "/path/to/rick.wav",
    sourceAuthorName: "Rick Astley",
    sourceAuthorUrl: "https://www.youtube.com/@RickAstleyYT",
    startTime: 43.2,
    endTime: 48.5,
    duration: 5.3,
    createdAt: Date.now(),
  },
  {
    id: "sample-2",
    name: "Drum Loop",
    sourceVideoId: "dQw4w9WgXcQ",
    sourceVideoTitle: "Rick Astley - Never Gonna Give You Up",
    sourceAudioPath: "/path/to/rick.wav",
    sourceAuthorName: "Rick Astley",
    sourceAuthorUrl: "https://www.youtube.com/@RickAstleyYT",
    startTime: 0,
    endTime: 4.1,
    duration: 4.1,
    createdAt: Date.now() - 10000,
  },
  {
    id: "sample-3",
    name: "Synth Stagger",
    sourceVideoId: "dQw4w9WgXcQ",
    sourceVideoTitle: "Rick Astley - Never Gonna Give You Up",
    sourceAudioPath: "/path/to/rick.wav",
    sourceAuthorName: "Rick Astley",
    sourceAuthorUrl: "https://www.youtube.com/@RickAstleyYT",
    startTime: 12.5,
    endTime: 14.2,
    duration: 1.7,
    createdAt: Date.now() - 20000,
  },
];

export const Default: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="max-w-xl mx-auto">
      <h3 className="text-neon-pink font-mono mb-4 uppercase tracking-widest">Saved Samples</h3>
      <SampleList
        samples={mockSamples}
        onDelete={(id) => console.log("Delete Sample:", id)}
        onUpdateName={(id, name) => console.log("Update Name:", id, name)}
      />
    </div>
  </div>
);

export const Empty: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="max-w-xl mx-auto">
      <h3 className="text-neon-pink font-mono mb-4 uppercase tracking-widest">Saved Samples</h3>
      <SampleList
        samples={[]}
        onDelete={(id) => console.log("Delete Sample:", id)}
        onUpdateName={(id, name) => console.log("Update Name:", id, name)}
      />
    </div>
  </div>
);
