#!/usr/bin/env node
/**
 * lint-docs.js — Editorial lint for DSDS documents (the advisory tier).
 *
 * Schema validation answers "is this document allowed?" scripts/validate/validate.js's
 * DSDS-01–DSDS-10 answer "is this document internally consistent?" This lint
 * answers "is this documentation good?" It runs on documents that already
 * validate, reports quality gaps, and NEVER fails the build for a
 * documentation finding — warnings are warnings, and the exit code is 0.
 *
 * schema/conformance-rules.yaml is the source of truth, same as the
 * semantic tier. At startup this loads the catalog, takes every rule with
 * `enforcement: advisory`, and runs the matching check implementation
 * (keyed by rule `name`, below). Removing a rule from the catalog disables
 * it here with no code change. The one way this script exits non-zero is
 * catalog/code drift — a bidirectional check, same shape as
 * scripts/checks/check-rule-catalog.js's own semantic-tier check: an advisory
 * catalog entry with no implementation, or an implementation with no
 * catalog entry. That's a tooling bug, not a documentation finding, and it
 * should fail loudly.
 *
 * Ported from origin/0.16.0's identical-purpose scripts/lint-docs.js, which
 * itself ported PR #33 (DSDS-011, `token-description-restates-identifier`,
 * by Cody Clark). That version's checks were written against the pre-0.20.0
 * model (`.dsds.json`, `entity.documentBlocks`, `criteria`) — re-implemented
 * here against 0.20.0's `entries`/`sections`/`items` shape instead of
 * carried over verbatim; see each check below for what changed and why.
 *
 * Usage:
 *   node scripts/validate/lint-docs.js [paths…]   # files or directories
 *   npm run lint                    # defaults to the same corpus validate.js does
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { rootDir, loadYaml, defaultTargets, entriesIn } = require("../lib");

const CATALOG_PATH = path.join(rootDir, "schema/conformance-rules.yaml");

function loadCatalog() {
  return loadYaml(CATALOG_PATH);
}

/**
 * Build the active rule set: catalog rules with `enforcement: advisory`,
 * joined to their check implementations. Exits non-zero on drift in either
 * direction — the catalog and this file must agree exactly.
 *
 * Two implementation maps, not one: IMPLEMENTATIONS runs once per entity
 * (entry/shared item) via entriesIn(doc); DOCUMENT_IMPLEMENTATIONS runs
 * once per file, against the raw parsed document, for a rule that's about
 * the document's own top-level shape (DSDS-19's field order) rather than
 * anything inside one entry. A rule name is expected in exactly one map -
 * drift-checked the same way as the single-map case, just unioned first.
 */
function activeRules() {
  const catalog = loadCatalog();
  const advisoryRules = catalog.filter((r) => r.enforcement === "advisory");

  const allImplNames = new Set([...Object.keys(IMPLEMENTATIONS), ...Object.keys(DOCUMENT_IMPLEMENTATIONS)]);
  const missingImpl = advisoryRules.filter((r) => !allImplNames.has(r.name));
  const catalogNames = new Set(advisoryRules.map((r) => r.name));
  const orphanImpl = [...allImplNames].filter((name) => !catalogNames.has(name));

  if (missingImpl.length || orphanImpl.length) {
    for (const r of missingImpl) {
      console.error(`✗ catalog drift: ${r.id} '${r.name}' is enforcement: advisory in schema/conformance-rules.yaml but has no implementation in scripts/validate/lint-docs.js`);
    }
    for (const name of orphanImpl) {
      console.error(`✗ catalog drift: '${name}' is implemented in scripts/validate/lint-docs.js but has no enforcement: advisory entry in schema/conformance-rules.yaml`);
    }
    process.exit(1);
  }

  return advisoryRules.map((r) => ({
    id: r.id,
    name: r.name,
    scope: r.name in DOCUMENT_IMPLEMENTATIONS ? "document" : "entity",
    check: IMPLEMENTATIONS[r.name] || DOCUMENT_IMPLEMENTATIONS[r.name],
  }));
}

// ---------------------------------------------------------------------------
// Check implementations, keyed by catalog rule `name`.
//
// Each receives (entry, emit) once per top-level entry/shared entity (see
// lib.js's entriesIn()) and calls emit(pointer, message) per finding. The
// message follows the same "what's wrong + what to do" formula
// validate.js's own error strings use.
// ---------------------------------------------------------------------------

function normalizeProse(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Every `guidelines` section item across an entry's sections, with a
// pointer for each - the 0.20.0 equivalent of 0.16.0's eachGuidelineItem()
// walk over documentBlocks/criteria, which has no analogue in this model
// (guidelines items live directly under sections[].items, not nested
// inside a second criteria array).
function eachGuidelineItem(entry, fn) {
  (entry.sections || []).forEach((section, si) => {
    if (!section || section.kind !== "guidelines") return;
    (section.items || []).forEach((item, ii) => {
      if (item) fn(item, `/sections/${si}/items/${ii}`);
    });
  });
}

const LOWERCASE_RFC_REGEX = /(?<![A-Za-z])(must|should)(?: not)?(?![A-Za-z])/g;

// ---------------------------------------------------------------------------
// STYLE_GUIDE.md's canonical orders (DSDS-16/17/18/19). Kept here, not
// derived from the schema files - the schema imposes no order at all (see
// STYLE_GUIDE.md's own opening paragraph), so there is no single source to
// read this back out of; STYLE_GUIDE.md and this list have to be kept in
// sync by hand when one changes.
// ---------------------------------------------------------------------------

const ENTRY_FIELD_ORDER = {
  component: ["id", "kind", "name", "description", "purpose", "metadata", "sourceFiles", "sections", "specs", "imports", "traits", "combos", "related", "extends", "refs", "$extensions"],
  token: ["id", "kind", "name", "description", "purpose", "tokenType", "source", "metadata", "sections", "combos", "related", "extends", "refs", "$extensions"],
  theme: ["id", "kind", "name", "description", "purpose", "colorScheme", "source", "metadata", "sections", "related", "extends", "refs", "$extensions"],
  system: ["id", "kind", "name", "description", "purpose", "metadata", "sections", "related", "extends", "refs", "$extensions"],
  entry: ["id", "kind", "name", "description", "purpose", "metadata", "sections", "related", "extends", "refs", "$extensions"],
};
const SHARED_FIELD_ORDER = ["id", "name", "description", "metadata", "sections", "refs", "$extensions"];
const DOCUMENT_FIELD_ORDER = ["schemaVersion", "$schema", "name", "entries", "shared", "refs", "$extensions"];
const SECTION_KIND_RANK = { guidelines: 0, definitions: 1, steps: 2, section: 3 };
const GUIDELINE_LEVEL_RANK = { must: 0, should: 1, may: 2, "should-not": 3, "must-not": 4 };

// Returns the out-of-order pair, or null if `actual` (filtered to keys that
// also appear in `canonical`) is already non-decreasing by canonical rank -
// the general "is this sequence sorted per this canonical list" check
// DSDS-16/17/18/19 all reduce to, just over different kinds of items.
function firstInversion(actual, rankOf) {
  for (let i = 1; i < actual.length; i++) {
    if (rankOf(actual[i]) < rankOf(actual[i - 1])) return [actual[i - 1], actual[i]];
  }
  return null;
}

const IMPLEMENTATIONS = {
  // Direct port of 0.16.0's check of the same name - only the walk changed
  // (guideline items live at sections[].items now, not
  // documentBlocks[].items), the regex and reasoning are identical.
  "rfc-keywords-lowercase-in-normative-prose": (entry, emit) => {
    eachGuidelineItem(entry, (item, p) => {
      if (typeof item.statement !== "string") return;
      const hits = item.statement.match(LOWERCASE_RFC_REGEX);
      if (hits) {
        emit(
          `${p}/statement`,
          `guideline in "${entry.id}" uses lowercase '${hits[0]}' in its statement — capitalize RFC 2119 keywords in normative prose (${hits[0].toUpperCase()}) so the conformance weight is explicit.`,
        );
      }
    });
  },

  // Ported from PR #33 (DSDS-011, by Cody Clark) - same algorithm
  // (normalize both strings, flag an exact restatement or a bare value
  // literal), adapted to a token entry's own id/name/description fields
  // directly (0.20.0 has no separate token-group kind to also check).
  "token-description-restates-identifier": (entry, emit) => {
    if (entry.kind !== "token") return;
    const desc = entry.description;
    if (typeof desc !== "string" || !desc.trim()) return;
    const raw = desc.trim();
    const d = normalizeProse(desc);
    if (!d) return;
    const id = normalizeProse(entry.id || "");
    const name = normalizeProse(entry.name || "");
    const restatesName = (id && d === id) || (name && d === name);
    const isBareValue =
      /^#[0-9a-f]{3,8}$/i.test(raw) ||
      /^(rgb|hsl)a?\([^)]*\)$/i.test(raw) ||
      /^-?\d*\.?\d+(px|rem|em|%|pt|vh|vw)?$/i.test(raw);
    if (restatesName || isBareValue) {
      emit(
        "/description",
        `token "${entry.id}" has a description that only ${restatesName ? "restates its id or name" : "gives a raw value"} — a token description should state the token's role or when to use it, not repeat what the id or the DTCG source value already says. Drop it (description is optional here) or state its purpose.`,
      );
    }
  },

  // No analogue in 0.16.0 - that model's "criterion-missing-verification"
  // checked a separate accessibility-criteria array 0.20.0 doesn't have.
  // The equivalent gap in this model is a hard-requirement guideline
  // (level: must/must-not) with no checkedBy at all: a tool has no way to
  // tell whether it's automatable, so it stays invisible to any dashboard
  // built off checkedBy. DSDS-03 already blocks the narrower case
  // (checkedBy: automated with no checks ref); this flags the case DSDS-03
  // can't see - checkedBy left out entirely.
  "guideline-missing-checkedby": (entry, emit) => {
    eachGuidelineItem(entry, (item, p) => {
      if ((item.level === "must" || item.level === "must-not") && !item.checkedBy) {
        emit(
          `${p}/checkedBy`,
          `guideline in "${entry.id}" is a hard requirement (level: ${item.level}) with no checkedBy — declare 'automated', 'assisted', or 'manual' so a tool can tell whether this rule is verifiable at all.`,
        );
      }
    });
  },

  // Adapted from 0.16.0's "entity-missing-use-cases" (which checked for a
  // documentBlocks entry of kind: use-cases). 0.20.0 folds that content
  // into a guidelines section with framing: when-to-use instead of a
  // separate block kind - this checks for that section's presence on a
  // component the same way the original checked for the block's.
  "component-missing-when-to-use": (entry, emit) => {
    if (entry.kind !== "component") return;
    const hasWhenToUse = (entry.sections || []).some(
      (s) => s && s.kind === "guidelines" && s.framing === "when-to-use",
    );
    if (!hasWhenToUse) {
      emit(
        "/sections",
        `component "${entry.id}" has no guidelines section with framing: when-to-use — "when do I use this?" is usually the first question documentation must answer. Add one, or note in metadata why it doesn't apply.`,
      );
    }
  },

  // Ported from PR #37 (DSDS-012, by Cody Clark) - the scale-position
  // companion to token-description-restates-identifier (DSDS-13). Same
  // algorithm as the original: flag a description that reduces to a single
  // leading scale word plus a number and nothing else - the ordinal the id
  // and the token's place among its metadata.group siblings already carry.
  // Adapted to 0.20.0's model the same way DSDS-13 was: a token entry's own
  // id/name/description, kind: token only (0.20.0 has no token-group kind).
  "token-description-restates-scale-position": (entry, emit) => {
    if (entry.kind !== "token") return;
    const desc = entry.description;
    if (typeof desc !== "string" || !desc.trim()) return;
    const d = normalizeProse(desc);
    if (!d) return;
    // A description that restates the id or name is DSDS-13's case; leave it
    // there so one that is both is reported once, not twice.
    const id = normalizeProse(entry.id || "");
    const name = normalizeProse(entry.name || "");
    if ((id && d === id) || (name && d === name)) return;
    // A single leading scale word plus a number, and nothing else: "shade
    // 900", "step 500", "level six", and the phrasal "level 6 of the neutral
    // scale"/"ramp". Kept deliberately narrow - the scale word must lead and
    // be singular, so number-first and plural forms ("nine weights", "twelve
    // steps") and a bare family-plus-number ("neutral 700") are left alone,
    // and any role or usage word stops the match. See the DSDS-16 note in
    // schema/conformance-rules.yaml.
    const SW = "(?:level|step|shade|tint|grade|weight|size|swatch)";
    const N = "(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
    const scaleOnly = [
      new RegExp(`^${SW} ${N}$`),
      new RegExp(`^${SW} ${N} of the [a-z]+ (?:scale|ramp)$`),
    ];
    if (scaleOnly.some((re) => re.test(d))) {
      emit(
        "/description",
        `token "${entry.id}" has a description that only restates its scale position — a token description should state the token's role or when to use it, not repeat the ordinal the id and its place in the scale already carry. Drop it (description is optional here) or state its purpose.`,
      );
    }
  },

  // STYLE_GUIDE.md §1 - only checks the relative order of fields actually
  // present (firstInversion filters `actual` to keys in `order` first), so
  // an entry that leaves a field out is never flagged for its absence.
  "entry-field-order": (entry, emit) => {
    const order = entry.kind === undefined ? SHARED_FIELD_ORDER : (ENTRY_FIELD_ORDER[entry.kind] || ENTRY_FIELD_ORDER.entry);
    const actual = Object.keys(entry).filter((k) => order.includes(k));
    const inversion = firstInversion(actual, (k) => order.indexOf(k));
    if (inversion) {
      emit(
        "",
        `"${entry.id}" has \`${inversion[0]}\` before \`${inversion[1]}\` — STYLE_GUIDE.md orders a ${entry.kind || "shared"} entry's fields as [${order.join(", ")}]. Actual order here: [${actual.join(", ")}].`,
      );
    }
  },

  // STYLE_GUIDE.md §2 - same-kind sections must stay contiguous and
  // general-to-specific (guidelines, definitions, steps, section); among
  // guidelines sections specifically, framing: when-to-use comes first.
  // Doesn't attempt the tag-scoped-guidelines sub-tier (see this rule's
  // own catalog note) - not mechanically checkable the same way.
  "section-order": (entry, emit) => {
    const sections = entry.sections;
    if (!Array.isArray(sections) || sections.length < 2) return;
    const kindInversion = firstInversion(sections, (s) => SECTION_KIND_RANK[s.kind] ?? 99);
    if (kindInversion) {
      emit(
        "/sections",
        `"${entry.id}" has a "${kindInversion[0].kind}" section before a "${kindInversion[1].kind}" section, out of STYLE_GUIDE.md's grouping — same-kind sections stay contiguous, ordered guidelines, definitions, steps, section (general to specific).`,
      );
      return; // fix grouping first - the framing check below assumes the guidelines sections are already one contiguous run
    }
    const guidelinesRun = sections.filter((s) => s.kind === "guidelines");
    const framingInversion = firstInversion(guidelinesRun, (s) => (s.framing === "when-to-use" ? 0 : 1));
    if (framingInversion) {
      emit(
        "/sections",
        `"${entry.id}" has a how-to-use guidelines section before a when-to-use one — STYLE_GUIDE.md orders \`framing: when-to-use\` first.`,
      );
    }
  },

  // STYLE_GUIDE.md §3 - must, should, may, should-not, must-not. Items
  // sharing a level keep their relative order (firstInversion only flags a
  // strict level-to-level inversion, not a tie).
  "guideline-item-level-order": (entry, emit) => {
    (entry.sections || []).forEach((section, si) => {
      if (!section || section.kind !== "guidelines" || !Array.isArray(section.items)) return;
      const inversion = firstInversion(section.items, (it) => GUIDELINE_LEVEL_RANK[it.level] ?? 99);
      if (inversion) {
        emit(
          `/sections/${si}/items`,
          `"${entry.id}" has a level: ${inversion[0].level} item before a level: ${inversion[1].level} one — STYLE_GUIDE.md orders guideline items must, should, may, should-not, must-not.`,
        );
      }
    });
  },
};

// Document-scoped rules run once per file, against the raw parsed
// document, instead of once per entity - see activeRules()'s own comment.
const DOCUMENT_IMPLEMENTATIONS = {
  // STYLE_GUIDE.md's "Base documents" order. Only applies to a base
  // document (has schemaVersion) - a standalone entry file has no
  // document-level fields of its own to order.
  "document-field-order": (doc, emit) => {
    if (typeof doc.schemaVersion === "undefined") return;
    const actual = Object.keys(doc).filter((k) => DOCUMENT_FIELD_ORDER.includes(k));
    const inversion = firstInversion(actual, (k) => DOCUMENT_FIELD_ORDER.indexOf(k));
    if (inversion) {
      emit(
        "",
        `document has \`${inversion[0]}\` before \`${inversion[1]}\` — STYLE_GUIDE.md orders a base document's fields as [${DOCUMENT_FIELD_ORDER.join(", ")}]. Actual order here: [${actual.join(", ")}].`,
      );
    }
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function main() {
  const rules = activeRules();

  const args = process.argv.slice(2);
  const targets = args.length
    ? args.flatMap((t) => {
        const stat = fs.existsSync(t) && fs.statSync(t);
        if (!stat) {
          console.error(`✗ Not found: ${t}`);
          return [];
        }
        if (stat.isFile()) return [t];
        return fs.readdirSync(t).filter((f) => f.endsWith(".yaml")).map((f) => path.join(t, f));
      })
    : defaultTargets();

  console.log("\nDSDS Doc Lint (warnings only — never fails the build)");
  console.log(`  ${rules.length} rule(s) from schema/conformance-rules.yaml: ${rules.map((r) => r.id).join(", ")}\n`);

  let totalFindings = 0;
  let cleanFiles = 0;

  for (const target of targets) {
    let doc;
    try {
      doc = loadYaml(target);
    } catch {
      continue; // not this tool's job - validate.js reports parse errors
    }
    const rel = path.relative(process.cwd(), target);
    const findings = [];
    for (const rule of rules) {
      if (rule.scope !== "document") continue;
      rule.check(doc, (p, message) => findings.push({ id: rule.id, rule: rule.name, path: p, message }));
    }
    for (const entry of entriesIn(doc)) {
      for (const rule of rules) {
        if (rule.scope === "document") continue;
        rule.check(entry, (p, message) => findings.push({ id: rule.id, rule: rule.name, path: p, message }));
      }
    }
    if (findings.length === 0) {
      cleanFiles++;
      continue;
    }
    console.log(`  ${rel}`);
    for (const f of findings) {
      console.log(`    ⚠ [${f.id} ${f.rule}] ${f.path}: ${f.message}`);
      totalFindings++;
    }
    console.log("");
  }

  console.log(`  ${targets.length} file(s) linted: ${cleanFiles} clean, ${totalFindings} warning(s).\n`);
}

main();
