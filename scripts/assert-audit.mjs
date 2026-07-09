#!/usr/bin/env node
// Assert openspec/specs/toolbar invariants against the latest device audit
// (posted by src/dev/dev-bridge.ts to scripts/dev-server.mjs).
// Usage: node scripts/assert-audit.mjs [--golden .devloop/golden-audit.json]
import { readFileSync } from "node:fs";

const audit = JSON.parse(readFileSync(".devloop/audit-latest.json", "utf8"));
const goldenPath = process.argv.includes("--golden")
  ? process.argv[process.argv.indexOf("--golden") + 1]
  : null;

const failures = [];
const ok = (cond, msg) => {
  if (!cond) failures.push(msg);
};
const px = (s) => Number.parseFloat(s ?? "NaN");

ok(audit.toolbarPresent || audit.pillPresent, "neither toolbar nor pill present");
if (audit.toolbarPresent) {
  const bar = audit.toolbarRect;
  ok(bar.y + bar.height <= audit.viewport.h, `toolbar below viewport: ${JSON.stringify(bar)}`);
  ok(bar.x >= 0 && bar.x + bar.width <= audit.viewport.w, "toolbar clipped horizontally");
  const isTablet = audit.bodyClasses.includes("is-tablet");
  for (const c of audit.controls) {
    const name = c.classes.join(".");
    ok(
      c.hasSvgIcon ||
        c.classes.includes("blackboard-gt-colorwell") ||
        c.classes.includes("blackboard-gt-swatch"),
      `${name}: icon missing`,
    );
    if (c.svgOpacity !== null)
      ok(px(c.svgOpacity) >= 0.99, `${name}: icon faded (opacity ${c.svgOpacity})`);
    ok(c.style.padding === "0px", `${name}: padding not neutralized (${c.style.padding})`);
    if (c.classes.includes("blackboard-gt-btn")) {
      // Flat buttons; on the 13" iPad clamp(34px,7vw,42px) resolves to 42px.
      if (isTablet)
        ok(
          Math.abs(c.rect.width - 42) <= 1 && Math.abs(c.rect.height - 42) <= 1,
          `${name}: not 42x42 (${c.rect.width}x${c.rect.height})`,
        );
      ok(
        !c.style.borderRadius.includes("50%") && px(c.style.borderRadius) < 16,
        `${name}: tool button not flat (${c.style.borderRadius})`,
      );
      if (c.active)
        ok(
          c.style.backgroundColor === "rgb(138, 92, 245)",
          `${name}: active accent wrong (${c.style.backgroundColor})`,
        );
    }
    if (c.classes.includes("blackboard-gt-colorwell"))
      ok(
        c.style.borderRadius.includes("50%") || px(c.style.borderRadius) >= c.rect.width / 2 - 1,
        `colorwell not circular (${c.style.borderRadius})`,
      );
  }
}

if (goldenPath) {
  const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
  const key = (c) => [...c.classes].sort().join(".");
  const gmap = new Map(golden.controls.map((c) => [key(c), c]));
  for (const c of audit.controls) {
    const g = gmap.get(key(c));
    if (!g) {
      failures.push(`control ${key(c)} absent from golden`);
      continue;
    }
    for (const dim of ["width", "height"])
      if (Math.abs(c.rect[dim] - g.rect[dim]) > 2)
        failures.push(`${key(c)}: ${dim} drifted ${g.rect[dim]} -> ${c.rect[dim]}`);
    for (const p of ["borderRadius", "backgroundColor", "webkitAppearance"])
      if (c.style[p] !== g.style[p])
        failures.push(`${key(c)}: ${p} drifted '${g.style[p]}' -> '${c.style[p]}'`);
  }
}

if (failures.length) {
  console.error(`AUDIT FAIL (${failures.length}):\n- ` + failures.join("\n- "));
  process.exit(1);
}
console.log(
  `AUDIT PASS (${audit.controls.length} controls, build ${audit.buildHash}, ${audit.bodyClasses.join(" ")})`,
);
