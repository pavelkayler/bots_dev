import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { registerHttpRoutes } from './api/http';
import { WsHub } from './api/wsHub';
import { SessionManager } from './engine/SessionManager';
import { initRunLogger, serializeUnknownError } from './logging/RunLogger';

async function main(): Promise<void> {
  const runLogger = initRunLogger();
  console.log(`[backend] debug log: ${runLogger.getFilePath()}`);
  runLogger.info('lifecycle', 'process_start', {
    nodeVersion: process.env.npm_config_user_agent ?? 'unknown',
    platform: process.env.OS ?? process.env.OSTYPE ?? 'unknown',
    pid: process.env.PID ?? 'unknown',
  });

  const app = Fastify({ logger: false });
  await app.register(websocket);

  const sessionManager = new SessionManager();
  const wsHub = new WsHub(sessionManager);

  registerHttpRoutes(app, sessionManager, wsHub);
  wsHub.attachRoutes(app);

  const port = Number(process.env.PORT ?? 3000);
  const host = '0.0.0.0';
  runLogger.info('lifecycle', 'listen_start', { host, port });
  try {
    await app.listen({ host, port });
    runLogger.info('lifecycle', 'listening', { host, port });
  } catch (error) {
    runLogger.error('lifecycle', 'listen_failed', {
      host,
      port,
      error: serializeUnknownError(error),
    });
    throw error;
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    runLogger.info('lifecycle', 'shutdown_start', { signal });

    try {
      await sessionManager.stop();
      runLogger.info('lifecycle', 'session_manager_stopped', { signal });
    } catch (error) {
      runLogger.error('lifecycle', 'session_manager_stop_failed', {
        signal,
        error: serializeUnknownError(error),
      });
    }

    try {
      await app.close();
      runLogger.info('lifecycle', 'http_ws_server_closed', { signal });
    } catch (error) {
      runLogger.error('lifecycle', 'app_close_failed', {
        signal,
        error: serializeUnknownError(error),
      });
    }

    await runLogger.close();

    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });
  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });

  process.on('uncaughtException', (error) => {
    runLogger.error('lifecycle', 'uncaught_exception', {
      error: serializeUnknownError(error),
    });
  });

  process.on('unhandledRejection', (reason) => {
    runLogger.error('lifecycle', 'unhandled_rejection', {
      reason: serializeUnknownError(reason),
    });
  });
}

main().catch((error) => {
  const runLogger = initRunLogger();
  runLogger.error('lifecycle', 'startup_failure', {
    error: serializeUnknownError(error),
  });
  void runLogger.close().finally(() => {
    process.exit(1);
  });
});
