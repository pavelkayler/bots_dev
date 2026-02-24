import fs from "node:fs";
import path from "node:path";

export type LogEvent = {
  ts: number;
  type: string;
  symbol?: string;
  payload?: unknown;
};

export class EventLogger {
  public readonly sessionId: string;
  public readonly filePath: string;

  // exactOptionalPropertyTypes=true requires explicit union with undefined
  private readonly onEvent: ((ev: LogEvent) => void) | undefined;

  constructor(sessionId: string, onEvent?: (ev: LogEvent) => void) {
    this.sessionId = sessionId;
    this.onEvent = onEvent;

    const dir = path.join(process.cwd(), "data", "sessions", sessionId);
    fs.mkdirSync(dir, { recursive: true });

    this.filePath = path.join(dir, "events.jsonl");

    this.log({
      ts: Date.now(),
      type: "SESSION_START",
      payload: { sessionId }
    });
  }

  log(ev: LogEvent) {
    try {
      fs.appendFileSync(this.filePath, JSON.stringify(ev) + "\n", "utf8");
    } catch {
      // ignore
    }

    try {
      this.onEvent?.(ev);
    } catch {
      // ignore
    }
  }
}
