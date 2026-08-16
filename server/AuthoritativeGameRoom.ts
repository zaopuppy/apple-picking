import { randomUUID } from 'node:crypto';
import { GameSimulation } from '../src/game/GameSimulation';
import { TICKS_PER_SECOND } from '../src/game/config';
import { cloneOrchardMap, type OrchardMap } from '../src/game/maps/OrchardMap';
import {
  createEmptyCommands,
  type ActorCommand,
  type GameCommands,
  type GameEvent,
} from '../src/game/types';
import {
  actorsForSeat,
  BUILD_VERSION,
  INPUT_STALE_MS,
  PROTOCOL_VERSION,
  RECONNECT_GRACE_MS,
  type ActorId,
  type ClientInputFrame,
  type NetworkGameEvent,
  type PlayerSummary,
  type RoomActionResponse,
  type RoomPhase,
  type RoomSession,
  type RoomState,
  type SeatId,
  type ServerStateFrame,
} from '../src/net/protocol';
import type { GameServer, GameSocket } from './types';

const FIXED_STEP_MS = 1000 / TICKS_PER_SECOND;
const PUMP_INTERVAL_MS = 8;
const SNAPSHOT_INTERVAL_TICKS = 3;
const MAX_CATCH_UP_STEPS = 5;

type RoomPlayer = {
  playerId: string;
  rejoinToken: string;
  socketId: string;
  seat: SeatId;
  ready: boolean;
  connected: boolean;
  disconnectDeadlineMs: number | null;
  lastInputAtMs: number;
  lastAcceptedSeq: number;
  lastAppliedSeq: number;
  lastAcceptedClientTick: number;
  lastAppliedClientTick: number;
  latestActors: Partial<Record<ActorId, ActorCommand>>;
  pendingActionActors: Set<ActorId>;
  pendingDropActors: Set<ActorId>;
};

export class AuthoritativeGameRoom {
  readonly map: OrchardMap;
  readonly createdAtMs = Date.now();

  private simulation: GameSimulation;
  private phase: RoomPhase = 'lobby';
  private resumePhase: RoomPhase = 'lobby';
  private matchId = `lobby-${randomUUID()}`;
  private readonly players = new Map<string, RoomPlayer>();
  private readonly pendingEvents: NetworkGameEvent[] = [];
  private readonly pumpHandle: ReturnType<typeof setInterval>;
  private previousPumpMs = performance.now();
  private accumulatorMs = 0;
  private lastActivityMs = Date.now();
  private eventSerial = 0;
  private disposed = false;

  constructor(
    private readonly io: GameServer,
    readonly code: string,
    map: OrchardMap,
    readonly mapHash: string,
  ) {
    this.map = cloneOrchardMap(map);
    this.simulation = this.createSimulation();
    this.pumpHandle = setInterval(() => this.pump(), PUMP_INTERVAL_MS);
  }

  join(
    socket: GameSocket,
    seat: SeatId,
    rejoin?: { playerId: string; rejoinToken: string },
  ): RoomActionResponse {
    this.lastActivityMs = Date.now();
    const returningPlayer = rejoin
      ? this.players.get(rejoin.playerId)
      : undefined;
    if (returningPlayer && returningPlayer.rejoinToken === rejoin?.rejoinToken) {
      returningPlayer.socketId = socket.id;
      returningPlayer.connected = true;
      returningPlayer.disconnectDeadlineMs = null;
      returningPlayer.lastInputAtMs = Date.now();
      this.attachSocket(socket, returningPlayer);
      if (this.phase === 'reconnecting' && this.allAssignedPlayersConnected()) {
        this.phase = this.resumePhase;
        this.accumulatorMs = 0;
        this.previousPumpMs = performance.now();
      }
      const session = this.createSession(returningPlayer);
      this.broadcastRoomState();
      return { ok: true, session };
    }

    if (this.phase !== 'lobby') {
      return this.error('ROOM_CLOSED', '比赛已经开始，只能由原玩家重连。');
    }
    if (this.playerForSeat(seat)) {
      return this.error('SEAT_TAKEN', seat === 'kid' ? 'kid 座位已被占用。' : '守卫队座位已被占用。');
    }
    if (this.players.size >= 2) return this.error('ROOM_FULL', '房间已满。');

    const player: RoomPlayer = {
      playerId: randomUUID(),
      rejoinToken: randomUUID(),
      socketId: socket.id,
      seat,
      ready: false,
      connected: true,
      disconnectDeadlineMs: null,
      lastInputAtMs: Date.now(),
      lastAcceptedSeq: 0,
      lastAppliedSeq: 0,
      lastAcceptedClientTick: 0,
      lastAppliedClientTick: 0,
      latestActors: {},
      pendingActionActors: new Set(),
      pendingDropActors: new Set(),
    };
    this.players.set(player.playerId, player);
    this.attachSocket(socket, player);
    const session = this.createSession(player);
    this.broadcastRoomState();
    return { ok: true, session };
  }

  setReady(socketId: string, ready: boolean): boolean {
    const player = this.playerForSocket(socketId);
    if (!player || !player.connected) return false;
    if (this.phase !== 'lobby' && this.phase !== 'finished') return false;
    player.ready = ready;
    this.lastActivityMs = Date.now();
    if (this.canStartMatch()) this.startMatch();
    else this.broadcastRoomState();
    return true;
  }

  acceptInput(socketId: string, frame: ClientInputFrame): void {
    if (this.phase !== 'countdown' && this.phase !== 'playing') return;
    if (frame.matchId !== this.matchId) return;
    const player = this.playerForSocket(socketId);
    if (!player || frame.seq <= player.lastAcceptedSeq) return;

    const ownedActors = new Set(actorsForSeat(player.seat));
    for (const [actorId, command] of Object.entries(frame.actors) as Array<[ActorId, ActorCommand]>) {
      if (!ownedActors.has(actorId)) continue;
      player.latestActors[actorId] = {
        moveX: command.moveX,
        moveZ: command.moveZ,
        actionPressed: false,
        dropPressed: false,
      };
      if (command.actionPressed) player.pendingActionActors.add(actorId);
      if (command.dropPressed) player.pendingDropActors.add(actorId);
    }
    player.lastAcceptedSeq = frame.seq;
    player.lastAcceptedClientTick = frame.clientTick;
    player.lastInputAtMs = Date.now();
    this.lastActivityMs = player.lastInputAtMs;
  }

  disconnect(socketId: string): void {
    const player = this.playerForSocket(socketId);
    if (!player) return;
    player.connected = false;
    player.ready = false;
    player.latestActors = {};
    player.pendingActionActors.clear();
    player.pendingDropActors.clear();
    player.disconnectDeadlineMs = Date.now() + RECONNECT_GRACE_MS;
    this.lastActivityMs = Date.now();

    if (this.phase === 'countdown' || this.phase === 'playing') {
      this.resumePhase = this.phase;
      this.phase = 'reconnecting';
    }
    this.broadcastRoomState();
  }

  leave(socket: GameSocket): boolean {
    const player = this.playerForSocket(socket.id);
    if (!player) return false;
    this.players.delete(player.playerId);
    socket.leave(this.socketRoomName());
    socket.data.roomCode = undefined;
    socket.data.playerId = undefined;
    if (this.phase !== 'lobby' && this.phase !== 'finished') this.phase = 'abandoned';
    this.lastActivityMs = Date.now();
    this.broadcastRoomState();
    return true;
  }

  getRoomState(): RoomState {
    return {
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: BUILD_VERSION,
      roomCode: this.code,
      phase: this.phase,
      matchId: this.matchId,
      mapId: this.map.id,
      mapHash: this.mapHash,
      players: this.playerSummaries(),
      reconnectDeadlineMs: this.nextReconnectDeadline(),
    };
  }

  isEmptyFor(durationMs: number): boolean {
    return this.players.size === 0 && Date.now() - this.lastActivityMs >= durationMs;
  }

  connectedPlayerCount(): number {
    return [...this.players.values()].filter((player) => player.connected).length;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearInterval(this.pumpHandle);
  }

  private pump(): void {
    if (this.disposed) return;
    this.expireDisconnectedPlayers();
    const now = performance.now();
    const elapsedMs = Math.min(250, Math.max(0, now - this.previousPumpMs));
    this.previousPumpMs = now;
    if (this.phase !== 'countdown' && this.phase !== 'playing') {
      this.accumulatorMs = 0;
      return;
    }

    this.accumulatorMs += elapsedMs;
    let steps = 0;
    while (this.accumulatorMs >= FIXED_STEP_MS && steps < MAX_CATCH_UP_STEPS) {
      this.advanceOneTick();
      this.accumulatorMs -= FIXED_STEP_MS;
      steps += 1;
    }
    if (steps === MAX_CATCH_UP_STEPS && this.accumulatorMs >= FIXED_STEP_MS) {
      this.accumulatorMs = 0;
    }
  }

  private advanceOneTick(): void {
    const step = this.simulation.step(this.buildCommands());
    for (const event of step.events) this.pendingEvents.push(this.networkEvent(event, step.snapshot.tick));

    const nextPhase = step.snapshot.matchState === 'Countdown'
      ? 'countdown'
      : step.snapshot.matchState === 'Playing'
        ? 'playing'
        : 'finished';
    const phaseChanged = nextPhase !== this.phase;
    if (phaseChanged) {
      this.phase = nextPhase;
      if (nextPhase === 'finished') {
        for (const player of this.players.values()) player.ready = false;
      }
      this.broadcastRoomState();
    }

    if (step.snapshot.tick % SNAPSHOT_INTERVAL_TICKS === 0 || phaseChanged || step.events.length > 0) {
      this.broadcastFrame(step.snapshot);
    }
  }

  private buildCommands(): GameCommands {
    const commands = createEmptyCommands();
    const now = Date.now();
    for (const player of this.players.values()) {
      const stale = !player.connected || now - player.lastInputAtMs > INPUT_STALE_MS;
      for (const actorId of actorsForSeat(player.seat)) {
        const held = stale ? undefined : player.latestActors[actorId];
        commands[actorId] = {
          moveX: held?.moveX ?? 0,
          moveZ: held?.moveZ ?? 0,
          actionPressed: !stale && player.pendingActionActors.has(actorId),
          dropPressed: !stale && player.pendingDropActors.has(actorId),
        };
        player.pendingActionActors.delete(actorId);
        player.pendingDropActors.delete(actorId);
      }
      player.lastAppliedSeq = player.lastAcceptedSeq;
      player.lastAppliedClientTick = player.lastAcceptedClientTick;
    }
    return commands;
  }

  private startMatch(): void {
    this.simulation = this.createSimulation();
    this.matchId = `match-${randomUUID()}`;
    this.phase = 'countdown';
    this.resumePhase = 'countdown';
    this.pendingEvents.length = 0;
    this.eventSerial = 0;
    this.accumulatorMs = 0;
    this.previousPumpMs = performance.now();
    for (const player of this.players.values()) {
      player.lastAcceptedSeq = 0;
      player.lastAppliedSeq = 0;
      player.lastAcceptedClientTick = 0;
      player.lastAppliedClientTick = 0;
      player.lastInputAtMs = Date.now();
      player.latestActors = {};
      player.pendingActionActors.clear();
      player.pendingDropActors.clear();
    }
    this.broadcastRoomState();
    this.broadcastFrame(this.simulation.getSnapshot());
  }

  private createSimulation(): GameSimulation {
    const simulation = new GameSimulation(this.map);
    simulation.seed(this.map.seed);
    return simulation;
  }

  private createSession(player: RoomPlayer): RoomSession {
    return {
      playerId: player.playerId,
      rejoinToken: player.rejoinToken,
      seat: player.seat,
      room: this.getRoomState(),
      map: cloneOrchardMap(this.map),
      frame: this.createFrame(this.simulation.getSnapshot(), []),
    };
  }

  private createFrame(snapshot: ServerStateFrame['snapshot'], events: NetworkGameEvent[]): ServerStateFrame {
    return {
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: BUILD_VERSION,
      roomCode: this.code,
      matchId: this.matchId,
      serverTick: snapshot.tick,
      sentAtMs: Date.now(),
      lastProcessedInputSeqByPlayer: Object.fromEntries(
        [...this.players.values()].map((player) => [player.playerId, player.lastAppliedSeq]),
      ),
      lastAppliedClientTickByPlayer: Object.fromEntries(
        [...this.players.values()].map((player) => [player.playerId, player.lastAppliedClientTick]),
      ),
      snapshot,
      events,
    };
  }

  private broadcastFrame(snapshot: ServerStateFrame['snapshot']): void {
    const events = this.pendingEvents.splice(0, this.pendingEvents.length);
    this.io.to(this.socketRoomName()).emit('state-frame', this.createFrame(snapshot, events));
  }

  private broadcastRoomState(): void {
    this.io.to(this.socketRoomName()).emit('room-state', this.getRoomState());
  }

  private attachSocket(socket: GameSocket, player: RoomPlayer): void {
    socket.join(this.socketRoomName());
    socket.data.roomCode = this.code;
    socket.data.playerId = player.playerId;
  }

  private networkEvent(event: GameEvent, tick: number): NetworkGameEvent {
    const eventId = `${this.matchId}:${tick}:${this.eventSerial}`;
    this.eventSerial += 1;
    return { ...event, eventId, tick };
  }

  private canStartMatch(): boolean {
    const guards = this.playerForSeat('guards');
    const kid = this.playerForSeat('kid');
    return Boolean(guards?.connected && guards.ready && kid?.connected && kid.ready);
  }

  private allAssignedPlayersConnected(): boolean {
    return this.players.size > 0 && [...this.players.values()].every((player) => player.connected);
  }

  private expireDisconnectedPlayers(): void {
    const now = Date.now();
    const expired = [...this.players.values()].filter((player) =>
      !player.connected && player.disconnectDeadlineMs !== null && player.disconnectDeadlineMs <= now);
    if (expired.length === 0) return;

    if (this.phase === 'reconnecting') {
      this.phase = 'abandoned';
    }
    for (const player of expired) this.players.delete(player.playerId);
    this.lastActivityMs = now;
    this.broadcastRoomState();
  }

  private playerForSocket(socketId: string): RoomPlayer | undefined {
    return [...this.players.values()].find((player) => player.socketId === socketId);
  }

  private playerForSeat(seat: SeatId): RoomPlayer | undefined {
    return [...this.players.values()].find((player) => player.seat === seat);
  }

  private playerSummaries(): PlayerSummary[] {
    return [...this.players.values()]
      .map((player) => ({
        playerId: player.playerId,
        seat: player.seat,
        ready: player.ready,
        connected: player.connected,
      }))
      .sort((first, second) => first.seat.localeCompare(second.seat));
  }

  private nextReconnectDeadline(): number | null {
    const deadlines = [...this.players.values()]
      .map((player) => player.disconnectDeadlineMs)
      .filter((deadline): deadline is number => deadline !== null);
    return deadlines.length > 0 ? Math.min(...deadlines) : null;
  }

  private socketRoomName(): string {
    return `game:${this.code}`;
  }

  private error(code: 'ROOM_FULL' | 'SEAT_TAKEN' | 'ROOM_CLOSED', message: string): RoomActionResponse {
    return { ok: false, error: { code, message } };
  }
}
