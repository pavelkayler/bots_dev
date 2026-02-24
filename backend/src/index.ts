import Fastify from "fastify";
import formbody from "@fastify/formbody";
import cors from "@fastify/cors";
import { registerHttpRoutes } from "./api/http.js";
import { createWsHub } from "./api/wsHub.js";

export async function buildApp() {
  const app = Fastify({ logger: true });

  // Accept application/x-www-form-urlencoded (PowerShell Invoke-RestMethod default)
  app.register(formbody);

  // CORS for frontend dev server (Vite)
  app.register(cors, {
    origin: (origin, cb) => {
      // allow non-browser tools (curl/PowerShell) with no Origin
      if (!origin) return cb(null, true);

      const ok = /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin);
      return cb(null, ok);
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"]
  });

  registerHttpRoutes(app);
  createWsHub(app);

  return app;
}

async function main() {
  const port = Number(process.env.PORT ?? 8080);
  const host = process.env.HOST ?? "0.0.0.0";

  const app = await buildApp();
  await app.listen({ port, host });

  app.log.info({ host, port }, "backend listening");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});