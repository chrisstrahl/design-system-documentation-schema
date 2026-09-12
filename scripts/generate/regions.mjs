#!/usr/bin/env node
/**
 * One generated region inside a hand-written file.
 *
 * Several files in this repo are written by a person but carry a block that has to stay
 * exactly what some schema file says - the rule catalog on the Conformance page, the
 * normative-statements index, the examples index, the entry/section envelopes in AGENTS.md.
 * Each of those had its own copy of the same twenty lines: find the two marker comments,
 * splice new content between them, and under --check exit 1 instead of writing. This is that
 * logic, once.
 *
 * The point is the same one STYLE_GUIDE.md makes about field order: a list that exists in two
 * places drifts, so derive it rather than retype it. A generator here supplies only the body;
 * the markers, the blank lines around them, the --check comparison and the "run npm run
 * generate" message are this module's job.
 *
 * Marker syntax follows the file extension. MDX rejects HTML comments outright, so an .mdx
 * file gets a JSX comment naming the region and everything else gets an HTML comment; see
 * markersFor below for the exact pair.
 */

import fs from "node:fs";
import path from "node:path";

/** The two markers that bound a region called `name` in `file`, in that file's comment syntax. */
export function markersFor(file, name) {
  const mdx = path.extname(file) === ".mdx";
  return mdx
    ? { begin: `{/* dsds:${name} */}`, end: `{/* /dsds:${name} */}` }
    : { begin: `<!-- dsds:${name} -->`, end: `<!-- /dsds:${name} -->` };
}

/**
 * Replace the region called `name` in `file` with `render()`'s output.
 *
 * @param {object} opts
 * @param {string} opts.file       Absolute path to the file holding the region.
 * @param {string} opts.name       Region name, without the `dsds:` prefix.
 * @param {() => string} opts.render  Produces the body. Markers and surrounding blank lines
 *                                    are added here, so a renderer never emits its own.
 * @param {boolean} opts.check     Report drift and exit 1 rather than writing.
 * @param {string} [opts.label]    What to call the region in console output.
 * @returns {boolean} true if the file already matched (nothing was written).
 */
export function syncRegion({ file, name, render, check, label }) {
  const what = label || `${path.basename(file)}'s ${name} region`;

  if (!fs.existsSync(file)) {
    console.error(`✗ ${path.relative(process.cwd(), file)} not found.`);
    process.exit(1);
  }

  const { begin, end } = markersFor(file, name);
  const current = fs.readFileSync(file, "utf-8");
  const at = current.indexOf(begin);
  const to = current.indexOf(end);

  // A missing marker is a hard error, never a silent no-op: a region that quietly stops being
  // regenerated is exactly the stale hand-maintained list this module exists to prevent.
  if (at === -1 || to === -1) {
    console.error(
      `✗ Marker comments missing in ${path.relative(process.cwd(), file)}. ` +
        `Expected ${begin} … ${end}.`,
    );
    process.exit(1);
  }
  if (to < at) {
    console.error(
      `✗ Markers out of order in ${path.relative(process.cwd(), file)}: ${end} precedes ${begin}.`,
    );
    process.exit(1);
  }

  const body = render().replace(/^\n+/, "").replace(/\s+$/, "");
  const updated = current.slice(0, at) + `${begin}\n\n${body}\n\n${end}` + current.slice(to + end.length);

  if (updated === current) {
    if (!check) console.log(`✓ ${what} already up to date.`);
    return true;
  }
  if (check) {
    console.error(`✗ ${what} is out of date. Run \`npm run generate\` to regenerate.`);
    process.exit(1);
  }
  fs.writeFileSync(file, updated, "utf-8");
  console.log(`✓ ${what} regenerated.`);
  return false;
}
