import type { GameEvent } from '../game/types';

export class AudioSystem {
  private context: AudioContext | null = null;
  private unlocked = false;

  constructor() {
    const unlock = () => {
      void this.unlock();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    this.context = new AudioContextClass();
    await this.context.resume();
    this.unlocked = true;
  }

  play(event: GameEvent): void {
    switch (event.type) {
      case 'pick-started': this.tone(280, 360, 0.12, 'triangle'); break;
      case 'picked': this.tone(420, 760, 0.16, 'triangle'); break;
      case 'dropped': this.tone(390, 230, 0.11, 'sine'); break;
      case 'pounce': this.tone(180, 520, 0.12, 'sawtooth'); break;
      case 'guards-stunned': this.tone(150, 90, 0.22, 'square'); break;
      case 'captured': this.tone(260, 110, 0.24, 'square'); break;
      case 'delivered': this.tone(520, 900, 0.22, 'triangle'); break;
      case 'match-ended': this.tone(event.winner === 'kid' ? 620 : 320, event.winner === 'kid' ? 1040 : 620, 0.42, 'triangle'); break;
      default: break;
    }
  }

  private tone(startFrequency: number, endFrequency: number, duration: number, type: OscillatorType): void {
    if (!this.context || this.context.state !== 'running') return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(startFrequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, now + duration * 0.72);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  dispose(): void {
    void this.context?.close();
    this.context = null;
  }
}
