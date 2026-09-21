import { z } from "zod";
import { MEETING_PROVIDERS } from "@/constants";

/**
 * Configuring the joining details on a booked lesson (§27).
 *
 * The shape is a discriminated action rather than a patch, because the five
 * things an operator does to a room want different fields and different
 * requirements: pasting in a link needs a URL, withdrawing one needs nothing
 * at all, and a partial-update schema that accepted both would also accept a
 * "manual" configuration with no URL in it.
 */

/**
 * A join link.
 *
 * `https` only, and hostname-bearing. A meeting link is a URL this application
 * will put behind a button a family clicks, so `javascript:` and `data:` are
 * refused here rather than relied on the renderer to neutralise, and plain
 * `http` is refused because a room reached over cleartext is a room whose
 * passcode travels in the open. `z.url()` on its own accepts all three.
 */
const joinUrl = z
  .string()
  .trim()
  .min(1, "Enter the link people will use to join.")
  .max(2000, "That link is too long.")
  .refine((value) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    return parsed.protocol === "https:" && Boolean(parsed.hostname);
  }, "Enter a full https:// link, for example https://zoom.us/j/1234567890.");

/**
 * Meeting ID and passcode as the platforms actually write them.
 *
 * Deliberately permissive about *format* — Zoom writes an 11-digit number,
 * Teams writes a long opaque string, and a passcode may be letters, digits or
 * both, so a regex modelled on today's Zoom would reject tomorrow's Teams —
 * and strict about the two things that matter: nothing invisible smuggled into
 * a credential, and a bound on length.
 *
 * "Invisible" has to mean more than `\s` and the C0 controls, which is all the
 * first version of this caught. A credential is copied off the screen and
 * typed into somebody else's app, so the characters that do damage are exactly
 * the ones a human cannot see they are copying:
 *
 *   - `\p{Cf}` — the format characters. A zero-width space or word joiner
 *     makes a passcode that looks right, reads right and is simply wrong when
 *     it is typed back in; a right-to-left override (U+202E) reorders what the
 *     badge renders, so the passcode shown is not the passcode stored.
 *   - `\p{Zs}\p{Zl}\p{Zp}` — every space separator, not only the ASCII ones
 *     `\s` covers. A non-breaking or ideographic space is a space.
 *   - `\p{Cs}` — a lone surrogate, which is not a character at all and
 *     survives into storage as replacement bytes.
 *
 * Verified against the live endpoint: U+200B, U+202E, U+200E, U+00AD and
 * U+2060 were all accepted into a stored passcode before this.
 */
const INVISIBLE = /[\s\p{Cc}\p{Cf}\p{Zs}\p{Zl}\p{Zp}\p{Cs}]/u;

const credential = (label) =>
  z
    .string()
    .trim()
    .max(120, `That ${label} is too long.`)
    .refine(
      (v) => !INVISIBLE.test(v),
      `A ${label} cannot contain spaces, line breaks or invisible characters.`,
    );

const instructions = z
  .string()
  .trim()
  .max(500, "Keep the joining notes under 500 characters.");

/**
 * `null` is meaningful and distinct from omission, exactly as it is for a
 * stored integration secret: omitting a passcode keeps the one on record,
 * sending `null` clears it. Without the distinction a form that submitted every
 * field would wipe a credential nobody meant to touch.
 */
const clearable = (schema) => schema.nullable().optional();

export const configureMeetingSchema = z.discriminatedUnion("action", [
  /** Ask the provider for a room again, after an outage. */
  z.object({ action: z.literal("retry") }),

  /** Store a room the tutor or operator already owns. */
  z.object({
    action: z.literal("manual"),
    provider: z.enum(Object.values(MEETING_PROVIDERS), {
      error: "Choose which platform this link is for.",
    }),
    joinUrl,
    meetingId: clearable(credential("meeting ID")),
    passcode: clearable(credential("passcode")),
    instructions: clearable(instructions),
  }),

  /** Withdraw the link from the people attending, reversibly. */
  z.object({ action: z.literal("disable") }),

  /** Hand it back. */
  z.object({ action: z.literal("enable") }),

  /** Remove it entirely; a room this platform owns is torn down first. */
  z.object({ action: z.literal("clear") }),
]);
