import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { registerHttpRoutes } from './api/http';
import { WsHub } from './api/wsHub';
import { SessionManager } from './engine/SessionManager';

async function main(): Promise<void> {
  const app = Fastify({ logger: false });
  await app.register(websocket);

  const sessionManager = new SessionManager();
  const wsHub = new WsHub(sessionManager);

  registerHttpRoutes(app, sessionManager);
  wsHub.attachRoutes(app);

  const port = Number((globalThis as any).process?.env?.PORT ?? 3000);
  await app.listen({ host: '0.0.0.0', port });
  console.log(`[backend] listening on http://0.0.0.0:${port}`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  (globalThis as any).process?.exit(1);
});
