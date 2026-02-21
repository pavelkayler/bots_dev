import { createWriteStream, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import type { EventRow } from '../types/dto';
import { WS_ERROR_CODES } from '../types/dto';

const MAX_QUEUE_LINES = 10_000;

export class EventLogger {
  private stream: ReturnType<typeof createWriteStream> | null = null;
  private queue: string[] = [];
  private closing = false;
  private overflowReported = false;

  constructor(private readonly baseDir = resolve('data', 'sessions')) {}

  start(sessionId: string): void {
    const filePath = resolve(this.baseDir, sessionId, 'events.jsonl');
    mkdirSync(dirname(filePath), { recursive: true });
    this.stream = createWriteStream(filePath, { flags: 'a' });
    this.closing = false;
    this.queue = [];
    this.overflowReported = false;

    this.stream.on('drain', () => {
      this.flushQueue();
    });
  }

  append(events: EventRow[]): void {
    if (!this.stream || this.closing || events.length === 0) {
      return;
    }

    for (const event of events) {
      if (this.queue.length >= MAX_QUEUE_LINES) {
        if (!this.overflowReported) {
          const overflowEvent: EventRow = {
            id: `evt_logger_overflow_${Date.now()}`,
            ts: Date.now(),
            type: 'error',
            symbol: 'SYSTEM',
            data: {
              scope: 'EVENT_LOGGER',
              code: WS_ERROR_CODES.QUEUE_OVERFLOW,
              message: `Event logger queue overflowed (${MAX_QUEUE_LINES} lines). Dropping new events.`,
            },
          };
          this.queue.push(`${JSON.stringify(overflowEvent)}\n`);
          this.overflowReported = true;
        }
        continue;
      }

      this.queue.push(`${JSON.stringify(event)}\n`);
    }

    this.flushQueue();
  }

  async stop(): Promise<void> {
    if (!this.stream) {
      return;
    }

    this.closing = true;
    await this.flushQueueFully();

    await new Promise<void>((resolvePromise) => {
      const target = this.stream;
      this.stream = null;
      if (!target) {
        resolvePromise();
        return;
      }
      target.end(() => resolvePromise());
    });

    this.queue = [];
    this.closing = false;
  }

  private flushQueue(): void {
    if (!this.stream || this.queue.length === 0) {
      return;
    }

    while (this.queue.length > 0) {
      const line = this.queue[0];
      if (!line) {
        this.queue.shift();
        continue;
      }
      const canContinue = this.stream.write(line);
      this.queue.shift();
      if (!canContinue) {
        break;
      }
    }
  }

  private async flushQueueFully(): Promise<void> {
    if (!this.stream) {
      return;
    }

    this.flushQueue();
    while (this.queue.length > 0 && this.stream) {
      await new Promise<void>((resolvePromise) => {
        this.stream?.once('drain', () => {
          this.flushQueue();
          resolvePromise();
        });
      });
    }
  }
}
