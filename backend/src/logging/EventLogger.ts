import { createWriteStream, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import type { EventRow } from '../api/dto';

export class EventLogger {
  private stream: ReturnType<typeof createWriteStream> | null = null;
  private queue: string[] = [];
  private closing = false;

  start(sessionId: string): void {
    const filePath = resolve('data', 'sessions', sessionId, 'events.jsonl');
    mkdirSync(dirname(filePath), { recursive: true });
    this.stream = createWriteStream(filePath, { flags: 'a' });
    this.closing = false;
    this.queue = [];

    this.stream.on('drain', () => {
      this.flushQueue();
    });
  }

  append(events: EventRow[]): void {
    if (!this.stream || this.closing || events.length === 0) {
      return;
    }

    for (const event of events) {
      this.queue.push(`${JSON.stringify(event)}\n`);
    }

    this.flushQueue();
  }

  async stop(): Promise<void> {
    if (!this.stream) {
      return;
    }

    this.closing = true;
    this.flushQueue();

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
}
