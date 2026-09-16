#!/usr/bin/env node
/**
 * Migrates DSDS 0.20.x documents to 0.21.0, which changes component traits twice: every trait
 * must now carry `traitType: variant | state`, and `setBy` is gone. A leftover `setBy` is a
 * hard validation error, not a warning - both trait branches set `unevaluatedProperties:
 * false` - so removing it is part of the migration, not an optional tidy-up.
 *
 * Order matters here: `setBy: component` is the one reliable signal for `traitType: state`,
 * so every trait is classified before its `setBy` line is dropped.
 *
 * Unlike migrate-to-0.20.js, this is not a model change - the document is already in the right
 * shape and only needs a field added. So this edits line by line rather than re-serialising
 * through js-yaml, which would discard every comment and reflow the file. Documents are
 * rewritten in place unless --dry-run is passed.
 *
 * `traitType` cannot be derived from `setBy`, which is the reason it replaced it. `setBy:
 * component` does imply a state - a condition the component puts itself in. `setBy: consumer`
 * implies nothing: `size` is a consumer-set variant and `disabled` is a consumer-set state.
 * So consumer-set and unmarked traits fall back to a list of names that are states by
 * convention, and every one of those guesses is printed for review. The script never claims
 * more confidence than it has.
 *
 * Usage: node scripts/tools/migrate-to-0.21.js <files-or-dirs…> [--dry-run]
 */
"use strict";

const fs = require("fs");
const path = require("path");

// Conditions a component is in, rather than dimensions a caller configures. Used only when
// `setBy` can't answer it. Deliberately short: a name not on this list becomes `variant`, and
// a wrong `variant` is easier to spot in review than a wrong `state`.
const STATE_NAMES = new Set([
  "hover", "focus", "focused", "focus-visible", "active", "pressed", "disabled", "loading",
  "busy", "selected", "checked", "indeterminate", "expanded", "collapsed", "open", "closed",
  "invalid", "valid", "error", "readonly", "read-only", "dragging", "visited", "required-error",
]);

function classify(trait) {
  if (trait.setBy === "component") return { type: "state", sure: true };
  if (STATE_NAMES.has(trait.id)) return { type: "state", sure: false };
  // An enum is a dimension with named values - almost always a variant, and rarely a state.
  if (trait.kind === "enum") return { type: "variant", sure: true };
  return { type: "variant", sure: false };
}

const indentOf = (line) => line.length - line.trimStart().length;

/**
 * Returns { lines, added, guesses } for one document's text. A trait item is a list entry
 * directly under a `traits:` key; anything more deeply indented (an enum's `values:`) is left
 * alone.
 */
function migrateText(lines, label) {
  const out = [];
  const guesses = [];
  let added = 0;

  // A comment explaining `setBy` outlives the field, and rewriting someone's prose is not this
  // script's call - so it's reported instead.
  const stale = lines
    .map((l, n) => [l, n + 1])
    .filter(([l]) => /^\s*#/.test(l) && /\bsetBy\b/.test(l))
    .map(([, n]) => `${label}:${n}: comment mentions \`setBy\`, which 0.21.0 removed - reword or delete`);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    if (!/^\s*traits:\s*$/.test(line)) continue;

    const traitsIndent = indentOf(line);
    let j = i + 1;

    while (j < lines.length) {
      const item = lines[j];
      // Blank lines and comments belong to the block; copy and keep going.
      if (item.trim() === "" || item.trim().startsWith("#")) { out.push(item); j++; continue; }
      const ind = indentOf(item);
      if (ind <= traitsIndent) break;               // dedented out of traits
      if (!/^\s*- /.test(item)) { out.push(item); j++; continue; }

      // Collect this item: its own `- ` line plus every line indented further than it.
      const itemIndent = ind;
      const body = [item];
      let k = j + 1;
      while (k < lines.length) {
        const l = lines[k];
        if (l.trim() === "") { body.push(l); k++; continue; }
        if (indentOf(l) <= itemIndent) break;
        body.push(l); k++;
      }

      const fieldIndent = " ".repeat(itemIndent + 2);
      const read = (name) => {
        for (const l of body) {
          const m = l.match(new RegExp("^\\s*(?:- )?" + name + ":\\s*(\\S+)\\s*$"));
          if (m && indentOf(l.replace(/^(\s*)- /, "$1  ")) === fieldIndent.length) {
            return m[1].replace(/^["']|["']$/g, "");
          }
        }
        return undefined;
      };

      const trait = { kind: read("kind"), id: read("id"), setBy: read("setBy"), traitType: read("traitType") };

      if (trait.traitType) {
        // Already has `traitType`, but may predate the `setBy` removal.
        const before = body.length;
        for (let b = body.length - 1; b >= 0; b--) {
          if (/^\s*setBy: (consumer|component)\s*$/.test(body[b])) body.splice(b, 1);
        }
        if (before !== body.length) added++;
        out.push(...body);
      } else {
        const { type, sure } = classify(trait);
        // Classification is done; `setBy` has given up everything it knew and is now an
        // unevaluated property, so it comes out.
        for (let b = body.length - 1; b >= 0; b--) {
          if (/^\s*setBy: (consumer|component)\s*$/.test(body[b])) body.splice(b, 1);
        }
        // Leads the trait, ahead of `kind`: on a trait it's `traitType` that says what the
        // reader is looking at, where `kind` only says what form the value takes.
        let anchor = body.findIndex((l) => /^\s*(?:- )?kind:/.test(l));
        if (anchor === -1) anchor = body.findIndex((l) => /^\s*(?:- )?id:/.test(l));
        if (anchor === -1) anchor = 0;
        const marker = body[anchor].match(/^(\s*)- /);
        if (marker) {
          // The anchor carries the list's `- `; the new field takes it over and the old
          // first field drops to a plain indented line.
          body[anchor] = marker[1] + "  " + body[anchor].replace(/^\s*- /, "");
          body.splice(anchor, 0, marker[1] + "- traitType: " + type);
        } else {
          body.splice(anchor, 0, fieldIndent + "traitType: " + type);
        }
        out.push(...body);
        added++;
        if (!sure) guesses.push(`${label}: trait "${trait.id || "(no id)"}" → ${type} (setBy: ${trait.setBy || "absent"}) - confirm`);
      }
      j = k;
    }
    i = j - 1;
  }
  return { lines: out, added, guesses, stale };
}

function collect(target, acc) {
  const st = fs.statSync(target);
  if (st.isDirectory()) {
    for (const e of fs.readdirSync(target)) collect(path.join(target, e), acc);
  } else if (/\.(ya?ml)$/.test(target)) {
    acc.push(target);
  }
  return acc;
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const targets = args.filter((a) => !a.startsWith("--"));
  if (!targets.length) {
    console.error("Usage: node scripts/tools/migrate-to-0.21.js <files-or-dirs…> [--dry-run]");
    process.exit(1);
  }

  const files = targets.reduce((acc, t) => collect(t, acc), []);
  let changed = 0, addedTotal = 0;
  const guesses = [];
  const stale = [];

  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    const text = fs.readFileSync(file, "utf8");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const res = migrateText(text.split(/\r?\n/), rel);
    if (!res.added) continue;
    if (!dryRun) fs.writeFileSync(file, res.lines.join(eol));
    changed++;
    addedTotal += res.added;
    guesses.push(...res.guesses);
    stale.push(...res.stale);
    console.log(`${dryRun ? "would add" : "added"} ${res.added} traitType field(s)  ${rel}`);
  }

  console.log(`\n${dryRun ? "Would update" : "Updated"} ${changed} file(s) of ${files.length} scanned; ${addedTotal} trait(s).`);
  if (guesses.length) {
    console.log(`\n${guesses.length} need(s) a human eye - setBy couldn't answer it:`);
    for (const g of guesses) console.log("  " + g);
  }
  if (stale.length) {
    console.log(`\n${stale.length} stale comment(s) left in place:`);
    for (const t of stale) console.log("  " + t);
  }
  console.log("\nBump each document's `schemaVersion` to 0.21.0, then run validate.");
}

main();
