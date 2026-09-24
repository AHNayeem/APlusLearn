import { z } from "zod";

/** Reusable primitives shared by every domain schema (§37). */

export const objectId = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "That reference is not valid.");

export const optionalObjectId = objectId.optional().or(z.literal("").transform(() => undefined));

export const email = z
  .email("Enter a valid email address.")
  .max(254)
  .transform((v) => v.toLowerCase().trim());

export const password = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "That password is too long.")
  .regex(/[a-z]/, "Include a lowercase letter.")
  .regex(/[A-Z]/, "Include an uppercase letter.")
  .regex(/[0-9]/, "Include a number.");

export const personName = z
  .string()
  .trim()
  .min(1, "This is required.")
  .max(60, "That is too long.")
  .regex(/^[\p{L}\p{M}'\- .]+$/u, "Use letters, spaces, hyphens and apostrophes only.");

/** Canadian phone number, stored digits-only with country code stripped. */
export const phone = z
  .string()
  .trim()
  .regex(/^\+?1?[\s.\-(]*\d{3}[\s.\-)]*\d{3}[\s.\-]*\d{4}$/, "Enter a valid Canadian phone number.")
  .transform((v) => v.replace(/\D/g, "").replace(/^1/, ""));

/** Canadian postal code, normalised to "M1B 2K3". */
export const postalCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ ]?\d[ABCEGHJ-NPRSTV-Z]\d$/, "Enter a valid Canadian postal code.")
  .transform((v) => v.replace(/\s/g, "").replace(/^(.{3})(.{3})$/, "$1 $2"));

export const provinceCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(AB|BC|MB|NB|NL|NS|NT|NU|ON|PE|QC|SK|YT)$/, "Choose a Canadian province or territory.");

export const courseCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}[A-Z0-9]{1,5}$/, "Enter a valid course code, e.g. MHF4U.");

/**
 * A link that will end up in an `href`.
 *
 * Restricted to http(s) deliberately: `z.url()` alone accepts `javascript:`
 * and `data:`, which are valid URLs and also a stored-XSS vector the moment
 * one is rendered as a link. Nothing this application links to needs another
 * scheme (§36).
 */
export const url = z
  .url("Enter a valid link.")
  .max(500)
  .refine((v) => /^https?:\/\//i.test(v), "Links must start with http:// or https://");

/**
 * An optional link. Blank is how a form clears one; it is not an error.
 *
 * Present here rather than restated per schema so every optional link in the
 * product is refused on the same grounds — a `javascript:`, `data:` or
 * `vbscript:` value is a stored-XSS vector wherever it lands in an `href`,
 * and which form it arrived through does not change that (§36).
 */
export const optionalUrl = url.optional().or(z.literal("").transform(() => undefined));

/**
 * A link to an image this application will render.
 *
 * Wider than `url` by exactly one case: a path this application serves itself
 * (`/api/avatars/…`), which is what an uploaded photo looks like. Everything
 * else must be an absolute http(s) URL, so no scheme that executes can reach
 * an `<img src>` or the image optimizer. `//host/path` is protocol-relative
 * rather than local and is judged as a remote URL, which it fails.
 *
 * Whether the host is one `next/image` will actually load is a separate
 * question, answered at render time by `renderableImageSrc` — this is the
 * trust boundary, that one is renderability.
 */
export const mediaUrl = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine(
    (v) => (v.startsWith("/") && !v.startsWith("//")) || /^https?:\/\//i.test(v),
    "Use a full https:// link to the image.",
  );

export const isoDate = z.iso.datetime({ offset: true }).or(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD."),
);

export const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.");

export const timeZone = z.string().max(64).default("America/Toronto");

/** Money always crosses the wire in cents, never as a float. */
export const cents = z.coerce.number().int().min(0).max(100_000_00);

export const rating = z.coerce.number().int().min(1).max(5);

/** Query-string pagination, coerced from strings. */
export const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

/** Turn "a,b,c" into ["a","b","c"] for multi-value query params. */
export const csvArray = (inner) =>
  z
    .string()
    .optional()
    .transform((v) => (v ? v.split(",").map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(inner).optional());

export const boolQuery = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true" || v === "1"));

export const shortText = (max = 200) => z.string().trim().max(max);
export const longText = (max = 2000) => z.string().trim().max(max);
