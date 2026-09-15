#!/usr/bin/env node
// The rule catalog (schema/conformance-rules.yaml) is the single source of truth validate.js's
// RULES map is built from. Nothing before this asserted the reverse: a catalog entry with a
// typo'd or renamed `name` produces `RULES.THAT_NAME === undefined` silently, surfacing only
// as a confusing failure elsewhere.
//
// Every catalog entry declares `enforcement` (structural|semantic|advisory|none), matching
// README.md's "Enforcement tiers" table. Only `semantic` is checked for drift here - advisory
// entries are checked the same way by lint-docs.js's own startup self-check, since that file
// already owns that list.
"use strict";

const fs = require("fs");
const path = require("path");
const { rootDir, loadYaml } = require("../lib");
const { validateConfig, assertUniqueBy } = require("../config-schema.js");

const CATALOG_PATH = path.join(rootDir, "schema/conformance-rules.yaml");
const VALIDATE_PATH = path.join(rootDir, "scripts/validate/validate.js");

const ENFORCEMENT_VALUES = new Set(["structural", "semantic", "advisory", "none"]);

// Shape first. Nothing checked that a rule has a `title` or a well-formed `id`, so a rule
// missing one rendered as `| \`DSDS-99\` | undefined |` on the published Conformance page while
// the build stayed green.
const catalog = assertUniqueBy(
  validateConfig("conformance-rules", loadYaml(CATALOG_PATH), "schema/conformance-rules.yaml"),
  "id",
  "schema/conformance-rules.yaml"
);
assertUniqueBy(catalog, "name", "schema/conformance-rules.yaml");
let ok = true;

for (const rule of catalog) {
  if (!ENFORCEMENT_VALUES.has(rule.enforcement)) {
    console.error(`✗ ${rule.id} '${rule.name}': enforcement is "${rule.enforcement}", expected one of [${[...ENFORCEMENT_VALUES].join(", ")}]`);
    ok = false;
  }
}

// Bidirectional drift check for the semantic tier: every catalog name with enforcement:
// semantic must be referenced in validate.js, and vice versa - a static text scan, so it
// catches a reference no code path currently exercises too.
const validateSrc = fs.readFileSync(VALIDATE_PATH, "utf-8");
const referencedNames = new Set([...validateSrc.matchAll(/\bRULES\.([A-Z_]+)\b/g)].map((m) => m[1]));

const semanticNames = new Set(catalog.filter((r) => r.enforcement === "semantic").map((r) => r.name));

for (const name of semanticNames) {
  if (!referencedNames.has(name)) {
    console.error(`✗ ${name}: enforcement: semantic in the catalog, but scripts/validate/validate.js never references RULES.${name}`);
    ok = false;
  }
}
for (const name of referencedNames) {
  if (!semanticNames.has(name)) {
    console.error(`✗ RULES.${name}: referenced in scripts/validate/validate.js but has no enforcement: semantic entry (or no entry at all) in the catalog`);
    ok = false;
  }
}

// Prose claims about the catalog drift too - the range is derivable, so assert it rather than
// trusting a human to re-count. Matches "`DSDS-01`–`DSDS-07`", "`DSDS-01` through `DSDS-07`",
// and the same forms without backticks.
const numeric = (id) => Number(id.slice("DSDS-".length));
const byId = (a, b) => numeric(a) - numeric(b);
const ids = catalog.map((r) => r.id).filter((id) => /^DSDS-\d+$/.test(id)).sort(byId);
const lowestId = ids[0];
const highestId = ids[ids.length - 1];

// A range starting at the catalog's first id can legitimately describe either the whole
// catalog or one tier that happens to start there - accurate, not drift. A tier not starting
// at `lowestId` is cited as its own range and never matches the `from !== lowestId` guard below.
const tierEnds = new Map();
for (const rule of catalog) {
  if (!/^DSDS-\d+$/.test(rule.id)) continue;
  const tier = tierEnds.get(rule.enforcement) || [];
  tier.push(rule.id);
  tierEnds.set(rule.enforcement, tier);
}
const allowedEnds = new Set([highestId]);
for (const tierIds of tierEnds.values()) {
  const sorted = [...tierIds].sort(byId);
  if (sorted[0] === lowestId) allowedEnds.add(sorted[sorted.length - 1]);
}

const RANGE_RE = /`?(DSDS-\d+)`?\s*(?:–|—|-|through|to)\s*`?(DSDS-\d+)`?/g;
const PROSE_FILES = ["README.md", "AGENTS.md"];

for (const rel of PROSE_FILES) {
  const filePath = path.join(rootDir, rel);
  if (!fs.existsSync(filePath)) continue;
  const text = fs.readFileSync(filePath, "utf-8");
  for (const m of text.matchAll(RANGE_RE)) {
    const [claim, from, to] = m;
    // Only a range starting at the catalog's own first id claims to describe the whole
    // catalog; a narrower range is prose about a subset.
    if (from !== lowestId) continue;
    if (!allowedEnds.has(to)) {
      const line = text.slice(0, m.index).split("\n").length;
      const expected = [...allowedEnds].sort(byId).map((id) => `${lowestId}–${id}`).join(" or ");
      console.error(`✗ ${rel}:${line}: describes the catalog as "${claim.replace(/\s+/g, " ")}", but the catalog runs ${expected} (${catalog.length} rules)`);
      ok = false;
    }
  }
}

if (ok) {
  console.log(`✓ ${catalog.length} rule(s) (${lowestId}–${highestId}) all declare a valid enforcement tier, every semantic one matches scripts/validate/validate.js exactly, and README.md/AGENTS.md describe the catalog's real range.`);
}
process.exit(ok ? 0 : 1);
