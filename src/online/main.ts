import { io, type Socket } from 'socket.io-client';
import '../styles.css';
import './styles.css';
import { Game } from '../game/Game';
import { createEmptyCommands } from '../game/types';
import { OnlineGameDriver } from '../net/OnlineGameDriver';
import {
  BUILD_VERSION,
  PROTOCOL_VERSION,
  type ClientInputFrame,
  type ClientToServerEvents,
  type RoomActionResponse,
  type RoomSession,
  type RoomState,
  type SeatId,
  type ServerToClientEvents,
} from '../net/protocol';

type OnlineSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type StoredSession = Pick<RoomSession, 'playerId' | 'rejoinToken' | 'seat'> & {
  roomCode: string;
};

const SESSION_STORAGE_KEY = 'apple-picking.online-session.v1';
const canvas = getElement<HTMLCanvasElement>('#game-canvas');
const lobby = getElement<HTMLElement>('#online-lobby');
const entryView = getElement<HTMLElement>('#lobby-entry-view');
const roomView = getElement<HTMLElement>('#lobby-room-view');
const reconnectView = getElement<HTMLElement>('#lobby-reconnect-view');
const createButton = getElement<HTMLButtonElement>('#create-room-button');
const joinButton = getElement<HTMLButtonElement>('#join-room-button');
const joinCodeInput = getElement<HTMLInputElement>('#join-room-code');
const readyButton = getElement<HTMLButtonElement>('#ready-button');
const leaveButton = getElement<HTMLButtonElement>('#leave-room-button');
const copyButton = getElement<HTMLButtonElement>('#copy-room-code');
const roomCodeValue = getElement<HTMLElement>('#room-code-value');
const roomPhaseMessage = getElement<HTMLElement>('#room-phase-message');
const lobbyError = getElement<HTMLElement>('#lobby-error');
const reconnectMessage = getElement<HTMLElement>('#reconnect-message');
const networkStatus = getElement<HTMLElement>('#network-status');
const networkStatusLabel = getElement<HTMLElement>('#network-status-label');
const networkRoomLabel = getElement<HTMLElement>('#network-room-label');
const buildLabel = getElement<HTMLElement>('#online-build-label');
const guardsSeat = getElement<HTMLElement>('#room-seat-guards');
const kidSeat = getElement<HTMLElement>('#room-seat-kid');
const seatButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-seat]')];

const socket: OnlineSocket = io({ transports: ['websocket', 'polling'] });
let selectedSeat: SeatId = 'guards';
let storedSession = loadStoredSession();
let currentRoom: RoomState | null = null;
let driver: OnlineGameDriver | null = null;
let game: Game | null = null;
let reconnectInFlight = false;
let actionInFlight = false;

buildLabel.textContent = `protocol ${PROTOCOL_VERSION} · ${BUILD_VERSION}`;
setNetworkState('connecting', '连接房间服务', 'HTTP 演示');
installUiHandlers();
installSocketHandlers();
installTestHooks();

function installUiHandlers(): void {
  for (const button of seatButtons) {
    button.addEventListener('click', () => {
      const seat = button.dataset.seat;
      if (seat !== 'guards' && seat !== 'kid') return;
      selectedSeat = seat;
      for (const option of seatButtons) {
        const selected = option.dataset.seat === selectedSeat;
        option.classList.toggle('selected', selected);
        option.setAttribute('aria-pressed', String(selected));
      }
    });
  }

  createButton.addEventListener('click', () => {
    if (actionInFlight) return;
    setActionPending(true);
    socket.emit('create-room', {
      protocolVersion: PROTOCOL_VERSION,
      buildVersion: BUILD_VERSION,
      seat: selectedSeat,
    }, handleRoomAction);
  });

  joinButton.addEventListener('click', joinRequestedRoom);
  joinCodeInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') joinRequestedRoom();
  });
  joinCodeInput.addEventListener('input', () => {
    joinCodeInput.value = normalizeRoomCode(joinCodeInput.value);
  });

  readyButton.addEventListener('click', () => {
    if (!currentRoom || !storedSession || actionInFlight) return;
    const me = currentRoom.players.find((player) => player.playerId === storedSession?.playerId);
    setActionPending(true);
    socket.emit('set-ready', { ready: !me?.ready }, (response) => {
      setActionPending(false);
      if (!response.ok) showError(response.error.message);
    });
  });

  leaveButton.addEventListener('click', () => {
    if (actionInFlight) return;
    setActionPending(true);
    socket.emit('leave-room', { reason: 'player-left' }, () => {
      clearStoredSession();
      window.location.reload();
    });
  });

  copyButton.addEventListener('click', async () => {
    if (!currentRoom) return;
    try {
      await navigator.clipboard.writeText(currentRoom.roomCode);
      copyButton.textContent = '已复制';
      window.setTimeout(() => { copyButton.textContent = '复制'; }, 1200);
    } catch {
      showError(`房间码：${currentRoom.roomCode}`);
    }
  });
}

function installSocketHandlers(): void {
  socket.on('connect', () => {
    setNetworkState('online', '房间服务在线', currentRoom?.roomCode ?? 'HTTP 演示');
    if (storedSession) rejoinStoredSession();
  });
  socket.on('disconnect', () => {
    setNetworkState('offline', '连接已中断', currentRoom?.roomCode ?? '等待重连');
    if (storedSession) showReconnect('连接暂时中断，服务端将暂停比赛并保留座位 15 秒。');
  });
  socket.on('room-state', (state) => {
    if (storedSession && state.roomCode !== storedSession.roomCode) return;
    currentRoom = state;
    renderRoomState(state);
  });
  socket.on('room-error', (error) => showError(error.message));
}

function joinRequestedRoom(): void {
  const roomCode = normalizeRoomCode(joinCodeInput.value);
  if (roomCode.length !== 6) {
    showError('请输入六位房间码。');
    return;
  }
  if (actionInFlight) return;
  setActionPending(true);
  socket.emit('join-room', {
    protocolVersion: PROTOCOL_VERSION,
    buildVersion: BUILD_VERSION,
    roomCode,
    seat: selectedSeat,
  }, handleRoomAction);
}

function rejoinStoredSession(): void {
  if (!storedSession || reconnectInFlight) return;
  reconnectInFlight = true;
  showReconnect('正在使用本标签页的私有凭据找回原座位。');
  socket.emit('join-room', {
    protocolVersion: PROTOCOL_VERSION,
    buildVersion: BUILD_VERSION,
    roomCode: storedSession.roomCode,
    seat: storedSession.seat,
    playerId: storedSession.playerId,
    rejoinToken: storedSession.rejoinToken,
  }, (response) => {
    reconnectInFlight = false;
    if (!response.ok) {
      clearStoredSession();
      showEntry();
      showError(response.error.message);
      return;
    }
    applySession(response.session);
  });
}

function handleRoomAction(response: RoomActionResponse): void {
  setActionPending(false);
  if (!response.ok) {
    showError(response.error.message);
    return;
  }
  applySession(response.session);
}

function applySession(session: RoomSession): void {
  storedSession = {
    playerId: session.playerId,
    rejoinToken: session.rejoinToken,
    seat: session.seat,
    roomCode: session.room.roomCode,
  };
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(storedSession));
  selectedSeat = session.seat;
  currentRoom = session.room;
  showError('');

  if (driver) {
    driver.replaceSession(session);
  } else {
    driver = new OnlineGameDriver(socket, session);
    game = new Game(canvas, { map: session.map, driver });
    game.start();
  }
  setNetworkState('online', '权威房间已连接', session.room.roomCode);
  renderRoomState(session.room);
}

function renderRoomState(room: RoomState): void {
  roomCodeValue.textContent = room.roomCode;
  networkRoomLabel.textContent = `${room.roomCode} · ${seatLabel(storedSession?.seat)}`;
  renderSeat(guardsSeat, room, 'guards');
  renderSeat(kidSeat, room, 'kid');

  const me = room.players.find((player) => player.playerId === storedSession?.playerId);
  readyButton.textContent = me?.ready ? '取消准备' : room.phase === 'finished' ? '再来一局' : '准备';
  readyButton.disabled = !me?.connected || (room.phase !== 'lobby' && room.phase !== 'finished');

  switch (room.phase) {
    case 'lobby':
      roomPhaseMessage.textContent = room.players.length < 2
        ? '等待另一位玩家加入。'
        : '双方点击准备后，由服务端统一开始倒计时。';
      showRoom();
      break;
    case 'countdown':
      hideLobby();
      break;
    case 'playing':
      hideLobby();
      break;
    case 'reconnecting': {
      const seconds = room.reconnectDeadlineMs
        ? Math.max(0, Math.ceil((room.reconnectDeadlineMs - Date.now()) / 1000))
        : 15;
      showReconnect(`有玩家掉线，权威模拟已暂停；座位还会保留约 ${seconds} 秒。`);
      break;
    }
    case 'finished':
      roomPhaseMessage.textContent = '本轮已经结束；双方再次准备即可开新局。';
      showRoom();
      break;
    case 'abandoned':
      roomPhaseMessage.textContent = '玩家未在保留时间内返回，本轮已作废。';
      readyButton.disabled = true;
      showRoom();
      break;
    default:
      assertNever(room.phase);
  }
}

function renderSeat(element: HTMLElement, room: RoomState, seat: SeatId): void {
  const player = room.players.find((candidate) => candidate.seat === seat);
  const detail = element.querySelector<HTMLElement>('small');
  if (!detail) return;
  if (!player) {
    element.dataset.state = 'empty';
    detail.textContent = '等待加入';
  } else if (!player.connected) {
    element.dataset.state = 'offline';
    detail.textContent = '等待重连';
  } else if (player.ready) {
    element.dataset.state = 'ready';
    detail.textContent = player.playerId === storedSession?.playerId ? '你已准备' : '对方已准备';
  } else {
    element.dataset.state = 'joined';
    detail.textContent = player.playerId === storedSession?.playerId ? '这是你' : '已经加入';
  }
}

function showEntry(): void {
  lobby.classList.add('visible');
  entryView.hidden = false;
  roomView.hidden = true;
  reconnectView.hidden = true;
}

function showRoom(): void {
  lobby.classList.add('visible');
  entryView.hidden = true;
  roomView.hidden = false;
  reconnectView.hidden = true;
}

function showReconnect(message: string): void {
  lobby.classList.add('visible');
  entryView.hidden = true;
  roomView.hidden = true;
  reconnectView.hidden = false;
  reconnectMessage.textContent = message;
}

function hideLobby(): void {
  lobby.classList.remove('visible');
}

function setActionPending(pending: boolean): void {
  actionInFlight = pending;
  createButton.disabled = pending;
  joinButton.disabled = pending;
  leaveButton.disabled = pending;
  if (pending) {
    readyButton.disabled = true;
    return;
  }
  const me = currentRoom?.players.find((player) => player.playerId === storedSession?.playerId);
  readyButton.disabled = !me?.connected ||
    (currentRoom?.phase !== 'lobby' && currentRoom?.phase !== 'finished');
}

function setNetworkState(
  state: 'connecting' | 'online' | 'offline',
  label: string,
  detail: string,
): void {
  networkStatus.dataset.state = state;
  networkStatusLabel.textContent = label;
  networkRoomLabel.textContent = detail;
}

function showError(message: string): void {
  lobbyError.textContent = message;
}

function loadStoredSession(): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof value.playerId !== 'string' || typeof value.rejoinToken !== 'string') return null;
    if (value.seat !== 'guards' && value.seat !== 'kid') return null;
    if (typeof value.roomCode !== 'string') return null;
    return {
      playerId: value.playerId,
      rejoinToken: value.rejoinToken,
      seat: value.seat,
      roomCode: normalizeRoomCode(value.roomCode),
    };
  } catch {
    return null;
  }
}

function clearStoredSession(): void {
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  storedSession = null;
  currentRoom = null;
}

function normalizeRoomCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function seatLabel(seat?: SeatId): string {
  return seat === 'guards' ? '守卫队' : seat === 'kid' ? 'kid' : '未选座';
}

function installTestHooks(): void {
  if (!import.meta.env.DEV) return;
  window.__THREE_GAME_ONLINE_TEST_HOOKS__ = {
    getRoomState: () => currentRoom,
    getDriverDiagnostics: () => driver?.getDiagnostics() ?? null,
    sendUnauthorizedGuardInput: () => {
      if (!driver) return;
      const diagnostics = driver.getDiagnostics();
      const command = createEmptyCommands().guard1;
      const frame: ClientInputFrame = {
        protocolVersion: PROTOCOL_VERSION,
        matchId: diagnostics.matchId,
        seq: diagnostics.sentInputFrames + 100_000,
        clientTick: diagnostics.clientTick,
        actors: { guard1: { ...command, moveX: 1 } },
      };
      driver.sendRawInputForTest(frame);
    },
    disconnectTransport: () => {
      socket.io.engine?.close();
    },
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled room phase: ${String(value)}`);
}

function getElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing online UI element: ${selector}`);
  return element;
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    game?.dispose();
    socket.disconnect();
    window.__THREE_GAME_ONLINE_TEST_HOOKS__ = undefined;
  });
}
