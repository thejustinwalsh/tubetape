import { useState, useCallback, useRef, useEffect } from "react";
import type { Project } from "../types";
import { isYouTubeUrl, extractVideoId } from "../lib/youtube";

interface ProjectComboboxProps {
  projects: Project[];
  currentProject: Project | null;
  onSubmitUrl: (url: string) => void;
  onSelectProject: (project: Project) => void;
  onClose: () => void;
  disabled?: boolean;
}

function ProjectCombobox({
  projects,
  currentProject,
  onSubmitUrl,
  onSelectProject,
  onClose,
  disabled,
}: ProjectComboboxProps) {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const isActive = isOpen || isFocused;

  const filteredProjects = inputValue
    ? projects.filter((p) =>
      p.title.toLowerCase().includes(inputValue.toLowerCase())
    )
    : projects;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setHighlightedIndex(-1);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
    setIsOpen(true);
    setHighlightedIndex(-1);
  }, []);

  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const pastedText = e.clipboardData.getData("text");
      if (pastedText && isYouTubeUrl(pastedText) && !disabled) {
        e.preventDefault();
        const videoId = extractVideoId(pastedText);

        const existingProject = videoId
          ? projects.find((p) => p.videoId === videoId)
          : null;

        if (existingProject) {
          onSelectProject(existingProject);
          setInputValue("");
          setIsOpen(false);
        } else {
          onSubmitUrl(pastedText.trim());
          setInputValue("");
          setIsOpen(false);
        }
      }
    },
    [disabled, projects, onSelectProject, onSubmitUrl]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          if (!isOpen && projects.length > 0) {
            setIsOpen(true);
            setHighlightedIndex(0);
          } else if (isOpen) {
            setHighlightedIndex((prev) =>
              prev < filteredProjects.length - 1 ? prev + 1 : prev
            );
          }
          break;
        case "ArrowUp":
          e.preventDefault();
          if (isOpen) {
            setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : 0));
          }
          break;
        case "Enter":
          e.preventDefault();
          if (isOpen && highlightedIndex >= 0 && filteredProjects[highlightedIndex]) {
            onSelectProject(filteredProjects[highlightedIndex]);
            setInputValue("");
            setIsOpen(false);
            setHighlightedIndex(-1);
          } else if (inputValue.trim()) {
            if (isYouTubeUrl(inputValue)) {
              const videoId = extractVideoId(inputValue);
              const existingProject = videoId
                ? projects.find((p) => p.videoId === videoId)
                : null;

              if (existingProject) {
                onSelectProject(existingProject);
              } else {
                onSubmitUrl(inputValue.trim());
              }
              setInputValue("");
              setIsOpen(false);
            }
          }
          break;
        case "Escape":
          setIsOpen(false);
          setHighlightedIndex(-1);
          break;
      }
    },
    [disabled, isOpen, highlightedIndex, filteredProjects, inputValue, projects, onSelectProject, onSubmitUrl]
  );

  const handleSelectProject = useCallback(
    (project: Project) => {
      onSelectProject(project);
      setInputValue("");
      setIsOpen(false);
      setHighlightedIndex(-1);
    },
    [onSelectProject]
  );

  const toggleDropdown = useCallback(() => {
    if (!disabled && projects.length > 0) {
      setIsOpen((prev) => !prev);
      if (!isOpen) {
        inputRef.current?.focus();
      }
    }
  }, [disabled, projects.length, isOpen]);

  if (currentProject) {
    return (
      <div className="w-full flex group">
        <div className="flex-1 min-w-0 h-7 px-3 bg-retro-surface border border-retro-surface-light border-r-0 rounded-l flex items-center">
          <span className="text-cyber-300 text-sm truncate w-full text-left">
            {currentProject.title}
          </span>
        </div>
        <button
          onClick={onClose}
          title="Close Project"
          className="h-7 w-7 flex-none flex items-center justify-center bg-retro-surface border border-retro-surface-light border-l-0 rounded-r text-cyber-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="square" d="M6 6l12 12M6 18L18 6" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full">
      <div className="flex group">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={handleInputChange}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            setIsFocused(true);
            if (projects.length > 0) setIsOpen(true);
          }}
          onBlur={() => setIsFocused(false)}
          placeholder={projects.length > 0 ? "Paste URL or select project..." : "Paste YouTube URL..."}
          disabled={disabled}
          className={`flex-1 min-w-0 h-7 px-3 bg-retro-surface border border-r-0 rounded-l text-cyber-100 placeholder-cyber-600 text-sm focus:outline-none focus:ring-0 transition-colors disabled:opacity-50 ${isActive
              ? "border-neon-cyan"
              : "border-retro-surface-light"
            }`}
        />
        <button
          type="button"
          onClick={toggleDropdown}
          disabled={disabled || projects.length === 0}
          className={`h-7 w-7 flex-none flex items-center justify-center bg-retro-surface border border-l-0 rounded-r transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${isActive
              ? "border-neon-cyan"
              : "border-retro-surface-light"
            }`}
          title={projects.length > 0 ? "Show projects" : "No projects yet"}
        >
          <svg
            className={`w-3 h-3 text-cyber-400 transition-transform ${isOpen ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {isOpen && filteredProjects.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-50 top-full left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-retro-surface border border-retro-surface-light rounded shadow-lg shadow-black/50"
        >
          {filteredProjects.map((project, index) => (
            <li
              key={project.videoId}
              onClick={() => handleSelectProject(project)}
              onMouseEnter={() => setHighlightedIndex(index)}
              className={`px-3 py-2 cursor-pointer text-sm transition-colors ${index === highlightedIndex
                ? "bg-neon-cyan/20 text-neon-cyan"
                : "text-cyber-300 hover:bg-retro-surface-light"
                }`}
            >
              <div className="truncate">{project.title}</div>
              <div className="text-xs text-cyber-600 truncate mt-0.5">
                {project.videoId}
              </div>
            </li>
          ))}
        </ul>
      )}

      {isOpen && inputValue && filteredProjects.length === 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 px-3 py-2 bg-retro-surface border border-retro-surface-light rounded text-cyber-500 text-sm">
          No matching projects
        </div>
      )}
    </div>
  );
}

export default ProjectCombobox;
