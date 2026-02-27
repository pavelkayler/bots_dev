import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function parseEnvLine(line: string): [string, string] | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;

  const eq = trimmed.indexOf("=");
  if (eq <= 0) return null;

  const key = trimmed.slice(0, eq).trim();
  let val = trimmed.slice(eq + 1).trim();

  // Strip surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }

  // Basic escapes for common cases
  val = val.replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t");

  if (!key) return null;
  return [key, val];
}

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf-8");
  for (const line of content.split(/\r?\n/)) {
    const kv = parseEnvLine(line);
    if (!kv) continue;
    const [k, v] = kv;
    // Do not override real environment variables
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

// Load env early (Node does not load .env automatically)
(() => {
  // Prefer backend/.env if running from backend folder; fallback to repo root .env
  const cwd = process.cwd();
  const candidates = [
    path.resolve(cwd, ".env"),
    path.resolve(cwd, "..", ".env"),
  ];

  // Also support resolving relative to this file location in case cwd is different
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  candidates.push(
    path.resolve(__dirname, "..", "..", ".env"), // backend/.env when running from dist or different cwd
    path.resolve(__dirname, "..", "..", "..", ".env") // repo root .env
  );

  for (const p of candidates) loadEnvFile(p);
})();

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
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
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
