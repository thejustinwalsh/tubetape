import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RegionPlayer, generatePeaks, sliceBuffer } from "./audioEngine";
import {
  createMockAudioBuffer,
  createMockAudioContext,
} from "../test/mocks/webAudio";

describe("generatePeaks", () => {
  it("should return correct number of peaks", () => {
    const channelData = new Float32Array(1000).fill(0.5);
    const buffer = createMockAudioBuffer({ length: 1000, channelData });

    const peaks = generatePeaks(buffer, 10);

    expect(peaks).toHaveLength(10);
  });

  it("should find max absolute value in each segment", () => {
    const channelData = new Float32Array(100);
    channelData[25] = 0.8;
    channelData[75] = -0.9;
    const buffer = createMockAudioBuffer({ length: 100, channelData });

    const peaks = generatePeaks(buffer, 2);

    expect(peaks[0]).toBeCloseTo(0.8, 5);
    expect(peaks[1]).toBeCloseTo(0.9, 5);
  });

  it("should handle silent audio", () => {
    const buffer = createMockAudioBuffer({ length: 100 });

    const peaks = generatePeaks(buffer, 10);

    expect(peaks.every((p) => p === 0)).toBe(true);
  });
});

describe("sliceBuffer", () => {
  it("should create buffer with correct duration", () => {
    const ctx = createMockAudioContext();
    const buffer = createMockAudioBuffer({ length: 44100, sampleRate: 44100 });

    const sliced = sliceBuffer(ctx, buffer, 0.25, 0.75);

    expect(ctx.createBuffer).toHaveBeenCalledWith(1, 22050, 44100);
    expect(sliced.length).toBe(22050);
  });

  it("should read source channel data for slicing", () => {
    const ctx = createMockAudioContext();
    const buffer = createMockAudioBuffer({ length: 44100, sampleRate: 44100 });

    sliceBuffer(ctx, buffer, 0, 0.5);

    expect(buffer.getChannelData).toHaveBeenCalledWith(0);
  });
});

describe("RegionPlayer", () => {
  let player: RegionPlayer;

  beforeEach(() => {
    player = new RegionPlayer();
  });

  afterEach(() => {
    player.destroy();
  });

  describe("init", () => {
    it("should initialize audio context", async () => {
      const ctx = await player.init(44100);

      expect(ctx).toBeDefined();
      expect(ctx.sampleRate).toBe(44100);
    });

    it("should reuse existing context on subsequent calls", async () => {
      const ctx1 = await player.init(44100);
      const ctx2 = await player.init(44100);

      expect(ctx1).toBe(ctx2);
    });

    it("should accept shared context", async () => {
      const sharedCtx = createMockAudioContext(48000);
      const ctx = await player.init(44100, sharedCtx);

      expect(ctx).toBe(sharedCtx);
    });
  });

  describe("isPlaying", () => {
    it("should be false initially", () => {
      expect(player.isPlaying).toBe(false);
    });
  });

  describe("playRegion", () => {
    it("should set isPlaying to true when playing", async () => {
      await player.init(44100);
      const buffer = createMockAudioBuffer();

      player.playRegion(buffer, 0, 1, false);

      expect(player.isPlaying).toBe(true);
    });

    it("should not call onEnded when manually stopped", async () => {
      await player.init(44100);
      const buffer = createMockAudioBuffer();
      const onEnded = vi.fn();

      player.playRegion(buffer, 0, 1, false, onEnded);
      player.stop();

      expect(player.isPlaying).toBe(false);
      expect(onEnded).not.toHaveBeenCalled();
    });
  });

  describe("stop", () => {
    it("should set isPlaying to false", async () => {
      await player.init(44100);
      const buffer = createMockAudioBuffer();

      player.playRegion(buffer, 0, 1, false);
      player.stop();

      expect(player.isPlaying).toBe(false);
    });

    it("should be safe to call when not playing", () => {
      expect(() => player.stop()).not.toThrow();
    });
  });

  describe("setVolume", () => {
    it("should clamp volume to 0-1 range", async () => {
      await player.init(44100);

      expect(() => player.setVolume(1.5)).not.toThrow();
      expect(() => player.setVolume(-0.5)).not.toThrow();
      expect(() => player.setVolume(0.5)).not.toThrow();
    });
  });

  describe("destroy", () => {
    it("should clean up resources", async () => {
      const ctx = await player.init(44100);
      const closeSpy = vi.spyOn(ctx, "close");

      player.destroy();

      expect(closeSpy).toHaveBeenCalled();
      expect(player.isPlaying).toBe(false);
    });
  });
});
