#!/usr/bin/env node
// STYLE_GUIDE.md tells authors to write a document's fields in the order the schema files
// list them, which makes those files the only record of that order. This asserts the schema
// files don't contradict each other about it.
//
// A kind file narrows some of the fields its base already declares - entries/token.schema.yaml
// redeclares `id` to loosen the pattern, every kind file redeclares `kind` to pin a const. When
// a kind file lists those shared fields in a different order than the base does, the two files
// disagree about the order authors are being told to follow. That happened: token.schema.yaml
// listed `kind, metadata, id` while entry.schema.yaml listed `id` first.
//
// Only the shared fields are checked, and only their order relative to each other. A kind file
// is free to put its own novel fields wherever it likes, and they do vary - definitions puts
// its novel field after `items` while guidelines and steps put theirs before. Nothing depends
// on that placement, because lib.js's entryFieldOrder drops the redeclared fields and reads the
// novel ones as a group.
"use strict";

const fs = require("fs");
const path = require("path");
const { schemaDir, declaredProps } = require("../lib");

// Each base file, paired with the directory holding the files that compose onto it via `allOf`.
const FAMILIES = [
  { base: "entries/entry.schema.yaml", dir: "entries" },
  { base: "sections/section.schema.yaml", dir: "sections" },
];

function membersOf(family) {
  return fs
    .readdirSync(path.join(schemaDir, family.dir))
    .filter((file) => file.endsWith(".schema.yaml") && `${family.dir}/${file}` !== family.base)
    .sort()
    .map((file) => `${family.dir}/${file}`);
}

let ok = true;
let checked = 0;

for (const family of FAMILIES) {
  const baseOrder = declaredProps(family.base);

  for (const member of membersOf(family)) {
    let own;
    try {
      own = declaredProps(member);
    } catch {
      // A member that declares no properties of its own has no order to disagree about.
      continue;
    }

    const shared = own.filter((key) => baseOrder.includes(key));
    const expected = baseOrder.filter((key) => shared.includes(key));
    checked += 1;

    if (shared.join(" ") === expected.join(" ")) continue;

    // Name the specific pair that's backwards - more useful than printing both whole lists.
    const at = shared.findIndex(
      (key, i) => i + 1 < shared.length && expected.indexOf(key) > expected.indexOf(shared[i + 1]),
    );
    console.error(
      `✗ schema/${member}: lists \`${shared[at]}\` before \`${shared[at + 1]}\`, but ` +
        `schema/${family.base} declares them the other way round. Both files tell authors what ` +
        `order to write these fields in, so they have to agree. Expected these shared fields in ` +
        `the order [${expected.join(", ")}], found [${shared.join(", ")}].`,
    );
    ok = false;
  }
}

if (ok) {
  console.log(
    `✓ All ${checked} kind schema(s) list their base's fields in the order the base declares them.`,
  );
}
process.exit(ok ? 0 : 1);
