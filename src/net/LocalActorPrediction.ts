import { GAME_CONFIG, TICKS_PER_SECOND, type MovementTuning } from '../game/config';
import { constrainCircleToMap } from '../game/MovementCollision';
import type { OrchardMap } from '../game/maps/OrchardMap';
import type {
  ActorCommand,
  GameSnapshot,
  GuardSnapshot,
  KidSnapshot,
  Vec2,
} from '../game/types';
import { actorsForSeat, type ActorId, type SeatId } from './protocol';

export type LocalInputSample = {
  clientTick: number;
  actors: Partial<Record<ActorId, ActorCommand>>;
};

export type LocalPredictionResult = {
  replayedTicks: number;
};

export function applyLocalActorPrediction(
  renderSnapshot: GameSnapshot,
  authoritativeSnapshot: GameSnapshot,
  seat: SeatId,
  map: OrchardMap,
  movementTuning: Readonly<MovementTuning>,
  inputHistory: readonly LocalInputSample[],
  afterClientTick: number,
): LocalPredictionResult {
  if (authoritativeSnapshot.matchState !== 'Playing') return { replayedTicks: 0 };
  const samples = inputHistory.filter((sample) => sample.clientTick > afterClientTick);
  if (samples.length === 0) {
    copyOwnedActors(renderSnapshot, authoritativeSnapshot, seat);
    return { replayedTicks: 0 };
  }

  for (const actorId of actorsForSeat(seat)) {
    if (actorId === 'kid') {
      const predicted = cloneKid(authoritativeSnapshot.kid);
      for (const sample of samples) {
        advanceKid(predicted, sample.actors.kid, map);
      }
      renderSnapshot.kid = predicted;
      continue;
    }

    const guardIndex = actorId === 'guard1' ? 0 : 1;
    const predicted = cloneGuard(authoritativeSnapshot.guards[guardIndex]);
    for (const sample of samples) {
      advanceGuard(predicted, sample.actors[actorId], map, movementTuning);
    }
    renderSnapshot.guards[guardIndex] = predicted;
  }
  return { replayedTicks: samples.length };
}

function copyOwnedActors(
  target: GameSnapshot,
  source: GameSnapshot,
  seat: SeatId,
): void {
  for (const actorId of actorsForSeat(seat)) {
    if (actorId === 'kid') target.kid = cloneKid(source.kid);
    else {
      const index = actorId === 'guard1' ? 0 : 1;
      target.guards[index] = cloneGuard(source.guards[index]);
    }
  }
}

function advanceGuard(
  guard: GuardSnapshot,
  command: ActorCommand | undefined,
  map: OrchardMap,
  movementTuning: Readonly<MovementTuning>,
): void {
  const direction = normalized(command);
  if (guard.state === 'Move' && command?.actionPressed && guard.cooldownTicks === 0) {
    if (lengthSquared(direction) > 0) guard.facing = direction;
    guard.state = 'Pounce';
    guard.stateTicks = GAME_CONFIG.pounceTicks;
  }

  if (guard.state === 'Move') {
    if (lengthSquared(direction) > 0) guard.facing = direction;
    move(
      guard.position,
      direction,
      movementTuning.baseSpeed * movementTuning.guardSpeedMultiplier,
    );
    guard.movementAmount = Math.min(1, Math.hypot(direction.x, direction.z));
  } else if (guard.state === 'Pounce') {
    move(guard.position, guard.facing, GAME_CONFIG.pounceSpeed);
    guard.movementAmount = 1;
  } else {
    guard.movementAmount = 0;
  }
  constrainCircleToMap(map, guard.position, GAME_CONFIG.guardRadius);
  advanceGuardState(guard);
}

function advanceGuardState(guard: GuardSnapshot): void {
  if (guard.state === 'Move') {
    guard.cooldownTicks = Math.max(0, guard.cooldownTicks - 1);
    guard.pounceReady = guard.cooldownTicks === 0;
    return;
  }
  guard.stateTicks = Math.max(0, guard.stateTicks - 1);
  if (guard.stateTicks > 0) {
    guard.pounceReady = false;
    return;
  }
  if (guard.state === 'Pounce') {
    guard.state = 'Recover';
    guard.stateTicks = GAME_CONFIG.recoverTicks;
    guard.pounceReady = false;
    return;
  }
  guard.state = 'Move';
  guard.cooldownTicks = GAME_CONFIG.pounceCooldownTicks;
  guard.pounceReady = false;
}

function advanceKid(
  kid: KidSnapshot,
  command: ActorCommand | undefined,
  map: OrchardMap,
): void {
  const direction = normalized(command);
  if (kid.state !== 'Picking' && kid.state !== 'Hit') {
    if (lengthSquared(direction) > 0) kid.facing = direction;
    move(kid.position, direction, kid.speed);
    kid.movementAmount = Math.min(1, Math.hypot(direction.x, direction.z));
    constrainCircleToMap(map, kid.position, GAME_CONFIG.kidRadius);
  } else {
    kid.movementAmount = 0;
  }

  if (kid.state === 'Normal') return;
  kid.stateTicks = Math.max(0, kid.stateTicks - 1);
  if (kid.stateTicks > 0) return;
  if (kid.state === 'Hit') {
    kid.state = 'Invincible';
    kid.stateTicks = GAME_CONFIG.invincibleTicks;
  } else if (kid.state === 'Invincible' || kid.state === 'Rejecting') {
    kid.state = 'Normal';
  }
}

function move(position: Vec2, direction: Vec2, speed: number): void {
  position.x += direction.x * speed / TICKS_PER_SECOND;
  position.z += direction.z * speed / TICKS_PER_SECOND;
}

function normalized(command: ActorCommand | undefined): Vec2 {
  const x = command?.moveX ?? 0;
  const z = command?.moveZ ?? 0;
  const length = Math.hypot(x, z);
  if (length <= 0.00001) return { x: 0, z: 0 };
  return { x: x / length, z: z / length };
}

function lengthSquared(vector: Vec2): number {
  return vector.x * vector.x + vector.z * vector.z;
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
