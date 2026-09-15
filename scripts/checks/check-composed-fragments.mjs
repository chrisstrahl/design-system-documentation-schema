#!/usr/bin/env node
/**
 * Composes examples/base/starter-kit-fragments/ with scripts/tools/compose.js and validates the
 * result.
 *
 * Two of those fragments are entry lists with no base-document wrapper, so they can't be
 * validated on their own and sit in lib.js's EXCLUDED_FROM_DEFAULT. That left them checked by
 * nothing at all — and left compose.js, which the README documents as the way to split a
 * document across files, with no test either. A regression in composition would only surface
 * when somebody tried to use it.
 *
 * This closes both: the fragments are validated through the one path they're meant to be used
 * through, and composing is exercised on every `npm run check:docs`.
 *
 * DSDS-11 warnings are expected here. The fragments point at `tokens/light.tokens.json` and
 * `tokens/dark.tokens.json`, which are illustrative paths with no file behind them; validate.js
 * reports an unresolvable `rel: file` as a warning, not an error, so a clean exit is the bar.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const FRAGMENT_DIR = path.join(ROOT, "examples/base/starter-kit-fragments");

function run(args) {
  try {
    return {
      out: execFileSync("node", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
      code: 0,
    };
  } catch (e) {
    return { out: `${e.stdout || ""}${e.stderr || ""}`, code: e.status ?? 1 };
  }
}

const fragments = fs
  .readdirSync(FRAGMENT_DIR)
  .filter((f) => f.endsWith(".yaml"))
  .sort();

if (fragments.length === 0) {
  console.error(`✗ No fragments found in ${path.relative(ROOT, FRAGMENT_DIR)}.`);
  process.exit(1);
}

// compose.js takes a directory, not a file list.
const composed = run([path.join(ROOT, "scripts/tools/compose.js"), FRAGMENT_DIR]);
if (composed.code !== 0) {
  console.error(`✗ compose.js failed on ${path.relative(ROOT, FRAGMENT_DIR)}:`);
  console.error(composed.out.split("\n").slice(0, 6).join("\n"));
  process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsds-composed-"));
const outFile = path.join(tmp, "composed.dsds.yaml");
fs.writeFileSync(outFile, composed.out);

const validated = run([path.join(ROOT, "scripts/validate/validate.js"), outFile]);
fs.rmSync(tmp, { recursive: true, force: true });

if (validated.code !== 0) {
  console.error(
    `✗ ${fragments.length} fragment(s) in ${path.relative(ROOT, FRAGMENT_DIR)} compose into a ` +
      `document that doesn't validate:`
  );
  for (const line of validated.out.split("\n").filter((l) => l.trim().startsWith("- "))) {
    console.error(`    ${line.trim()}`);
  }
  process.exit(1);
}

console.log(
  `✓ ${fragments.length} starter-kit fragment(s) compose into a document that validates.`
);
