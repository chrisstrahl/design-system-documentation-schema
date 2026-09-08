#!/usr/bin/env node
// Validates entry and base document YAML file(s): each entry against its own
// entries/<kind>.schema.yaml (falling back to entry.schema.yaml), each section against its own
// sections/<kind>.schema.yaml, plus the semantic rules below (ref resolution, cycles, etc). A
// file with a `schemaVersion` key is a base document; its inline `entries` are checked the
// same way a standalone entry file's are.
"use strict";

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");
const { rootDir, schemaDir, loadYaml, walkYamlFiles, defaultTargets, findRefs, entriesIn } = require("../lib");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

// Stable ids for every semantic (hand-written) check this validator enforces, so a fixture or
// an independent implementation can cite which rule failed. Not applied to pure JSON Schema
// errors, which already cite instancePath/schemaPath. Filtered to enforcement: semantic - the
// catalog (schema/conformance-rules.yaml) also carries structural and advisory (lint-docs.js) entries.
const RULES = Object.fromEntries(
  loadYaml(path.join(rootDir, "schema/conformance-rules.yaml"))
    .filter((rule) => rule.enforcement === "semantic")
    .map((rule) => [rule.name, rule.id])
);

function err(id, message) {
  return `[${id}] ${message}`;
}

// Register every schema file by its $id so cross-file $refs resolve. schemaById keeps the raw
// parsed objects around too, so discriminator-aware validation below can inspect them directly.
const schemaById = new Map();
for (const file of walkYamlFiles(schemaDir)) {
  const schema = loadYaml(file);
  ajv.addSchema(schema, schema.$id);
  schemaById.set(schema.$id, schema);
}

function schemaFor(id, fallbackId, profileId) {
  if (profileId) {
    const profileValidate = ajv.getSchema(profileId);
    if (profileValidate) return profileValidate;
  }
  return ajv.getSchema(id) || ajv.getSchema(fallbackId);
}

// Optional local profiles: a project can drop a file at profiles/entries/<kind>.schema.yaml or
// profiles/sections/<kind>.schema.yaml that narrows an existing kind (never adds a field) - see
// extending.mdx. profiles/ is a sibling of schema/, so bundle.js's own walk never sees it. A
// profile must declare its own $id, distinct from the schema it profiles, or Ajv crashes on the collision.
const PROFILES_DIR = path.join(rootDir, "profiles");
const profileEntryIdByKind = new Map(); // kind -> profile's own $id
const profileSectionIdByKind = new Map();

function loadProfiles(subdir, targetMap) {
  const dir = path.join(PROFILES_DIR, subdir);
  if (!fs.existsSync(dir)) return;
  for (const file of walkYamlFiles(dir)) {
    const schema = loadYaml(file);
    if (!schema.$id) {
      throw new Error(`Profile ${path.relative(rootDir, file)} has no $id of its own.`);
    }
    ajv.addSchema(schema, schema.$id);
    const kind = path.basename(file).replace(/\.schema\.yaml$/, "");
    targetMap.set(kind, schema.$id);
  }
}
loadProfiles("entries", profileEntryIdByKind);
loadProfiles("sections", profileSectionIdByKind);

// Project discovery: follows rel: file links transitively so ref resolution can run against a
// whole multi-file system, not just the one file handed to the validator. Bounded to the
// directory of the file being validated (and its subdirectories) as a real security boundary -
// a hosted validator fed an untrusted document must not follow an href like `../../etc/passwd`.
// This means a sibling in a parent/cousin directory won't be found (unresolved `to:` there is a
// warning, not a confirmed break); an explicit `--root` flag would widen it, not implemented yet.
function resolveHref(href, fromAbsPath) {
  return path.resolve(path.dirname(fromAbsPath), href);
}

function isWithinRoot(absPath, root) {
  const rel = path.relative(root, absPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

// Returns every entry/shared entity reachable from entryAbsPath via rel: file, plus siblingCount
// (files actually read) - a missing/unparseable/out-of-bounds sibling is silently skipped, so
// callers can tell "checked, not there" from "nothing else was reachable."
function loadProject(entryAbsPath) {
  const root = path.dirname(entryAbsPath);
  const visited = new Map(); // absPath -> doc
  const queue = [entryAbsPath];

  while (queue.length) {
    const absPath = queue.shift();
    if (visited.has(absPath)) continue;
    if (!isWithinRoot(absPath, root) || !fs.existsSync(absPath)) continue;
    let doc;
    try {
      doc = loadYaml(absPath);
    } catch (e) {
      continue;
    }
    visited.set(absPath, doc);
    for (const fileRef of doc.refs || []) {
      if (fileRef && fileRef.rel === "file" && typeof fileRef.href === "string") {
        queue.push(resolveHref(fileRef.href, absPath));
      }
    }
  }

  return {
    entities: [...visited.values()].flatMap((d) => entriesIn(d)),
    siblingCount: Math.max(0, visited.size - 1),
  };
}

// DSDS-11: does a relative sourceFiles[].file/source/rel:file href exist on disk? Reuses the
// same directory boundary as loadProject(). URL-scheme hrefs (https:, npm:) are never checked.
const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

function checkFileExists(href, filePath, warnings, label) {
  if (!filePath || typeof href !== "string" || URL_SCHEME_RE.test(href)) return;
  const abs = resolveHref(href, filePath);
  const root = path.dirname(filePath);
  if (!isWithinRoot(abs, root)) return; // outside this check's boundary - not evaluated, not assumed broken
  if (!fs.existsSync(abs)) {
    warnings.push(err(RULES.FILE_REF_EXISTS, `${label} points at "${href}", which doesn't exist on disk (checked ${path.relative(rootDir, abs)})`));
  }
}

// Every {href, rel: "file"} object anywhere in an entity's tree - the same walk findRefs() does
// for {to, rel}, but keyed on href since a file-pointing ref is never a `to:`.
function findFileHrefRefs(value, out) {
  if (Array.isArray(value)) {
    value.forEach((item) => findFileHrefRefs(item, out));
    return;
  }
  if (value && typeof value === "object") {
    if (value.rel === "file" && typeof value.href === "string") out.push(value.href);
    for (const val of Object.values(value)) findFileHrefRefs(val, out);
  }
}

// sourceFiles[].file and source accept a bare string (shorthand for href) or a full {href, ...}
// object - both point at a file regardless of `rel`, unlike a general `refs` entry.
function refHref(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.href === "string") return value.href;
  return undefined;
}

function validateFileRefs(entity, warnings, opts) {
  if (!opts.filePath) return;
  if (entity.kind === "component") {
    for (const [i, sf] of (entity.sourceFiles || []).entries()) {
      checkFileExists(refHref(sf.file), opts.filePath, warnings, `"${entity.id}" sourceFiles[${i}].file`);
    }
  }
  if (entity.kind === "token" && entity.source !== undefined) {
    checkFileExists(refHref(entity.source), opts.filePath, warnings, `"${entity.id}" source`);
  }
  // Exclude sourceFiles/source from this generic walk - already checked
  // explicitly above, regardless of whether they use the bare-string or
  // {href, rel: file} object form. Walking them again here would double
  // up a finding whenever the object form happens to carry rel: file.
  const { sourceFiles, source, ...rest } = entity;
  const fileHrefs = [];
  findFileHrefRefs(rest, fileHrefs);
  for (const href of fileHrefs) {
    checkFileExists(href, opts.filePath, warnings, `"${entity.id}" ref (rel: file)`);
  }
}

// The current spec version, read back out of any loaded schema's own $id rather than
// hardcoded, so this file never needs touching on a version bump.
const SPEC_VERSION = (() => {
  for (const id of schemaById.keys()) {
    const m = /\/v([^/]+)\//.exec(id);
    if (m) return m[1];
  }
  throw new Error("Could not determine the spec version from any loaded schema's $id.");
})();

function specUrl(relPath) {
  return `https://designsystemdocspec.org/v${SPEC_VERSION}/${relPath}`;
}

// A branch is either a plain object schema or one that extends a shared base via allOf; the
// discriminator field can live as a sibling of `allOf` (current shape) or inside one of its
// array elements (older shape, kept as a fallback). Returns the branch's matching tag values,
// or null if it has no such field.
function branchDiscriminatorValues(branch, prop) {
  const candidates = [branch, ...(branch.allOf || [])];
  for (const candidate of candidates) {
    const propSchema = candidate.properties && candidate.properties[prop];
    if (!propSchema) continue;
    if (propSchema.const !== undefined) return [propSchema.const];
    if (Array.isArray(propSchema.enum)) return propSchema.enum;
  }
  return null;
}

const branchValidatorCache = new Map();
function compileBranch(branch) {
  let validate = branchValidatorCache.get(branch);
  if (!validate) {
    validate = ajv.compile(branch);
    branchValidatorCache.set(branch, validate);
  }
  return validate;
}

// Brute-forcing all of Ajv's anyOf branches on a typo produces 20+ irrelevant errors. Since each
// branch declares which tag value it's for, read the tag first and validate only that branch.
function validateDiscriminatedItems(items, branches, prop, label, errors) {
  const fallbackBranch = branches.find((b) => branchDiscriminatorValues(b, prop) === null);
  const knownValues = [...new Set(branches.flatMap((b) => branchDiscriminatorValues(b, prop) || []))];

  for (const [i, item] of (items || []).entries()) {
    const itemLabel = `${label}[${i}]`;
    const value = item && item[prop];

    let branch;
    if (value === undefined) {
      branch = fallbackBranch;
      if (!branch) {
        errors.push(`${itemLabel} is missing "${prop}" (expected one of [${knownValues.join(", ")}])`);
        continue;
      }
    } else {
      branch = branches.find((b) => (branchDiscriminatorValues(b, prop) || []).includes(value));
      if (!branch) {
        errors.push(`${itemLabel} has "${prop}": ${JSON.stringify(value)}, which is not one of [${knownValues.join(", ")}]`);
        continue;
      }
    }

    const validateBranch = compileBranch(branch);
    if (!validateBranch(item)) {
      const tag = value !== undefined ? value : "(untagged)";
      for (const err of validateBranch.errors) {
        errors.push(`${itemLabel} (${prop}: ${tag}) schema: ${err.instancePath || "/"} ${err.message}`);
      }
    }
  }
}

function traitsBranches() {
  const schema = schemaById.get(specUrl("entries/component.schema.yaml"));
  return schema.allOf[1].properties.traits.items.anyOf;
}

// Ajv reports a failed `contains` by surfacing every per-item probe error alongside the real
// summary - noise, not signal. Collapses those into one message built from what it found.
function collapseContainsFailures(ajvErrors) {
  const containsErrors = ajvErrors.filter((e) => e.keyword === "contains");
  if (!containsErrors.length) return ajvErrors;

  const prefixes = containsErrors.map((e) => `${e.schemaPath}/`);

  return ajvErrors
    .map((e) => {
      if (e.keyword !== "contains") return e;
      const prefix = `${e.schemaPath}/`;
      const needs = ajvErrors
        .filter((n) => n !== e && n.schemaPath.startsWith(prefix))
        .map((n) => {
          if (n.keyword === "enum" && n.params && Array.isArray(n.params.allowedValues)) {
            const parts = n.schemaPath.slice(prefix.length).split("/");
            const field = parts[0] === "properties" ? parts[1] : parts[0];
            return `\`${field}\` in [${n.params.allowedValues.join(", ")}]`;
          }
          if (n.keyword === "required" && n.params) return `\`${n.params.missingProperty}\``;
          return null;
        })
        .filter(Boolean);
      const need = needs.length ? [...new Set(needs)].join(" or ") : "a matching item";
      return { ...e, message: `must contain at least one item with ${need}` };
    })
    .filter((e) => e.keyword === "contains" || !prefixes.some((p) => e.schemaPath.startsWith(p)));
}

function validateSections(sections, label, errors) {
  for (const [i, section] of (sections || []).entries()) {
    const sectionSchemaId = specUrl(`sections/${section.kind}.schema.yaml`);
    const validateSection = schemaFor(sectionSchemaId, specUrl("sections/section.schema.yaml"), profileSectionIdByKind.get(section.kind));
    const sectionLabel = `${label} section[${i}] (${section.kind})`;

    if (!validateSection(section)) {
      for (const err of collapseContainsFailures(validateSection.errors)) {
        errors.push(`${sectionLabel} schema: ${err.instancePath || "/"} ${err.message}`);
      }
    }
  }
}

// The whole-entry check below already catches a bad section too; skip those since
// validateSections() reports the same problem with a section index/kind instead of a bare instancePath.
const NESTED_SECTION_ERROR = /^\/sections\/\d/;

// opts.standalone: an entry validated as its own file. An entry nested inside a base document is
// already covered by that document's own single validateItemRefs() pass over every sibling at once.
function validateEntry(entry, errors, warnings, opts = {}) {
  const entrySchemaId = specUrl(`entries/${entry.kind}.schema.yaml`);
  const validate = schemaFor(entrySchemaId, specUrl("entries/entry.schema.yaml"), profileEntryIdByKind.get(entry.kind));
  const isComponent = entry.kind === "component";

  if (!validate(entry)) {
    for (const err of validate.errors) {
      // Per-trait shape errors are replaced below with discriminator-aware ones.
      if (isComponent && err.instancePath.startsWith("/traits")) continue;
      if (NESTED_SECTION_ERROR.test(err.instancePath)) continue;
      errors.push(`entry "${entry.id}" schema: ${err.instancePath || "/"} ${err.message}`);
    }
    if (isComponent && Array.isArray(entry.traits)) {
      validateDiscriminatedItems(entry.traits, traitsBranches(), "kind", `entry "${entry.id}" traits`, errors);
    }
  }
  validateSections(entry.sections, `entry "${entry.id}"`, errors);
  if (opts.standalone) {
    validateItemRefs(entry, errors, warnings, opts);
    validateComboTargets(entry, errors, warnings, opts);
    validateSameAsLevels(entry, errors, warnings, opts);
  }
  validateSemanticRules(entry, errors);
  validateFileRefs(entry, warnings, opts);
}

function validateShared(entry, errors, warnings, opts = {}) {
  const validate = ajv.getSchema(specUrl("shared.schema.yaml"));
  if (!validate(entry)) {
    for (const err of validate.errors) {
      if (NESTED_SECTION_ERROR.test(err.instancePath)) continue;
      errors.push(`shared "${entry.id}" schema: ${err.instancePath || "/"} ${err.message}`);
    }
  }
  validateSections(entry.sections, `shared "${entry.id}"`, errors);
  validateSemanticRules(entry, errors);
  validateFileRefs(entry, warnings, opts);
}

// Checks that can't be expressed as a single item's shape - they need to see across an
// entry's sections (or its own top-level fields) at once.
function validateSemanticRules(entry, errors) {
  const sections = entry.sections || [];

  // checkedBy: automated needs a refs/checks entry (rel: test/lint-rule) pointing at what runs it,
  // so it isn't just an unverifiable label - doesn't require the target to actually resolve.
  for (const section of sections) {
    if (section.kind !== "guidelines") continue;
    for (const [i, item] of (section.items || []).entries()) {
      if (item.checkedBy !== "automated") continue;
      const hasCheckRef = [...(item.refs || []), ...(item.checks || [])].some((r) => r.rel === "test" || r.rel === "lint-rule");
      if (!hasCheckRef) {
        errors.push(
          err(RULES.CHECKED_BY_NEEDS_REF, `entry "${entry.id}" ${section.kind} item[${i}] declares checkedBy: automated but has no refs/checks entry (rel: test, lint-rule) pointing at what actually runs the check`)
        );
      }
    }
  }

  // One sourceFiles entry per platform (including "no platform given," which share one bucket).
  const sourceFilesByPlatform = new Map();
  for (const sourceFile of entry.sourceFiles || []) {
    const key = sourceFile.platform || "(unspecified)";
    sourceFilesByPlatform.set(key, (sourceFilesByPlatform.get(key) || 0) + 1);
  }
  for (const [platform, count] of sourceFilesByPlatform) {
    if (count > 1) {
      errors.push(err(RULES.ONE_API_PER_PLATFORM, `entry "${entry.id}" declares ${count} sourceFiles entries for platform "${platform}" - only one is allowed per platform`));
    }
  }
}

// base.schema.yaml's entries/shared items dispatch per kind too, so a bad one shows up in Ajv's
// own errors here as well; skip those since the per-entry/per-shared loop below reports it with
// better context. Keep everything else this pass catches (a bogus top-level field, an empty array).
const NESTED_ENTRY_OR_SHARED_ERROR = /^\/(entries|shared)\/\d/;

function validateBase(doc, errors, warnings, opts = {}) {
  const validate = ajv.getSchema(specUrl("base.schema.yaml"));
  if (!validate(doc)) {
    for (const err of validate.errors) {
      if (NESTED_ENTRY_OR_SHARED_ERROR.test(err.instancePath)) continue;
      errors.push(`base schema: ${err.instancePath || "/"} ${err.message}`);
    }
  }
  // DSDS-11 for the base document's OWN top-level `refs`. Entry-level refs
  // are covered by validateFileRefs() inside validateEntry/validateShared
  // below; nothing covered these, and they're the likeliest of the three to
  // rot - a base document's `rel: file` refs are the multi-file split the
  // quickstart recommends for a large system, so they're a list of sibling
  // filenames maintained by hand as components come and go. This repo's own
  // test/site-components/index.dsds.yaml carried a ref to a component file
  // that had been deleted, and validated clean.
  //
  // Walk only `doc.refs`, not the whole document: findFileHrefRefs recurses,
  // so passing `doc` would re-find every entry's refs and double-report them.
  if (opts.filePath) {
    const docFileHrefs = [];
    findFileHrefRefs(doc.refs, docFileHrefs);
    for (const href of docFileHrefs) {
      checkFileExists(href, opts.filePath, warnings, "base document ref (rel: file)");
    }
  }

  for (const entry of doc.entries || []) {
    validateEntry(entry, errors, warnings, opts);
  }
  for (const entry of doc.shared || []) {
    validateShared(entry, errors, warnings, opts);
  }

  // entries and shared entries share one id/addressing space, so a collision between the two arrays is as broken as one within entries alone.
  const seenIds = new Set();
  for (const entity of entriesIn(doc)) {
    if (seenIds.has(entity.id)) {
      errors.push(err(RULES.UNIQUE_ENTRY_ID, `id "${entity.id}" is declared more than once in this document (entries and shared entries share one id space)`));
    }
    seenIds.add(entity.id);
  }

  // When a `kind: system` entry declares metadata.platforms, every platform used anywhere must be one of them.
  const declaredPlatforms = (doc.entries || [])
    .filter((e) => e.kind === "system")
    .flatMap((e) => (e.metadata && e.metadata.platforms) || []);
  if (declaredPlatforms.length) {
    const known = new Set(declaredPlatforms);
    for (const entry of doc.entries || []) {
      for (const [i, sourceFile] of (entry.sourceFiles || []).entries()) {
        if (sourceFile.platform && !known.has(sourceFile.platform)) {
          errors.push(
            err(RULES.PLATFORM_VOCABULARY, `entry "${entry.id}" sourceFiles[${i}] declares platform "${sourceFile.platform}", which is not in the system entry's metadata.platforms [${[...known].join(", ")}]`)
          );
        }
      }
      for (const [i, item] of (entry.imports || []).entries()) {
        if (item.platform && !known.has(item.platform)) {
          errors.push(
            err(RULES.PLATFORM_VOCABULARY, `entry "${entry.id}" imports[${i}] declares platform "${item.platform}", which is not in the system entry's metadata.platforms [${[...known].join(", ")}]`)
          );
        }
      }
      // status is either a single object or a list, one entry per platform - normalize to an array and check each.
      const entryStatus = entry.metadata && entry.metadata.status;
      const statusEntries = Array.isArray(entryStatus)
        ? entryStatus
        : entryStatus
          ? [entryStatus]
          : [];
      for (const [i, statusEntry] of statusEntries.entries()) {
        if (!statusEntry || !statusEntry.platform || known.has(statusEntry.platform)) continue;
        const where = Array.isArray(entryStatus) ? `metadata.status[${i}]` : "metadata.status";
        errors.push(
          err(RULES.PLATFORM_VOCABULARY, `entry "${entry.id}" ${where} declares platform "${statusEntry.platform}", which is not in the system entry's metadata.platforms [${[...known].join(", ")}]`)
        );
      }
    }
  }

  validateItemRefs(doc, errors, warnings, opts);
  validateComboTargets(doc, errors, warnings, opts);
  validateSameAsLevels(doc, errors, warnings, opts);
  validateGraphCycles(doc, errors);
}

// Standard 3-color DFS cycle detection over a directed adjacency list. Returns the cycle as an ordered array of ids, or null.
function findCycle(edges) {
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const stack = [];
  let cycle = null;

  function visit(node) {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of edges.get(node) || []) {
      if (cycle) return;
      const state = color.get(next) || WHITE;
      if (state === WHITE) {
        visit(next);
      } else if (state === GRAY) {
        const start = stack.indexOf(next);
        cycle = stack.slice(start).concat(next);
      }
      if (cycle) return;
    }
    stack.pop();
    color.set(node, BLACK);
  }

  for (const node of edges.keys()) {
    if (cycle) break;
    if ((color.get(node) || WHITE) === WHITE) visit(node);
  }
  return cycle;
}

// DSDS-06/DSDS-07: a `composes` or `depends-on` ref chain must not lead back to an entry
// already in it. Only the bare-entry form of `to` forms a graph edge - an entryId#itemId ref
// points at content inside an entry, not another graph node. Each rel is its own independent graph.
function validateGraphCycles(doc, errors) {
  const entities = entriesIn(doc);
  const relsToCheck = [
    { rel: "composes", ruleId: RULES.COMPOSES_CYCLE },
    { rel: "depends-on", ruleId: RULES.DEPENDS_ON_CYCLE },
  ];

  for (const { rel, ruleId } of relsToCheck) {
    const edges = new Map();
    for (const entity of entities) {
      const found = [];
      findRefs(entity, "", found);
      for (const { to, rel: foundRel } of found) {
        if (foundRel !== rel || to.includes("#")) continue;
        if (!edges.has(entity.id)) edges.set(entity.id, new Set());
        edges.get(entity.id).add(to);
      }
    }
    const cycle = findCycle(edges);
    if (cycle) {
      errors.push(err(ruleId, `"${rel}" ref chain forms a cycle: ${cycle.join(" -> ")}`));
    }
  }
}

// Every item id declared anywhere on an entry - the resolution target for an entryId#itemId ref.
// Walks into any nested array of objects, not just a section's top-level items, so an id is
// addressable no matter how deep it sits. Keeps the item object per id (not just the id), for
// checks that need to read a field off the target item.
function collectItemsById(entry) {
  const byId = new Map();
  function walk(item) {
    if (!item || typeof item !== "object") return;
    if (typeof item.id === "string") byId.set(item.id, item);
    for (const value of Object.values(item)) {
      if (Array.isArray(value)) {
        for (const child of value) walk(child);
      }
    }
  }
  for (const section of entry.sections || []) {
    for (const item of section.items || []) walk(item);
    for (const item of section.freeform || []) walk(item);
  }
  for (const trait of entry.traits || []) walk(trait);
  return byId;
}

function collectItemIds(entry) {
  const ids = new Set();
  function walk(item) {
    if (!item || typeof item !== "object") return;
    if (typeof item.id === "string") ids.add(item.id);
    for (const value of Object.values(item)) {
      if (Array.isArray(value)) {
        for (const child of value) walk(child);
      }
    }
  }
  for (const section of entry.sections || []) {
    for (const item of section.items || []) walk(item);
    for (const item of section.freeform || []) walk(item);
  }
  for (const trait of entry.traits || []) walk(trait);
  return ids;
}

// Every trait-space target a combo could legally name: a bare id for a boolean trait, or
// "traitId.valueId" for each enum value (plus the bare enum trait id itself, permissively).
function collectTraitTargets(entry) {
  const targets = new Set();
  for (const trait of entry.traits || []) {
    if (!trait || typeof trait.id !== "string") continue;
    targets.add(trait.id);
    if (trait.kind === "enum") {
      for (const value of trait.values || []) {
        if (value && typeof value.id === "string") targets.add(`${trait.id}.${value.id}`);
      }
    }
  }
  return targets;
}

// DSDS-09: resolves each combo's `subject`/`items[]` against three spaces in order - a
// `{braced}` token reference, a trait/`traitId.valueId` on the entity's own traits, or a bare
// entry id in the wider pool. A bare id is only reported once it misses both trait and entry
// space, using the same warning-vs-error split as validateItemRefs.
function validateComboTargets(doc, errors, warnings, opts = {}) {
  const localEntities = entriesIn(doc);
  const localIds = new Set(localEntities.map((e) => e.id));

  const hasAnyCombos = localEntities.some((e) => Array.isArray(e.combos) && e.combos.length);
  if (!hasAnyCombos) return;

  const { hasWiderScope, widerEntities, treatAsError, scopeNote } = resolveWiderScope(doc, localIds, opts);
  const widerIds = hasWiderScope ? new Set(widerEntities.map((e) => e.id)) : null;
  const widerKindById = hasWiderScope ? new Map(widerEntities.map((e) => [e.id, e.kind])) : null;

  for (const entity of localEntities) {
    if (!Array.isArray(entity.combos)) continue;
    const traitTargets = collectTraitTargets(entity);

    for (const [i, combo] of entity.combos.entries()) {
      if (!combo || typeof combo !== "object") continue;
      const targets = [{ value: combo.subject, at: `combos[${i}].subject` }];
      for (const [j, item] of (combo.items || []).entries()) {
        targets.push({ value: item, at: `combos[${i}].items[${j}]` });
      }

      for (const { value, at } of targets) {
        if (typeof value !== "string") continue;
        const label = `"${entity.id}" ${at} "${value}"`;
        const braced = /^\{(.+)\}$/.exec(value);

        if (braced) {
          const tokenId = braced[1];
          const kind = widerIds && widerIds.has(tokenId) ? widerKindById.get(tokenId) : undefined;
          if (kind === "token") continue;
          const msg = kind
            ? `${label} names "${tokenId}", which exists but is a ${kind}, not a token`
            : `${label} targets unknown token "${tokenId}"`;
          if (treatAsError) errors.push(err(RULES.COMBO_TARGET_RESOLVES, msg));
          else warnings.push(err(RULES.COMBO_TARGET_RESOLVES, `${msg} ${scopeNote}`));
          continue;
        }

        if (traitTargets.has(value)) continue;

        if (widerIds && widerIds.has(value)) continue;
        if (treatAsError) {
          errors.push(err(RULES.COMBO_TARGET_RESOLVES, `${label} matches no trait on "${entity.id}", and no known entry or shared entry`));
        } else {
          warnings.push(err(RULES.COMBO_TARGET_RESOLVES, `${label} matches no trait on "${entity.id}", and no known entry or shared entry ${scopeNote}`));
        }
      }
    }
  }
}

// Resolves a ref's `to` (DSDS-05/08) against the document's own entries/shared entries first,
// then widens to this document's `rel: file` project and any CLI sibling files - the latter is
// how a standalone entry file (with no `refs` of its own) can still resolve a pointer to a
// sibling. Shared by validateItemRefs and validateComboTargets (DSDS-09) for that same pool.
// An unresolved target is a hard error only when no wider source was even available to check;
// otherwise it's a warning, since an incomplete search can't assert something is truly broken.
function resolveWiderScope(doc, localIds, opts) {
  const isSplitAcrossFiles = (doc.refs || []).some((r) => r && r.rel === "file");
  const hasCliSiblings =
    Array.isArray(opts.cliEntities) && opts.cliEntities.some((e) => !localIds.has(e.id));
  const hasWiderScope = isSplitAcrossFiles || hasCliSiblings;

  let widerEntities = [];
  let foundSiblings = false;
  if (hasWiderScope) {
    if (hasCliSiblings) widerEntities = widerEntities.concat(opts.cliEntities);
    if (isSplitAcrossFiles && opts.filePath) {
      const { entities: projectEntities, siblingCount } = loadProject(path.resolve(opts.filePath));
      widerEntities = widerEntities.concat(projectEntities);
      foundSiblings = foundSiblings || siblingCount > 0;
    }
    foundSiblings = foundSiblings || hasCliSiblings;
  }

  // A base document with no `rel: file` link out declares its entries/shared arrays as
  // complete, so an unresolved target there is a hard error. A standalone entry file can never
  // assert that same completeness (it may be one piece of a larger indexed project), so an
  // unresolved target there is always a warning, even with no wider scope to check at all.
  const treatAsError = !opts.standalone && !hasWiderScope;

  // Claims a search only when one actually happened.
  const scopeNote = foundSiblings
    ? "(checked every file given to this run, and this document's own rel: file project)"
    : "(no other file could be checked against)";

  return { hasWiderScope, widerEntities, treatAsError, scopeNote };
}

// DSDS-10: a guidelines item can borrow another item's text via `rel: same-as` while still
// declaring its own required `level`, so nothing else checks the two agree. Once the same-as
// target resolves and has its own `level`, this compares them and errors on a mismatch -
// always a hard error, since resolution (DSDS-05) already succeeded by this point.
function validateSameAsLevels(doc, errors, warnings, opts = {}) {
  const localEntities = entriesIn(doc);
  const localIds = new Set(localEntities.map((e) => e.id));
  const localItemsByEntity = new Map(localEntities.map((e) => [e.id, collectItemsById(e)]));

  const { hasWiderScope, widerEntities } = resolveWiderScope(doc, localIds, opts);
  const widerItemsByEntity = hasWiderScope
    ? new Map(widerEntities.map((e) => [e.id, collectItemsById(e)]))
    : null;

  function findItem(targetId, itemId) {
    const local = localItemsByEntity.get(targetId);
    if (local && local.has(itemId)) return local.get(itemId);
    const wider = widerItemsByEntity && widerItemsByEntity.get(targetId);
    return wider && wider.has(itemId) ? wider.get(itemId) : null;
  }

  for (const entity of localEntities) {
    for (const section of entity.sections || []) {
      if (section.kind !== "guidelines") continue;
      for (const [i, item] of (section.items || []).entries()) {
        if (!item || typeof item.level !== "string") continue;
        for (const ref of item.refs || []) {
          if (!ref || ref.rel !== "same-as" || typeof ref.to !== "string") continue;
          const hashIdx = ref.to.indexOf("#");
          if (hashIdx === -1) continue;
          const targetItem = findItem(ref.to.slice(0, hashIdx), ref.to.slice(hashIdx + 1));
          if (!targetItem || typeof targetItem.level !== "string") continue;
          if (targetItem.level !== item.level) {
            errors.push(
              err(
                RULES.SAME_AS_LEVEL_MATCHES,
                `"${entity.id}" guidelines item[${i}] declares level "${item.level}" but its same-as target "${ref.to}" declares level "${targetItem.level}" - the two must agree`,
              ),
            );
          }
        }
      }
    }
  }
}

function validateItemRefs(doc, errors, warnings, opts = {}) {
  const localEntities = entriesIn(doc);
  const localIds = new Set(localEntities.map((e) => e.id));
  const localItemIdsByEntity = new Map(localEntities.map((e) => [e.id, collectItemIds(e)]));

  const { hasWiderScope, widerEntities, treatAsError, scopeNote } = resolveWiderScope(doc, localIds, opts);
  const widerIds = hasWiderScope ? new Set(widerEntities.map((e) => e.id)) : null;
  const widerItemIdsByEntity = hasWiderScope
    ? new Map(widerEntities.map((e) => [e.id, collectItemIds(e)]))
    : null;

  for (const entity of localEntities) {
    const found = [];
    findRefs(entity, "", found);
    for (const { to, rel, at } of found) {
      if (to.includes("://")) continue;
      const label = `"${entity.id}" ref${at ? ` (${at})` : ""} "${to}" (rel: ${rel})`;
      const hashIdx = to.indexOf("#");

      if (hashIdx === -1) {
        if (!to || localIds.has(to)) continue;
        if (treatAsError) {
          errors.push(err(RULES.ENTRY_REF_RESOLVES, `${label} targets unknown entry/shared "${to}"`));
        } else if (!widerIds || !widerIds.has(to)) {
          warnings.push(err(RULES.ENTRY_REF_RESOLVES, `${label} targets unknown entry/shared "${to}" ${scopeNote}`));
        }
        continue;
      }

      const targetId = to.slice(0, hashIdx);
      const itemId = to.slice(hashIdx + 1);
      if (!targetId || !itemId) continue;

      const localItemIds = localItemIdsByEntity.get(targetId);
      if (localItemIds) {
        if (!localItemIds.has(itemId)) {
          errors.push(err(RULES.ITEM_REF_RESOLVES, `${label} targets unknown item "${itemId}" on "${targetId}"`));
        }
        continue;
      }

      if (treatAsError) {
        errors.push(err(RULES.ITEM_REF_RESOLVES, `${label} targets unknown entry/shared "${targetId}"`));
        continue;
      }

      const widerItemIds = widerItemIdsByEntity && widerItemIdsByEntity.get(targetId);
      if (!widerItemIds) {
        warnings.push(err(RULES.ITEM_REF_RESOLVES, `${label} targets unknown entry/shared "${targetId}" ${scopeNote}`));
      } else if (!widerItemIds.has(itemId)) {
        warnings.push(err(RULES.ITEM_REF_RESOLVES, `${label} targets unknown item "${itemId}" on "${targetId}" ${scopeNote}`));
      }
    }
  }
}

// The reusable core: given an already-parsed document, returns every error and warning as
// strings, with no I/O beyond opts.filePath's project discovery and no process exit -
// tools/conformance-test.js reuses this function so fixtures run against the same logic the
// CLI does. Pass opts.filePath whenever the document came from a real file on disk.
function validateDoc(doc, opts = {}) {
  const errors = [];
  const warnings = [];
  const isBase = typeof doc.schemaVersion !== "undefined";
  // A root `dsdsVersion` with no `schemaVersion` is DSDS ≤0.15.2's old base-document marker
  // (renamed in 0.20.0); catch it here with a clear message instead of routing into
  // validateEntry() and reporting confusing entry-shape errors.
  if (!isBase && doc && typeof doc === "object" && typeof doc.dsdsVersion !== "undefined") {
    errors.push(
      `this document targets DSDS ≤0.15.2; 0.20.0 renamed the root "dsdsVersion" field to "schemaVersion" (see the CHANGELOG's 0.20.0 entry for the rest of what changed). Rename the field, or run a 0.15.2-era validator against this document instead.`,
    );
    return { errors, warnings };
  }
  if (isBase) {
    validateBase(doc, errors, warnings, opts);
  } else {
    validateEntry(doc, errors, warnings, { ...opts, standalone: true });
  }
  return { errors, warnings };
}

function validateFile(target, opts = {}) {
  const doc = loadYaml(target);
  const isBase = typeof doc.schemaVersion !== "undefined";
  const { errors, warnings } = validateDoc(doc, { filePath: target, cliEntities: opts.cliEntities });

  const rel = path.relative(rootDir, target);
  if (errors.length) {
    console.error(`✗ ${rel} failed validation:\n`);
    for (const e of errors) console.error(`  - ${e}`);
    if (warnings.length) {
      console.error(`\n  ${warnings.length} warning(s):`);
      for (const w of warnings) console.error(`  - ${w}`);
    }
    return false;
  }

  if (warnings.length && opts.strict) {
    console.error(`✗ ${rel} failed validation in --strict mode:\n`);
    for (const w of warnings) console.error(`  - ${w}`);
    return false;
  }

  console.log(`✓ ${rel}`);
  if (isBase) {
    const sharedCount = (doc.shared || []).length;
    console.log(`  base document  schemaVersion: ${doc.schemaVersion}  ${(doc.entries || []).length} entry(ies)${sharedCount ? `, ${sharedCount} shared` : ""}, ${(doc.refs || []).length} ref(s)`);
  } else {
    console.log(`  ${doc.kind} "${doc.id}"  status: ${JSON.stringify(doc.metadata && doc.metadata.status)}`);
    console.log(`  ${(doc.sections || []).length} section(s), ${(doc.refs || []).length} ref(s)`);
  }
  if (warnings.length) {
    console.log(`  ${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  - ${w}`);
  }
  return true;
}

// Only run the CLI when invoked directly - tools/conformance-test.js requires this file for
// validateDoc/RULES and must not trigger a second full run (with its own process.exit).
if (require.main === module) {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const targets = args.filter((a) => a !== "--strict");
  const resolvedTargets = targets.length ? targets : defaultTargets();

  // Every entity across every file given to this run, gathered up front so files passed
  // together (as `npm run check` does) can resolve refs against each other - the only way a
  // standalone entry file (no `refs` of its own) can see its siblings.
  const cliEntities = [];
  for (const target of resolvedTargets) {
    try {
      cliEntities.push(...entriesIn(loadYaml(target)));
    } catch (e) {
      // validateFile() below reports the real parse/read error for this file.
    }
  }

  let ok = true;
  for (const target of resolvedTargets) {
    if (!validateFile(target, { strict, cliEntities })) ok = false;
  }
  process.exit(ok ? 0 : 1);
}

module.exports = { validateDoc, RULES };
