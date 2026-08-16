import { createHash, randomInt } from 'node:crypto';
import { cloneOrchardMap } from '../src/game/maps/OrchardMap';
import { SWEET_ORCHARD_ISLAND_MAP } from '../src/game/maps/IslandTourMap';
import {
  BUILD_VERSION,
  PROTOCOL_VERSION,
  isCompatibleClient,
  isSeatId,
  parseClientInputFrame,
  parseReadyRequest,
  type BasicActionResponse,
  type CreateRoomRequest,
  type JoinRoomRequest,
  type LeaveRoomRequest,
  type RoomActionResponse,
} from '../src/net/protocol';
import { AuthoritativeGameRoom } from './AuthoritativeGameRoom';
import type { GameServer, GameSocket } from './types';

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const EMPTY_ROOM_TTL_MS = 30_000;
const ROOM_SWEEP_MS = 10_000;

export class RoomManager {
  private readonly rooms = new Map<string, AuthoritativeGameRoom>();
  private readonly sweepHandle: ReturnType<typeof setInterval>;

  constructor(private readonly io: GameServer) {
    this.io.on('connection', (socket) => this.installSocketHandlers(socket));
    this.sweepHandle = setInterval(() => this.sweep(), ROOM_SWEEP_MS);
  }

  getDiagnostics(): { rooms: number; connectedPlayers: number } {
    return {
      rooms: this.rooms.size,
      connectedPlayers: [...this.rooms.values()]
        .reduce((total, room) => total + room.connectedPlayerCount(), 0),
    };
  }

  dispose(): void {
    clearInterval(this.sweepHandle);
    for (const room of this.rooms.values()) room.dispose();
    this.rooms.clear();
  }

  private installSocketHandlers(socket: GameSocket): void {
    socket.on('create-room', (request, acknowledge) => {
      acknowledge(this.createRoom(socket, request));
    });
    socket.on('join-room', (request, acknowledge) => {
      acknowledge(this.joinRoom(socket, request));
    });
    socket.on('set-ready', (request, acknowledge) => {
      const parsed = parseReadyRequest(request);
      const room = this.roomForSocket(socket);
      if (!parsed || !room) {
        acknowledge(this.basicError('NOT_IN_ROOM', '尚未加入房间。'));
        return;
      }
      if (!room.setReady(socket.id, parsed.ready)) {
        acknowledge(this.basicError('BAD_REQUEST', '当前房间状态不能更改准备状态。'));
        return;
      }
      acknowledge({ ok: true });
    });
    socket.on('leave-room', (_request: LeaveRoomRequest, acknowledge) => {
      const room = this.roomForSocket(socket);
      if (!room || !room.leave(socket)) {
        acknowledge(this.basicError('NOT_IN_ROOM', '尚未加入房间。'));
        return;
      }
      acknowledge({ ok: true });
    });
    socket.on('input-frame', (rawFrame) => {
      const frame = parseClientInputFrame(rawFrame);
      const room = this.roomForSocket(socket);
      if (!frame || !room) return;
      room.acceptInput(socket.id, frame);
    });
    socket.on('disconnect', () => {
      this.roomForSocket(socket)?.disconnect(socket.id);
    });
  }

  private createRoom(socket: GameSocket, request: CreateRoomRequest): RoomActionResponse {
    if (!isCompatibleClient(request?.protocolVersion, request?.buildVersion)) {
      return this.versionError();
    }
    if (!isSeatId(request?.seat)) return this.requestError('请选择有效角色。');
    this.leaveCurrentRoom(socket);

    const code = this.generateRoomCode();
    const map = cloneOrchardMap(SWEET_ORCHARD_ISLAND_MAP);
    const mapHash = createHash('sha256').update(JSON.stringify(map)).digest('hex').slice(0, 16);
    const room = new AuthoritativeGameRoom(this.io, code, map, mapHash);
    this.rooms.set(code, room);
    return room.join(socket, request.seat);
  }

  private joinRoom(socket: GameSocket, request: JoinRoomRequest): RoomActionResponse {
    if (!isCompatibleClient(request?.protocolVersion, request?.buildVersion)) {
      return this.versionError();
    }
    if (!isSeatId(request?.seat) || typeof request.roomCode !== 'string') {
      return this.requestError('房间码或角色无效。');
    }
    const code = normalizeRoomCode(request.roomCode);
    const room = this.rooms.get(code);
    if (!room) {
      return { ok: false, error: { code: 'ROOM_NOT_FOUND', message: '没有找到这个房间。' } };
    }
    this.leaveCurrentRoom(socket, code);
    const rejoin = typeof request.playerId === 'string' && typeof request.rejoinToken === 'string'
      ? { playerId: request.playerId, rejoinToken: request.rejoinToken }
      : undefined;
    return room.join(socket, request.seat, rejoin);
  }

  private leaveCurrentRoom(socket: GameSocket, exceptCode?: string): void {
    const currentCode = socket.data.roomCode;
    if (!currentCode || currentCode === exceptCode) return;
    this.rooms.get(currentCode)?.leave(socket);
  }

  private roomForSocket(socket: GameSocket): AuthoritativeGameRoom | undefined {
    return socket.data.roomCode ? this.rooms.get(socket.data.roomCode) : undefined;
  }

  private generateRoomCode(): string {
    for (;;) {
      let code = '';
      for (let index = 0; index < 6; index += 1) {
        code += ROOM_CODE_ALPHABET[randomInt(ROOM_CODE_ALPHABET.length)];
      }
      if (!this.rooms.has(code)) return code;
    }
  }

  private sweep(): void {
    for (const [code, room] of this.rooms) {
      if (!room.isEmptyFor(EMPTY_ROOM_TTL_MS)) continue;
      room.dispose();
      this.rooms.delete(code);
    }
  }

  private requestError(message: string): RoomActionResponse {
    return { ok: false, error: { code: 'BAD_REQUEST', message } };
  }

  private versionError(): RoomActionResponse {
    return {
      ok: false,
      error: {
        code: 'VERSION_MISMATCH',
        message: `客户端版本不匹配，需要协议 ${PROTOCOL_VERSION} / 构建 ${BUILD_VERSION}。`,
      },
    };
  }

  private basicError(code: 'BAD_REQUEST' | 'NOT_IN_ROOM', message: string): BasicActionResponse {
    return { ok: false, error: { code, message } };
  }
}

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}
