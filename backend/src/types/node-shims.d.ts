declare module 'fs' {
  export const createWriteStream: any;
  export const mkdirSync: any;
}

declare module 'path' {
  export const dirname: any;
  export const resolve: any;
}
