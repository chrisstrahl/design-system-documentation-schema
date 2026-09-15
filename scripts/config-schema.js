#!/usr/bin/env node
/**
 * Validates the repo's own config files against JSON Schema, using the Ajv this project already
 * ships.
 *
 * These are not DSDS documents and not part of the published spec - they're the data the build
 * reads: the rule catalog, the interoperability map, the terms table. Each was checked by a
 * hand-written loop that only covered what its author remembered, and the rule catalog wasn't
 * checked at all beyond its `enforcement` value. A rule missing `title` rendered as
 * `| \`DSDS-99\` | undefined |` on the published Conformance page, and the build stayed green.
 *
 * Schemas live in scripts/config-schemas/, deliberately outside schema/: everything under
 * schema/**\/*.schema.yaml is the published spec, walked by walkYamlFiles, asserted to carry a
 * versioned $id by check-schema-ids.js, bundled, and mirrored into site/dist/v<version>/. A
 * build-config schema in there would be published as though it were part of the format.
 *
 * Not in scripts/lib.js on purpose. lib.js ships in the npm package and is required by
 * lint-docs.js; keeping Ajv out of that path means `dsds-lint` doesn't load a validator it
 * never uses.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const Ajv = require("ajv/dist/2020");

const SCHEMA_DIR = path.join(__dirname, "config-schemas");

// Same options validate.js uses, so a config error reads like a document error.
const ajv = new Ajv({ allErrors: true, strict: false });

const compiled = new Map();

function validatorFor(name) {
  if (!compiled.has(name)) {
    const file = path.join(SCHEMA_DIR, `${name}.schema.json`);
    if (!fs.existsSync(file)) {
      throw new Error(`No config schema at ${path.relative(process.cwd(), file)}`);
    }
    compiled.set(name, ajv.compile(JSON.parse(fs.readFileSync(file, "utf8"))));
  }
  return compiled.get(name);
}

// Ajv's instancePath is a JSON pointer (/3/title). Rendered as `[3].title` it reads like the
// YAML the author is looking at.
function pointerToPath(pointer) {
  if (!pointer) return "(root)";
  return pointer
    .split("/")
    .filter(Boolean)
    .map((seg) => (/^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`))
    .join("")
    .replace(/^\./, "");
}

function formatError(err) {
  const where = pointerToPath(err.instancePath);
  if (err.keyword === "required") {
    return `${where}: missing \`${err.params.missingProperty}\``;
  }
  if (err.keyword === "additionalProperties") {
    return `${where}: unexpected key \`${err.params.additionalProperty}\``;
  }
  if (err.keyword === "enum") {
    return `${where}: ${err.message} (${err.params.allowedValues.join(", ")})`;
  }
  return `${where}: ${err.message}`;
}

/**
 * Validate `data` against scripts/config-schemas/<name>.schema.json.
 * Prints every problem and exits 1 on failure, matching how the other build scripts report.
 *
 * @param {string} name      Schema basename, e.g. "terms".
 * @param {unknown} data     Parsed YAML/JSON.
 * @param {string} sourceRel Path to show in the message, relative to the repo root.
 * @returns {unknown} `data`, so callers can `return validateConfig(...)`.
 */
function validateConfig(name, data, sourceRel) {
  const validate = validatorFor(name);
  if (validate(data)) return data;

  console.error(`✗ ${sourceRel} doesn't match scripts/config-schemas/${name}.schema.json:`);
  for (const err of validate.errors || []) {
    console.error(`    ${formatError(err)}`);
  }
  process.exit(1);
}

/**
 * JSON Schema's `uniqueItems` compares whole objects, so it can't express "these ids are
 * unique". Two rules sharing an id is a real failure mode - the second silently wins wherever
 * the catalog is keyed by id - so it's checked here instead.
 */
function assertUniqueBy(rows, key, sourceRel) {
  const seen = new Map();
  const duplicates = [];
  rows.forEach((row, i) => {
    const value = row?.[key];
    if (seen.has(value)) duplicates.push({ value, first: seen.get(value), second: i });
    else seen.set(value, i);
  });
  if (!duplicates.length) return rows;

  console.error(`✗ ${sourceRel} has a duplicate \`${key}\`:`);
  for (const d of duplicates) {
    console.error(`    "${d.value}" appears at [${d.first}] and again at [${d.second}]`);
  }
  process.exit(1);
}

module.exports = { validateConfig, assertUniqueBy };
