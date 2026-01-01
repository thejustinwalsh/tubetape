
import type { Story } from "@ladle/react";
import ProjectCombobox from "./ProjectCombobox";
import type { Project } from "../types";

const mockProjects: Project[] = [
  {
    videoId: "dQw4w9WgXcQ",
    title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
    authorName: "Rick Astley",
    authorUrl: "https://www.youtube.com/@RickAstleyYT",
    audioPath: "/path/to/rick.wav",
  },
  {
    videoId: "9bZkp7q19f0",
    title: "PSY - GANGNAM STYLE(강남스타일) M/V",
    authorName: "officialpsy",
    authorUrl: "https://www.youtube.com/@officialpsy",
    audioPath: "/path/to/psy.wav",
  },
  {
    videoId: "kJQP7kiw5Fk",
    title: "Luis Fonsi - Despacito ft. Daddy Yankee",
    authorName: "LuisFonsiVEVO",
    authorUrl: "https://www.youtube.com/@LuisFonsiVEVO",
    audioPath: "/path/to/despacito.wav",
  },
];

export const Default: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="max-w-xl mx-auto">
      <ProjectCombobox
        projects={mockProjects}
        currentProject={null}
        onSubmitUrl={(url) => console.log("Submitted URL:", url)}
        onSelectProject={(project) => console.log("Selected Project:", project)}
        onClose={() => console.log("Closed")}
      />
    </div>
  </div>
);

export const Empty: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="max-w-xl mx-auto">
      <ProjectCombobox
        projects={[]}
        currentProject={null}
        onSubmitUrl={(url) => console.log("Submitted URL:", url)}
        onSelectProject={(project) => console.log("Selected Project:", project)}
        onClose={() => console.log("Closed")}
      />
    </div>
  </div>
);

export const Selected: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="max-w-xl mx-auto">
      <ProjectCombobox
        projects={mockProjects}
        currentProject={mockProjects[0]}
        onSubmitUrl={(url) => console.log("Submitted URL:", url)}
        onSelectProject={(project) => console.log("Selected Project:", project)}
        onClose={() => console.log("Closed")}
      />
    </div>
  </div>
);

export const Disabled: Story = () => (
  <div className="p-8 min-h-screen">
    <div className="max-w-xl mx-auto">
      <ProjectCombobox
        projects={mockProjects}
        currentProject={null}
        onSubmitUrl={(url) => console.log("Submitted URL:", url)}
        onSelectProject={(project) => console.log("Selected Project:", project)}
        onClose={() => console.log("Closed")}
        disabled
      />
    </div>
  </div>
);
