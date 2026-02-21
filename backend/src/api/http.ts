import { ZodError } from 'zod';
import { sessionStartRequestSchema } from './dto';
import type { SessionManager } from '../engine/SessionManager';
import type { WsHub } from './wsHub';

function resolveVersion(): string {
  return (globalThis as any).process?.env?.GIT_HASH ?? (globalThis as any).process?.env?.npm_package_version ?? 'unknown';
}

export function registerHttpRoutes(app: any, sessionManager: SessionManager, wsHub: WsHub): void {
  const startedAtTs = Date.now();
  const version = resolveVersion();

  app.post('/api/session/start', async (request: any, reply: any) => {
    try {
      const parsed = sessionStartRequestSchema.parse(request.body ?? {});
      return sessionManager.start(parsed);
    } catch (error) {
      if (error instanceof ZodError) {
        reply.status(400);
        return {
          type: 'error',
          ts: Date.now(),
          sessionId: sessionManager.getStatus().sessionId,
          scope: 'API',
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body for /api/session/start',
          data: { issues: error.issues },
        };
      }
      reply.status(500);
      return {
        type: 'error',
        ts: Date.now(),
        sessionId: sessionManager.getStatus().sessionId,
        scope: 'API',
        code: 'INTERNAL_ERROR',
        message: 'Unexpected error',
        data: {},
      };
    }
  });

  app.post('/api/session/stop', async () => sessionManager.stop());

  app.get('/api/session/status', async () => sessionManager.getStatus());

  app.get('/api/health', async () => {
    const status = sessionManager.getStatus();
    return {
      ok: true,
      uptimeSec: Math.floor((Date.now() - startedAtTs) / 1000),
      wsClientsConnected: wsHub.getConnectedClientsCount(),
      session: {
        state: status.state,
      },
      lastTickTs: sessionManager.getLastTickTs(),
    };
  });

  app.get('/api/version', async () => ({ ok: true, version }));
}
