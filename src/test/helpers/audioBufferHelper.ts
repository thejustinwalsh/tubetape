export function createAudioBuffer(options: {
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

  const audioContext = new AudioContext({ sampleRate });
  const buffer = audioContext.createBuffer(numberOfChannels, length, sampleRate);
  
  for (let channel = 0; channel < numberOfChannels; channel++) {
    const channelBuffer = buffer.getChannelData(channel);
    channelBuffer.set(channelData);
  }
  
  audioContext.close();
  
  return buffer;
}
