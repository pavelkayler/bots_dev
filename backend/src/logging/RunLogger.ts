import { createWriteStream, mkdirSync } from 'fs';
import { resolve } from 'path';

type LogLevel = 'INFO' | 'WARN' | 'ERROR';

const MAX_QUEUE_LINES = 10_000;
const LOG_PATH = resolve('data', 'debug', 'backend_debug.log');

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { value: String(error) };
}

export class RunLogger {
  private stream: ReturnType<typeof createWriteStream>;
  private queue: string[] = [];
  private ended = false;
  private dropNoticePending = false;

  constructor(private readonly filePath: string = LOG_PATH) {
    mkdirSync(resolve('data', 'debug'), { recursive: true });
    this.stream = createWriteStream(this.filePath, { flags: 'w' });
    this.stream.on('drain', () => {
      this.flushQueue();
    });
  }

  getFilePath(): string {
    return this.filePath;
  }

  info(scope: string, message: string, payload: Record<string, unknown> = {}): void {
    this.write('INFO', scope, message, payload);
  }

  warn(scope: string, message: string, payload: Record<string, unknown> = {}): void {
    this.write('WARN', scope, message, payload);
  }

  error(scope: string, message: string, payload: Record<string, unknown> = {}): void {
    this.write('ERROR', scope, message, payload);
  }

  errorFrom(scope: string, message: string, error: unknown, payload: Record<string, unknown> = {}): void {
    this.write('ERROR', scope, message, {
      ...payload,
      error: serializeError(error),
    });
  }

  async close(): Promise<void> {
    if (this.ended) {
      return;
    }

    await this.flushQueueFully();

    await new Promise<void>((resolvePromise) => {
      this.stream.end(() => resolvePromise());
    });

    this.ended = true;
  }

  private write(level: LogLevel, scope: string, message: string, payload: Record<string, unknown>): void {
    if (this.ended) {
      return;
    }

    const line = `${new Date().toISOString()} ${level} ${scope} ${message} ${JSON.stringify(payload)}\n`;
    this.enqueue(line);
    this.flushQueue();
  }

  private enqueue(line: string): void {
    if (this.queue.length < MAX_QUEUE_LINES) {
      this.queue.push(line);
      return;
    }

    if (!this.dropNoticePending) {
      this.dropNoticePending = true;
      const droppedLine = `${new Date().toISOString()} ERROR logger DROPPED_LOG_LINES ${JSON.stringify({
        maxQueueLines: MAX_QUEUE_LINES,
      })}\n`;

      if (this.queue.length >= MAX_QUEUE_LINES) {
        this.queue.shift();
      }
      this.queue.push(droppedLine);
    }
  }

  private flushQueue(): void {
    while (this.queue.length > 0) {
      const line = this.queue[0];
      if (!line) {
        this.queue.shift();
        continue;
      }
      const canContinue = this.stream.write(line);
      this.queue.shift();
      if (!canContinue) {
        return;
      }
    }

    this.dropNoticePending = false;
  }

  private async flushQueueFully(): Promise<void> {
    this.flushQueue();

    while (this.queue.length > 0) {
      await new Promise<void>((resolvePromise) => {
        this.stream.once('drain', () => {
          this.flushQueue();
          resolvePromise();
        });
      });
    }
  }
}

let runLogger: RunLogger | null = null;

export function initRunLogger(filePath?: string): RunLogger {
  if (!runLogger) {
    runLogger = new RunLogger(filePath);
  }
  return runLogger;
}

export function getRunLogger(): RunLogger {
  return runLogger ?? initRunLogger();
}

export function serializeUnknownError(error: unknown): Record<string, unknown> {
  return serializeError(error);
}
