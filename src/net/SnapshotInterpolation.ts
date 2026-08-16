import { TICKS_PER_SECOND } from '../game/config';
import type {
  AppleSnapshot,
  GameSnapshot,
  GuardSnapshot,
  KidSnapshot,
  Vec2,
} from '../game/types';

export const DEFAULT_INTERPOLATION_DELAY_TICKS = 6;
const MAX_BUFFERED_SNAPSHOTS = 32;
const MAX_EXTRAPOLATION_TICKS = 2;

type BufferedSnapshot = {
  snapshot: GameSnapshot;
  receivedAtMs: number;
};

export type SnapshotTimelineSample = {
  snapshot: GameSnapshot;
  renderTick: number;
  interpolationAlpha: number;
  bufferedFrames: number;
};

export class SnapshotTimeline {
  private readonly frames: BufferedSnapshot[] = [];
  private lastRenderTick = Number.NEGATIVE_INFINITY;
  private lastSampleAtMs: number | null = null;

  constructor(
    initialSnapshot: GameSnapshot,
    receivedAtMs: number,
    private readonly delayTicks = DEFAULT_INTERPOLATION_DELAY_TICKS,
  ) {
    this.reset(initialSnapshot, receivedAtMs);
  }

  reset(snapshot: GameSnapshot, receivedAtMs: number): void {
    this.frames.length = 0;
    this.frames.push({ snapshot: cloneSnapshot(snapshot), receivedAtMs });
    this.lastRenderTick = Number.NEGATIVE_INFINITY;
    this.lastSampleAtMs = null;
  }

  push(snapshot: GameSnapshot, receivedAtMs: number): boolean {
    const latest = this.frames[this.frames.length - 1];
    if (latest && snapshot.tick <= latest.snapshot.tick) return false;
    this.frames.push({ snapshot: cloneSnapshot(snapshot), receivedAtMs });
    if (this.frames.length > MAX_BUFFERED_SNAPSHOTS) this.frames.shift();
    return true;
  }

  sample(nowMs: number): SnapshotTimelineSample {
    const latest = this.frames[this.frames.length - 1];
    if (!latest) throw new Error('Snapshot timeline has no frames.');
    if (this.frames.length === 1) {
      this.lastSampleAtMs = nowMs;
      return {
        snapshot: cloneSnapshot(latest.snapshot),
        renderTick: latest.snapshot.tick,
        interpolationAlpha: 1,
        bufferedFrames: 1,
      };
    }

    const elapsedTicks = Math.max(0, nowMs - latest.receivedAtMs) * TICKS_PER_SECOND / 1000;
    const rawRenderTick = latest.snapshot.tick + elapsedTicks - this.delayTicks;
    const maximumRenderTick = latest.snapshot.tick + MAX_EXTRAPOLATION_TICKS;
    let renderTick = rawRenderTick;
    if (Number.isFinite(this.lastRenderTick) && this.lastSampleAtMs !== null) {
      const nominalAdvance = Math.max(0, nowMs - this.lastSampleAtMs) * TICKS_PER_SECOND / 1000;
      const desiredAdvance = Math.max(0, rawRenderTick - this.lastRenderTick);
      const minimumAdvance = nominalAdvance * 0.85;
      const maximumAdvance = nominalAdvance * 1.15;
      renderTick = this.lastRenderTick + clamp(desiredAdvance, minimumAdvance, maximumAdvance);
    }
    renderTick = Math.min(renderTick, maximumRenderTick);
    this.lastRenderTick = renderTick;
    this.lastSampleAtMs = nowMs;

    const first = this.frames[0];
    if (renderTick <= first.snapshot.tick) {
      return {
        snapshot: cloneSnapshot(first.snapshot),
        renderTick,
        interpolationAlpha: 0,
        bufferedFrames: this.frames.length,
      };
    }

    for (let index = 1; index < this.frames.length; index += 1) {
      const to = this.frames[index];
      if (renderTick > to.snapshot.tick) continue;
      const from = this.frames[index - 1];
      const span = Math.max(1, to.snapshot.tick - from.snapshot.tick);
      const alpha = clamp((renderTick - from.snapshot.tick) / span, 0, 1);
      return {
        snapshot: interpolateSnapshots(from.snapshot, to.snapshot, alpha),
        renderTick,
        interpolationAlpha: alpha,
        bufferedFrames: this.frames.length,
      };
    }

    const to = latest.snapshot;
    const from = this.frames[this.frames.length - 2].snapshot;
    const span = Math.max(1, to.tick - from.tick);
    const alpha = clamp((renderTick - from.tick) / span, 0, 1 + MAX_EXTRAPOLATION_TICKS / span);
    return {
      snapshot: interpolateSnapshots(from, to, alpha),
      renderTick,
      interpolationAlpha: alpha,
      bufferedFrames: this.frames.length,
    };
  }
}

export function cloneSnapshot(snapshot: GameSnapshot): GameSnapshot {
  return {
    ...snapshot,
    guards: [cloneGuard(snapshot.guards[0]), cloneGuard(snapshot.guards[1])],
    kid: cloneKid(snapshot.kid),
    apples: snapshot.apples.map(cloneApple),
  };
}

export function interpolateSnapshots(
  from: GameSnapshot,
  to: GameSnapshot,
  alpha: number,
): GameSnapshot {
  const useTo = alpha >= 1;
  const discrete = useTo ? to : from;
  return {
    ...discrete,
    tick: Math.round(lerp(from.tick, to.tick, alpha)),
    playTicks: Math.round(lerp(from.playTicks, to.playTicks, alpha)),
    elapsedSeconds: lerp(from.elapsedSeconds, to.elapsedSeconds, alpha),
    countdownTicks: Math.max(0, Math.round(lerp(from.countdownTicks, to.countdownTicks, alpha))),
    guards: [
      interpolateGuard(from.guards[0], to.guards[0], alpha),
      interpolateGuard(from.guards[1], to.guards[1], alpha),
    ],
    kid: interpolateKid(from.kid, to.kid, alpha),
    apples: interpolateApples(from.apples, to.apples, alpha),
  };
}

function interpolateGuard(from: GuardSnapshot, to: GuardSnapshot, alpha: number): GuardSnapshot {
  const discrete = alpha >= 1 ? to : from;
  return {
    ...discrete,
    position: lerpVec2(from.position, to.position, alpha),
    facing: normalizedLerp(from.facing, to.facing, alpha),
    stateTicks: Math.max(0, Math.round(lerp(from.stateTicks, to.stateTicks, alpha))),
    cooldownTicks: Math.max(0, Math.round(lerp(from.cooldownTicks, to.cooldownTicks, alpha))),
    movementAmount: clamp(lerp(from.movementAmount, to.movementAmount, alpha), 0, 1),
  };
}

function interpolateKid(from: KidSnapshot, to: KidSnapshot, alpha: number): KidSnapshot {
  const discrete = alpha >= 1 ? to : from;
  return {
    ...discrete,
    carriedAppleIds: [...discrete.carriedAppleIds],
    position: lerpVec2(from.position, to.position, alpha),
    facing: normalizedLerp(from.facing, to.facing, alpha),
    stateTicks: Math.max(0, Math.round(lerp(from.stateTicks, to.stateTicks, alpha))),
    pickingProgress: clamp(lerp(from.pickingProgress, to.pickingProgress, alpha), 0, 1),
    speed: Math.max(0, lerp(from.speed, to.speed, alpha)),
    movementAmount: clamp(lerp(from.movementAmount, to.movementAmount, alpha), 0, 1),
  };
}

function interpolateApples(
  from: readonly AppleSnapshot[],
  to: readonly AppleSnapshot[],
  alpha: number,
): AppleSnapshot[] {
  const fromById = new Map(from.map((apple) => [apple.id, apple]));
  return to.map((toApple) => {
    const fromApple = fromById.get(toApple.id);
    if (!fromApple) return cloneApple(toApple);
    const discrete = alpha >= 1 ? toApple : fromApple;
    return {
      ...discrete,
      position: lerpVec2(fromApple.position, toApple.position, alpha),
      lockTicks: Math.max(0, Math.round(lerp(fromApple.lockTicks, toApple.lockTicks, alpha))),
    };
  });
}

function cloneGuard(guard: GuardSnapshot): GuardSnapshot {
  return {
    ...guard,
    position: { ...guard.position },
    facing: { ...guard.facing },
  };
}

function cloneKid(kid: KidSnapshot): KidSnapshot {
  return {
    ...kid,
    position: { ...kid.position },
    facing: { ...kid.facing },
    carriedAppleIds: [...kid.carriedAppleIds],
  };
}

function cloneApple(apple: AppleSnapshot): AppleSnapshot {
  return {
    ...apple,
    position: { ...apple.position },
  };
}

function lerpVec2(from: Vec2, to: Vec2, alpha: number): Vec2 {
  return {
    x: lerp(from.x, to.x, alpha),
    z: lerp(from.z, to.z, alpha),
  };
}

function normalizedLerp(from: Vec2, to: Vec2, alpha: number): Vec2 {
  const result = lerpVec2(from, to, alpha);
  const length = Math.hypot(result.x, result.z);
  if (length <= 0.00001) return { x: 0, z: 0 };
  return { x: result.x / length, z: result.z / length };
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
