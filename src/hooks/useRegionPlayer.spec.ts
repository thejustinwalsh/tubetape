import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRegionPlayer } from "./useRegionPlayer";
import { createMockAudioBuffer, setupWebAudioMock } from "../test/mocks/webAudio";

describe("useRegionPlayer", () => {
  beforeEach(() => {
    setupWebAudioMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize with default state", () => {
    const { result } = renderHook(() => useRegionPlayer({ sampleRate: 44100 }));

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it("should set isPlaying true when playRegion called", () => {
    const { result } = renderHook(() => useRegionPlayer({ sampleRate: 44100 }));
    const buffer = createMockAudioBuffer();

    act(() => {
      result.current.playRegion(buffer, 0, 1, false);
    });

    expect(result.current.isPlaying).toBe(true);
  });

  it("should set isPlaying false when stop called", () => {
    const { result } = renderHook(() => useRegionPlayer({ sampleRate: 44100 }));
    const buffer = createMockAudioBuffer();

    act(() => {
      result.current.playRegion(buffer, 0, 1, false);
    });

    act(() => {
      result.current.stop();
    });

    expect(result.current.isPlaying).toBe(false);
    expect(result.current.progress).toBe(0);
  });

  it("should toggle playback state", () => {
    const { result } = renderHook(() => useRegionPlayer({ sampleRate: 44100 }));
    const buffer = createMockAudioBuffer();

    act(() => {
      result.current.toggle(buffer, 0, 1, false);
    });

    expect(result.current.isPlaying).toBe(true);

    act(() => {
      result.current.toggle(buffer, 0, 1, false);
    });

    expect(result.current.isPlaying).toBe(false);
  });

  it("should cleanup on unmount", () => {
    const { unmount } = renderHook(() => useRegionPlayer({ sampleRate: 44100 }));

    expect(() => unmount()).not.toThrow();
  });
});
