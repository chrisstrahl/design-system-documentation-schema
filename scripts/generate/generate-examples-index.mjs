#!/usr/bin/env node
/**
 * Generates the file listing on the Examples page directly from the examples/ directory tree,
 * so a new or removed example shows up without anyone editing a hand-typed list - same
 * generate-into-markers pattern as generate-rule-catalog.mjs. build-site.js mirrors examples/
 * into site/dist/examples/ verbatim so each link below actually resolves.
 *
 * Usage:
 *   node scripts/generate/generate-examples-index.mjs           # regenerate the list
 *   node scripts/generate/generate-examples-index.mjs --check   # exit 1 if out of date
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncRegion } from "./regions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const EXAMPLES_DIR = path.join(ROOT, "examples");
const PAGE = path.join(ROOT, "site", "content", "examples.mdx");

const REGION = "examples-index";

// One-line blurb per top-level category, hand-written and stable; the file list under each is
// what's generated.
const GROUP_BLURBS = {
  base: "Full base documents — a system with multiple entries, split across files via `rel: file`.",
  entries: "Standalone entry files, one per kind, plus the source/manifest/story files a couple of them point at.",
  quickstart: "The Quick Start guide's own snippets, one per step, building up from a bare base document to a described, related entry.",
  interop: "Worked pairs showing a DSDS entry pointing at a real DTCG token file or CEM manifest, instead of restating it.",
  invalid: "One broken example per semantic rule (`DSDS-XX-*.yaml`) plus plain schema fixtures (`schema-*.yaml`) — the negative-test corpus `scripts/validate/conformance-test.js` runs against.",
  "anti-patterns": "Documents that validate cleanly and are still worth avoiding — the schema checks structure, not judgment. See each file's own leading comment.",
};

function walk(dir, baseDir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, baseDir, out);
    } else {
      out.push(path.relative(baseDir, full).split(path.sep).join("/"));
    }
  }
}

function renderIndex() {
  const groups = fs
    .readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const lines = [];
  let total = 0;
  for (const group of groups) {
    const groupDir = path.join(EXAMPLES_DIR, group);
    const files = [];
    walk(groupDir, EXAMPLES_DIR, files);
    total += files.length;
    lines.push(`## ${group}/`);
    lines.push("");
    if (GROUP_BLURBS[group]) {
      lines.push(GROUP_BLURBS[group]);
      lines.push("");
    }
    for (const file of files) {
      lines.push(`- [\`${file}\`](/examples/${file})`);
    }
    lines.push("");
  }
  lines.push(`*${total} files across ${groups.length} categories, generated from the \`examples/\` directory by \`scripts/generate/generate-examples-index.mjs\` — do not edit by hand.*`);
  return lines.join("\n");
}

function main() {
  const check = process.argv.includes("--check");
  syncRegion({
    file: PAGE,
    name: REGION,
    render: renderIndex,
    check,
    label: "Examples index",
  });
}

main();
