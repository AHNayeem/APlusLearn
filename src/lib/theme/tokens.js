import { DEFAULT_SETTINGS } from "@/constants/config";
import { buildScale, normalizeHex, readableTextOn } from "./palette";

/**
 * The bridge between configured colours and the design system (§26).
 *
 * `globals.css` is still the source of truth for *which* tokens exist and what
 * they mean. This module only re-points the ones an administrator is allowed
 * to choose, using the same names, so no component ever carries a literal
 * colour. Anything not listed here — the plum CTA family, the ink neutrals,
 * radii, shadows — stays exactly as shipped.
 */

/**
 * Which step each configurable role anchors to, and which steps the stylesheet
 * actually declares. Emitting a token `globals.css` never declared would leave
 * a variable nothing reads; emitting fewer would leave a gap at runtime.
 */
const ROLES = {
  primaryColor: { prefix: "brand", anchor: 6, steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] },
  accentColor: { prefix: "accent", anchor: 5, steps: [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] },
  successColor: { prefix: "success", anchor: 5, steps: [50, 100, 500, 600, 700] },
  warningColor: { prefix: "warning", anchor: 5, steps: [50, 100, 500, 600, 700] },
  dangerColor: { prefix: "danger", anchor: 5, steps: [50, 100, 500, 600, 700] },
};

/** Colours used as-is rather than expanded into a scale. */
const FLAT_ROLES = {
  canvasColor: "canvas",
  surfaceColor: "surface",
  footerColor: "footer",
};

/**
 * Build the CSS variable block for a theme.
 *
 * The selector is doubled (`:root:root`) deliberately. Tailwind v4 emits the
 * `@theme` defaults onto `:root`, and the order in which Next injects a
 * stylesheet link versus an inline `<style>` is not something a layout should
 * depend on. Doubling the selector wins on specificity instead of on order,
 * which is stable in every injection scenario.
 *
 * @returns {string} CSS, or "" when nothing is configured (so the shipped
 *   tokens stand untouched — the safe default of §19).
 */
export function buildThemeCss(theme) {
  const declarations = [];
  const shipped = DEFAULT_SETTINGS.theme;

  for (const [key, role] of Object.entries(ROLES)) {
    const hex = normalizeHex(theme?.[key]);
    // An untouched role emits nothing, so a default install renders from
    // `globals.css` exactly as it was designed rather than from a ramp that
    // merely passes through the same anchor.
    if (!hex || hex === normalizeHex(shipped[key])) continue;

    const scale = buildScale(hex, { anchor: role.anchor });
    if (!scale) continue;

    for (const step of role.steps) {
      declarations.push(`--color-${role.prefix}-${step}:${scale[step]}`);
    }
  }

  for (const [key, token] of Object.entries(FLAT_ROLES)) {
    const hex = normalizeHex(theme?.[key]);
    if (hex && hex !== normalizeHex(shipped[key])) declarations.push(`--color-${token}:${hex}`);
  }

  if (!declarations.length) return "";
  return `:root:root{${declarations.join(";")}}`;
}

/**
 * The colour the browser chrome and PWA manifest should use. Falls back to the
 * shipped brand-600 so a missing setting never produces an invalid meta tag.
 */
export function themeColor(theme, fallback = "#2348d6") {
  return normalizeHex(theme?.primaryColor) ?? fallback;
}

/**
 * Swatches the admin preview renders. Kept here rather than in the component so
 * the preview is guaranteed to be showing the same computation the page will
 * apply after saving.
 */
export function previewSwatches(theme) {
  return Object.entries(ROLES)
    .map(([key, role]) => {
      const hex = normalizeHex(theme?.[key]);
      const scale = hex ? buildScale(hex, { anchor: role.anchor }) : null;
      if (!scale) return null;
      return {
        key,
        prefix: role.prefix,
        // The anchor step is the administrator's colour verbatim.
        base: hex,
        onBase: readableTextOn(hex),
        steps: role.steps.map((step) => ({ step, hex: scale[step] })),
      };
    })
    .filter(Boolean);
}
