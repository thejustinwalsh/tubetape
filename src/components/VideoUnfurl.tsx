import type { VideoMetadata } from "../types";
import { openUrl } from "@tauri-apps/plugin-opener";

interface VideoUnfurlProps {
  metadata: VideoMetadata;
  progress?: { percent: number; status: string };
}

function VideoUnfurl({ metadata, progress }: VideoUnfurlProps) {
  return (
    <div className="bg-retro-surface px-4 py-2">
      <div className="flex items-center gap-3">
        <img
          src={metadata.thumbnailUrl}
          alt=""
          className="w-16 h-12 object-cover rounded flex-none"
          onError={(e) => {
            const img = e.target as HTMLImageElement;
            img.src = `https://img.youtube.com/vi/${metadata.videoId}/default.jpg`;
          }}
        />
        
        <div className="flex-1 min-w-0">
          <h2 
            className="text-cyber-100 text-sm font-medium truncate"
            title="Open in YouTube"
          >
            {metadata.title}
          </h2>
          <div className="flex flex-row gap-3 items-center">
            <p className="text-cyber-500 text-xs truncate">
              {metadata.authorName}
            </p>
            <div 
              className="flex items-center gap-1 mt-0.5 text-cyber-600 hover:text-neon-cyan transition-colors cursor-pointer w-fit"
              onClick={() => openUrl(`https://youtube.com/watch?v=${metadata.videoId}`)}
            >
              <span className="text-[10px] font-mono truncate max-w-50">
                https://youtube.com/watch?v={metadata.videoId}
              </span>
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="square" strokeLinejoin="miter" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </div>
          </div>
        </div>

        {progress && (
          <div className="flex-none flex items-center gap-3">
            <div className="w-32">
              <div className="h-1 bg-retro-surface-light rounded-full overflow-hidden">
                {progress.percent < 0 ? (
                  <div className="h-full w-1/3 bg-acid-green animate-pulse-slide" />
                ) : (
                  <div
                    className="h-full bg-acid-green transition-all duration-300"
                    style={{ width: `${progress.percent}%` }}
                  />
                )}
              </div>
              <p className="text-cyber-500 text-xs mt-1 text-right">
                {progress.status}
              </p>
            </div>
            {progress.percent >= 0 && (
              <span className="text-acid-green text-xs font-mono">
                {Math.round(progress.percent)}%
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default VideoUnfurl;
