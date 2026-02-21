import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { sessionStartRequestSchema } from './dto';
import type { SessionManager } from '../engine/SessionManager';
import type { WsHub } from './wsHub';
import { WS_ERROR_CODES } from '../types/dto';

function resolveVersion(): string {
  return process.env.GIT_HASH ?? process.env.npm_package_version ?? 'unknown';
}

export function registerHttpRoutes(app: FastifyInstance, sessionManager: SessionManager, wsHub: WsHub): void {
  const startedAtTs = Date.now();
  const version = resolveVersion();

  app.post('/api/session/start', async (request: FastifyRequest, reply: FastifyReply) => {
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
          code: WS_ERROR_CODES.VALIDATION_ERROR,
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
        code: WS_ERROR_CODES.INTERNAL_ERROR,
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
      session: { state: status.state },
      lastTickTs: sessionManager.getLastTickTs(),
    };
  });

  app.get('/api/version', async () => ({ ok: true, version }));
}
