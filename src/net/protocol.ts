import { DEFAULT_MOVEMENT_TUNING, type MovementTuning } from '../game/config';
import type { OrchardMap } from '../game/maps/OrchardMap';
import type {
  ActorCommand,
  GameEvent,
  GameSnapshot,
} from '../game/types';

export const PROTOCOL_VERSION = 2;
export const BUILD_VERSION = '0.3.0-smooth-online-demo';
export const INPUT_STALE_MS = 250;
export const RECONNECT_GRACE_MS = 15_000;

export type ActorId = 'guard1' | 'guard2' | 'kid';
export type SeatId = 'guards' | 'kid';
export type RoomPhase =
  | 'lobby'
  | 'countdown'
  | 'playing'
  | 'reconnecting'
  | 'finished'
  | 'abandoned';

export type PlayerSummary = {
  playerId: string;
  seat: SeatId;
  ready: boolean;
  connected: boolean;
};

export type RoomState = {
  protocolVersion: typeof PROTOCOL_VERSION;
  buildVersion: typeof BUILD_VERSION;
  roomCode: string;
  phase: RoomPhase;
  matchId: string;
  mapId: string;
  mapHash: string;
  players: PlayerSummary[];
  reconnectDeadlineMs: number | null;
};

export type NetworkGameEvent = GameEvent & {
  eventId: string;
  tick: number;
};

export type ServerStateFrame = {
  protocolVersion: typeof PROTOCOL_VERSION;
  buildVersion: typeof BUILD_VERSION;
  roomCode: string;
  matchId: string;
  serverTick: number;
  sentAtMs: number;
  lastProcessedInputSeqByPlayer: Record<string, number>;
  lastAppliedClientTickByPlayer: Record<string, number>;
  snapshot: GameSnapshot;
  events: NetworkGameEvent[];
};

export type ClientInputFrame = {
  protocolVersion: typeof PROTOCOL_VERSION;
  matchId: string;
  seq: number;
  clientTick: number;
  actors: Partial<Record<ActorId, ActorCommand>>;
};

export type CreateRoomRequest = {
  protocolVersion: typeof PROTOCOL_VERSION;
  buildVersion: typeof BUILD_VERSION;
  seat: SeatId;
};

export type JoinRoomRequest = {
  protocolVersion: typeof PROTOCOL_VERSION;
  buildVersion: typeof BUILD_VERSION;
  roomCode: string;
  seat: SeatId;
  playerId?: string;
  rejoinToken?: string;
};

export type ReadyRequest = {
  ready: boolean;
};

export type LeaveRoomRequest = {
  reason: 'player-left' | 'return-local';
};

export type RoomSession = {
  playerId: string;
  rejoinToken: string;
  seat: SeatId;
  room: RoomState;
  map: OrchardMap;
  frame: ServerStateFrame;
};

export type RoomErrorCode =
  | 'BAD_REQUEST'
  | 'VERSION_MISMATCH'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_FULL'
  | 'SEAT_TAKEN'
  | 'ROOM_CLOSED'
  | 'NOT_IN_ROOM';

export type RoomError = {
  code: RoomErrorCode;
  message: string;
};

export type RoomActionResponse =
  | { ok: true; session: RoomSession }
  | { ok: false; error: RoomError };

export type BasicActionResponse =
  | { ok: true }
  | { ok: false; error: RoomError };

export interface ClientToServerEvents {
  'create-room': (
    request: CreateRoomRequest,
    acknowledge: (response: RoomActionResponse) => void,
  ) => void;
  'join-room': (
    request: JoinRoomRequest,
    acknowledge: (response: RoomActionResponse) => void,
  ) => void;
  'set-ready': (
    request: ReadyRequest,
    acknowledge: (response: BasicActionResponse) => void,
  ) => void;
  'leave-room': (
    request: LeaveRoomRequest,
    acknowledge: (response: BasicActionResponse) => void,
  ) => void;
  'input-frame': (frame: ClientInputFrame) => void;
}

export interface ServerToClientEvents {
  'room-state': (state: RoomState) => void;
  'state-frame': (frame: ServerStateFrame) => void;
  'room-error': (error: RoomError) => void;
}

export interface InterServerEvents {}

export interface SocketData {
  roomCode?: string;
  playerId?: string;
}

export function actorsForSeat(seat: SeatId): readonly ActorId[] {
  return seat === 'guards' ? ['guard1', 'guard2'] : ['kid'];
}

export function isSeatId(value: unknown): value is SeatId {
  return value === 'guards' || value === 'kid';
}

export function isCompatibleClient(
  protocolVersion: unknown,
  buildVersion: unknown,
): boolean {
  return protocolVersion === PROTOCOL_VERSION && buildVersion === BUILD_VERSION;
}

export function parseClientInputFrame(value: unknown): ClientInputFrame | null {
  if (!isRecord(value) || value.protocolVersion !== PROTOCOL_VERSION) return null;
  if (typeof value.matchId !== 'string' || value.matchId.length > 80) return null;
  if (!isSafeSequence(value.seq) || !isSafeSequence(value.clientTick)) return null;
  if (!isRecord(value.actors)) return null;

  const actors: Partial<Record<ActorId, ActorCommand>> = {};
  for (const actorId of ['guard1', 'guard2', 'kid'] as const) {
    const command = value.actors[actorId];
    if (command === undefined) continue;
    const parsed = parseActorCommand(command);
    if (!parsed) return null;
    actors[actorId] = parsed;
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    matchId: value.matchId,
    seq: value.seq,
    clientTick: value.clientTick,
    actors,
  };
}

export function parseSeatRequest(value: unknown): SeatId | null {
  if (!isRecord(value) || !isSeatId(value.seat)) return null;
  return value.seat;
}

export function parseReadyRequest(value: unknown): ReadyRequest | null {
  if (!isRecord(value) || typeof value.ready !== 'boolean') return null;
  return { ready: value.ready };
}

export function defaultMovementTuning(): MovementTuning {
  return { ...DEFAULT_MOVEMENT_TUNING };
}

function parseActorCommand(value: unknown): ActorCommand | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.moveX) || !isFiniteNumber(value.moveZ)) return null;
  if (typeof value.actionPressed !== 'boolean' || typeof value.dropPressed !== 'boolean') return null;
  let moveX = clamp(value.moveX, -1, 1);
  let moveZ = clamp(value.moveZ, -1, 1);
  const length = Math.hypot(moveX, moveZ);
  if (length > 1) {
    moveX /= length;
    moveZ /= length;
  }
  return {
    moveX,
    moveZ,
    actionPressed: value.actionPressed,
    dropPressed: value.dropPressed,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isSafeSequence(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
