import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useAppStats } from "./useAppStats";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
const mockInvoke = vi.mocked(invoke);

describe("useAppStats", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("should initialize with default stats", () => {
    mockInvoke.mockResolvedValue({ cacheSizeMb: 0, memoryUsageMb: 0 });

    const { result } = renderHook(() => useAppStats());

    expect(result.current.stats.cacheSizeMb).toBe(0);
    expect(result.current.stats.memoryUsageMb).toBe(null);
  });

  it("should fetch stats on mount", async () => {
    mockInvoke.mockResolvedValue({ cacheSizeMb: 150.5, memoryUsageMb: 256.7 });

    const { result } = renderHook(() => useAppStats());

    await waitFor(() => {
      expect(result.current.stats.cacheSizeMb).toBe(150.5);
    });
    expect(result.current.stats.memoryUsageMb).toBe(257);
  });

  it("should call get_app_stats command", async () => {
    mockInvoke.mockResolvedValue({ cacheSizeMb: 0, memoryUsageMb: 0 });

    renderHook(() => useAppStats());

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith("get_app_stats");
    });
  });

  it("should provide refetch function", async () => {
    mockInvoke
      .mockResolvedValueOnce({ cacheSizeMb: 100, memoryUsageMb: 200 })
      .mockResolvedValueOnce({ cacheSizeMb: 200, memoryUsageMb: 300 });

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
    mockInvoke.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(() => useAppStats());

    await waitFor(() => {
      expect(consoleSpy).toHaveBeenCalled();
    });

    expect(result.current.stats.cacheSizeMb).toBe(0);
    consoleSpy.mockRestore();
  });
});
