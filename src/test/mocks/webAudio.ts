import { vi } from "vitest";

export function createMockAudioBuffer(options: {
  length?: number;
  sampleRate?: number;
  numberOfChannels?: number;
  channelData?: Float32Array;
} = {}): AudioBuffer {
  const {
    length = 44100,
    sampleRate = 44100,
    numberOfChannels = 1,
    channelData = new Float32Array(length).fill(0),
  } = options;

  return {
    length,
    duration: length / sampleRate,
    sampleRate,
    numberOfChannels,
    getChannelData: vi.fn((channel: number) => {
      if (channel >= numberOfChannels) throw new Error("Invalid channel");
      return channelData;
    }),
    copyFromChannel: vi.fn(),
    copyToChannel: vi.fn(),
  } as unknown as AudioBuffer;
}

export function createMockGainNode(): GainNode {
  return {
    gain: { value: 1, setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
  } as unknown as GainNode;
}

export function createMockAudioBufferSourceNode(): AudioBufferSourceNode {
  let onendedCallback: (() => void) | null = null;

  const node = {
    buffer: null,
    loop: false,
    loopStart: 0,
    loopEnd: 0,
    playbackRate: { value: 1 },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(() => {
      if (onendedCallback) onendedCallback();
    }),
    get onended() {
      return onendedCallback;
    },
    set onended(cb: (() => void) | null) {
      onendedCallback = cb;
    },
  };

  return node as unknown as AudioBufferSourceNode;
}

export function createMockAudioContext(sampleRate = 44100): AudioContext {
  let currentTime = 0;
  const timeInterval = setInterval(() => {
    currentTime += 0.016;
  }, 16);

  const ctx = {
    sampleRate,
    state: "running" as AudioContextState,
    get currentTime() {
      return currentTime;
    },
    destination: {} as AudioDestinationNode,
    createGain: vi.fn(() => createMockGainNode()),
    createBufferSource: vi.fn(() => createMockAudioBufferSourceNode()),
    createBuffer: vi.fn((channels: number, length: number, sr: number) => {
      return createMockAudioBuffer({ numberOfChannels: channels, length, sampleRate: sr });
    }),
    resume: vi.fn().mockResolvedValue(undefined),
    suspend: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(() => {
      clearInterval(timeInterval);
      return Promise.resolve();
    }),
  };

  return ctx as unknown as AudioContext;
}

export function setupWebAudioMock() {
  class MockAudioContext {
    sampleRate: number;
    state: AudioContextState = "running";
    destination = {} as AudioDestinationNode;
    private _currentTime = 0;

    constructor(options?: AudioContextOptions) {
      this.sampleRate = options?.sampleRate ?? 44100;
    }

    get currentTime() {
      return this._currentTime;
    }

    createGain = vi.fn(() => createMockGainNode());
    createBufferSource = vi.fn(() => createMockAudioBufferSourceNode());
    createBuffer = vi.fn((channels: number, length: number, sr: number) => {
      return createMockAudioBuffer({ numberOfChannels: channels, length, sampleRate: sr });
    });
    resume = vi.fn().mockResolvedValue(undefined);
    suspend = vi.fn().mockResolvedValue(undefined);
    close = vi.fn().mockResolvedValue(undefined);
  }

  vi.stubGlobal("AudioContext", MockAudioContext);
  vi.stubGlobal("webkitAudioContext", MockAudioContext);

  return MockAudioContext;
}
