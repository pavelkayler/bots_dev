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

  registerHttpRoutes(app, sessionManager, wsHub);
  wsHub.attachRoutes(app);

  const port = Number((globalThis as any).process?.env?.PORT ?? 3000);
  await app.listen({ host: '0.0.0.0', port });

  console.log('=============================================');
  console.log('[backend] bybit-paper-bot local runtime ready');
  console.log(`[backend] http:    http://0.0.0.0:${port}`);
  console.log(`[backend] health:  http://0.0.0.0:${port}/api/health`);
  console.log(`[backend] version: http://0.0.0.0:${port}/api/version`);
  console.log('[backend] press Ctrl+C for graceful shutdown');
  console.log('=============================================');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`[backend] received ${signal}; starting graceful shutdown...`);

    try {
      await sessionManager.stop();
      console.log('[backend] session manager stopped cleanly.');
    } catch (error) {
      console.error('[backend] session stop failed:', error);
    }

    try {
      await app.close();
      console.log('[backend] http+ws server closed.');
    } catch (error) {
      console.error('[backend] app close failed:', error);
    }

    (globalThis as any).process?.exit(0);
  };

  (globalThis as any).process?.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  (globalThis as any).process?.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  (globalThis as any).process?.exit(1);
});
