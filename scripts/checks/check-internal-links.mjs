#!/usr/bin/env node
/**
 * Regression guard for this repo's own internal links: every markdown `[text](target)` link
 * and bare `https://designsystemdocspec.org/...` URL in README.md, AGENTS.md,
 * site/content/**\/*.mdx, and schema/conformance-rules.yaml, resolved against the already-built
 * site/dist/ (run `npm run build` first). Exists because a page restructure silently breaks
 * links nothing else catches. Does not check external links, versioned schema/bundle artifact
 * URLs (/v<n>/...), or README/AGENTS.md's own bare `#anchor` links (those are GitHub's own
 * same-page anchors, not this site's rendered HTML). Run via `npm run check:docs`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "..");
const DIST_DIR = path.join(ROOT, "site", "dist");
const CONTENT_DIR = path.join(ROOT, "site", "content");

// Which built page a source file's own bare `#anchor` links resolve against. site/content/*.mdx
// files compile 1:1 to a page of the same name except these entries.
const PAGE_FOR_SOURCE = {
  "overview.mdx": "index",
  "quickstart.mdx": "quickstart",
  "extending.mdx": "extending",
  "conformance.mdx": "conformance",
  "stability.mdx": "stability",
  "interoperability.mdx": "interoperability",
  "fragments/404.mdx": "404",
  "fragments/schema-intro.mdx": "schema",
};

const MD_LINK_RE = /\[[^\]]*\]\(([^)\s]+)\)/g;
const ABS_URL_RE = /https:\/\/designsystemdocspec\.org(\/[^\s")'<>]*)?/g;

function extractLinks(text) {
  const links = new Set();
  for (const m of text.matchAll(MD_LINK_RE)) links.add(m[1]);
  for (const m of text.matchAll(ABS_URL_RE)) links.add(m[0]);
  return [...links];
}

// A link worth checking: any path this site serves (root "/", "#anchor", an extensionless
// page path, "<page>.html", or a served artifact) as a relative or absolute
// designsystemdocspec.org link. Not checked: other external URLs, mailto:, or a versioned
// artifact path (/v<n>/...). Deliberately doesn't require a ".html" extension - it used to,
// and that silently skipped links in the site's own canonical extensionless form.
function isSiteDocLink(link) {
  let rel = link;
  if (rel.startsWith("https://designsystemdocspec.org")) {
    rel = rel.slice("https://designsystemdocspec.org".length) || "/";
  } else if (/^https?:\/\//.test(rel) || rel.startsWith("mailto:")) {
    return false;
  }
  if (/^\/v[\w.{}]/.test(rel)) return false; // versioned schema/bundle artifact
  if (rel === "/" || rel.startsWith("#")) return true;
  // A path this site could serve: path segments, optionally with an "#anchor". Excludes
  // anything with a "{{...}}" placeholder or a space (template or prose, not a link).
  return /^\/?[\w-]+(\.[\w-]+)?(\/[\w-]+(\.[\w-]+)?)*(#[\w.-]*)?$/.test(rel);
}

function toDistTarget(link, currentPage) {
  let rel = link.startsWith("https://designsystemdocspec.org")
    ? link.slice("https://designsystemdocspec.org".length) || "/"
    : link;
  rel = rel.replace(/^\//, "");
  // A bare "#anchor" means "this same page" (only meaningful for a source that compiles to
  // one); an empty path always means the home page.
  if (rel.startsWith("#")) {
    return { file: `${currentPage}.html`, anchor: rel.slice(1) };
  }
  if (rel === "") {
    return { file: "index.html", anchor: "" };
  }
  const [file, anchor = ""] = rel.split("#");
  // An extensionless path is a page (this site publishes "/quickstart", Netlify serves
  // quickstart.html); a path that already carries an extension is checked as-is.
  const hasExtension = path.extname(file) !== "";
  return { file: hasExtension ? file : `${file}.html`, anchor };
}

const anchorCache = new Map();
function anchorExists(file, anchor) {
  if (!anchor) return true;
  // Only an HTML page carries id="..."/anchor="..." attributes. An anchor on a markdown
  // mirror is a heading slug a markdown renderer derives, not markup in the file.
  if (!file.endsWith(".html")) return true;
  if (!anchorCache.has(file)) {
    const filePath = path.join(DIST_DIR, file);
    anchorCache.set(file, fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf-8") : null);
  }
  const html = anchorCache.get(file);
  if (html == null) return false;
  return html.includes(`id="${anchor}"`) || html.includes(`anchor="${anchor}"`);
}

function collectMdxFiles(dir, base = "") {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectMdxFiles(full, rel));
    else if (entry.name.endsWith(".mdx")) out.push(rel);
  }
  return out;
}

const sources = [
  { label: "README.md", path: path.join(ROOT, "README.md"), page: null },
  { label: "AGENTS.md", path: path.join(ROOT, "AGENTS.md"), page: null },
  { label: "schema/conformance-rules.yaml", path: path.join(ROOT, "schema/conformance-rules.yaml"), page: null },
  ...collectMdxFiles(CONTENT_DIR).map((rel) => ({
    label: `site/content/${rel}`,
    path: path.join(CONTENT_DIR, rel),
    page: PAGE_FOR_SOURCE[rel] || null,
  })),
];

let ok = true;
let checked = 0;

for (const source of sources) {
  const text = fs.readFileSync(source.path, "utf-8");
  for (const link of extractLinks(text)) {
    if (!isSiteDocLink(link)) continue;
    // README.md and AGENTS.md are read on GitHub too, so only a rooted "/path" or an
    // absolute designsystemdocspec.org link out of them is this site's concern - a bare
    // relative link or "#anchor" is GitHub's own repo path/same-page anchor, not a page here.
    if (!source.page && !link.startsWith("/") && !link.startsWith("https://designsystemdocspec.org")) continue;
    checked++;
    const { file, anchor } = toDistTarget(link, source.page);
    const filePath = path.join(DIST_DIR, file);
    if (!fs.existsSync(filePath)) {
      console.error(`✗ ${source.label}: "${link}" -> site/dist/${file} does not exist`);
      ok = false;
      continue;
    }
    if (!anchorExists(file, anchor)) {
      console.error(`✗ ${source.label}: "${link}" -> site/dist/${file} exists, but no id/anchor "${anchor}" found in it`);
      ok = false;
    }
  }
}

if (ok) {
  console.log(`✓ ${checked} internal link(s) across ${sources.length} source file(s) all resolve against site/dist/.`);
}
process.exit(ok ? 0 : 1);
