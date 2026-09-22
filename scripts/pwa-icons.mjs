/**
 * Regenerate the PWA icon set from the shipped application mark.
 *
 * The mark in `public/icon.svg` is the source; everything under
 * `public/icons/` is derived from it, so rebranding means editing one SVG and
 * running this once — not hand-editing five PNGs.
 *
 * `sharp` is not a dependency of this application. It arrives with Next, which
 * uses it for image optimisation, and this script is the only thing in the
 * repository that reaches for it. That is deliberate: the generated PNGs are
 * committed, so a build, a deploy and `bun install --production` never run
 * this file. If Next ever stops shipping sharp, this script stops working and
 * nothing else does.
 *
 *   node scripts/pwa-icons.mjs
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(root, "public", "icon.svg");
const OUT = join(root, "public", "icons");

/** brand-600 — the ground the mark is drawn on, matching `icon.svg`. */
const BRAND = "#2348d6";

let sharp;
try {
  ({ default: sharp } = await import("sharp"));
} catch {
  console.error(
    "sharp is not resolvable. It normally arrives with Next; install it as a\n" +
      "dev dependency to regenerate icons, or edit public/icons/* by hand.",
  );
  process.exit(1);
}

const svg = await readFile(SOURCE);

/**
 * A `purpose: "any"` icon: the mark exactly as drawn, rounded corners and
 * transparency intact, because the platform draws it on its own ground.
 */
async function plain(size) {
  return sharp(svg, { density: 512 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * The mark's ink, as a fraction of the drawn square.
 *
 * `icon.svg` draws its glyphs inside a filled rounded rectangle, so there is
 * no alpha channel to trim against — the ink is found by walking the pixels
 * and asking which ones are not the ground. Measured rather than hard-coded
 * so that editing the SVG moves the maskable crop with it.
 *
 * @returns {Promise<{left:number,top:number,width:number,height:number}>}
 */
async function inkBox() {
  const SAMPLE = 512;
  const { data, info } = await sharp(svg, { density: 512 })
    .resize(SAMPLE, SAMPLE)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const ground = [0x23, 0x48, 0xd6];
  let minX = info.width;
  let maxX = -1;
  let minY = info.height;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      if (data[i + 3] < 8) continue;
      const isGround = ground.every((channel, n) => Math.abs(data[i + n] - channel) < 24);
      if (isGround) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  if (maxX < 0) throw new Error("public/icon.svg has no ink distinguishable from its ground.");

  return {
    left: minX / SAMPLE,
    top: minY / SAMPLE,
    width: (maxX - minX + 1) / SAMPLE,
    height: (maxY - minY + 1) / SAMPLE,
  };
}

/**
 * The share of the icon the ink may occupy.
 *
 * A maskable icon is cropped by the platform to a circle, a squircle or a
 * rounded square of its choosing, and only the middle 80% — the "safe zone" —
 * is guaranteed to survive. 0.62 keeps this mark's corners inside that circle
 * with room to spare, while still filling enough of the tile to read at 48px.
 */
const SAFE_FRACTION = 0.62;

/**
 * A `purpose: "maskable"` icon: the ink, optically centred, on a ground that
 * bleeds to every edge so no crop can expose a corner.
 */
async function maskable(size, ink) {
  // Rendered large, cropped, then scaled down: sharp allows one resize per
  // pipeline, so cropping the ink out and fitting it to the safe zone are two.
  const SOURCE = 1024;
  const left = Math.round(ink.left * SOURCE);
  const top = Math.round(ink.top * SOURCE);

  const cropped = await sharp(svg, { density: 512 })
    .resize(SOURCE, SOURCE)
    .extract({
      left,
      top,
      width: Math.min(Math.round(ink.width * SOURCE), SOURCE - left),
      height: Math.min(Math.round(ink.height * SOURCE), SOURCE - top),
    })
    .png()
    .toBuffer();

  const safe = Math.round(size * SAFE_FRACTION);
  const mark = await sharp(cropped)
    .resize({ width: safe, height: safe, fit: "inside" })
    .png()
    .toBuffer();

  return sharp({
    create: { width: size, height: size, channels: 4, background: BRAND },
  })
    .composite([{ input: mark, gravity: "centre" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * iOS applies its own squircle mask and composites the icon on black, so a
 * transparent corner reads as a black notch. Flattening onto the brand colour
 * makes the corners disappear into the mark.
 */
async function apple(size) {
  return sharp(svg, { density: 512 })
    .resize(size, size)
    .flatten({ background: BRAND })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const ink = await inkBox();

const files = [
  ["icon-192.png", await plain(192)],
  ["icon-512.png", await plain(512)],
  ["icon-maskable-192.png", await maskable(192, ink)],
  ["icon-maskable-512.png", await maskable(512, ink)],
  ["apple-touch-icon.png", await apple(180)],
];

for (const [name, buffer] of files) {
  await writeFile(join(OUT, name), buffer);
  console.log(`${name.padEnd(24)} ${String(buffer.length).padStart(7)} bytes`);
}
