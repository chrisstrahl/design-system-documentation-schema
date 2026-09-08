#!/usr/bin/env node
/**
 * Generates the site's shared Open Graph image: the DSDS logo centered on the accent
 * background color at the standard 1200×630 OG size, rendered with a real Chromium instance
 * loading tokens.css so it always matches the current design tokens.
 *
 * NOT part of `npm run build` - the output, site/assets/og-image.png, is a committed source
 * asset build-site.js copies like any other, so a headless Chromium isn't a hard dependency of
 * every build/deploy to reproduce a file that changes about once a year. Run it by hand, and
 * commit the result, when the logo or the accent/text tokens change - nothing detects that
 * automatically.
 *
 * Usage:
 *   npm run og:generate     # then commit site/assets/og-image.png
 */

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const SITE_DIR = path.join(ROOT, "site");
const LOGO_PATH = path.join(SITE_DIR, "assets", "dsds.svg");
const OUTPUT_PATH = path.join(SITE_DIR, "assets", "og-image.png");
const TEMP_HTML_PATH = path.join(SITE_DIR, ".og-image-source.html");

const WIDTH = 1200;
const HEIGHT = 630;
const LOGO_SIZE = 360;

async function main() {
  const logoSvg = fs.readFileSync(LOGO_PATH, "utf8");

  // Loaded from site/ so the relative tokens.css link resolves like a real page. The logo's
  // fill is set via CSS, not the SVG's own hardcoded fill="black" - a stylesheet rule always
  // wins over an SVG presentation attribute, same as <ds-logo>.
  const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="stylesheet" href="tokens.css">
<style>
  html, body { margin: 0; padding: 0; }
  .og {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--ds-color-bg-accent);
  }
  .og svg {
    width: ${LOGO_SIZE}px;
    height: ${LOGO_SIZE}px;
  }
  .og svg path {
    fill: var(--ds-color-text);
  }
</style>
</head>
<body>
  <div class="og">${logoSvg}</div>
</body>
</html>
`;

  fs.writeFileSync(TEMP_HTML_PATH, html);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: WIDTH, height: HEIGHT },
    });
    await page.goto("file://" + TEMP_HTML_PATH);
    const og = page.locator(".og");
    await og.screenshot({ path: OUTPUT_PATH });
    console.log(`✓ Generated ${path.relative(ROOT, OUTPUT_PATH)}`);
  } finally {
    await browser.close();
    fs.unlinkSync(TEMP_HTML_PATH);
  }
}

main();
