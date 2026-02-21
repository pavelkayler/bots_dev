declare const process: {
  argv: string[];
  env: Record<string, string | undefined>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  exit(code?: number): void;
};

declare module 'fs' {
  export const createWriteStream: any;
  export const mkdirSync: any;
  export const mkdtempSync: any;
  export const readFileSync: any;
  export const readdirSync: any;
  export const rmSync: any;
}

declare module 'path' {
  export const dirname: any;
  export const resolve: any;
}

declare module 'os' {
  export const tmpdir: any;
}
