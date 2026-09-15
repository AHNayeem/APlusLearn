/**
 * Brand colour → design-token ramp (§26 platform settings, §34 accessibility).
 *
 * An administrator picks one hex per role. Scattering that hex through the UI
 * would fork the design system, so instead it is expanded here into the exact
 * token names `globals.css` already declares, and emitted as a single CSS
 * variable block. Components keep using `bg-brand-600` and never learn that a
 * colour was configured.
 *
 * The ramp is generated in OKLab, not sRGB: interpolating lightness in sRGB
 * turns mid-tones muddy and makes the 600 step's contrast unpredictable. The
 * chosen colour is kept *exactly* at its own step — an administrator who types
 * #2563EB gets #2563EB — and the rest of the scale is fitted around it, so the
 * relationship between 50 and 950 stays the same shape for every brand.
 *
 * Nothing here is admin-facing policy: `contrastRatio` is what the validation
 * layer uses to refuse a colour that cannot carry white text.
 */

/** Lightness shape of the shipped brand ramp, normalised and re-fitted below. */
const RAMP_SHAPE = [0.971, 0.936, 0.885, 0.808, 0.704, 0.637, 0.577, 0.505, 0.444, 0.396, 0.28];

/** Chroma relative to the chosen colour, so tints stay tints and shades stay rich. */
const RAMP_CHROMA = [0.14, 0.28, 0.48, 0.72, 0.94, 1.03, 1, 0.92, 0.8, 0.7, 0.52];

const STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/** Where the caller's colour sits in the ramp. Brand/accent anchor at 600. */
const ANCHOR = 6;

const LIGHTEST = 0.975;
const DARKEST = 0.255;

export const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value) {
  return typeof value === "string" && HEX_PATTERN.test(value.trim());
}

/** "#abc" and "#AABBCC" both normalise to "#aabbcc". */
export function normalizeHex(value) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!HEX_PATTERN.test(raw)) return null;
  const body = raw.slice(1);
  const full = body.length === 3 ? body.split("").map((c) => c + c).join("") : body;
  return `#${full}`;
}

function hexToRgb(hex) {
  const normal = normalizeHex(hex);
  if (!normal) return null;
  return {
    r: parseInt(normal.slice(1, 3), 16) / 255,
    g: parseInt(normal.slice(3, 5), 16) / 255,
    b: parseInt(normal.slice(5, 7), 16) / 255,
  };
}

function rgbToHex({ r, g, b }) {
  const channel = (v) => {
    const byte = Math.round(Math.min(1, Math.max(0, v)) * 255);
    return byte.toString(16).padStart(2, "0");
  };
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

/* --- sRGB transfer function ------------------------------------------------ */

function toLinear(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function toGamma(value) {
  return value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;
}

/* --- OKLab ----------------------------------------------------------------- */

function rgbToOklab({ r, g, b }) {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function oklabToRgb({ L, a, b }) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    r: toGamma(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: toGamma(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: toGamma(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

function oklchToOklab({ L, C, h }) {
  const rad = (h * Math.PI) / 180;
  return { L, a: Math.cos(rad) * C, b: Math.sin(rad) * C };
}

function oklabToOklch({ L, a, b }) {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}

function inGamut({ r, g, b }) {
  const limit = 1 + 1e-4;
  return r >= -1e-4 && g >= -1e-4 && b >= -1e-4 && r <= limit && g <= limit && b <= limit;
}

/**
 * Bring an OKLCH colour into sRGB by desaturating rather than clipping
 * channels: clipping shifts hue, which is exactly what a brand cannot afford.
 */
function oklchToHex({ L, C, h }) {
  let chroma = C;
  for (let i = 0; i < 24; i += 1) {
    const rgb = oklabToRgb(oklchToOklab({ L, C: chroma, h }));
    if (inGamut(rgb)) return rgbToHex(rgb);
    chroma *= 0.88;
  }
  return rgbToHex(oklabToRgb(oklchToOklab({ L, C: 0, h })));
}

/**
 * Expand one hex into the eleven-step scale, keeping the input untouched at
 * the anchor step.
 *
 * @param {string} hex        the administrator's colour
 * @param {number} anchor     index into STEPS the colour occupies (default 600)
 * @returns {Record<number, string>|null}
 */
export function buildScale(hex, { anchor = ANCHOR } = {}) {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;

  const base = oklabToOklch(rgbToOklab(rgb));
  const anchorShape = RAMP_SHAPE[anchor];

  const scale = {};
  STEPS.forEach((step, index) => {
    if (index === anchor) {
      scale[step] = normalizeHex(hex);
      return;
    }

    // Re-fit the shipped ramp's shape onto [LIGHTEST, base.L] above the anchor
    // and [base.L, DARKEST] below it, so the curve survives any input.
    const L =
      index < anchor
        ? LIGHTEST +
          ((base.L - LIGHTEST) * (RAMP_SHAPE[0] - RAMP_SHAPE[index])) /
            (RAMP_SHAPE[0] - anchorShape)
        : base.L +
          ((DARKEST - base.L) * (anchorShape - RAMP_SHAPE[index])) /
            (anchorShape - RAMP_SHAPE[RAMP_SHAPE.length - 1]);

    const C = (base.C * RAMP_CHROMA[index]) / RAMP_CHROMA[anchor];
    scale[step] = oklchToHex({ L: Math.min(0.995, Math.max(0.02, L)), C, h: base.h });
  });

  return scale;
}

/* --- Contrast -------------------------------------------------------------- */

function relativeLuminance({ r, g, b }) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG 2.1 contrast ratio between two hex colours, 1–21. */
export function contrastRatio(a, b) {
  const first = hexToRgb(a);
  const second = hexToRgb(b);
  if (!first || !second) return 0;
  const la = relativeLuminance(first);
  const lb = relativeLuminance(second);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA body-text contrast. The one threshold the whole system is held to. */
export const MIN_TEXT_CONTRAST = 4.5;

/** The darkest ink in the design system, used as the alternative text colour. */
const INK = "#0f172a";

/** The body text colour `globals.css` sets on `<body>`. */
const BODY_INK = "#334155";

/**
 * Two different rules, because the roles are used differently.
 *
 * The primary brand and the footer ground always carry *white* text — solid
 * buttons, the header CTA, the footer band — so they must clear AA against
 * white specifically. A pale primary would leave every button on the platform
 * unreadable, and no amount of good intent in the picker fixes that.
 *
 * Accent and the semantic colours are used both ways: as a solid chip and as
 * a light tint behind dark text. They only have to be legible against *one* of
 * the two, which is what `readableTextOn` then picks. The shipped orange
 * (#fe7b12) is exactly this case — unreadable under white, excellent under
 * ink — so a stricter rule here would reject the platform's own palette.
 */
export function isUsableAsSolid(hex) {
  return contrastRatio(hex, "#ffffff") >= MIN_TEXT_CONTRAST;
}

export function isLegible(hex) {
  return Math.max(contrastRatio(hex, "#ffffff"), contrastRatio(hex, INK)) >= MIN_TEXT_CONTRAST;
}

/**
 * Page and card grounds are the other way round: they sit *behind* the body
 * text, which is always dark. A ground too dark for that text would make the
 * whole application unreadable, so it is refused rather than accepted as a
 * "dark mode" the rest of the design system does not implement.
 */
export function isUsableAsSurface(hex) {
  return contrastRatio(hex, BODY_INK) >= MIN_TEXT_CONTRAST;
}

/** Text colour that reads on a given ground — used by previews and emails. */
export function readableTextOn(hex) {
  return contrastRatio(hex, "#ffffff") >= contrastRatio(hex, INK) ? "#ffffff" : INK;
}
