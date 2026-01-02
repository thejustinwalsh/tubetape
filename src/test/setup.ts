import { vi, beforeAll, afterEach } from "vitest";
import "@testing-library/dom";
import { setupWebAudioMock } from "./mocks/webAudio";

beforeAll(() => {
  global.requestAnimationFrame = (cb) => {
    return setTimeout(() => cb(performance.now()), 16) as unknown as number;
  };
  global.cancelAnimationFrame = (id) => clearTimeout(id);

  setupWebAudioMock();

  if (!global.crypto) {
    global.crypto = {
      randomUUID: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    } as Crypto;
  }
});

afterEach(() => {
  vi.clearAllMocks();
});
