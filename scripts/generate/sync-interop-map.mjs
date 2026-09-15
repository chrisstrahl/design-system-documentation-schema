#!/usr/bin/env node
/**
 * Renders schema/interop-map.yaml into the three places that print the interoperability table.
 *
 * README.md, AGENTS.md and site/content/interoperability.mdx each carried their own copy: three
 * sets of column headers, three wordings of the same cells, and three different row counts -
 * the site page listed JSON Schema, split design artifacts from distribution, and named the
 * `$extensions` catch-all, while the other two listed none of that. Adding an integration meant
 * remembering three files. Now it means adding a row.
 *
 * Only the column order and headers differ per surface, and that difference is real: README and
 * AGENTS.md introduce the table by talking about formats, so they lead with the format; the
 * site page calls the section "The map" and leads with the layer. Everything else - every cell,
 * every link, every row - comes from the one file.
 *
 * Usage:
 *   node scripts/generate/sync-interop-map.mjs           # rewrite all three tables
 *   node scripts/generate/sync-interop-map.mjs --check    # exit 1 if any has drifted
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs";

import { syncRegion } from "./regions.mjs"

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const { validateConfig } = require("../config-schema.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const SOURCE = path.join(ROOT, "schema", "interop-map.yaml");
const REGION = "interop-map";

// Which cell goes in which column, and what to call it, per surface.
const SURFACES = [
  {
    file: path.join(ROOT, "README.md"),
    headers: ["Format", "Layer it owns", "The DSDS field"],
    columns: ["format", "layer", "field"],
  },
  {
    file: path.join(ROOT, "AGENTS.md"),
    headers: ["Format", "Layer it owns", "Point at it with"],
    columns: ["format", "layer", "field"],
  },
  {
    file: path.join(ROOT, "site", "content", "interoperability.mdx"),
    headers: ["Layer", "Format it interoperates with", "The DSDS field"],
    columns: ["layer", "format", "field"],
  },
];

function loadRows() {
  // Shape, required keys and unexpected keys all come from
  // scripts/config-schemas/interop-map.schema.json rather than a loop that only covers what
  // someone remembered to check.
  return validateConfig(
    "interop-map",
    yaml.load(fs.readFileSync(SOURCE, "utf-8")),
    path.relative(ROOT, SOURCE)
  );
}

// A cell can legitimately contain a pipe only if it's escaped; catching it here beats shipping
// a table that silently grows a column.
function cell(text) {
  if (/(?<!\\)\|/.test(text)) {
    console.error(`✗ Unescaped "|" in an interop-map cell: ${text}`);
    process.exit(1);
  }
  return text;
}

function renderTable(rows, { headers, columns }) {
  const lines = [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
  ];
  for (const row of rows) {
    lines.push(`| ${columns.map((c) => cell(row[c])).join(" | ")} |`);
  }
  return lines.join("\n");
}

const check = process.argv.includes("--check");
const rows = loadRows();
let allCurrent = true;

for (const surface of SURFACES) {
  const current = syncRegion({
    file: surface.file,
    name: REGION,
    render: () => renderTable(rows, surface),
    check,
    label: `${path.basename(surface.file)}'s interoperability table (${rows.length} rows)`,
  });
  allCurrent = allCurrent && current;
}

if (check && allCurrent) {
  console.log(`✓ All 3 interoperability tables match schema/interop-map.yaml (${rows.length} rows).`);
}
