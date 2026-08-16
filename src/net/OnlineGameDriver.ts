import type { Socket } from 'socket.io-client';
import type { GameDriver } from '../game/GameDriver';
import type { MovementTuning } from '../game/config';
import {
  createEmptyCommands,
  type ActorCommand,
  type GameCommands,
  type GameSnapshot,
  type SimulationStep,
} from '../game/types';
import {
  actorsForSeat,
  defaultMovementTuning,
  PROTOCOL_VERSION,
  type ActorId,
  type ClientInputFrame,
  type ClientToServerEvents,
  type RoomSession,
  type SeatId,
  type ServerStateFrame,
  type ServerToClientEvents,
} from './protocol';

type OnlineSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type OnlineDriverDiagnostics = {
  roomCode: string;
  matchId: string;
  seat: SeatId;
  clientTick: number;
  serverTick: number;
  sentInputFrames: number;
  receivedStateFrames: number;
  lastProcessedInputSeq: number;
};

export class OnlineGameDriver implements GameDriver {
  readonly mode = 'online' as const;

  private roomCode: string;
  private matchId: string;
  private seat: SeatId;
  private playerId: string;
  private snapshot: GameSnapshot;
  private clientTick = 0;
  private nextInputSeq = 1;
  private sentInputFrames = 0;
  private receivedStateFrames = 0;
  private lastProcessedInputSeq = 0;
  private readonly pendingSteps: SimulationStep[] = [];
  private readonly seenEventIds = new Set<string>();
  private lastSentActors: Partial<Record<ActorId, ActorCommand>> = {};

  constructor(
    private readonly socket: OnlineSocket,
    session: RoomSession,
  ) {
    this.roomCode = session.room.roomCode;
    this.matchId = session.frame.matchId;
    this.seat = session.seat;
    this.playerId = session.playerId;
    this.snapshot = session.frame.snapshot;
    this.socket.on('state-frame', this.handleStateFrame);
  }

  tick(commands: GameCommands): readonly SimulationStep[] {
    this.clientTick += 1;
    const actors = this.commandsForOwnedActors(commands);
    if (this.shouldSend(actors)) this.sendInputFrame(actors);
    if (this.pendingSteps.length === 0) return [];
    return this.pendingSteps.splice(0, this.pendingSteps.length);
  }

  getSnapshot(): GameSnapshot {
    return this.snapshot;
  }

  getMovementTuning(): Readonly<MovementTuning> {
    return defaultMovementTuning();
  }

  setMovementTuning(_tuning: MovementTuning): void {}

  seed(_value: number): void {}

  loadScenario(_name: string): void {}

  stepForTest(_commands: GameCommands, _ticks: number): readonly SimulationStep[] {
    return [];
  }

  replaceSession(session: RoomSession): void {
    this.roomCode = session.room.roomCode;
    this.matchId = session.frame.matchId;
    this.seat = session.seat;
    this.playerId = session.playerId;
    this.snapshot = session.frame.snapshot;
    this.lastProcessedInputSeq = session.frame.lastProcessedInputSeqByPlayer[this.playerId] ?? 0;
    this.clientTick = 0;
    this.nextInputSeq = Math.max(this.nextInputSeq, this.lastProcessedInputSeq + 1);
    this.lastSentActors = {};
    this.pendingSteps.length = 0;
    this.seenEventIds.clear();
  }

  sendRawInputForTest(frame: ClientInputFrame): void {
    this.socket.emit('input-frame', frame);
  }

  getDiagnostics(): OnlineDriverDiagnostics {
    return {
      roomCode: this.roomCode,
      matchId: this.matchId,
      seat: this.seat,
      clientTick: this.clientTick,
      serverTick: this.snapshot.tick,
      sentInputFrames: this.sentInputFrames,
      receivedStateFrames: this.receivedStateFrames,
      lastProcessedInputSeq: this.lastProcessedInputSeq,
    };
  }

  dispose(): void {
    this.socket.off('state-frame', this.handleStateFrame);
    this.pendingSteps.length = 0;
  }

  private readonly handleStateFrame = (frame: ServerStateFrame): void => {
    if (frame.roomCode !== this.roomCode) return;
    if (frame.matchId !== this.matchId) {
      this.matchId = frame.matchId;
      this.seenEventIds.clear();
      this.pendingSteps.length = 0;
    } else if (frame.serverTick <= this.snapshot.tick) {
      return;
    }

    this.snapshot = frame.snapshot;
    this.receivedStateFrames += 1;
    this.lastProcessedInputSeq = frame.lastProcessedInputSeqByPlayer[this.playerId] ?? 0;
    const events = frame.events.filter((event) => {
      if (this.seenEventIds.has(event.eventId)) return false;
      this.seenEventIds.add(event.eventId);
      return true;
    });
    this.pendingSteps.push({ snapshot: frame.snapshot, events });
  };

  private commandsForOwnedActors(commands: GameCommands): Partial<Record<ActorId, ActorCommand>> {
    const actors: Partial<Record<ActorId, ActorCommand>> = {};
    for (const actorId of actorsForSeat(this.seat)) actors[actorId] = { ...commands[actorId] };
    return actors;
  }

  private shouldSend(actors: Partial<Record<ActorId, ActorCommand>>): boolean {
    if (!this.socket.connected) return false;
    const edgePressed = Object.values(actors).some((command) =>
      command?.actionPressed || command?.dropPressed);
    const heldChanged = !sameHeldCommands(actors, this.lastSentActors);
    return edgePressed || heldChanged || this.clientTick % 2 === 0;
  }

  private sendInputFrame(actors: Partial<Record<ActorId, ActorCommand>>): void {
    const frame: ClientInputFrame = {
      protocolVersion: PROTOCOL_VERSION,
      matchId: this.matchId,
      seq: this.nextInputSeq,
      clientTick: this.clientTick,
      actors,
    };
    this.nextInputSeq += 1;
    this.sentInputFrames += 1;
    this.lastSentActors = cloneHeldActors(actors);
    this.socket.emit('input-frame', frame);
  }
}

function cloneHeldActors(
  actors: Partial<Record<ActorId, ActorCommand>>,
): Partial<Record<ActorId, ActorCommand>> {
  const commands = createEmptyCommands();
  const result: Partial<Record<ActorId, ActorCommand>> = {};
  for (const actorId of Object.keys(actors) as ActorId[]) {
    result[actorId] = {
      ...commands[actorId],
      ...actors[actorId],
      actionPressed: false,
      dropPressed: false,
    };
  }
  return result;
}

function sameHeldCommands(
  first: Partial<Record<ActorId, ActorCommand>>,
  second: Partial<Record<ActorId, ActorCommand>>,
): boolean {
  for (const actorId of ['guard1', 'guard2', 'kid'] as const) {
    const firstCommand = first[actorId];
    const secondCommand = second[actorId];
    if (firstCommand === undefined && secondCommand === undefined) continue;
    if (firstCommand === undefined || secondCommand === undefined) return false;
    if (firstCommand.moveX !== secondCommand.moveX || firstCommand.moveZ !== secondCommand.moveZ) {
      return false;
    }
  }
  return true;
}
