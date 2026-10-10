// Set at build time by `define` in vite.config.ts: the package version, and the commit (plus `+dirty` for uncommitted
// changes) the build came from. Shown on the title screen so a deploy can be matched to a commit.
declare const __APP_VERSION__: string;
declare const __APP_SHA__: string;

export const APP_VERSION: string = __APP_VERSION__;
export const APP_SHA: string = __APP_SHA__;
