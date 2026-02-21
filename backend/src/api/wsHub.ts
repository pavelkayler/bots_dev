import type { HelloMessage } from './dto';
import type { SessionManager } from '../engine/SessionManager';

export class WsHub {
  private clients = new Set<any>();

  constructor(private readonly sessionManager: SessionManager) {
    this.sessionManager.onTick((message) => this.broadcast(message));
    this.sessionManager.onEventsAppend((message) => this.broadcast(message));
    this.sessionManager.onSessionState((message) => this.broadcast(message));
    this.sessionManager.onError((message) => this.broadcast(message));
  }

  attachRoutes(app: any): void {
    app.get('/ws', { websocket: true }, (socketOrConnection: any) => {
      const socket = socketOrConnection?.socket ?? socketOrConnection;
      this.clients.add(socket);

      this.send(socket, this.makeHello());
      this.send(socket, this.sessionManager.getSnapshot());

      socket.on('close', () => {
        this.clients.delete(socket);
      });
    });
  }

  private makeHello(): HelloMessage {
    return {
      type: 'hello',
      ts: Date.now(),
      protocolVersion: 1,
      server: { name: 'bybit-paper-bot', env: 'local' },
    };
  }

  private broadcast(message: unknown): void {
    const payload = JSON.stringify(message);
    for (const socket of this.clients) {
      if (socket?.readyState === 1) {
        socket.send(payload);
      }
    }
  }

  private send(socket: any, message: unknown): void {
    if (socket?.readyState === 1) {
      socket.send(JSON.stringify(message));
    }
  }
}
