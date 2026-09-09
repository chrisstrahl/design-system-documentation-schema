#!/usr/bin/env node
/**
 * Editorial lint for DSDS documents (the advisory tier): schema validation and validate.js's
 * DSDS-01-10 answer "is this document allowed/consistent?", this answers "is this
 * documentation good?" It runs on documents that already validate, reports quality gaps, and
 * never fails the build - exit code is always 0 for a documentation finding.
 *
 * schema/conformance-rules.yaml is the source of truth: at startup this loads every
 * `enforcement: advisory` rule and runs its matching check implementation, keyed by rule
 * `name`. The only way this script exits non-zero is catalog/code drift (an advisory entry
 * with no implementation, or vice versa) - a tooling bug, not a documentation finding.
 *
 * Usage: node scripts/validate/lint-docs.js [paths…], or `npm run lint`.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  rootDir,
  loadYaml,
  defaultTargets,
  entriesIn,
  declaredProps,
  entryFieldOrder,
  declaredEnum,
  enumRanker,
} = require("../lib");

const CATALOG_PATH = path.join(rootDir, "schema/conformance-rules.yaml");

function loadCatalog() {
  return loadYaml(CATALOG_PATH);
}

/**
 * Build the active rule set: catalog rules with `enforcement: advisory`, joined to their
 * check implementations, exiting non-zero on drift in either direction. Two implementation
 * maps: IMPLEMENTATIONS runs once per entity via entriesIn(doc); DOCUMENT_IMPLEMENTATIONS
 * runs once per file against the raw parsed document, for rules about the document's own
 * top-level shape rather than anything inside one entry.
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
// Check implementations, keyed by catalog rule `name`. Each receives (entry, emit) once per
// top-level entry/shared entity and calls emit(pointer, message) per finding, following the
// same "what's wrong + what to do" formula validate.js's error strings use.
// ---------------------------------------------------------------------------

function normalizeProse(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Every `guidelines` section item across an entry's sections, with a pointer for each.
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
// STYLE_GUIDE.md's canonical orders (DSDS-17/18/19/20). Field order comes from the schema
// files; the rank tables further down do not, because they order the items inside an array
// and no schema file has an opinion about that. Those are kept in sync with the guide by hand.
// ---------------------------------------------------------------------------

// Read out of the schema files, not transcribed from them. STYLE_GUIDE.md's rule is to
// follow the order the schema lists, so reading that order at runtime is the only honest way
// to check it - a hardcoded table here would be a second source of truth for the exact thing
// the guide says has one, and it drifted twice before this became derived (a stale
// `related`/`extends` order, and `imports` in the wrong place). See lib.js's
// `entryFieldOrder` for how the two lists compose.
const SHARED_FIELD_ORDER = declaredProps("shared.schema.yaml");
const DOCUMENT_FIELD_ORDER = declaredProps("base.schema.yaml");
// Read from the schema enums, in the order each one declares its values. These used to be
// hand-kept tables here; the enums were reordered to match the guide, so the schema now
// records these orders and this file reads them instead of holding a second copy. Each ranker
// also picks up the `default` its schema declares, so a section that leaves `for` or `framing`
// out is ranked as the value a validator would read it as.
const KIND_AT = (d) => d.properties.kind.oneOf.find((m) => m.enum);
const SECTION_KIND = declaredEnum("sections/section.schema.yaml", KIND_AT);
// A namespaced custom kind ("acme.custom-section") isn't in the enum and has no defined place
// in the order, so it ranks last rather than being treated as unknown-and-therefore-equal.
const sectionKindRank = enumRanker("sections/section.schema.yaml", KIND_AT);

const AUDIENCE = declaredEnum("sections/section.schema.yaml", (d) => d.properties.for);
const audienceRank = enumRanker("sections/section.schema.yaml", (d) => d.properties.for);

const FRAMING_AT = (d) => d.allOf.find((m) => m.properties).properties.framing;
const FRAMING = declaredEnum("sections/guidelines.schema.yaml", FRAMING_AT);
const framingRank = enumRanker("sections/guidelines.schema.yaml", FRAMING_AT);

const LEVEL = declaredEnum("common/requirement-level.schema.yaml", (d) => d);
const levelRank = enumRanker("common/requirement-level.schema.yaml", (d) => d);

// How a section's audience reads once the schema's default is applied, for use in messages.
// A section that leaves `for` out is ranked as the default, so it has to be named as the
// default too - printing "for: undefined" would describe the document rather than the problem.
function describeAudience(section) {
  return section.for === undefined ? `${AUDIENCE.fallback} (defaulted)` : section.for;
}

// Returns the first out-of-order pair, or null if `actual` is already non-decreasing by
// canonical rank - the general "is this sequence sorted" check DSDS-17/18/19/20 all reduce to.
function firstInversion(actual, rankOf) {
  for (let i = 1; i < actual.length; i++) {
    if (rankOf(actual[i]) < rankOf(actual[i - 1])) return [actual[i - 1], actual[i]];
  }
  return null;
}

const IMPLEMENTATIONS = {
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

  // Normalizes both strings and flags an exact restatement or a bare value literal.
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

  // A hard-requirement guideline (level: must/must-not) with no checkedBy at all is invisible
  // to any dashboard built off it. DSDS-03 already blocks the narrower case (checkedBy:
  // automated with no checks ref); this flags checkedBy left out entirely.
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

  // The scale-position companion to token-description-restates-identifier (DSDS-13): flags a
  // description that reduces to a single leading scale word plus a number and nothing else -
  // the ordinal the id and the token's metadata.group position already carry.
  "token-description-restates-scale-position": (entry, emit) => {
    if (entry.kind !== "token") return;
    const desc = entry.description;
    if (typeof desc !== "string" || !desc.trim()) return;
    const d = normalizeProse(desc);
    if (!d) return;
    // A description that restates the id or name is DSDS-13's case; leave it there so one
    // that is both is reported once, not twice.
    const id = normalizeProse(entry.id || "");
    const name = normalizeProse(entry.name || "");
    if ((id && d === id) || (name && d === name)) return;
    // A single leading scale word plus a number, and nothing else ("shade 900", "level 6 of
    // the neutral scale"). Kept narrow: the scale word must lead and be singular, so
    // number-first/plural forms and any role/usage word leave it alone. See DSDS-16's note.
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

  // STYLE_GUIDE.md §2 - only checks the relative order of fields actually present, so an
  // entry that leaves a field out is never flagged for its absence.
  "entry-field-order": (entry, emit) => {
    // A namespaced custom kind (`acme.icon-library`) has no schema file of its own, so it
    // falls back to the bare envelope - the same fallback entry.schema.yaml's dispatch gives it.
    const order = entry.kind === undefined ? SHARED_FIELD_ORDER : entryFieldOrder(entry.kind);
    const actual = Object.keys(entry).filter((k) => order.includes(k));
    const inversion = firstInversion(actual, (k) => order.indexOf(k));
    if (inversion) {
      const source = entry.kind === undefined
        ? "shared.schema.yaml"
        : `entries/entry.schema.yaml, then entries/${entry.kind}.schema.yaml`;
      emit(
        "",
        `"${entry.id}" has \`${inversion[0]}\` before \`${inversion[1]}\` — STYLE_GUIDE.md §2 says match the spec's own declared order, which for a ${entry.kind || "shared"} entry (${source}) is [${order.join(", ")}]. Actual order here: [${actual.join(", ")}].`,
      );
    }
  },

  // STYLE_GUIDE.md §4 - same-kind sections must stay contiguous and general-to-specific
  // (guidelines, definitions, steps, section); among guidelines sections, framing:
  // when-to-use comes first, then audience (all, human, agent) within one framing group.
  // Doesn't attempt the tag-scoped-guidelines sub-tier (see this rule's catalog note) -
  // "this section is really about one tag" means reading its items, not its shape.
  "section-order": (entry, emit) => {
    const sections = entry.sections;
    if (!Array.isArray(sections) || sections.length < 2) return;
    const kindInversion = firstInversion(sections, (s) => sectionKindRank(s.kind));
    if (kindInversion) {
      emit(
        "/sections",
        `"${entry.id}" has a "${kindInversion[0].kind}" section before a "${kindInversion[1].kind}" section, out of STYLE_GUIDE.md's grouping — same-kind sections stay contiguous, ordered ${SECTION_KIND.values.join(", ")} (general to specific).`,
      );
      return; // fix grouping first - the framing check below assumes the guidelines sections are already one contiguous run
    }
    const guidelinesRun = sections.filter((s) => s.kind === "guidelines");
    const framingInversion = firstInversion(guidelinesRun, (s) => framingRank(s.framing));
    if (framingInversion) {
      emit(
        "/sections",
        `"${entry.id}" has a how-to-use guidelines section before a when-to-use one — STYLE_GUIDE.md orders \`framing\` ${FRAMING.values.join(", ")}.`,
      );
      return; // fix specificity first - the audience sort below only orders sections that TIE on framing
    }
    // Audience, within one framing group only. Grouping by framing rather than scanning the
    // whole run is what keeps the two sorts composed in the right order: a `for: agent`
    // when-to-use section legitimately precedes a `for: all` how-to-use one, so comparing
    // those two on `for` would be a false positive.
    const byFraming = new Map();
    for (const s of guidelinesRun) {
      const framing = s.framing || FRAMING.fallback;
      if (!byFraming.has(framing)) byFraming.set(framing, []);
      byFraming.get(framing).push(s);
    }
    for (const [framing, run] of byFraming) {
      const audienceInversion = firstInversion(run, (s) => audienceRank(s.for));
      if (audienceInversion) {
        emit(
          "/sections",
          `"${entry.id}" has a \`for: ${describeAudience(audienceInversion[0])}\` guidelines section before a \`for: ${describeAudience(audienceInversion[1])}\` one (both ${framing}) — STYLE_GUIDE.md orders audience ${AUDIENCE.values.join(", ")}, broadest readership first.`,
        );
        break;
      }
    }
  },

  // STYLE_GUIDE.md §5 - must, should, may, should-not, must-not. Items sharing a level keep
  // their relative order; only a strict level-to-level inversion is flagged.
  "guideline-item-level-order": (entry, emit) => {
    (entry.sections || []).forEach((section, si) => {
      if (!section || section.kind !== "guidelines" || !Array.isArray(section.items)) return;
      const inversion = firstInversion(section.items, (it) => levelRank(it.level));
      if (inversion) {
        emit(
          `/sections/${si}/items`,
          `"${entry.id}" has a level: ${inversion[0].level} item before a level: ${inversion[1].level} one — STYLE_GUIDE.md orders guideline items ${LEVEL.values.join(", ")}.`,
        );
      }
    });
  },
};

// Document-scoped rules run once per file, against the raw parsed document, instead of once
// per entity - see activeRules()'s own comment.
const DOCUMENT_IMPLEMENTATIONS = {
  // STYLE_GUIDE.md's "Base documents" order - only applies to a base document (has
  // schemaVersion); a standalone entry file has no document-level fields to order.
  "document-field-order": (doc, emit) => {
    if (typeof doc.schemaVersion === "undefined") return;
    const actual = Object.keys(doc).filter((k) => DOCUMENT_FIELD_ORDER.includes(k));
    const inversion = firstInversion(actual, (k) => DOCUMENT_FIELD_ORDER.indexOf(k));
    if (inversion) {
      emit(
        "",
        `document has \`${inversion[0]}\` before \`${inversion[1]}\` — STYLE_GUIDE.md says match the spec's own declared order, which for a base document (base.schema.yaml) is [${DOCUMENT_FIELD_ORDER.join(", ")}]. Actual order here: [${actual.join(", ")}].`,
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
