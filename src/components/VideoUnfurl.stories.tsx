
import type { Story } from "@ladle/react";
import VideoUnfurl from "./VideoUnfurl";
import type { VideoMetadata } from "../types";

const mockMetadata: VideoMetadata = {
  videoId: "dQw4w9WgXcQ",
  title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
  authorName: "Rick Astley",
  authorUrl: "https://www.youtube.com/@RickAstleyYT",
  thumbnailUrl: "https://img.youtube.com/vi/dQw4w9WgXcQ/maxresdefault.jpg",
};

export const Default: Story = () => (
  <div className="p-4 min-h-screen">
    <div className="max-w-2xl mx-auto border border-retro-surface-light rounded overflow-hidden">
      <VideoUnfurl metadata={mockMetadata} />
    </div>
  </div>
);

export const Extracting: Story = () => (
  <div className="p-4 min-h-screen">
    <div className="max-w-2xl mx-auto border border-retro-surface-light rounded overflow-hidden">
      <VideoUnfurl 
        metadata={mockMetadata} 
        progress={{ percent: 45, status: "Extracting audio..." }} 
      />
    </div>
  </div>
);

export const Converting: Story = () => (
  <div className="p-4 min-h-screen">
    <div className="max-w-2xl mx-auto border border-retro-surface-light rounded overflow-hidden">
      <VideoUnfurl 
        metadata={mockMetadata} 
        progress={{ percent: 85, status: "Converting to WAV..." }} 
      />
    </div>
  </div>
);
