import { useState, useCallback } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { commands } from "../bindings";
import type { SampleDocType } from "../lib/db";

interface SampleListProps {
  samples: SampleDocType[];
  onDelete: (id: string) => void;
  onUpdateName: (id: string, name: string) => void;
}

function SampleList({ samples, onDelete, onUpdateName }: SampleListProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [exportingId, setExportingId] = useState<string | null>(null);

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
  };

  const startEditing = useCallback((sample: SampleDocType) => {
    setEditingId(sample.id);
    setEditName(sample.name);
  }, []);

  const saveEdit = useCallback(() => {
    if (editingId && editName.trim()) {
      onUpdateName(editingId, editName.trim());
    }
    setEditingId(null);
    setEditName("");
  }, [editingId, editName, onUpdateName]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
    setEditName("");
  }, []);

  const handleExport = useCallback(async (sample: SampleDocType) => {
    try {
      const savePath = await save({
        defaultPath: `${sample.name.replace(/[^a-zA-Z0-9]/g, "_")}.mp3`,
        filters: [{ name: "Audio", extensions: ["mp3"] }],
      });

      if (!savePath) return;

      setExportingId(sample.id);

      const result = await commands.exportSample(
        sample.sourceAudioPath,
        savePath,
        sample.startTime,
        sample.endTime
      );

      if (result.status === "error") {
        throw new Error(result.error);
      }

      setExportingId(null);
    } catch (err) {
      console.error("Export failed:", err);
      setExportingId(null);
    }
  }, []);

  if (samples.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="text-4xl mb-2 flex justify-center text-cyber-700">
          <svg className="w-12 h-12" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z" />
          </svg>
        </div>
        <p className="text-cyber-600 text-sm">No samples yet</p>
        <p className="text-cyber-700 text-xs mt-1">Drag on the waveform to create a selection</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {samples.map((sample) => (
        <div
          key={sample.id}
          className="bg-retro-surface border border-retro-surface-light rounded p-3 flex items-center gap-3"
        >
          <div className="flex-1 min-w-0">
            {editingId === sample.id ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  className="flex-1 px-2 py-1 bg-retro-dark border border-neon-cyan text-cyber-100 text-sm rounded focus:outline-none"
                  autoFocus
                />
                <button
                  onClick={saveEdit}
                  className="px-2 py-1 text-xs bg-acid-green/20 border border-acid-green text-acid-green rounded"
                >
                  Save
                </button>
                <button
                  onClick={cancelEdit}
                  className="px-2 py-1 text-xs bg-retro-surface-light border border-retro-surface-light text-cyber-400 rounded"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <>
                <div
                  className="text-cyber-100 text-sm font-medium truncate cursor-pointer hover:text-neon-cyan"
                  onClick={() => startEditing(sample)}
                  title="Click to edit name"
                >
                  {sample.name}
                </div>
                <div className="text-cyber-600 text-xs mt-0.5">
                  <span className="text-acid-green">{formatTime(sample.startTime)}</span>
                  <span className="mx-1">→</span>
                  <span className="text-acid-green">{formatTime(sample.endTime)}</span>
                  <span className="mx-2 text-cyber-700">|</span>
                  <span>{formatTime(sample.duration)}</span>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => handleExport(sample)}
              disabled={exportingId === sample.id}
              className="px-2 py-1 text-xs bg-neon-pink/20 hover:bg-neon-pink/30 border border-neon-pink text-neon-pink rounded transition-colors disabled:opacity-50"
            >
              {exportingId === sample.id ? "..." : "Export"}
            </button>

            <button
              onClick={() => onDelete(sample.id)}
              className="px-2 py-1 text-xs bg-retro-surface-light hover:bg-red-500/20 border border-retro-surface-light hover:border-red-500 text-cyber-400 hover:text-red-400 rounded transition-colors"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default SampleList;
