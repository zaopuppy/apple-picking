import { GameSimulation } from '../game/GameSimulation';
import type { OrchardMap } from '../game/maps/OrchardMap';
import {
  createEmptyCommands,
  type ActorCommand,
  type GameCommands,
  type GameSnapshot,
} from '../game/types';
import {
  actorsForSeat,
  type ActorId,
  type SeatId,
  type ServerStateFrame,
} from './protocol';
import { cloneSnapshot } from './SnapshotInterpolation';

export type LocalInputSample = {
  clientTick: number;
  actors: Partial<Record<ActorId, ActorCommand>>;
};

export type CheckpointReplayResult = {
  snapshot: GameSnapshot;
  replayedTicks: number;
};

export function createPredictionSimulation(
  map: OrchardMap,
  frame: ServerStateFrame,
): GameSimulation {
  const simulation = new GameSimulation(map);
  simulation.restoreCheckpoint(frame.checkpoint);
  return simulation;
}

export function replayFromAuthoritativeFrame(
  simulation: GameSimulation,
  frame: ServerStateFrame,
  seat: SeatId,
  inputHistory: readonly LocalInputSample[],
  afterClientTick: number,
): CheckpointReplayResult {
  simulation.restoreCheckpoint(frame.checkpoint);
  let replayedTicks = 0;
  for (const sample of inputHistory) {
    if (sample.clientTick <= afterClientTick) continue;
    simulation.step(predictionCommands(frame.appliedCommands, seat, sample.actors));
    replayedTicks += 1;
  }
  return { snapshot: simulation.getSnapshot(), replayedTicks };
}

export function predictionCommands(
  appliedCommands: GameCommands,
  seat: SeatId,
  ownedActors: Partial<Record<ActorId, ActorCommand>>,
): GameCommands {
  const commands = createEmptyCommands();
  for (const actorId of ['guard1', 'guard2', 'kid'] as const) {
    const applied = appliedCommands[actorId];
    commands[actorId] = {
      moveX: applied.moveX,
      moveZ: applied.moveZ,
      actionPressed: false,
      dropPressed: false,
    };
  }
  for (const actorId of actorsForSeat(seat)) {
    const local = ownedActors[actorId];
    if (local) commands[actorId] = { ...local };
  }
  return commands;
}

export function applyOwnedPrediction(
  interpolatedSnapshot: GameSnapshot,
  predictedSnapshot: GameSnapshot,
  seat: SeatId,
  previousPredictedSnapshot: GameSnapshot = predictedSnapshot,
  interpolationAlpha = 1,
): GameSnapshot {
  const result = cloneSnapshot(interpolatedSnapshot);
  const alpha = Math.max(0, Math.min(1, interpolationAlpha));
  for (const actorId of actorsForSeat(seat)) {
    if (actorId === 'kid') {
      result.kid = {
        ...predictedSnapshot.kid,
        position: interpolatePosition(
          previousPredictedSnapshot.kid.position,
          predictedSnapshot.kid.position,
          alpha,
        ),
        facing: { ...predictedSnapshot.kid.facing },
        carriedAppleIds: [...predictedSnapshot.kid.carriedAppleIds],
      };
      continue;
    }
    const index = actorId === 'guard1' ? 0 : 1;
    result.guards[index] = {
      ...predictedSnapshot.guards[index],
      position: interpolatePosition(
        previousPredictedSnapshot.guards[index].position,
        predictedSnapshot.guards[index].position,
        alpha,
      ),
      facing: { ...predictedSnapshot.guards[index].facing },
    };
  }
  return result;
}

function interpolatePosition(
  previous: { x: number; z: number },
  current: { x: number; z: number },
  alpha: number,
): { x: number; z: number } {
  return {
    x: previous.x + (current.x - previous.x) * alpha,
    z: previous.z + (current.z - previous.z) * alpha,
  };
}
