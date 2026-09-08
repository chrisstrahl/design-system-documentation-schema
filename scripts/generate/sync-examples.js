#!/usr/bin/env node
/**
 * Synchronizes JSON examples from source files into markdown. Scans all MDX content pages in
 * site/content/ for include directives (`<!-- dsds:include path/to/file.json#/key -->`) and
 * replaces the fenced JSON code block that follows with the content at that path (inserting
 * one if none follows). `#/key/nested/0` navigates the JSON structure, supporting array
 * indices. Paths resolve relative to the project root.
 *
 * Usage:
 *   node scripts/generate/sync-examples.js           # update all markdown files
 *   node scripts/generate/sync-examples.js --check   # check only, exit 1 if out of date
 */

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const ROOT = path.resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Parses an include directive line into { filePath, keyPath } or null if not a directive.
function parseDirective(line) {
  const trimmed = line.trim();
  // Two marker syntaxes: HTML comments in spec/modules markdown, MDX (JSX) comments in
  // site/content pages - MDX rejects HTML comments outright.
  let style = "html";
  let match = trimmed.match(/^<!--\s*dsds:include\s+(\S+)\s*-->$/);
  if (!match) {
    match = trimmed.match(/^\{\/\*\s*dsds:include\s+(\S+)\s*\*\/\}$/);
    style = "mdx";
  }
  if (!match) return null;

  const raw = match[1];
  const hashIndex = raw.indexOf("#");

  if (hashIndex === -1) {
    return { filePath: raw, keyPath: [], style };
  }

  const filePath = raw.slice(0, hashIndex);
  const fragment = raw.slice(hashIndex + 1);
  // Fragment is like /tokenDoc or /tokenApi/0
  const keyPath = fragment
    .replace(/^\//, "")
    .split("/")
    .filter((s) => s.length > 0);

  return { filePath, keyPath };
}

// Tests if a line is a closing include marker.
function isClosingMarker(line) {
  return /^\s*(<!--\s*\/dsds:include\s*-->|\{\/\*\s*\/dsds:include\s*\*\/\})\s*$/.test(line);
}

// Resolves a key path into a JSON value; supports object keys and array indices.
function resolveKeyPath(data, keyPath) {
  let current = data;
  for (const segment of keyPath) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current)) {
      const idx = parseInt(segment, 10);
      if (isNaN(idx)) return undefined;
      current = current[idx];
    } else if (typeof current === "object") {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}

// Reads a JSON file and optionally navigates to a key path, returning the pretty-printed
// JSON string.
function readExample(filePath, keyPath) {
  const absPath = path.resolve(ROOT, filePath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${filePath} (resolved to ${absPath})`);
  }

  const raw = fs.readFileSync(absPath, "utf-8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${filePath}: ${e.message}`);
  }

  if (keyPath.length === 0) {
    return JSON.stringify(data, null, 2);
  }

  const value = resolveKeyPath(data, keyPath);
  if (value === undefined) {
    throw new Error(
      `Key path /${keyPath.join("/")} not found in ${filePath}. ` +
        `Available top-level keys: ${Object.keys(data).join(", ")}`,
    );
  }

  return JSON.stringify(value, null, 2);
}

// ---------------------------------------------------------------------------
// Process a single markdown file
// ---------------------------------------------------------------------------

// Processes a markdown file, replacing include directives with JSON content. Returns
// { content, updated, includes: [{ line, filePath, keyPath, ok, error }] }.
function processMarkdown(mdPath) {
  const text = fs.readFileSync(mdPath, "utf-8");
  const lines = text.split("\n");
  const output = [];
  const includes = [];
  let updated = false;
  let i = 0;

  while (i < lines.length) {
    const directive = parseDirective(lines[i]);

    if (!directive) {
      output.push(lines[i]);
      i++;
      continue;
    }

    // Found an include directive
    const directiveLine = i + 1; // 1-based for reporting
    output.push(lines[i]); // keep the directive comment
    i++;

    // Try to read the example content
    let jsonContent;
    let error = null;
    try {
      jsonContent = readExample(directive.filePath, directive.keyPath);
    } catch (e) {
      error = e.message;
      includes.push({
        line: directiveLine,
        filePath: directive.filePath,
        keyPath: directive.keyPath,
        ok: false,
        error,
      });
      // Skip past the existing code block and closing marker, leaving it untouched on error.
      i = skipExistingBlock(lines, i);
      continue;
    }

    const newBlock = "```json\n" + jsonContent + "\n```";

    // Check if the next non-empty content is an existing fenced code block
    const existingEnd = findExistingCodeBlock(lines, i);

    if (existingEnd !== null) {
      // There's an existing code block — compare and replace
      const existingBlock = lines.slice(i, existingEnd + 1).join("\n");

      if (existingBlock === newBlock) {
        // No change needed — copy as-is
        for (let j = i; j <= existingEnd; j++) {
          output.push(lines[j]);
        }
        i = existingEnd + 1;
      } else {
        // Replace the block
        output.push(...newBlock.split("\n"));
        i = existingEnd + 1;
        updated = true;
      }
    } else {
      // No existing code block — insert one
      output.push(...newBlock.split("\n"));
      updated = true;
    }

    // Handle closing marker
    if (i < lines.length && isClosingMarker(lines[i])) {
      output.push(lines[i]);
      i++;
    } else {
      // Insert closing marker if missing, matching the directive syntax
      output.push(
        directive.style === "mdx" ? "{/* /dsds:include */}" : "<!-- /dsds:include -->",
      );
      updated = true;
    }

    includes.push({
      line: directiveLine,
      filePath: directive.filePath,
      keyPath: directive.keyPath,
      ok: true,
      error: null,
    });
  }

  return {
    content: output.join("\n"),
    updated,
    includes,
  };
}

// Starting at line index `start`, checks if the next content is a fenced JSON code block.
// Returns the index of the closing ``` line, or null.
function findExistingCodeBlock(lines, start) {
  let i = start;

  if (i >= lines.length) return null; // the very next line should be the opening fence
  if (!/^\s*```json\s*$/i.test(lines[i])) return null;

  // Find the closing fence
  i++;
  while (i < lines.length) {
    if (/^\s*```\s*$/.test(lines[i])) {
      return i;
    }
    i++;
  }

  return null; // unclosed block
}

// Skips past an existing code block and optional closing marker, used when an error occurs
// reading the source file so the existing content is left untouched.
function skipExistingBlock(lines, start) {
  let i = start;

  // Skip code block if present
  if (i < lines.length && /^\s*```json\s*$/i.test(lines[i])) {
    i++;
    while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
      i++;
    }
    if (i < lines.length) i++; // skip closing ```
  }

  // Skip closing marker if present
  if (i < lines.length && isClosingMarker(lines[i])) {
    i++;
  }

  return i;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");

  console.log(
    checkOnly
      ? "Checking markdown include directives...\n"
      : "Syncing markdown include directives...\n",
  );

  const CONTENT_DIR = path.join(ROOT, "site", "content");
  const mdFiles = fs.existsSync(CONTENT_DIR)
    ? fs
        .readdirSync(CONTENT_DIR)
        .filter((f) => f.endsWith(".mdx"))
        .sort()
        .map((f) => path.join(CONTENT_DIR, f))
    : [];

  let totalIncludes = 0;
  let totalUpdated = 0;
  let totalErrors = 0;
  let filesWithChanges = 0;

  for (const mdPath of mdFiles) {
    const relPath = path.relative(ROOT, mdPath);
    const result = processMarkdown(mdPath);

    if (result.includes.length === 0) continue;

    const label = checkOnly && result.updated ? "⚠" : "✓";
    console.log(`  ${label} ${relPath}`);

    for (const inc of result.includes) {
      const ref =
        inc.keyPath.length > 0
          ? `${inc.filePath}#/${inc.keyPath.join("/")}`
          : inc.filePath;

      if (inc.ok) {
        console.log(`      Line ${inc.line}: ${ref}`);
      } else {
        console.error(`    ✗ Line ${inc.line}: ${ref}`);
        console.error(`      Error: ${inc.error}`);
        totalErrors++;
      }
    }

    totalIncludes += result.includes.length;

    if (result.updated) {
      filesWithChanges++;
      totalUpdated += result.includes.filter((i) => i.ok).length;

      if (!checkOnly) {
        fs.writeFileSync(mdPath, result.content, "utf-8");
      }
    }
  }

  if (mdFiles.length === 0) {
    // No .mdx files at all is a broken checkout, not a passing sync - unlike zero *includes*
    // across real .mdx files, which is a legitimate state.
    console.error(
      "  ✗ No .mdx files found — site/content/ is missing or empty.",
    );
    process.exit(1);
  }

  console.log(
    `\n  ${totalIncludes} include${totalIncludes === 1 ? "" : "s"} found`,
  );

  if (checkOnly) {
    if (filesWithChanges > 0) {
      console.log(
        `  ${filesWithChanges} file${filesWithChanges === 1 ? "" : "s"} out of date`,
      );
      console.log("\n  Run `node scripts/generate/sync-examples.js` to update.\n");
      process.exit(1);
    } else if (totalErrors > 0) {
      console.log(`  ${totalErrors} error${totalErrors === 1 ? "" : "s"}`);
      process.exit(1);
    } else {
      console.log("  All includes are up to date.\n");
      process.exit(0);
    }
  } else {
    if (totalUpdated > 0) {
      console.log(
        `  ${totalUpdated} block${totalUpdated === 1 ? "" : "s"} updated across ${filesWithChanges} file${filesWithChanges === 1 ? "" : "s"}`,
      );
    } else {
      console.log("  All includes already up to date.");
    }

    if (totalErrors > 0) {
      console.log(`  ${totalErrors} error${totalErrors === 1 ? "" : "s"}`);
      process.exit(1);
    }

    console.log("\nDone.\n");
    process.exit(0);
  }
}

main();
