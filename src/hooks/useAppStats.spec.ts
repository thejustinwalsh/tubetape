import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAppStats } from "./useAppStats";

// Mock the bindings module
vi.mock("../bindings", () => ({
  commands: {
    getAppStats: vi.fn(),
  },
}));

import { commands } from "../bindings";
const mockGetAppStats = commands.getAppStats as Mock;

describe("useAppStats", () => {
  beforeEach(() => {
    mockGetAppStats.mockReset();
  });

  it("should initialize with default stats", () => {
    mockGetAppStats.mockResolvedValue({ status: "ok", data: { cacheSizeMb: 0, memoryUsageMb: 0 } });

    const { result } = renderHook(() => useAppStats());

    expect(result.current.stats.cacheSizeMb).toBe(0);
    expect(result.current.stats.memoryUsageMb).toBe(null);
  });

  it("should fetch stats on mount", async () => {
    mockGetAppStats.mockResolvedValue({ status: "ok", data: { cacheSizeMb: 150.5, memoryUsageMb: 256.7 } });

    const { result } = renderHook(() => useAppStats());

    await waitFor(() => {
      expect(result.current.stats.cacheSizeMb).toBe(150.5);
    });
    expect(result.current.stats.memoryUsageMb).toBe(257);
  });

  it("should call getAppStats command", async () => {
    mockGetAppStats.mockResolvedValue({ status: "ok", data: { cacheSizeMb: 0, memoryUsageMb: 0 } });

    renderHook(() => useAppStats());

    await waitFor(() => {
      expect(mockGetAppStats).toHaveBeenCalled();
    });
  });

  it("should provide refetch function", async () => {
    mockGetAppStats
      .mockResolvedValueOnce({ status: "ok", data: { cacheSizeMb: 100, memoryUsageMb: 200 } })
      .mockResolvedValueOnce({ status: "ok", data: { cacheSizeMb: 200, memoryUsageMb: 300 } });

    const { result } = renderHook(() => useAppStats());

    await waitFor(() => {
      expect(result.current.stats.cacheSizeMb).toBe(100);
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(result.current.stats.cacheSizeMb).toBe(200);
  });

  it("should handle fetch errors gracefully", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetAppStats.mockResolvedValue({ status: "error", error: "Network error" });

    const { result } = renderHook(() => useAppStats());

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    expect(result.current.stats.cacheSizeMb).toBe(0);
    consoleSpy.mockRestore();
  });
});
