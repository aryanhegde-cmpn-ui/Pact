/**
 * Generates the PWA icon set.
 *
 *   npm run icons
 *
 * A wordmark drawn here as SVG and rasterised with sharp, rather than a
 * dependency on an external design asset. Colours come from the design tokens
 * so the icon cannot drift from the app.
 *
 * Two shapes, because they are used differently:
 *
 *   standard  the glyph on its own, edge to edge
 *   maskable  the same glyph inside the 40% safe zone, on a filled bleed, so
 *             Android can crop it to a circle, squircle or rounded square
 *             without clipping the mark
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');

// From src/styles/tokens.css. Kept in sync by hand; there is one palette.
const BASE = '#0b0d10';
const SIGNAL = '#d8763a';
const TEXT = '#e6eaef';

/**
 * The mark: a "P" cut by a horizontal rule.
 *
 * The rule is the deadline -- the thing the letter is measured against. Simple
 * enough to stay legible at 48px on a home screen, which is the only size that
 * actually matters.
 */
function wordmark(size, { maskable }) {
  // Maskable icons must keep content inside the middle 80% (a 40% safe radius),
  // because the launcher crops to an arbitrary shape.
  const scale = maskable ? 0.62 : 0.82;
  const glyph = size * scale;
  const offset = (size - glyph) / 2;
  const stroke = glyph * 0.13;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${BASE}"/>
  <g transform="translate(${offset} ${offset})">
    <path
      d="M ${glyph * 0.2} ${glyph * 0.94}
         L ${glyph * 0.2} ${glyph * 0.06}
         L ${glyph * 0.56} ${glyph * 0.06}
         A ${glyph * 0.26} ${glyph * 0.26} 0 0 1 ${glyph * 0.56} ${glyph * 0.58}
         L ${glyph * 0.2} ${glyph * 0.58}"
      fill="none" stroke="${TEXT}" stroke-width="${stroke}"
      stroke-linecap="square" stroke-linejoin="miter"/>
    <line x1="${glyph * 0.06}" y1="${glyph * 0.75}" x2="${glyph * 0.94}" y2="${glyph * 0.75}"
      stroke="${SIGNAL}" stroke-width="${stroke * 0.8}" stroke-linecap="square"/>
  </g>
</svg>`;
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const targets = [
    { name: 'icon-192.png', size: 192, maskable: false },
    { name: 'icon-512.png', size: 512, maskable: false },
    { name: 'icon-maskable-192.png', size: 192, maskable: true },
    { name: 'icon-maskable-512.png', size: 512, maskable: true },
    // iOS ignores the manifest and uses this. It also has no maskable concept
    // and applies its own corner radius, so it takes the standard shape.
    { name: 'apple-touch-icon.png', size: 180, maskable: false },
  ];

  for (const target of targets) {
    const svg = wordmark(target.size, { maskable: target.maskable });
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(join(OUT, target.name));
    console.log(`  ${target.name.padEnd(26)} ${target.size}x${target.size}`);
  }

  // The source SVG ships too: it is the only scalable copy, and regenerating
  // from it beats redrawing when a size is added.
  await writeFile(join(OUT, 'icon.svg'), wordmark(512, { maskable: false }), 'utf8');
  console.log('  icon.svg                   vector source');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
