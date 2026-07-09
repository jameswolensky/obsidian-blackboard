import esbuild from "esbuild";
import process from "process";
import os from "node:os";
import { execSync } from "node:child_process";
import { builtinModules } from "node:module";

const prod = process.argv[2] === "production";

// __DEV_BUILD__ gates src/dev/* out of release builds (tree-shaken).
// __DEV_SERVER__ lets the iPad resolve this Mac over mDNS without hardcoding an IP.
// os.hostname() can return a non-Bonjour name (e.g. "Mac.localdomain"), so on macOS
// use the real Bonjour LocalHostName — that's what iOS devices can resolve via mDNS.
function devHost() {
  if (process.platform === "darwin") {
    try {
      return execSync("scutil --get LocalHostName").toString().trim() + ".local";
    } catch {
      // fall through to os.hostname()
    }
  }
  return os.hostname();
}
const define = {
  __DEV_BUILD__: prod ? "false" : "true",
  __DEV_SERVER__: JSON.stringify(`http://${devHost()}:8737`),
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
