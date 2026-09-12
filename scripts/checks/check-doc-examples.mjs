#!/usr/bin/env node
/**
 * Runs the real validator and the real linter over every YAML snippet in the docs an author or
 * an agent copies from: STYLE_GUIDE.md's own examples, and the templates in
 * `.agents/skills/*​/SKILL.md`.
 *
 * Nothing checked these before, and both had rotted. `dsds-add`'s component template wrote
 * `context: how-to-use` (the field is `framing`; `context` has its own enum), carried an empty
 * `items: []` that fails minItems, and put `sourceFiles`/`imports` ahead of `sections` -
 * against the field order the same file told the agent to follow. The style guide's §7
 * "complete example" validated but tripped `DSDS-14` three times.
 *
 * Two passes per snippet:
 *   - Lint always. Order rules read key order, so they work fine on a template full of
 *     `<placeholder>` values. This is what catches a template that contradicts the guide.
 *   - Validate when the snippet is a whole entry or base document. Placeholders are swapped for
 *     stand-ins that satisfy the schema's patterns first (see PLACEHOLDER_STANDINS), and any
 *     file a `sourceFiles`/`specs` entry points at is created in the temp dir so DSDS-11 can
 *     pass. Snippets using a literal `...` elision are illustrative, not documents, so they're
 *     linted but not validated.
 *
 * Run via `npm run check:docs`. Exits non-zero on a parse failure, a validation error, or any
 * order-rule finding.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");

const SOURCES = [
  "STYLE_GUIDE.md",
  ...fs
    .readdirSync(path.join(ROOT, ".agents/skills"))
    .map((d) => `.agents/skills/${d}/SKILL.md`)
    .filter((p) => fs.existsSync(path.join(ROOT, p))),
];

// A template's `<angle bracket>` values are prose, not data. To run the real validator over one
// we need something that satisfies the schema's patterns; a generic token isn't enough because
// `since` is semver-shaped and `platform` is a lowercase-dotted id. Keyed by field name, with a
// plain fallback.
const PLACEHOLDER_STANDINS = {
  since: "1.0.0",
  platform: "react",
  file: "./src/Placeholder.tsx",
  href: "./placeholder.json",
  id: "placeholder",
  package: "@org/ds",
  code: "import { X } from '@org/ds'",
};
const FALLBACK_STANDIN = "placeholder";

const isPlaceholder = (v) => typeof v === "string" && /^<.*>$/.test(v.trim());

function fillPlaceholders(node, key) {
  if (Array.isArray(node)) return node.map((v) => fillPlaceholders(v, key));
  if (node && typeof node === "object") {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillPlaceholders(v, k)]));
  }
  if (!isPlaceholder(node)) return node;
  return PLACEHOLDER_STANDINS[key] ?? FALLBACK_STANDIN;
}

/** Every ```yaml fence in a markdown file, with the line its body starts on. */
function fences(text) {
  const lines = text.split("\n");
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/^```ya?ml\s*$/.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !/^```\s*$/.test(lines[j])) j++;
    out.push({ line: i + 2, body: lines.slice(i + 1, j).join("\n") });
    i = j;
  }
  return out;
}

// A snippet is often a fragment - just `sections:`, or just `items:`. Wrap it into the smallest
// document that makes the order rules apply, so a fragment is checked rather than skipped.
function asDocument(parsed) {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  if ("schemaVersion" in parsed) return { doc: parsed, whole: true };
  if ("entries" in parsed) {
    return { doc: { schemaVersion: readVersion(), name: "Wrapped", ...parsed }, whole: false };
  }
  if ("kind" in parsed && "id" in parsed) return { doc: parsed, whole: true };
  const base = { kind: "entry", id: "wrapped", name: "Wrapped", description: "Wrapped fragment." };
  if ("sections" in parsed || "metadata" in parsed || "combos" in parsed || "refs" in parsed) {
    return { doc: { ...base, ...parsed }, whole: false };
  }
  if ("items" in parsed) {
    return { doc: { ...base, sections: [{ kind: "guidelines", for: "all", ...parsed }] }, whole: false };
  }
  return null;
}

function readVersion() {
  const id = yaml.load(fs.readFileSync(path.join(ROOT, "schema/dsds.bundled.yaml"), "utf8"), {
    schema: yaml.JSON_SCHEMA,
  }).$id;
  return (id.match(/\/v([\d.]+)\//) || [])[1] || "0.0.0";
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsds-doc-examples-"));
let ok = true;
let checked = 0;
let validated = 0;

function run(script, file) {
  try {
    return { out: execFileSync("node", [path.join(ROOT, script), file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), code: 0 };
  } catch (e) {
    return { out: `${e.stdout || ""}${e.stderr || ""}`, code: e.status ?? 1 };
  }
}

for (const rel of SOURCES) {
  const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
  for (const fence of fences(text)) {
    const at = `${rel}:${fence.line}`;
    let parsed;
    try {
      parsed = yaml.load(fence.body, { schema: yaml.JSON_SCHEMA });
    } catch (e) {
      console.error(`✗ ${at}: snippet doesn't parse as YAML — ${e.message.split("\n")[0]}`);
      ok = false;
      continue;
    }
    const wrapped = asDocument(parsed);
    if (!wrapped) continue; // not a document-shaped snippet (a bare enum list, say)
    checked += 1;

    // Lint pass: order rules read key order, so placeholders are fine here.
    const lintFile = path.join(tmp, `lint-${checked}.dsds.yaml`);
    fs.writeFileSync(lintFile, yaml.dump(wrapped.doc, { lineWidth: 0 }));
    const lint = run("scripts/validate/lint-docs.js", lintFile);
    const findings = lint.out
      .split("\n")
      .filter((l) => /⚠ \[DSDS-(1[789]|2[0-3])/.test(l))
      .map((l) => l.trim());
    if (findings.length) {
      console.error(`✗ ${at}: snippet breaks the order rules it's meant to demonstrate:`);
      for (const f of findings) console.error(`    ${f}`);
      ok = false;
    }

    // Validate pass: only for a whole document, and only when it isn't using `...` elisions.
    if (!wrapped.whole || /(^|\s)\.\.\.(\s|$)/.test(fence.body)) continue;
    const filled = fillPlaceholders(wrapped.doc);
    const dir = fs.mkdtempSync(path.join(tmp, "doc-"));
    for (const list of [filled.sourceFiles, filled.specs, filled.imports].filter(Array.isArray)) {
      for (const item of list) {
        const target = typeof item?.file === "string" ? item.file : item?.href;
        if (typeof target !== "string" || /^[a-z]+:/i.test(target)) continue;
        const abs = path.join(dir, target);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, "");
      }
    }
    const docFile = path.join(dir, "snippet.dsds.yaml");
    fs.writeFileSync(docFile, yaml.dump(filled, { lineWidth: 0 }));
    validated += 1;
    const res = run("scripts/validate/validate.js", docFile);
    if (res.code !== 0) {
      console.error(`✗ ${at}: snippet doesn't validate:`);
      for (const line of res.out.split("\n").filter((l) => l.trim().startsWith("- "))) {
        console.error(`    ${line.trim()}`);
      }
      ok = false;
    }
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

if (ok) {
  console.log(
    `✓ All ${checked} YAML snippet(s) in ${SOURCES.length} authoring doc(s) follow the order rules; ` +
      `${validated} that are whole documents also validate.`,
  );
}
process.exit(ok ? 0 : 1);
