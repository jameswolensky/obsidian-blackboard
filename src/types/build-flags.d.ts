// Build-time flags injected by esbuild `define` (see esbuild.config.mjs) and mirrored
// in vitest.config.ts. Production builds get `false`, which dead-code-eliminates every
// `if (__DEV_BUILD__)` branch and tree-shakes the src/dev/* modules behind them.
declare const __DEV_BUILD__: boolean;
declare const __DEV_SERVER__: string;
