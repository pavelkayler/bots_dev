import type { FastifyInstance } from 'fastify';
import type {
  HelloMessage,
  TickMessage,
  EventsAppendMessage,
  SessionStateMessage,
  ErrorMessage,
  SnapshotMessage,
} from '../types/dto';
import type { SessionManager } from '../engine/SessionManager';
import { getRunLogger, serializeUnknownError } from '../logging/RunLogger';

type OutboundMessage = TickMessage | EventsAppendMessage | SessionStateMessage | ErrorMessage | SnapshotMessage | HelloMessage;
type WsSocket = {
  readyState: number;
  send: (payload: string) => void;
  on: (event: 'close', listener: (code: number, reason: unknown) => void) => void;
};

export class WsHub {
  private clients = new Set<WsSocket>();
  private readonly runLogger = getRunLogger();

  constructor(private readonly sessionManager: SessionManager) {
    this.sessionManager.onTick((message) => this.broadcast(message));
    this.sessionManager.onEventsAppend((message) => this.broadcast(message));
    this.sessionManager.onSessionState((message) => this.broadcast(message));
    this.sessionManager.onError((message) => this.broadcast(message));
  }

  attachRoutes(app: FastifyInstance): void {
    app.get('/ws', { websocket: true }, (socket: WsSocket, request) => {
      this.clients.add(socket);
      this.runLogger.info('ws', 'client_connected', {
        remoteAddress: request.ip,
        clientsConnected: this.clients.size,
      });

      this.sendInitialMessages(socket);

      socket.on('close', (code, reasonBuffer: unknown) => {
        this.clients.delete(socket);
        this.runLogger.info('ws', 'client_disconnected', {
          remoteAddress: request.ip,
          code,
          reason: String(reasonBuffer ?? ''),
          clientsConnected: this.clients.size,
        });
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
      this.safeSend(socket, payload);
    }
  }

  private send(socket: WsSocket, message: OutboundMessage): void {
    this.safeSend(socket, JSON.stringify(message));
  }

  private sendInitialMessages(socket: WsSocket): void {
    setTimeout(() => {
      this.send(socket, this.makeHello());
      this.send(socket, this.sessionManager.getSnapshot());
    }, 0);
  }

  private safeSend(socket: WsSocket, payload: string): void {
    try {
      socket.send(payload);
    } catch (error) {
      this.runLogger.error('ws', 'send_failed', {
        clientsConnected: this.clients.size,
        error: serializeUnknownError(error),
      });
      this.clients.delete(socket);
    }
  }
}
