// Shared helpers for validate.js and conformance-test.js - loading files and finding entries,
// so neither script has to redeclare the other's copy.
"use strict";

const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const rootDir = path.join(__dirname, "..");
const schemaDir = path.join(rootDir, "schema");
const exampleDirs = [
  path.join(rootDir, "examples/entries"),
  path.join(rootDir, "examples/base"),
  path.join(rootDir, "examples/quickstart"),
];

// 01-base-document.yaml is deliberately incomplete - the Quick Start page itself labels it
// "not valid on its own yet" (the first step of a build-up that only gets a real `entries`
// array at 03). Every other quickstart/*.yaml is standalone-valid and belongs in the sweep.
const EXCLUDED_FROM_DEFAULT = new Set([path.join(rootDir, "examples/quickstart/01-base-document.yaml")]);
// No docEntryDirs equivalent yet - the live site's own content isn't ported to the new schema.
const docEntryDirs = [];

// JSON_SCHEMA disables YAML's implicit !!timestamp type, which otherwise parses a bare
// `2026-06-02` into a JS Date instead of the string isoDate.schema.yaml requires. Scoped to
// this loader only, not a repo-wide js-yaml behavior change.
function loadYaml(file) {
  return yaml.load(fs.readFileSync(file, "utf8"), { schema: yaml.JSON_SCHEMA });
}

// ---------------------------------------------------------------------------
// Schema-derived field order
// ---------------------------------------------------------------------------

// STYLE_GUIDE.md §1 says to write a document's fields in the order the schema files list
// them, which makes those files the only place that order is recorded. Anything that needs
// a canonical field order reads it from here instead of keeping a copy, because a copy goes
// stale the moment a schema file is reordered and it goes stale silently.

const EXTENSIONS_KEY = "$extensions";

const declaredPropsCache = new Map();

// A schema file's own property names, in the order it declares them. Throws when a file
// turns out to declare none: every file callers ask for declares properties today, so an
// empty answer means the properties moved somewhere this function doesn't look - into an
// `allOf` branch, behind a `$ref`, down into `$defs`. Without the throw the callers would
// quietly stop working: a field-order check with an empty order passes every document, and
// an empty omit list turns a delta prop-table into a full one. Both look like success.
function declaredProps(relPath) {
  if (!declaredPropsCache.has(relPath)) {
    const doc = loadYaml(path.join(schemaDir, relPath));
    const inline = (doc.allOf || []).find((member) => member.properties);
    const keys = Object.keys(doc.properties || (inline && inline.properties) || {});
    if (keys.length === 0) {
      throw new Error(
        `schema/${relPath} declares no properties of its own, so no field order can be ` +
          `derived from it. Either the file was restructured, or the caller asked for the ` +
          `wrong one.`,
      );
    }
    declaredPropsCache.set(relPath, keys);
  }
  // A copy, so a caller that sorts or splices its result can't corrupt the cache.
  return declaredPropsCache.get(relPath).slice();
}

// The field order for an entry of `kind`: the fields every kind shares, from
// entries/entry.schema.yaml, then that kind's own fields, from entries/<kind>.schema.yaml,
// then `$extensions` last. It takes two lists because a kind's own fields live in a
// different file from the shared ones, and JSON Schema's `allOf` can't interleave them.
// `$extensions` has to be pinned because it's declared with the shared fields, so joining
// the two lists end to end would leave it stranded in the middle. A namespaced custom kind
// (`acme.icon-library`) has no schema file of its own and gets the shared fields alone -
// the same fallback entry.schema.yaml's own dispatch gives it.
function entryFieldOrder(kind) {
  const base = declaredProps("entries/entry.schema.yaml");
  const shared = base.filter((key) => key !== EXTENSIONS_KEY);
  const kindFile = `entries/${kind}.schema.yaml`;
  const own =
    kind && fs.existsSync(path.join(schemaDir, kindFile))
      ? declaredProps(kindFile).filter((key) => !base.includes(key))
      : [];
  return [...shared, ...own, EXTENSIONS_KEY];
}

// A schema file's enum values, in the order it declares them, together with the default it
// declares for that field. `locate` picks the field out of the loaded document because these
// sit at different depths: common/requirement-level.schema.yaml is an enum at its root,
// sections/section.schema.yaml keeps `for` under `properties`, sections/guidelines.schema.yaml
// keeps `framing` inside an `allOf` member. Throws for the same reason declaredProps does - a
// missing enum would turn a sort check into a no-op that passes every document, and a check
// that passes everything reads as success.
function declaredEnum(relPath, locate) {
  const field = locate(loadYaml(path.join(schemaDir, relPath)));
  const values = field && field.enum;
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(
      `schema/${relPath} declares no enum where one was expected, so no order can be derived ` +
        `from it. Either the file was restructured, or the caller looked in the wrong place.`,
    );
  }
  return { values, fallback: field.default };
}

// Builds a rank function from a declared enum, for sorting values into the order the schema
// lists them. A field left out of a document ranks as the default the schema declares for it,
// which is the same thing a validator would read it as - not as unknown. A value the schema
// doesn't list at all ranks last, so an unrecognized one sorts to the end instead of throwing.
function enumRanker(relPath, locate) {
  const { values, fallback } = declaredEnum(relPath, locate);
  const rank = new Map(values.map((value, index) => [value, index]));
  return (value) => {
    const resolved = value === undefined || value === null ? fallback : value;
    return rank.has(resolved) ? rank.get(resolved) : values.length;
  };
}

// Only matches *.schema.yaml - excludes schema/conformance-rules.yaml, which lives alongside
// the schema files but isn't itself a JSON Schema document.
function walkYamlFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkYamlFiles(full);
    return entry.name.endsWith(".schema.yaml") ? [full] : [];
  });
}

function defaultTargets() {
  return [...exampleDirs, ...docEntryDirs].flatMap((dir) =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir)
          .filter((f) => f.endsWith(".yaml"))
          .map((f) => path.join(dir, f))
          .filter((f) => !EXCLUDED_FROM_DEFAULT.has(f))
      : []
  );
}

function isBaseDoc(doc) {
  return typeof doc.schemaVersion !== "undefined";
}

// Every entity in a file, whether a standalone entry or a base document with several inline,
// so callers don't need to special-case either shape. Includes `shared` alongside `entries`,
// since both share one id/refs/sections addressing space.
function entriesIn(doc) {
  return isBaseDoc(doc) ? [...(doc.entries || []), ...(doc.shared || [])] : [doc];
}

// Finds every {to, rel} shaped object anywhere inside a value, regardless of what field it's
// under - one generic walk instead of a separate case for each place a ref can appear.
// `combos` subjects/items (bare strings, not {to, rel} objects) are a deliberately different,
// lighter pointer concept and aren't picked up here.
function findRefs(value, at, out) {
  if (Array.isArray(value)) {
    value.forEach((item, i) => findRefs(item, `${at}[${i}]`, out));
    return;
  }
  if (value && typeof value === "object") {
    if (typeof value.to === "string" && typeof value.rel === "string") {
      out.push({ to: value.to, rel: value.rel, at });
    }
    for (const [key, val] of Object.entries(value)) {
      findRefs(val, at ? `${at}.${key}` : key, out);
    }
  }
}

module.exports = {
  rootDir,
  schemaDir,
  exampleDirs,
  docEntryDirs,
  loadYaml,
  declaredProps,
  declaredEnum,
  enumRanker,
  entryFieldOrder,
  walkYamlFiles,
  defaultTargets,
  isBaseDoc,
  entriesIn,
  findRefs,
};
