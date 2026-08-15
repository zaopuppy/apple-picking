import {
  AUDIO_MANIFEST,
  getAudioAssetPaths,
  getAudioCue,
  type AudioCue,
  type AudioCueEntry,
} from '../assets/AudioManifest';
import type { GameEvent } from '../game/types';

export type AudioDiagnostics = {
  externalEnabled: boolean;
  unlocked: boolean;
  sampleFiles: number;
  fetchedSamples: number;
  decodedSamples: number;
  failedSamples: number;
  lastFailure: string | null;
  samplePlays: number;
  fallbackPlays: number;
};

export class AudioSystem {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private unlocked = false;
  private readonly externalEnabled: boolean;
  private readonly encodedSamples = new Map<string, ArrayBuffer>();
  private readonly decodedSamples = new Map<string, AudioBuffer>();
  private readonly cueCursors = new Map<AudioCue, number>();
  private readonly activeSources = new Set<AudioBufferSourceNode>();
  private readonly abortController = new AbortController();
  private readonly preloadPromise: Promise<void>;
  private failedSamples = 0;
  private lastFailure: string | null = null;
  private samplePlays = 0;
  private fallbackPlays = 0;
  private disposed = false;
  private readonly unlockFromGesture = () => {
    void this.unlock();
  };

  constructor() {
    this.externalEnabled = new URLSearchParams(window.location.search).get('audio') !== 'procedural';
    this.preloadPromise = this.externalEnabled ? this.preloadSamples() : Promise.resolve();
    window.addEventListener('pointerdown', this.unlockFromGesture, { once: true });
    window.addEventListener('keydown', this.unlockFromGesture, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.disposed) return;
    if (this.context) {
      if (this.context.state !== 'running') await this.context.resume();
      this.unlocked = this.context.state === 'running';
      await this.decodePreloadedSamples(this.context);
      return;
    }
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    const context = new AudioContextClass();
    const masterGain = context.createGain();
    masterGain.gain.value = 0.72;
    masterGain.connect(context.destination);
    this.context = context;
    this.masterGain = masterGain;
    await context.resume();
    this.unlocked = context.state === 'running';
    await this.decodePreloadedSamples(context);
  }

  play(event: GameEvent): void {
    const cue = getAudioCue(event);
    if (!cue) return;
    const entry = AUDIO_MANIFEST[cue];
    if (this.playSample(cue, entry, event)) return;

    const fallback = entry.fallback;
    const winnerScale = event.type === 'match-ended' && event.winner === 'guards' ? 0.58 : 1;
    this.fallbackPlays += this.tone(
      fallback.startFrequency * winnerScale,
      fallback.endFrequency * winnerScale,
      fallback.duration,
      fallback.oscillator,
    ) ? 1 : 0;
  }

  getDiagnostics(): AudioDiagnostics {
    return {
      externalEnabled: this.externalEnabled,
      unlocked: this.unlocked,
      sampleFiles: getAudioAssetPaths().length,
      fetchedSamples: this.encodedSamples.size,
      decodedSamples: this.decodedSamples.size,
      failedSamples: this.failedSamples,
      lastFailure: this.lastFailure,
      samplePlays: this.samplePlays,
      fallbackPlays: this.fallbackPlays,
    };
  }

  private async preloadSamples(): Promise<void> {
    await Promise.all(getAudioAssetPaths().map(async (path) => {
      try {
        const url = new URL(path, document.baseURI);
        const response = await fetch(url, {
          headers: { Accept: 'audio/wav,audio/*;q=0.9,*/*;q=0.1' },
          signal: this.abortController.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.encodedSamples.set(path, await response.arrayBuffer());
      } catch (error) {
        if (!this.abortController.signal.aborted) {
          this.failedSamples += 1;
          this.lastFailure = `${path}: ${error instanceof Error ? error.message : String(error)}`;
          console.warn(`Audio sample unavailable, using procedural fallback: ${path}`, error);
        }
      }
    }));
  }

  private async decodePreloadedSamples(context: AudioContext): Promise<void> {
    if (!this.externalEnabled || this.disposed) return;
    await this.preloadPromise;
    await Promise.all([...this.encodedSamples.entries()].map(async ([path, encoded]) => {
      if (this.decodedSamples.has(path)) return;
      try {
        const decoded = await context.decodeAudioData(encoded.slice(0));
        if (!this.disposed && this.context === context) this.decodedSamples.set(path, decoded);
      } catch (error) {
        this.failedSamples += 1;
        this.lastFailure = `${path}: ${error instanceof Error ? error.message : String(error)}`;
        console.warn(`Audio sample could not be decoded, using procedural fallback: ${path}`, error);
      }
    }));
  }

  private playSample(cue: AudioCue, entry: AudioCueEntry, event: GameEvent): boolean {
    const context = this.context;
    const destination = this.masterGain;
    if (!this.externalEnabled || !context || !destination || context.state !== 'running') return false;

    const cursor = this.cueCursors.get(cue) ?? 0;
    const path = entry.variants[cursor % entry.variants.length];
    const buffer = this.decodedSamples.get(path);
    if (!buffer) return false;

    const source = context.createBufferSource();
    const gain = context.createGain();
    const rateRange = entry.playbackRate[1] - entry.playbackRate[0];
    const rateStep = (cursor % 3) / 2;
    source.buffer = buffer;
    source.playbackRate.value = entry.playbackRate[0] + rateRange * rateStep;
    if (event.type === 'match-ended') {
      source.playbackRate.value *= event.winner === 'kid' ? 1.08 : 0.76;
    }
    gain.gain.value = entry.volume;
    source.connect(gain).connect(destination);
    source.onended = () => {
      this.activeSources.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    this.activeSources.add(source);
    this.cueCursors.set(cue, cursor + 1);
    this.samplePlays += 1;
    source.start();
    return true;
  }

  private tone(startFrequency: number, endFrequency: number, duration: number, type: OscillatorType): boolean {
    const context = this.context;
    const destination = this.masterGain;
    if (!context || !destination || context.state !== 'running') return false;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const now = context.currentTime;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration * 0.72);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    return true;
  }

  dispose(): void {
    this.disposed = true;
    this.abortController.abort();
    window.removeEventListener('pointerdown', this.unlockFromGesture);
    window.removeEventListener('keydown', this.unlockFromGesture);
    for (const source of this.activeSources) source.stop();
    this.activeSources.clear();
    this.decodedSamples.clear();
    this.encodedSamples.clear();
    this.masterGain?.disconnect();
    this.masterGain = null;
    void this.context?.close();
    this.context = null;
    this.unlocked = false;
  }
}
