import type { GameEvent } from '../game/types';

export type AudioCue =
  | 'pick-started'
  | 'picked'
  | 'dropped'
  | 'pounce'
  | 'guards-stunned'
  | 'captured'
  | 'delivered'
  | 'match-ended';

export type AudioCueEntry = {
  variants: readonly string[];
  volume: number;
  playbackRate: readonly [number, number];
  fallback: {
    startFrequency: number;
    endFrequency: number;
    duration: number;
    oscillator: OscillatorType;
  };
};

const KENNEY_AUDIO_ROOT = 'assets/audio/kenney';

export const AUDIO_MANIFEST: Readonly<Record<AudioCue, AudioCueEntry>> = {
  'pick-started': {
    variants: [`${KENNEY_AUDIO_ROOT}/pick-started.mp3`],
    volume: 0.38,
    playbackRate: [0.98, 1.04],
    fallback: { startFrequency: 280, endFrequency: 360, duration: 0.12, oscillator: 'triangle' },
  },
  picked: {
    variants: [
      `${KENNEY_AUDIO_ROOT}/picked-01.mp3`,
      `${KENNEY_AUDIO_ROOT}/picked-02.mp3`,
    ],
    volume: 0.34,
    playbackRate: [0.97, 1.05],
    fallback: { startFrequency: 420, endFrequency: 760, duration: 0.16, oscillator: 'triangle' },
  },
  dropped: {
    variants: [
      `${KENNEY_AUDIO_ROOT}/apple-drop-01.mp3`,
      `${KENNEY_AUDIO_ROOT}/apple-drop-02.mp3`,
    ],
    volume: 0.42,
    playbackRate: [0.96, 1.03],
    fallback: { startFrequency: 390, endFrequency: 230, duration: 0.11, oscillator: 'sine' },
  },
  pounce: {
    variants: [`${KENNEY_AUDIO_ROOT}/guard-pounce.mp3`],
    volume: 0.48,
    playbackRate: [0.96, 1.02],
    fallback: { startFrequency: 180, endFrequency: 520, duration: 0.12, oscillator: 'sawtooth' },
  },
  'guards-stunned': {
    variants: [`${KENNEY_AUDIO_ROOT}/guards-stunned.mp3`],
    volume: 0.46,
    playbackRate: [0.98, 1.02],
    fallback: { startFrequency: 150, endFrequency: 90, duration: 0.22, oscillator: 'square' },
  },
  captured: {
    variants: [`${KENNEY_AUDIO_ROOT}/kid-captured.mp3`],
    volume: 0.48,
    playbackRate: [0.97, 1.01],
    fallback: { startFrequency: 260, endFrequency: 110, duration: 0.24, oscillator: 'square' },
  },
  delivered: {
    variants: [`${KENNEY_AUDIO_ROOT}/apple-delivered.mp3`],
    volume: 0.42,
    playbackRate: [0.99, 1.05],
    fallback: { startFrequency: 520, endFrequency: 900, duration: 0.22, oscillator: 'triangle' },
  },
  'match-ended': {
    variants: [`${KENNEY_AUDIO_ROOT}/match-ended.mp3`],
    volume: 0.5,
    playbackRate: [0.94, 1.06],
    fallback: { startFrequency: 620, endFrequency: 1040, duration: 0.42, oscillator: 'triangle' },
  },
};

export function getAudioCue(event: GameEvent): AudioCue | null {
  switch (event.type) {
    case 'pick-started':
    case 'picked':
    case 'dropped':
    case 'pounce':
    case 'guards-stunned':
    case 'captured':
    case 'delivered':
    case 'match-ended':
      return event.type;
    default:
      return null;
  }
}

export function getAudioAssetPaths(): string[] {
  return [...new Set(Object.values(AUDIO_MANIFEST).flatMap((entry) => entry.variants))];
}
