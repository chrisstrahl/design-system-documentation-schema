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
  walkYamlFiles,
  defaultTargets,
  isBaseDoc,
  entriesIn,
  findRefs,
};
