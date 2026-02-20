declare module 'ws';

declare module 'luxon' {
  export const DateTime: {
    fromMillis(ts: number, opts?: { zone?: string }): {
      setZone(zone: string): { toFormat(fmt: string): string };
    };
  };
}

declare const process: {
  on(event: string, listener: (...args: unknown[]) => void): void;
  exit(code?: number): void;
};
