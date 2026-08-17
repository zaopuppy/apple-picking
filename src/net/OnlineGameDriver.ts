import type { Socket } from 'socket.io-client';
import type { GameDriver } from '../game/GameDriver';
import { GameSimulation } from '../game/GameSimulation';
import type { MovementTuning } from '../game/config';
import {
  createEmptyCommands,
  type ActorCommand,
  type GameCommands,
  type GameSnapshot,
  type SimulationStep,
  type Vec2,
} from '../game/types';
import {
  applyOwnedPrediction,
  createPredictionSimulation,
  predictionCommands,
  replayFromAuthoritativeFrame,
  type LocalInputSample,
} from './CheckpointPrediction';
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
import {
  DEFAULT_INTERPOLATION_DELAY_TICKS,
  SnapshotTimeline,
  cloneSnapshot,
} from './SnapshotInterpolation';

type OnlineSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type OnlineDriverDiagnostics = {
  predictionMode: 'checkpoint-replay';
  roomCode: string;
  matchId: string;
  seat: SeatId;
  clientTick: number;
  serverTick: number;
  sentInputFrames: number;
  receivedStateFrames: number;
  lastProcessedInputSeq: number;
  lastAppliedClientTick: number;
  renderTick: number;
  bufferedStateFrames: number;
  interpolationAlpha: number;
  predictionReplayTicks: number;
  predictionTick: number;
  lastCorrectionDistance: number;
  maxCorrectionDistance: number;
  simulatedStateLatencyMs: number;
  simulatedStateJitterMs: number;
};

export type OnlineGameDriverOptions = {
  now?: () => number;
  interpolationDelayTicks?: number;
};

const MAX_INPUT_HISTORY_TICKS = 180;
const MAX_CORRECTION_SPEED = 2;

export class OnlineGameDriver implements GameDriver {
  readonly mode = 'online' as const;

  private roomCode: string;
  private matchId: string;
  private seat: SeatId;
  private playerId: string;
  private predictionSimulation: GameSimulation;
  private predictedSnapshot: GameSnapshot;
  private previousPredictedSnapshot: GameSnapshot;
  private lastAppliedCommands: GameCommands;
  private authoritativeSnapshot: GameSnapshot;
  private renderSnapshot: GameSnapshot;
  private readonly now: () => number;
  private timeline: SnapshotTimeline;
  private clientTick = 0;
  private nextInputSeq = 1;
  private sentInputFrames = 0;
  private receivedStateFrames = 0;
  private lastProcessedInputSeq = 0;
  private lastAppliedClientTick = 0;
  private renderTick = 0;
  private bufferedStateFrames = 1;
  private interpolationAlpha = 1;
  private predictionReplayTicks = 0;
  private lastCorrectionDistance = 0;
  private maxCorrectionDistance = 0;
  private simulatedStateLatencyMs = 0;
  private simulatedStateJitterMs = 0;
  private delayedFrameSerial = 0;
  private lastSnapshotAtMs: number;
  private readonly predictionCorrectionOffsets: Record<ActorId, Vec2> = {
    guard1: { x: 0, z: 0 },
    guard2: { x: 0, z: 0 },
    kid: { x: 0, z: 0 },
  };
  private readonly pendingSteps: SimulationStep[] = [];
  private readonly seenEventIds = new Set<string>();
  private readonly inputHistory: LocalInputSample[] = [];
  private readonly delayedFrameTimers = new Set<ReturnType<typeof setTimeout>>();
  private lastSentActors: Partial<Record<ActorId, ActorCommand>> = {};

  constructor(
    private readonly socket: OnlineSocket,
    session: RoomSession,
    options: OnlineGameDriverOptions = {},
  ) {
    this.now = options.now ?? (() => performance.now());
    this.roomCode = session.room.roomCode;
    this.matchId = session.frame.matchId;
    this.seat = session.seat;
    this.playerId = session.playerId;
    this.predictionSimulation = createPredictionSimulation(session.map, session.frame);
    this.predictedSnapshot = this.predictionSimulation.getSnapshot();
    this.previousPredictedSnapshot = cloneSnapshot(this.predictedSnapshot);
    this.lastAppliedCommands = cloneCommands(session.frame.appliedCommands);
    this.authoritativeSnapshot = cloneSnapshot(session.frame.snapshot);
    this.renderSnapshot = cloneSnapshot(session.frame.snapshot);
    this.lastSnapshotAtMs = this.now();
    this.timeline = new SnapshotTimeline(
      session.frame.snapshot,
      this.lastSnapshotAtMs,
      options.interpolationDelayTicks ?? DEFAULT_INTERPOLATION_DELAY_TICKS,
    );
    this.socket.on('state-frame', this.handleStateFrame);
  }

  tick(commands: GameCommands): readonly SimulationStep[] {
    this.clientTick += 1;
    const actors = this.commandsForOwnedActors(commands);
    if (this.socket.connected) {
      this.inputHistory.push({
        clientTick: this.clientTick,
        actors: cloneActors(actors, true),
      });
      if (this.inputHistory.length > MAX_INPUT_HISTORY_TICKS) this.inputHistory.shift();
      if (this.predictedSnapshot.matchState === 'Playing') {
        this.previousPredictedSnapshot = this.predictedSnapshot;
        this.predictedSnapshot = this.predictionSimulation.step(
          predictionCommands(this.lastAppliedCommands, this.seat, actors),
        ).snapshot;
      }
      this.predictionReplayTicks = this.inputHistory.length;
      if (this.shouldSend(actors)) this.sendInputFrame(actors);
    }
    if (this.pendingSteps.length === 0) return [];
    return this.pendingSteps.splice(0, this.pendingSteps.length);
  }

  getSnapshot(interpolationAlpha = 1): GameSnapshot {
    const nowMs = this.now();
    const sample = this.timeline.sample(nowMs);
    const nextSnapshot = applyOwnedPrediction(
      sample.snapshot,
      this.predictedSnapshot,
      this.seat,
      this.previousPredictedSnapshot,
      interpolationAlpha,
    );
    this.renderTick = sample.renderTick;
    this.bufferedStateFrames = sample.bufferedFrames;
    this.interpolationAlpha = sample.interpolationAlpha;

    this.applyPredictionCorrection(nextSnapshot, nowMs);
    this.renderSnapshot = nextSnapshot;
    this.lastSnapshotAtMs = nowMs;
    return this.renderSnapshot;
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
    this.predictionSimulation = createPredictionSimulation(session.map, session.frame);
    this.predictedSnapshot = this.predictionSimulation.getSnapshot();
    this.previousPredictedSnapshot = cloneSnapshot(this.predictedSnapshot);
    this.lastAppliedCommands = cloneCommands(session.frame.appliedCommands);
    this.authoritativeSnapshot = cloneSnapshot(session.frame.snapshot);
    this.renderSnapshot = cloneSnapshot(session.frame.snapshot);
    this.lastProcessedInputSeq = session.frame.lastProcessedInputSeqByPlayer[this.playerId] ?? 0;
    this.lastAppliedClientTick = session.frame.lastAppliedClientTickByPlayer[this.playerId] ?? 0;
    this.clientTick = this.lastAppliedClientTick;
    this.nextInputSeq = Math.max(this.nextInputSeq, this.lastProcessedInputSeq + 1);
    this.lastSentActors = {};
    this.inputHistory.length = 0;
    this.pendingSteps.length = 0;
    this.seenEventIds.clear();
    this.clearDelayedFrames();
    this.lastCorrectionDistance = 0;
    this.maxCorrectionDistance = 0;
    this.clearPredictionCorrection();
    this.lastSnapshotAtMs = this.now();
    this.timeline.reset(session.frame.snapshot, this.lastSnapshotAtMs);
  }

  sendRawInputForTest(frame: ClientInputFrame): void {
    this.socket.emit('input-frame', frame);
  }

  getDiagnostics(): OnlineDriverDiagnostics {
    return {
      predictionMode: 'checkpoint-replay',
      roomCode: this.roomCode,
      matchId: this.matchId,
      seat: this.seat,
      clientTick: this.clientTick,
      serverTick: this.authoritativeSnapshot.tick,
      sentInputFrames: this.sentInputFrames,
      receivedStateFrames: this.receivedStateFrames,
      lastProcessedInputSeq: this.lastProcessedInputSeq,
      lastAppliedClientTick: this.lastAppliedClientTick,
      renderTick: this.renderTick,
      bufferedStateFrames: this.bufferedStateFrames,
      interpolationAlpha: this.interpolationAlpha,
      predictionReplayTicks: this.predictionReplayTicks,
      predictionTick: this.predictedSnapshot.tick,
      lastCorrectionDistance: this.lastCorrectionDistance,
      maxCorrectionDistance: this.maxCorrectionDistance,
      simulatedStateLatencyMs: this.simulatedStateLatencyMs,
      simulatedStateJitterMs: this.simulatedStateJitterMs,
    };
  }

  getAuthoritativeSnapshotForTest(): GameSnapshot {
    return cloneSnapshot(this.authoritativeSnapshot);
  }

  setSimulatedNetworkForTest(stateLatencyMs: number, stateJitterMs = 0): void {
    this.simulatedStateLatencyMs = Math.max(0, stateLatencyMs);
    this.simulatedStateJitterMs = Math.max(0, stateJitterMs);
    this.delayedFrameSerial = 0;
  }

  dispose(): void {
    this.socket.off('state-frame', this.handleStateFrame);
    this.pendingSteps.length = 0;
    this.clearDelayedFrames();
  }

  private readonly handleStateFrame = (frame: ServerStateFrame): void => {
    const jitterPattern = [0, 1, -0.5, 0.65, -0.25] as const;
    const jitter = jitterPattern[this.delayedFrameSerial % jitterPattern.length] *
      this.simulatedStateJitterMs;
    this.delayedFrameSerial += 1;
    const delayMs = Math.max(0, this.simulatedStateLatencyMs + jitter);
    if (delayMs <= 0) {
      this.processStateFrame(frame);
      return;
    }
    const timer = setTimeout(() => {
      this.delayedFrameTimers.delete(timer);
      this.processStateFrame(frame);
    }, delayMs);
    this.delayedFrameTimers.add(timer);
  };

  private processStateFrame(frame: ServerStateFrame): void {
    if (frame.roomCode !== this.roomCode) return;
    if (frame.checkpoint.tick !== frame.serverTick || frame.snapshot.tick !== frame.serverTick) return;
    const receivedAtMs = this.now();
    const matchChanged = frame.matchId !== this.matchId;
    if (matchChanged) {
      this.matchId = frame.matchId;
      this.seenEventIds.clear();
      this.pendingSteps.length = 0;
      this.inputHistory.length = 0;
      this.authoritativeSnapshot = cloneSnapshot(frame.snapshot);
      this.renderSnapshot = cloneSnapshot(frame.snapshot);
      this.timeline.reset(frame.snapshot, receivedAtMs);
      this.clearPredictionCorrection();
    } else if (frame.serverTick <= this.authoritativeSnapshot.tick) {
      return;
    } else {
      this.authoritativeSnapshot = cloneSnapshot(frame.snapshot);
      this.timeline.push(frame.snapshot, receivedAtMs);
    }

    this.receivedStateFrames += 1;
    this.lastProcessedInputSeq = frame.lastProcessedInputSeqByPlayer[this.playerId] ?? 0;
    this.lastAppliedClientTick = frame.lastAppliedClientTickByPlayer[this.playerId] ?? 0;
    this.lastAppliedCommands = cloneCommands(frame.appliedCommands);
    while (
      this.inputHistory.length > 0 &&
      this.inputHistory[0].clientTick <= this.lastAppliedClientTick
    ) {
      this.inputHistory.shift();
    }
    const prediction = replayFromAuthoritativeFrame(
      this.predictionSimulation,
      frame,
      this.seat,
      this.inputHistory,
      this.lastAppliedClientTick,
    );
    if (!matchChanged) this.recordPredictionCorrection(this.predictedSnapshot, prediction.snapshot);
    this.predictedSnapshot = prediction.snapshot;
    if (matchChanged) this.previousPredictedSnapshot = cloneSnapshot(prediction.snapshot);
    this.predictionReplayTicks = prediction.replayedTicks;
    const events = frame.events.filter((event) => {
      if (this.seenEventIds.has(event.eventId)) return false;
      this.seenEventIds.add(event.eventId);
      return true;
    });
    this.pendingSteps.push({ snapshot: frame.snapshot, events });
  }

  private clearDelayedFrames(): void {
    for (const timer of this.delayedFrameTimers) clearTimeout(timer);
    this.delayedFrameTimers.clear();
  }

  private recordPredictionCorrection(
    previousPrediction: GameSnapshot,
    nextPrediction: GameSnapshot,
  ): void {
    this.lastCorrectionDistance = 0;
    for (const actorId of actorsForSeat(this.seat)) {
      const previous = actorPosition(previousPrediction, actorId);
      const next = actorPosition(nextPrediction, actorId);
      const deltaX = previous.x - next.x;
      const deltaZ = previous.z - next.z;
      const distance = Math.hypot(deltaX, deltaZ);
      const offset = this.predictionCorrectionOffsets[actorId];
      offset.x += deltaX;
      offset.z += deltaZ;
      this.lastCorrectionDistance = Math.max(this.lastCorrectionDistance, distance);
      this.maxCorrectionDistance = Math.max(this.maxCorrectionDistance, distance);
    }
  }

  private applyPredictionCorrection(snapshot: GameSnapshot, nowMs: number): void {
    const deltaSeconds = Math.max(0, nowMs - this.lastSnapshotAtMs) / 1000;
    for (const actorId of actorsForSeat(this.seat)) {
      const offset = this.predictionCorrectionOffsets[actorId];
      const offsetLength = Math.hypot(offset.x, offset.z);
      if (offsetLength > 0.000001) {
        const remaining = Math.max(0, offsetLength - MAX_CORRECTION_SPEED * deltaSeconds);
        const scale = remaining / offsetLength;
        offset.x *= scale;
        offset.z *= scale;
      } else {
        offset.x = 0;
        offset.z = 0;
      }
      const position = actorPosition(snapshot, actorId);
      position.x += offset.x;
      position.z += offset.z;
    }
  }

  private clearPredictionCorrection(): void {
    for (const actorId of ['guard1', 'guard2', 'kid'] as const) {
      this.predictionCorrectionOffsets[actorId].x = 0;
      this.predictionCorrectionOffsets[actorId].z = 0;
    }
  }

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

function cloneCommands(commands: GameCommands): GameCommands {
  return {
    guard1: { ...commands.guard1 },
    guard2: { ...commands.guard2 },
    kid: { ...commands.kid },
    restartPressed: commands.restartPressed,
  };
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

function cloneActors(
  actors: Partial<Record<ActorId, ActorCommand>>,
  includeEdges: boolean,
): Partial<Record<ActorId, ActorCommand>> {
  const result: Partial<Record<ActorId, ActorCommand>> = {};
  for (const actorId of Object.keys(actors) as ActorId[]) {
    const command = actors[actorId];
    if (!command) continue;
    result[actorId] = {
      ...command,
      actionPressed: includeEdges && command.actionPressed,
      dropPressed: includeEdges && command.dropPressed,
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

function actorPosition(snapshot: GameSnapshot, actorId: ActorId): Vec2 {
  if (actorId === 'kid') return snapshot.kid.position;
  return snapshot.guards[actorId === 'guard1' ? 0 : 1].position;
}
