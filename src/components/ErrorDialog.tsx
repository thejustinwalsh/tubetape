import { useEffect, useRef } from "react";

interface ErrorDialogProps {
  error: string;
  onDismiss: () => void;
}

function ErrorDialog({ error, onDismiss }: ErrorDialogProps) {
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    buttonRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onDismiss();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onDismiss]);

  return (
    <div className="h-full flex items-center justify-center p-4">
      <div className="bg-retro-surface border border-neon-pink/50 rounded p-6 max-w-lg w-full max-h-[80vh] flex flex-col">
        <p className="text-neon-pink text-sm font-medium mb-2 flex-none">Error</p>
        <p className="text-cyber-300 text-sm mb-4 overflow-y-auto flex-1 whitespace-pre-wrap wrap-break-word">
          {error}
        </p>
        <button
          ref={buttonRef}
          onClick={onDismiss}
          className="w-full px-4 py-2 bg-retro-surface-light hover:bg-neon-pink/20 border border-neon-pink/50 text-neon-pink text-sm rounded transition-colors flex-none focus:outline-none focus:ring-2 focus:ring-neon-pink/50"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

export default ErrorDialog;
