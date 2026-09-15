"use client";

import { RotateCcw } from "lucide-react";
import { Alert, Button, Card, CardBody, CardHeader, Field, Input } from "@/components/ui";
import { DEFAULT_SETTINGS } from "@/constants";
import {
  buildScale, contrastRatio, isLegible, isUsableAsSolid, isUsableAsSurface,
  normalizeHex, readableTextOn, MIN_TEXT_CONTRAST,
} from "@/lib/theme/palette";
import { useSettingsSection } from "./useSettingsSection";
import { SectionForm } from "./SectionForm";

/**
 * Appearance (§26, §34).
 *
 * The important property of this panel is that it lies about nothing. The
 * preview is rendered from `buildScale` — the same function the server uses to
 * write the CSS variables — and the contrast warning uses the same threshold
 * the validator enforces. A colour that looks acceptable here is one the save
 * will accept, and vice versa.
 *
 * Deliberately small. Six colours, a preview, and a reset. A full theme editor
 * would be a bigger surface to maintain than the design system it edits.
 */
/**
 * `rule` mirrors the server's validator exactly — see `lib/theme/palette.js`.
 * `white` roles always carry white text; `legible` roles are used both as a
 * solid chip and as a tint, so either text colour may carry them; `surface`
 * roles sit behind the dark body text.
 */
const ROLES = [
  {
    key: "primaryColor",
    label: "Primary",
    hint: "Buttons, links, focus rings and the browser theme colour.",
    rule: "white",
  },
  {
    key: "accentColor",
    label: "Accent",
    hint: "Highlights, ratings and secondary calls to action.",
    rule: "legible",
  },
  { key: "successColor", label: "Success", hint: "Confirmations and positive states.", rule: "legible" },
  { key: "warningColor", label: "Warning", hint: "Cautions that are not yet errors.", rule: "legible" },
  {
    key: "dangerColor",
    label: "Danger",
    hint: "Errors, cancellations and destructive actions.",
    rule: "legible",
  },
  { key: "canvasColor", label: "Page background", hint: "The ground behind cards.", rule: "surface" },
  {
    key: "surfaceColor",
    label: "Card background",
    hint: "Cards, panels and form controls.",
    rule: "surface",
  },
  {
    key: "footerColor",
    label: "Footer",
    hint: "The deep band at the bottom of public pages.",
    rule: "white",
  },
];

const CHECKS = {
  white: isUsableAsSolid,
  legible: isLegible,
  surface: isUsableAsSurface,
};

function contrastProblem(rule, hex) {
  if (!hex || CHECKS[rule](hex)) return undefined;

  if (rule === "white") {
    return `White text on this is only ${contrastRatio(hex, "#ffffff").toFixed(1)}:1 — it needs ${MIN_TEXT_CONTRAST}:1, so this will be refused.`;
  }
  if (rule === "surface") {
    return `Body text on this is only ${contrastRatio(hex, "#334155").toFixed(1)}:1 — pick a lighter background.`;
  }
  return `No text colour reads on this — it needs ${MIN_TEXT_CONTRAST}:1 against white or ink.`;
}

export function AppearanceSettings({ settings }) {
  const s = useSettingsSection("theme", { ...settings.theme });

  const reset = () => s.setForm({ ...DEFAULT_SETTINGS.theme });
  const isDefault = ROLES.every(
    ({ key }) => normalizeHex(s.form[key]) === normalizeHex(DEFAULT_SETTINGS.theme[key]),
  );

  return (
    <SectionForm onSubmit={s.submit} pending={s.pending} error={s.error} fieldErrors={s.fieldErrors}>
      <Alert tone="info" title="Colours are expanded, not applied literally">
        Each colour becomes a full tonal scale so hovers, tints and dark shades stay in proportion.
        The colour you choose is kept exactly as the solid tone; the rest is derived from it.
      </Alert>

      <Card>
        <CardHeader
          title="Brand colours"
          description="A colour that cannot carry white text is refused — the platform's buttons depend on it."
        />
        <CardBody className="space-y-5">
          {ROLES.map((role) => (
            <ColorField
              key={role.key}
              role={role}
              value={s.form[role.key] ?? ""}
              onChange={s.set(role.key)}
              error={s.errorFor(role.key)}
            />
          ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={reset}
            disabled={isDefault}
            iconLeft={<RotateCcw className="size-4" />}
          >
            Reset to the shipped palette
          </Button>
        </CardBody>
      </Card>

      <ThemePreview theme={s.form} />
    </SectionForm>
  );
}

function ColorField({ role, value, onChange, error }) {
  const hex = normalizeHex(value);
  const problem = contrastProblem(role.rule, hex);

  return (
    <Field
      label={role.label}
      htmlFor={`set-${role.key}`}
      hint={role.hint}
      error={error ?? problem}
    >
      <div className="flex items-center gap-3">
        {/* Two controls, one value: the swatch for picking, the text box for
            pasting a brand hex from a style guide. */}
        <input
          type="color"
          id={`set-${role.key}`}
          value={hex ?? "#000000"}
          onChange={onChange}
          className="size-11 shrink-0 cursor-pointer rounded-xl border border-ink-200 bg-white p-1"
        />
        {/* The same value, typed rather than picked — a brand hex usually
            arrives pasted from a style guide, not chosen from a wheel. */}
        <Input
          id={`${role.key}-value`}
          value={value ?? ""}
          onChange={onChange}
          spellCheck={false}
          maxLength={7}
          className="max-w-36 font-mono uppercase"
          aria-label={`${role.label} hex value`}
          error={Boolean(error || problem)}
        />
        {hex && !problem && (
          <span
            className="rounded-lg px-2.5 py-1 text-xs font-bold"
            style={{ backgroundColor: hex, color: readableTextOn(hex) }}
          >
            Text
          </span>
        )}
      </div>
    </Field>
  );
}

/**
 * A miniature of the real components, rendered with inline colours drawn from
 * the same generated scale the stylesheet will use. Inline styles are correct
 * here and only here: this has to show an unsaved palette, which by definition
 * is not yet in any CSS variable.
 */
function ThemePreview({ theme }) {
  const brand = buildScale(theme.primaryColor, { anchor: 6 });
  const accent = buildScale(theme.accentColor, { anchor: 5 });
  const success = buildScale(theme.successColor, { anchor: 5 });
  const danger = buildScale(theme.dangerColor, { anchor: 5 });
  if (!brand || !accent) return null;

  return (
    <Card>
      <CardHeader title="Preview" description="How the palette reads before you save it." />
      <CardBody>
        <div
          className="space-y-5 rounded-xl border border-ink-200 p-5"
          style={{ backgroundColor: normalizeHex(theme.canvasColor) ?? "#f7f9fc" }}
        >
          <div
            className="space-y-4 rounded-xl border p-4 shadow-xs"
            style={{
              backgroundColor: normalizeHex(theme.surfaceColor) ?? "#ffffff",
              borderColor: "var(--color-ink-200)",
            }}
          >
            <div className="flex flex-wrap items-center gap-2">
              <PreviewButton background={brand[600]} label="Book a lesson" />
              <PreviewButton background={accent[600]} label="Save tutor" />
              <span
                className="rounded-xl px-3.5 py-2 text-sm font-semibold"
                style={{ backgroundColor: brand[50], color: brand[700] }}
              >
                Secondary
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <PreviewBadge background={success?.[100]} color={success?.[700]} label="Confirmed" />
              <PreviewBadge background={accent[100]} color={accent[800]} label="Pending" />
              <PreviewBadge background={danger?.[100]} color={danger?.[700]} label="Cancelled" />
            </div>

            <p className="text-sm text-ink-600">
              A verified tutor for your exact course.{" "}
              <a href="#preview" style={{ color: brand[600], fontWeight: 600 }} onClick={(e) => e.preventDefault()}>
                Compare tutors
              </a>{" "}
              and book in minutes.
            </p>

            <nav aria-label="Preview navigation" className="flex gap-1 border-b border-ink-200 text-sm">
              <span
                className="border-b-2 px-3 pb-2 font-semibold"
                style={{ color: brand[700], borderColor: brand[600] }}
              >
                Active tab
              </span>
              <span className="px-3 pb-2 font-semibold text-ink-500">Another tab</span>
            </nav>
          </div>

          <div
            className="rounded-xl p-4 text-sm"
            style={{ backgroundColor: normalizeHex(theme.footerColor) ?? "#2a1332", color: "#ffffffb3" }}
          >
            Footer band — the one dark surface on public pages.
          </div>

          <Ramp label="Primary" scale={brand} />
          <Ramp label="Accent" scale={accent} />
        </div>
      </CardBody>
    </Card>
  );
}

function PreviewButton({ background, label }) {
  return (
    <span
      className="rounded-xl px-3.5 py-2 text-sm font-semibold"
      style={{ backgroundColor: background, color: readableTextOn(background) }}
    >
      {label}
    </span>
  );
}

function PreviewBadge({ background, color, label }) {
  if (!background) return null;
  return (
    <span className="rounded-full px-2.5 py-1 text-xs font-bold" style={{ backgroundColor: background, color }}>
      {label}
    </span>
  );
}

function Ramp({ label, scale }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-ink-400">{label} scale</p>
      <ul className="mt-2 flex overflow-hidden rounded-lg">
        {Object.entries(scale).map(([step, hex]) => (
          <li key={step} className="h-8 flex-1" style={{ backgroundColor: hex }} title={`${step} · ${hex}`}>
            <span className="sr-only">
              {label} {step}: {hex}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
