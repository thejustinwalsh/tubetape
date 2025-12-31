import { useState, useCallback } from "react";

interface URLInputProps {
  onSubmit: (url: string) => void;
  disabled?: boolean;
}

function URLInput({ onSubmit, disabled }: URLInputProps) {
  const [url, setUrl] = useState("");

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (url.trim() && !disabled) {
        onSubmit(url.trim());
        setUrl("");
      }
    },
    [url, disabled, onSubmit]
  );

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const pastedText = e.clipboardData.getData("text");
      if (pastedText && isYouTubeUrl(pastedText) && !disabled) {
        e.preventDefault();
        setUrl(pastedText);
        onSubmit(pastedText.trim());
        setUrl("");
      }
    },
    [disabled, onSubmit]
  );

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex gap-1">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onPaste={handlePaste}
          placeholder="Paste YouTube URL..."
          disabled={disabled}
          className="flex-1 h-7 px-3 bg-retro-surface border border-retro-surface-light rounded text-cyber-100 placeholder-cyber-600 text-sm focus:outline-none focus:border-neon-cyan transition-colors disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={disabled || !url.trim()}
          className="h-7 px-3 bg-retro-surface-light hover:bg-neon-pink/20 border border-retro-surface-light hover:border-neon-pink text-cyber-300 hover:text-neon-pink text-xs font-medium uppercase tracking-wide rounded transition-colors disabled:opacity-50 disabled:hover:bg-retro-surface-light disabled:hover:border-retro-surface-light disabled:hover:text-cyber-300"
        >
          Load
        </button>
      </div>
    </form>
  );
}

function isYouTubeUrl(url: string): boolean {
  return /(?:youtube\.com\/(?:watch\?v=|embed\/|v\/|shorts\/)|youtu\.be\/)/.test(url);
}

export default URLInput;
