#!/usr/bin/env node
/**
 * Drift guard for CONTRIBUTING.md's "Every script" reference: asserts, in both directions,
 * that every script in package.json appears in CONTRIBUTING.md, and every `npm run <name>` in
 * CONTRIBUTING.md is a script that still exists. Checks presence, not prose quality - a
 * one-line description nobody maintains still beats an entry that silently disappears.
 *
 * Run via `npm run check:docs`. Exits non-zero on drift in either direction.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const scripts = new Set(
  Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf-8")).scripts),
);

const contributing = fs.readFileSync(path.join(ROOT, "CONTRIBUTING.md"), "utf-8");
// Only count a name inside backticks - prose like "run npm run check first" shouldn't satisfy
// the reference.
const documented = new Set([...contributing.matchAll(/`npm run ([\w:.-]+)/g)].map((m) => m[1]));

let ok = true;

for (const name of [...scripts].sort()) {
  if (!documented.has(name)) {
    console.error(`✗ package.json's "${name}" script isn't in CONTRIBUTING.md's "Every script" reference`);
    ok = false;
  }
}

for (const name of [...documented].sort()) {
  if (!scripts.has(name)) {
    console.error(`✗ CONTRIBUTING.md documents \`npm run ${name}\`, which no longer exists in package.json`);
    ok = false;
  }
}

if (ok) {
  console.log(`✓ All ${scripts.size} npm script(s) are documented in CONTRIBUTING.md, and it documents no script that doesn't exist.`);
}
process.exit(ok ? 0 : 1);
