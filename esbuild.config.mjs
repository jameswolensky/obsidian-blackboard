import esbuild from "esbuild";
import process from "process";
import os from "node:os";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

// __DEV_BUILD__ gates src/dev/* out of release builds (tree-shaken).
// __DEV_SERVER__ lets the iPad resolve this Mac over mDNS without hardcoding an IP.
const define = {
  __DEV_BUILD__: prod ? "false" : "true",
  __DEV_SERVER__: JSON.stringify(`http://${os.hostname()}:8737`),
};

esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
    ...builtinModules.map((m) => "node:" + m),
  ],
  format: "cjs",
  target: "es2018",
  define,
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: prod,
}).catch(() => process.exit(1));
