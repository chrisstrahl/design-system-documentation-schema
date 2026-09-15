#!/usr/bin/env node
/**
 * Generates the `/conformance` page's rule catalog table directly from
 * schema/conformance-rules.yaml, so the two can't drift the way a hand-maintained copy can -
 * the same generate-into-markers pattern extract-normative.mjs and sync-examples.js use.
 *
 * Usage:
 *   node scripts/generate/generate-rule-catalog.mjs           # regenerate the table
 *   node scripts/generate/generate-rule-catalog.mjs --check   # exit 1 if out of date
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { syncRegion } from "./regions.mjs";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");
const { validateConfig } = require("../config-schema.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const CATALOG_PATH = path.join(ROOT, "schema", "conformance-rules.yaml");
const PAGE = path.join(ROOT, "site", "content", "conformance.mdx");

const REGION = "rule-catalog";

function renderTable(rules) {
  const lines = ["| ID | Rule |", "|---|---|"];
  for (const rule of rules) {
    lines.push(`| \`${rule.id}\` | ${rule.title} |`);
  }
  return lines.join("\n");
}

function main() {
  const check = process.argv.includes("--check");

  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`✗ ${path.relative(ROOT, CATALOG_PATH)} not found.`);
    process.exit(1);
  }
  const rules = validateConfig(
    "conformance-rules",
    yaml.load(fs.readFileSync(CATALOG_PATH, "utf-8")),
    "schema/conformance-rules.yaml"
  );
  if (!Array.isArray(rules) || rules.length === 0) {
    console.error(`✗ ${path.relative(ROOT, CATALOG_PATH)} has no rules.`);
    process.exit(1);
  }

  syncRegion({
    file: PAGE,
    name: REGION,
    render: () => renderTable(rules),
    check,
    label: `Rule catalog table (${rules.length} rules)`,
  });
}

main();
