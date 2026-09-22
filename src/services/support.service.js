import "server-only";
import { SITE, SUPPORT_TOPIC_LABELS, SUPPORT_TOPICS } from "@/constants";
import { AppError, ValidationError } from "@/lib/api/errors";
import { getAppConfig } from "./settings.service";
import { brandedEmailTemplates, sendEmail } from "./external/email-provider";

/**
 * Enquiries from the floating support launcher (§35, §36).
 *
 * The launcher is the only unauthenticated write path into the platform that
 * a stranger can reach from any page, so three decisions are made here rather
 * than at the route:
 *
 * 1. **A signed-in enquiry takes its identity from the session.** The payload's
 *    `name` and `email` are read only when nobody is signed in — the client
 *    supplies intent, never state, and an authenticated message arriving under
 *    somebody else's address would be worse than useless to whoever answers it.
 *
 * 2. **Nothing is sent to the address in the form.** Only the support inbox is
 *    written to, with the enquirer's address in `Reply-To`. An endpoint that
 *    mailed an acknowledgement to whatever address a stranger typed would be a
 *    small open relay, and a rate limit alone does not fix that.
 *
 * 3. **A failure to deliver is reported, not swallowed.** Everywhere else in
 *    the platform email is a notification about something already recorded, so
 *    a bounce is a nuisance. Here the email *is* the record: if it does not
 *    leave, the message is gone, and the person is told to write to the
 *    support address directly instead of being thanked for nothing.
 */
export async function submitSupportEnquiry(input, { user = null } = {}) {
  /**
   * A bot filled the hidden field. Answer exactly as the real path does —
   * same shape, same delay profile — and drop the message on the floor.
   */
  if (input.website) return { received: true };

  const name = user ? `${user.firstName} ${user.lastName}`.trim() : input.name;
  const fromEmail = user ? user.email : input.email;

  if (!name || !fromEmail) {
    throw new ValidationError({
      fieldErrors: {
        ...(name ? {} : { name: ["Tell us who you are."] }),
        ...(fromEmail ? {} : { email: ["We need an address to reply to."] }),
      },
    });
  }

  const { contact } = await getAppConfig();
  const inbox = contact.supportEmail || SITE.supportEmail;

  const templates = await brandedEmailTemplates();
  const message = templates.supportEnquiry({
    name,
    fromEmail,
    topicLabel: SUPPORT_TOPIC_LABELS[input.topic] ?? SUPPORT_TOPIC_LABELS[SUPPORT_TOPICS.OTHER],
    accountLabel: user ? `Signed in — ${user.role.toLowerCase()} (${user.id})` : "Not signed in",
    pageLabel: input.path ?? "Not recorded",
    message: input.message,
  });

  let result;
  try {
    /**
     * Sent with no `category`, deliberately. The notification switches exist so
     * an operator can stop the platform *talking to members*; an enquiry a
     * member of the public just wrote is the opposite direction, and silently
     * discarding it because "announcement emails" are off would lose somebody's
     * safety report. The email module's own switch still applies — that one is
     * the transport, and a dead transport is reported below.
     */
    result = await sendEmail({ to: inbox, replyTo: fromEmail, ...message }, { critical: true });
  } catch {
    throw undeliverable(inbox);
  }

  if (!result?.delivered) throw undeliverable(inbox);

  return { received: true };
}

/**
 * 503 rather than 500: the request was valid and the platform is at fault, and
 * the message names the way around it. The address is already public — it is
 * on the support page and in the footer of every email — so repeating it here
 * discloses nothing.
 */
function undeliverable(inbox) {
  return new AppError(
    `We couldn't send your message just now. Please email ${inbox} directly and we'll pick it up from there.`,
    { status: 503, code: "SUPPORT_DELIVERY_FAILED" },
  );
}
