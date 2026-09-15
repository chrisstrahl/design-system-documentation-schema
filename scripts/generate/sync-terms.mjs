#!/usr/bin/env node
/**
 * Renders schema/terms.yaml into every surface that should carry the house vocabulary: the
 * Conformance page, README.md and AGENTS.md. Same mechanism as sync-interop-map.mjs — one
 * source, `syncRegion` into marker pairs, `--check` fails the build when a copy drifts.
 *
 * Why a table and not a style memo: the vocabulary was already consistent by the numbers
 * (entry 348, section 252, kind 200 vs 19 for "type"), but nothing recorded the decision, so
 * the losing synonym kept coming back — the skills called a document a "spec" 32 times, and the
 * schema named an undeclared "tool" in normative sentences the Conformance page assigns to a
 * conforming consumer. A generated table is re-read on every build; a memo isn't.
 *
 * Usage:
 *   node scripts/generate/sync-terms.mjs           # regenerate every copy
 *   node scripts/generate/sync-terms.mjs --check   # exit 1 if any is out of date
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
const SOURCE = path.join(ROOT, "schema", "terms.yaml");
const REGION = "terms";

// README and AGENTS get the short form: the decision, not the citation. The Conformance page,
// which is where the classes are defined, gets the full table.
const SURFACES = [
  {
    file: path.join(ROOT, "site", "content", "conformance.mdx"),
    headers: ["Use", "For", "Not", "Defined in"],
    columns: ["use", "for", "not", "where"],
  },
  {
    file: path.join(ROOT, "README.md"),
    headers: ["Use", "For", "Not"],
    columns: ["use", "for", "not"],
  },
  {
    file: path.join(ROOT, "AGENTS.md"),
    headers: ["Use", "For", "Not"],
    columns: ["use", "for", "not"],
  },
];

function loadRows() {
  // Shape, required keys and unexpected keys all come from
  // scripts/config-schemas/terms.schema.json rather than a loop that only covers what
  // someone remembered to check.
  return validateConfig(
    "terms",
    yaml.load(fs.readFileSync(SOURCE, "utf-8")),
    path.relative(ROOT, SOURCE)
  );
}

// Same guard sync-interop-map.mjs uses: an unescaped pipe silently grows a column.
function cell(text) {
  const value = text ?? "";
  if (/(?<!\\)\|/.test(value)) {
    console.error(`✗ Unescaped "|" in a terms cell: ${value}`);
    process.exit(1);
  }
  return value;
}

function renderTable(rows, { headers, columns }) {
  const lines = [`| ${headers.join(" | ")} |`, `|${headers.map(() => "---").join("|")}|`];
  for (const row of rows) {
    const cells = columns.map((c) => {
      // `use` is the term itself, so it reads as code; `not` is a list of words to avoid.
      if (c === "use") return `**${cell(row.use)}**`;
      if (c === "not") return cell(row.not);
      return cell(row[c]);
    });
    lines.push(`| ${cells.join(" | ")} |`);
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
    label: `${path.basename(surface.file)}'s terms table (${rows.length} rows)`,
  });
  allCurrent = allCurrent && current;
}

if (check && allCurrent) {
  console.log(`✓ All ${SURFACES.length} terms tables match schema/terms.yaml (${rows.length} rows).`);
}
