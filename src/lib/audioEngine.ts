export class RegionPlayer {
  private audioContext: AudioContext | null = null;
  private sourceNode: AudioBufferSourceNode | null = null;
  private gainNode: GainNode | null = null;
  private _isPlaying = false;
  private onEnded: (() => void) | null = null;
  private onProgress: ((progress: number) => void) | null = null;
  private animationFrameId: number | null = null;
  private playbackStartTime = 0;
  private regionDuration = 0;
  private isLooping = false;

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  async init(sampleRate: number, sharedContext?: AudioContext): Promise<AudioContext> {
    if (!this.audioContext) {
      this.audioContext = sharedContext || new AudioContext({ sampleRate });
      this.setupAudioNodes();
    }
    
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
    
    return this.audioContext;
  }

  private setupAudioNodes(): void {
    if (!this.audioContext) return;
    this.gainNode = this.audioContext.createGain();
    this.gainNode.connect(this.audioContext.destination);
  }

  private startProgressLoop(): void {
    if (this.animationFrameId !== null) return;
    
    const update = () => {
      if (this._isPlaying && this.audioContext && this.onProgress) {
        const elapsed = this.audioContext.currentTime - this.playbackStartTime;
        let progress: number;
        
        if (this.isLooping) {
          progress = (elapsed % this.regionDuration) / this.regionDuration;
        } else {
          progress = Math.min(elapsed / this.regionDuration, 1);
        }
        
        this.onProgress(progress);
      }
      
      if (this._isPlaying) {
        this.animationFrameId = requestAnimationFrame(update);
      }
    };
    
    this.animationFrameId = requestAnimationFrame(update);
  }

  private stopProgressLoop(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  playRegion(
    buffer: AudioBuffer,
    startTime: number,
    endTime: number,
    loop: boolean,
    onEnded?: () => void,
    onProgress?: (progress: number) => void
  ): void {
    this.stop();
    
    if (!this.audioContext || !this.gainNode) {
      console.error("RegionPlayer not initialized");
      return;
    }

    this.onEnded = onEnded ?? null;
    this.onProgress = onProgress ?? null;
    this.regionDuration = endTime - startTime;
    this.isLooping = loop;

    this.sourceNode = this.audioContext.createBufferSource();
    this.sourceNode.buffer = buffer;
    this.sourceNode.connect(this.gainNode);

    this.sourceNode.loop = loop;
    this.sourceNode.loopStart = startTime;
    this.sourceNode.loopEnd = endTime;

    this.sourceNode.onended = () => {
      this._isPlaying = false;
      this.stopProgressLoop();
      this.onEnded?.();
    };

    const duration = loop ? undefined : endTime - startTime;
    this.playbackStartTime = this.audioContext.currentTime;
    this.sourceNode.start(0, startTime, duration);
    this._isPlaying = true;
    this.startProgressLoop();
  }

  stop(): void {
    this.stopProgressLoop();
    if (this.sourceNode) {
      this.sourceNode.onended = null;
      try {
        this.sourceNode.stop();
      } catch {
      }
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    this._isPlaying = false;
  }

  setVolume(volume: number): void {
    if (this.gainNode) {
      this.gainNode.gain.value = Math.max(0, Math.min(1, volume));
    }
  }

  destroy(): void {
    this.stop();
    this.audioContext?.close();
    this.audioContext = null;
    this.gainNode = null;
  }
}

export function generatePeaks(buffer: AudioBuffer, peakCount: number): number[] {
  const channelData = buffer.getChannelData(0);
  const samplesPerPeak = Math.floor(channelData.length / peakCount);
  const peaks: number[] = [];

  for (let i = 0; i < peakCount; i++) {
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, channelData.length);
    
    let max = 0;
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channelData[j]);
      if (abs > max) max = abs;
    }
    peaks.push(max);
  }

  return peaks;
}

export function sliceBuffer(
  ctx: AudioContext,
  buffer: AudioBuffer,
  startTime: number,
  endTime: number
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const startSample = Math.floor(startTime * sampleRate);
  const endSample = Math.ceil(endTime * sampleRate);
  const length = endSample - startSample;

  const sliced = ctx.createBuffer(buffer.numberOfChannels, length, sampleRate);

  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const src = buffer.getChannelData(ch);
    const dst = sliced.getChannelData(ch);
    dst.set(src.subarray(startSample, endSample));
  }

  return sliced;
}
