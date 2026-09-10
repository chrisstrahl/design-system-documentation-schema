#!/usr/bin/env node
/**
 * Runs the `readability` CLI against every piece of DSDS content intended for human reading
 * and emits a sorted summary: (1) long-form prose (README, CHANGELOG, MDX content pages,
 * .claude/ docs) and (2) schema descriptions, concatenated per-file into one blob so metrics
 * aren't dominated by single-sentence cells. Prints one row per file (score/grade/sentence and
 * word/complex/unfamiliar counts) plus a "Worst offenders" callout below threshold.
 *
 * The `readability` CLI must be on PATH - symlink the readability tool's (Rust)
 * src-rust/target/release/readability-cli binary onto PATH as `readability`.
 */

import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchemaYaml } from "../site/render-prop-table.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Discover content
// ---------------------------------------------------------------------------

// Every page under site/content/ is discovered rather than listed, so a hardcoded list can't
// silently stop covering new pages. Non-content long-form files still need naming below.
function findContentPages(dir) {
  if (!fs.existsSync(path.join(ROOT, dir))) return [];
  const out = [];
  for (const entry of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...findContentPages(rel));
    else if (entry.name.endsWith(".mdx")) out.push(rel);
  }
  return out.sort();
}

const LONG_FORM_PATHS = [
  "README.md",
  "CHANGELOG",
  "CONTRIBUTING.md",
  "SECURITY.md",
  "STYLE_GUIDE.md",
  "COMPATIBILITY_REPORT.md",
  "recommendations.md",
  ...findContentPages("site/content"),
  ".claude/skills/review-schema/reference.md",
].filter((p) => fs.existsSync(path.join(ROOT, p)));

function findSchemaFiles(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...findSchemaFiles(full));
    } else if (entry.name.endsWith(".schema.yaml")) {
      out.push(full);
    }
  }
  return out;
}

const SCHEMA_FILES = findSchemaFiles(path.join(ROOT, "schema"));

// ---------------------------------------------------------------------------
// Schema description extraction
// ---------------------------------------------------------------------------

// Recursively walks a JSON schema and yields every `description` string, skipping the values
// inside `enum`/`pattern`/`default`/`format`/`const` since those aren't human prose.
function* descriptionsOf(node) {
  if (Array.isArray(node)) {
    for (const child of node) yield* descriptionsOf(child);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      if (
        key === "enum" ||
        key === "pattern" ||
        key === "default" ||
        key === "const" ||
        key === "format"
      ) {
        continue;
      }
      if (key === "description" && typeof value === "string") {
        yield value;
      } else {
        yield* descriptionsOf(value);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// readability CLI invocation
// ---------------------------------------------------------------------------

function scoreText(text, { asMarkdown = false } = {}) {
  if (!text || text.trim().length === 0) return null;
  const args = ["--format", "json"];
  if (asMarkdown) args.push("--markdown");
  try {
    const result = execFileSync("readability", args, {
      input: text,
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
    return JSON.parse(result);
  } catch (err) {
    return { error: err.message };
  }
}

function scoreFile(absPath, { markdown = false } = {}) {
  const text = fs.readFileSync(absPath, "utf-8");
  return scoreText(text, { asMarkdown: markdown });
}

// Fail fast when the CLI is absent, otherwise every row reads "(error)" and the aggregate
// math runs on an empty set.
try {
  execFileSync("readability", ["--format", "json"], {
    input: "probe.",
    encoding: "utf-8",
  });
} catch {
  console.error(
    "The `readability` CLI is not on PATH. Symlink the readability tool's " +
      "src-rust/target/release/readability-cli binary onto PATH as `readability`.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function fmt(n, decimals = 1) {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  return typeof n === "number" ? n.toFixed(decimals) : String(n);
}

function pad(s, w, align = "left") {
  const str = String(s);
  if (str.length >= w) return str.slice(0, w);
  const fill = " ".repeat(w - str.length);
  return align === "right" ? fill + str : str + fill;
}

function header(text) {
  console.log("\n" + text);
  console.log("=".repeat(text.length));
}

function row(cols, widths, aligns) {
  const parts = cols.map((c, i) =>
    pad(c, widths[i], aligns ? aligns[i] : "left"),
  );
  console.log(parts.join("  "));
}

const COL_WIDTHS = [42, 7, 22, 9, 9, 11, 13];
const COL_HEADERS = [
  "Source",
  "Score",
  "Grade",
  "Sentences",
  "Words",
  "Complex %",
  "Unfamiliar %",
];
const COL_ALIGNS = ["left", "right", "left", "right", "right", "right", "right"];

function summarizeRow(label, result) {
  if (!result || result.error) {
    row(
      [label, "—", "(error)", "—", "—", "—", "—"],
      COL_WIDTHS,
      COL_ALIGNS,
    );
    return null;
  }
  const stats = result.stats || {};
  const complexPct =
    stats.words && stats.complexWords
      ? (stats.complexWords / stats.words) * 100
      : null;
  const difficultPct =
    stats.words && stats.difficultWords
      ? (stats.difficultWords / stats.words) * 100
      : null;
  row(
    [
      label,
      fmt(result.score, 0),
      result.grade || "",
      fmt(stats.sentences, 0),
      fmt(stats.words, 0),
      fmt(complexPct, 0) + "%",
      fmt(difficultPct, 0) + "%",
    ],
    COL_WIDTHS,
    COL_ALIGNS,
  );
  return { label, score: result.score, grade: result.grade };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const all = [];

header("Long-form content");
row(COL_HEADERS, COL_WIDTHS, COL_ALIGNS);
row(
  COL_WIDTHS.map((w) => "-".repeat(w)),
  COL_WIDTHS,
);
for (const rel of LONG_FORM_PATHS) {
  const abs = path.join(ROOT, rel);
  const isMd = abs.endsWith(".md") || abs.endsWith(".mdx") || rel === "CHANGELOG";
  const result = scoreFile(abs, { markdown: isMd });
  const summary = summarizeRow(rel, result);
  if (summary) all.push({ ...summary, category: "long-form" });
}

header("Schema descriptions (concatenated per file)");
row(COL_HEADERS, COL_WIDTHS, COL_ALIGNS);
row(
  COL_WIDTHS.map((w) => "-".repeat(w)),
  COL_WIDTHS,
);
for (const abs of SCHEMA_FILES) {
  const rel = path.relative(ROOT, abs);
  let data;
  try {
    data = loadSchemaYaml(abs);
  } catch (e) {
    row([rel, "—", "(parse error)", "—", "—", "—", "—"], COL_WIDTHS, COL_ALIGNS);
    continue;
  }
  const descs = Array.from(descriptionsOf(data));
  if (descs.length === 0) {
    row([rel, "—", "(no descriptions)", "—", "—", "—", "—"], COL_WIDTHS, COL_ALIGNS);
    continue;
  }
  // Join with double newline so the CLI counts sentence boundaries correctly.
  const blob = descs.join("\n\n");
  const result = scoreText(blob, { asMarkdown: false });
  const summary = summarizeRow(rel, result);
  if (summary) all.push({ ...summary, category: "schema" });
}

// ---------------------------------------------------------------------------
// Worst offenders
// ---------------------------------------------------------------------------

const SCORE_THRESHOLD = 30;
const offenders = all
  .filter((x) => typeof x.score === "number" && x.score < SCORE_THRESHOLD)
  .sort((a, b) => a.score - b.score);

header(
  `Worst offenders (score < ${SCORE_THRESHOLD}/100; lower is harder to read)`,
);
if (offenders.length === 0) {
  console.log("None — every file scored at least " + SCORE_THRESHOLD + "/100.");
} else {
  for (const o of offenders) {
    console.log(
      `  ${pad(o.label, 50)}  score=${pad(String(o.score), 3, "right")}  (${o.grade})`,
    );
  }
}

const SUMMARY_FILES = all.filter((x) => typeof x.score === "number");
if (SUMMARY_FILES.length === 0) {
  console.error(
    "\nNo files produced a score — every CLI invocation errored. Check `readability` on PATH.",
  );
  process.exit(1);
}
const avgScore =
  SUMMARY_FILES.reduce((sum, x) => sum + x.score, 0) / SUMMARY_FILES.length;

header("Aggregate");
console.log(
  `  Files scored:        ${SUMMARY_FILES.length} (${LONG_FORM_PATHS.length} long-form + ${SCHEMA_FILES.length} schemas)`,
);
console.log(`  Average score:       ${avgScore.toFixed(1)}/100`);
console.log(
  `  Lowest:              ${SUMMARY_FILES.reduce((min, x) => (x.score < min.score ? x : min)).label} (${SUMMARY_FILES.reduce((min, x) => (x.score < min.score ? x : min)).score}/100)`,
);
console.log(
  `  Highest:             ${SUMMARY_FILES.reduce((max, x) => (x.score > max.score ? x : max)).label} (${SUMMARY_FILES.reduce((max, x) => (x.score > max.score ? x : max)).score}/100)`,
);
