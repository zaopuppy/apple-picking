import type { MovementTuning } from './config';
import type { OrchardMap } from './maps/OrchardMap';
import type {
  AppleState,
  GuardState,
  KidState,
  MatchState,
  Vec2,
} from './types';

export const SIMULATION_CHECKPOINT_VERSION = 1;

export type GuardCheckpoint = {
  id: 'guard1' | 'guard2';
  position: Vec2;
  previousPosition: Vec2;
  facing: Vec2;
  state: GuardState;
  stateTicks: number;
  cooldownTicks: number;
  pounceStartedTick: number;
};

export type KidCheckpoint = {
  position: Vec2;
  previousPosition: Vec2;
  facing: Vec2;
  state: KidState;
  stateTicks: number;
  carriedAppleIds: number[];
  pickingTargetId: number | null;
};

export type AppleCheckpoint = {
  id: number;
  state: AppleState;
  position: Vec2;
  lockTicks: number;
};

export type SimulationCheckpoint = {
  version: typeof SIMULATION_CHECKPOINT_VERSION;
  mapId: string;
  mapVersion: OrchardMap['version'];
  tick: number;
  playTicks: number;
  matchState: MatchState;
  countdownTicks: number;
  catches: number;
  rngState: number;
  dropSerial: number;
  movementTuning: MovementTuning;
  guards: [GuardCheckpoint, GuardCheckpoint];
  kid: KidCheckpoint;
  apples: AppleCheckpoint[];
};
