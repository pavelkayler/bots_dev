import type { FastifyInstance } from 'fastify';
import type { HelloMessage, TickMessage, EventsAppendMessage, SessionStateMessage, ErrorMessage, SnapshotMessage } from '../types/dto';
import type { SessionManager } from '../engine/SessionManager';

type OutboundMessage = TickMessage | EventsAppendMessage | SessionStateMessage | ErrorMessage | SnapshotMessage | HelloMessage;
type WsSocket = {
  readyState: number;
  send: (payload: string) => void;
  on: (event: 'close', listener: () => void) => void;
};
type WsConnection = { socket: WsSocket };
const SOCKET_OPEN = 1;

export class WsHub {
  private clients = new Set<WsSocket>();

  constructor(private readonly sessionManager: SessionManager) {
    this.sessionManager.onTick((message) => this.broadcast(message));
    this.sessionManager.onEventsAppend((message) => this.broadcast(message));
    this.sessionManager.onSessionState((message) => this.broadcast(message));
    this.sessionManager.onError((message) => this.broadcast(message));
  }

  attachRoutes(app: FastifyInstance): void {
    app.get('/ws', { websocket: true }, (connection: WsConnection) => {
      const socket = connection.socket;
      this.clients.add(socket);

      this.send(socket, this.makeHello());
      this.send(socket, this.sessionManager.getSnapshot());

      socket.on('close', () => {
        this.clients.delete(socket);
      });
    });
  }

  getConnectedClientsCount(): number {
    return this.clients.size;
  }

  private makeHello(): HelloMessage {
    return {
      type: 'hello',
      ts: Date.now(),
      protocolVersion: 1,
      server: { name: 'bybit-paper-bot', env: 'local' },
    };
  }

  private broadcast(message: OutboundMessage): void {
    const payload = JSON.stringify(message);
    for (const socket of this.clients) {
      if (socket.readyState === SOCKET_OPEN) {
        socket.send(payload);
      }
    }
  }

  private send(socket: WsSocket, message: OutboundMessage): void {
    if (socket.readyState === SOCKET_OPEN) {
      socket.send(JSON.stringify(message));
    }
  }
}
