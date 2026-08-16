import { createServer } from 'node:http';
import { Server } from 'socket.io';
import {
  type ClientToServerEvents,
  type InterServerEvents,
  type ServerToClientEvents,
  type SocketData,
} from '../src/net/protocol';
import { RoomManager } from './RoomManager';

const requestedPort = Number(process.env.APPLE_PICKING_SERVER_PORT ?? 5190);
const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : 5190;

const httpServer = createServer((request, response) => {
  if (request.url === '/healthz') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, ...roomManager.getDiagnostics() }));
    return;
  }
  response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  response.end('Apple Picking multiplayer demo server');
});

const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: { origin: true, credentials: false },
  serveClient: false,
});
const roomManager = new RoomManager(io);

httpServer.listen(port, '0.0.0.0', () => {
  console.log(`[multiplayer] HTTP + WebSocket demo server listening on http://127.0.0.1:${port}`);
});

const shutdown = (): void => {
  roomManager.dispose();
  io.close();
  httpServer.close(() => process.exit(0));
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
