import type { Vec2 } from './types';

export const TICKS_PER_SECOND = 60;
export const FIXED_DELTA_SECONDS = 1 / TICKS_PER_SECOND;
export const ARENA_SCALE = 3;

export type MovementTuning = {
  baseSpeed: number;
  guardSpeedMultiplier: number;
  kidSpeedMultiplier: number;
};

export const DEFAULT_MOVEMENT_TUNING: Readonly<MovementTuning> = {
  baseSpeed: 8,
  guardSpeedMultiplier: 1.05,
  kidSpeedMultiplier: 1.2,
};

export const GAME_CONFIG = {
  arenaHalfWidth: 12 * ARENA_SCALE,
  arenaHalfDepth: 9 * ARENA_SCALE,
  countdownTicks: 3 * TICKS_PER_SECOND,
  catchTarget: 3,
  kidRadius: 0.48,
  guardRadius: 0.55,
  appleRadius: 0.34,
  slowdownPerApple: 0.1,
  minimumCarryMultiplier: 0.55,
  maxCarriedApples: 3,
  pickupRadius: 1.15,
  pickingTicks: 24,
  pickupRejectTicks: 30,
  kidHitStunTicks: 18,
  kidHitKnockback: 0.72,
  invincibleTicks: 72,
  invincibleSpeedMultiplier: 1.25,
  manualDropLockTicks: 36,
  captureDropLockTicks: 72,
  pounceTicks: 13,
  pounceSpeed: 9,
  recoverTicks: 42,
  pounceCooldownTicks: 36,
  simultaneousPounceTicks: 9,
  stunTicks: 60,
  deliveryRadius: 3.2,
  maxFrameRate: 60,
  maxFrameDelta: 0.1,
  maxDpr: 2,
} as const;

export type Obstacle = Vec2 & {
  halfWidth: number;
  halfDepth: number;
};

export const OBSTACLES: readonly Obstacle[] = [
  { x: -4.1 * ARENA_SCALE, z: -0.8 * ARENA_SCALE, halfWidth: 1.45 * ARENA_SCALE, halfDepth: 0.72 * ARENA_SCALE },
  { x: 2.6 * ARENA_SCALE, z: 1.55 * ARENA_SCALE, halfWidth: 1.35 * ARENA_SCALE, halfDepth: 0.72 * ARENA_SCALE },
  { x: 0.1 * ARENA_SCALE, z: -4.15 * ARENA_SCALE, halfWidth: 1.65 * ARENA_SCALE, halfDepth: 0.68 * ARENA_SCALE },
];

export const DELIVERY_ZONE: Vec2 = { x: 8.1 * ARENA_SCALE, z: 5.35 * ARENA_SCALE };

export const KID_START: Vec2 = { x: -9.1 * ARENA_SCALE, z: 6.25 * ARENA_SCALE };
export const GUARD1_START: Vec2 = { x: -7.6 * ARENA_SCALE, z: -6.25 * ARENA_SCALE };
export const GUARD2_START: Vec2 = { x: 7.3 * ARENA_SCALE, z: -6.25 * ARENA_SCALE };

export const APPLE_SPAWNS: readonly Vec2[] = [
  { x: -8.1 * ARENA_SCALE, z: 3.95 * ARENA_SCALE },
  { x: -3.9 * ARENA_SCALE, z: 3.45 * ARENA_SCALE },
  { x: 0.15 * ARENA_SCALE, z: 3.7 * ARENA_SCALE },
  { x: 5.8 * ARENA_SCALE, z: 1.05 * ARENA_SCALE },
  { x: 8.35 * ARENA_SCALE, z: -3.55 * ARENA_SCALE },
  { x: -7.65 * ARENA_SCALE, z: -4.65 * ARENA_SCALE },
];
