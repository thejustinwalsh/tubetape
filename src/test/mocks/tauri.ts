import { vi } from "vitest";

export const mockInvoke = vi.fn();
export const invoke = mockInvoke;
export const mockChannel = vi.fn(() => ({
  onmessage: null,
  send: vi.fn(),
}));

export const save = vi.fn().mockResolvedValue("/mock/path/file.mp3");
export const open = vi.fn().mockResolvedValue("/mock/path/file.mp3");
export const readFile = vi.fn().mockResolvedValue(new Uint8Array([0, 0, 0]));
export const writeFile = vi.fn().mockResolvedValue(undefined);
export const openUrl = vi.fn().mockResolvedValue(undefined);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
  Channel: mockChannel,
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save,
  open,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile,
  writeFile,
}));

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl,
}));

export function resetTauriMocks() {
  mockInvoke.mockReset();
  mockChannel.mockReset();
}
