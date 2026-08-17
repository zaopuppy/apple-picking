/**
 * Deterministic seeded RNG (mulberry32). Route ALL gameplay randomness through
 * a seeded generator instead of Math.random so the __THREE_GAME_TEST_HOOKS__
 * seed() hook keeps visual baselines and bot playtests reproducible.
 */
export type SeededRandom = (() => number) & {
  getState: () => number;
  setState: (state: number) => void;
};

export function createSeededRandom(seed: number): SeededRandom {
  let state = seed >>> 0;
  const random = (() => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }) as SeededRandom;
  random.getState = () => state;
  random.setState = (nextState: number) => {
    state = nextState >>> 0;
  };
  return random;
}
