/**
 * Where a visitor can reach a human, and how each channel is addressed (§26).
 *
 * Shared by the server component that resolves settings and the client widget
 * that renders the buttons, so it holds no `server-only` marker and touches no
 * database — it is string handling and nothing else.
 */

/** Roles land in different workspaces, so "your messages" is not one URL. */
const MESSAGES_PATH_BY_ROLE = {
  PARENT: "/messages",
  STUDENT: "/messages",
  TUTOR: "/tutor/messages",
};

/**
 * `wa.me` accepts digits only, country code included and no leading `+`.
 * Anything an operator typed — spaces, dashes, brackets, a `+` — is stripped
 * here rather than trusted, because the value also arrives from settings that
 * predate the field's validation.
 */
export function whatsappDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/**
 * A WhatsApp deep link, or null when no number is configured.
 *
 * Returning null rather than a broken link is the whole point: the widget
 * renders the button only when this returns something.
 */
export function whatsappLink(number, prefill) {
  const digits = whatsappDigits(number);
  if (digits.length < 8) return null;

  const text = prefill ? `?text=${encodeURIComponent(prefill)}` : "";
  return `https://wa.me/${digits}${text}`;
}

/** The signed-in person's conversation list, or null for a role without one. */
export function messagesPathForRole(role) {
  return MESSAGES_PATH_BY_ROLE[role] ?? null;
}
