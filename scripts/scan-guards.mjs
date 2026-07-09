#!/usr/bin/env node
// Guards mirroring the store analyzers that local eslint doesn't cover:
// CSS !important count and bare `document.` usage in shipped source
// (comments and src/dev/* excluded). Non-zero counts exit 1.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const cssCount = (readFileSync("styles.css", "utf8").match(/!important/g) ?? []).length;

const tsFiles = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (!p.includes("src/dev")) walk(p);
    } else if (p.endsWith(".ts")) tsFiles.push(p);
  }
};
walk("src");

const bare = [];
for (const f of tsFiles) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, "");
    if (code.trim().startsWith("*")) return; // block-comment prose
    if (/(?<![\w.$])document\./.test(code)) bare.push(`${f}:${i + 1}: ${line.trim()}`);
  });
}

console.log(`CSS_IMPORTANT_COUNT=${cssCount}`);
console.log(`BARE_DOCUMENT_COUNT=${bare.length}`);
for (const b of bare) console.log("  " + b);
process.exit(cssCount === 0 && bare.length === 0 ? 0 : 1);
