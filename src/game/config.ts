import type { Vec2 } from './types';

export const TICKS_PER_SECOND = 60;
export const FIXED_DELTA_SECONDS = 1 / TICKS_PER_SECOND;

export const GAME_CONFIG = {
  arenaHalfWidth: 12,
  arenaHalfDepth: 9,
  countdownTicks: 3 * TICKS_PER_SECOND,
  catchTarget: 3,
  kidRadius: 0.48,
  guardRadius: 0.55,
  appleRadius: 0.34,
  kidBaseSpeed: 4.8,
  guardSpeed: 4.2,
  slowdownPerApple: 0.1,
  minimumCarryMultiplier: 0.55,
  maxCarriedApples: 3,
  pickupRadius: 1.15,
  pickingTicks: 24,
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
  deliveryRadius: 2,
  maxFrameRate: 60,
  maxFrameDelta: 0.1,
  maxDpr: 2,
} as const;

export type Obstacle = Vec2 & {
  halfWidth: number;
  halfDepth: number;
};

export const OBSTACLES: readonly Obstacle[] = [
  { x: -4.1, z: -0.8, halfWidth: 1.45, halfDepth: 0.72 },
  { x: 2.6, z: 1.55, halfWidth: 1.35, halfDepth: 0.72 },
  { x: 0.1, z: -4.15, halfWidth: 1.65, halfDepth: 0.68 },
];

export const DELIVERY_ZONE: Vec2 = { x: 8.1, z: 5.35 };

export const KID_START: Vec2 = { x: -9.1, z: 6.25 };
export const GUARD1_START: Vec2 = { x: -6.8, z: -6.4 };
export const GUARD2_START: Vec2 = { x: 6.6, z: -6.3 };

export const APPLE_SPAWNS: readonly Vec2[] = [
  { x: -8.1, z: 3.95 },
  { x: -3.9, z: 3.45 },
  { x: 0.15, z: 3.7 },
  { x: 5.8, z: 1.05 },
  { x: 8.35, z: -3.55 },
  { x: -7.65, z: -4.65 },
];
