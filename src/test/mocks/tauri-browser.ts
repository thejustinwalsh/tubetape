export const mockInvoke = () => Promise.resolve();
export const invoke = mockInvoke;
export const mockChannel = () => ({
  onmessage: null,
  send: () => {},
});

export const save = () => Promise.resolve("/mock/path/file.mp3");
export const open = () => Promise.resolve("/mock/path/file.mp3");

function generateMockWavFile(): Uint8Array {
  const sampleRate = 44100;
  const durationSecs = 3;
  const numSamples = sampleRate * durationSecs;
  const numChannels = 1;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  
  const samples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    
    // Bass: 60Hz pulse with decay envelope
    const bassEnv = Math.exp(-((t % 0.5) * 4));
    const bass = Math.sin(2 * Math.PI * 60 * t) * bassEnv * 0.4;
    
    // Mid: 220Hz + 330Hz chord with slow LFO
    const midEnv = 0.3 + 0.2 * Math.sin(2 * Math.PI * 0.5 * t);
    const mid = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 330 * t) * 0.7) * midEnv * 0.25;
    
    // High: 880Hz with rhythmic gate
    const gate = Math.sin(2 * Math.PI * 4 * t) > 0.3 ? 1 : 0.1;
    const high = Math.sin(2 * Math.PI * 880 * t) * gate * 0.15;
    
    // Noise percussion every half-beat
    const beatPhase = (t * 2) % 1;
    const noiseEnv = beatPhase < 0.05 ? Math.exp(-beatPhase * 40) : 0;
    const noise = (Math.random() * 2 - 1) * noiseEnv * 0.3;
    
    const mixed = Math.max(-1, Math.min(1, bass + mid + high + noise));
    samples[i] = Math.floor(mixed * 32767);
  }
  
  // WAV format: 44-byte header + PCM data
  const dataSize = numSamples * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  
  // RIFF/WAVE header (see: http://soundfile.sapp.org/doc/WaveFormat/)
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);
  
  for (let i = 0; i < numSamples; i++) {
    view.setInt16(44 + i * 2, samples[i], true);
  }
  
  return new Uint8Array(buffer);
}

function writeString(view: DataView, offset: number, str: string) {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}

let cachedWav: Uint8Array | null = null;

export const readFile = () => {
  if (!cachedWav) {
    cachedWav = generateMockWavFile();
  }
  return Promise.resolve(cachedWav);
};

export const writeFile = () => Promise.resolve(undefined);
export const openUrl = () => Promise.resolve(undefined);

export const Channel = mockChannel;
