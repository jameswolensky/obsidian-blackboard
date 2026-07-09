#!/usr/bin/env node
// Blackboard dev server: serves build artifacts to the iPad dev-bridge and
// receives device-truth audits. LAN only. Node >= 20, zero deps.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".devloop");
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 8737);

const ARTIFACTS = { "main.js": "main.js", "styles.css": "styles.css", "manifest.json": "manifest.json" };

const buildVersion = () => {
  const h = createHash("sha256");
  for (const f of Object.values(ARTIFACTS)) h.update(readFileSync(join(ROOT, f)));
  return h.digest("hex").slice(0, 16);
};

createServer((req, res) => {
  const p = new URL(req.url, "http://x").pathname;
  try {
    if (req.method === "GET" && p === "/build/version") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ version: buildVersion() }));
    }
    if (req.method === "GET" && p.startsWith("/build/") && ARTIFACTS[p.slice(7)]) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      return res.end(readFileSync(join(ROOT, ARTIFACTS[p.slice(7)])));
    }
    // Serve the Tier 2 harness (and the stylesheet paths it links) from the same
    // origin so its in-page fetch() verdict POST needs no CORS. Path layout matches
    // the historical python http.server (repo root).
    if (req.method === "GET" && (p.startsWith("/test/webkit/") || p === "/styles.css")) {
      const rel = p.replace(/\.\./g, "").replace(/^\//, "");
      const type = rel.endsWith(".css")
        ? "text/css"
        : rel.endsWith(".mjs") || rel.endsWith(".js")
          ? "text/javascript"
          : "text/html";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      return res.end(readFileSync(join(ROOT, rel)));
    }
    if (req.method === "POST" && (p === "/audit" || p === "/webkit-verdict")) {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const name = p === "/audit" ? "audit-latest.json" : "webkit-verdict.json";
        writeFileSync(join(OUT, name), body);
        console.log(`[dev-server] ${p} <- ${body.length} bytes @ ${new Date().toISOString()}`);
        res.writeHead(204);
        res.end();
      });
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
}).listen(PORT, "0.0.0.0", () => console.log(`[dev-server] listening on 0.0.0.0:${PORT}`));
