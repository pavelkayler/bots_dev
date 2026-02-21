#!/usr/bin/env node
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';

const rootDir = process.cwd();
const pidDir = resolve(rootDir, '.pids');
const backendPidFile = resolve(pidDir, 'backend.pid');
const frontendPidFile = resolve(pidDir, 'frontend.pid');

mkdirSync(pidDir, { recursive: true });

function startProcess(name, command, pidFile) {
  const child = spawn(command, {
    cwd: rootDir,
    shell: true,
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  console.log(`[dev] ${name} started (pid=${child.pid})`);
}

function killProcess(pidFile, name) {
  if (!existsSync(pidFile)) {
    console.log(`[dev] ${name} pid file not found; skipping.`);
    return;
  }

  const pid = Number(readFileSync(pidFile, 'utf-8').trim());
  if (!Number.isFinite(pid) || pid <= 0) {
    rmSync(pidFile, { force: true });
    console.log(`[dev] ${name} pid file invalid; cleaned.`);
    return;
  }

  try {
    if (process.platform === 'win32') {
      spawn(`taskkill /PID ${pid} /T /F`, { shell: true, stdio: 'ignore' });
    } else {
      try {
        process.kill(-pid, 'SIGTERM');
      } catch {
        process.kill(pid, 'SIGTERM');
      }
    }
    console.log(`[dev] ${name} stop signal sent (pid=${pid})`);
  } catch {
    console.log(`[dev] ${name} already stopped (pid=${pid})`);
  } finally {
    rmSync(pidFile, { force: true });
  }
}

function start() {
  startProcess('backend', 'npm run build --prefix backend && npm run start --prefix backend', backendPidFile);
  startProcess('frontend', 'npm run dev --prefix frontend -- --host 0.0.0.0 --port 5173', frontendPidFile);
}

function stop() {
  killProcess(frontendPidFile, 'frontend');
  killProcess(backendPidFile, 'backend');
}

const command = process.argv[2] ?? 'start';
if (command === 'start') {
  start();
} else if (command === 'stop') {
  stop();
} else if (command === 'restart') {
  stop();
  start();
} else {
  console.log('Usage: node scripts/dev.mjs <start|stop|restart>');
  process.exit(1);
}
