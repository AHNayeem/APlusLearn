import "server-only";
import { SITE } from "@/constants/config";

/**
 * Email abstraction (§38). Without provider credentials the dev transport
 * logs a readable summary, so verification and reset links are always
 * reachable during development without blocking the flow.
 */

export class EmailProvider {
  async send() {
    throw new Error("not implemented");
  }
}

export class ConsoleEmailProvider extends EmailProvider {
  get name() {
    return "CONSOLE";
  }

  async send({ to, subject, text, html }) {
    if (process.env.NODE_ENV !== "test") {
      console.info(
        [
          "",
          "──────────── ✉️  APlus Learn email ────────────",
          `To:      ${to}`,
          `Subject: ${subject}`,
          "",
          text ?? stripTags(html ?? ""),
          "───────────────────────────────────────────────",
          "",
        ].join("\n"),
      );
    }
    return { delivered: true, provider: this.name, messageId: `console-${Date.now()}` };
  }
}

function stripTags(html) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

let cached;

export function getEmailProvider() {
  if (cached) return cached;
  // if (process.env.RESEND_API_KEY) cached = new ResendEmailProvider(...)
  cached = new ConsoleEmailProvider();
  return cached;
}

const baseUrl = () => process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

/** Templates. Kept here so copy and delivery stay in one place. */
export const emailTemplates = {
  verifyEmail: ({ firstName, token }) => ({
    subject: `Confirm your ${SITE.name} account`,
    text: `Hi ${firstName},

Welcome to ${SITE.name}. Confirm your email address to finish setting up your account:

${baseUrl()}/verify-email?token=${token}

This link expires in 24 hours. If you didn't create an account, you can ignore this email.

— The ${SITE.name} team`,
  }),

  resetPassword: ({ firstName, token }) => ({
    subject: `Reset your ${SITE.name} password`,
    text: `Hi ${firstName},

We received a request to reset your password. Choose a new one here:

${baseUrl()}/reset-password?token=${token}

This link expires in one hour. If you didn't request this, nothing has changed and you can ignore this email.

— The ${SITE.name} team`,
  }),

  bookingConfirmed: ({ firstName, booking }) => ({
    subject: `Lesson confirmed — ${booking.courseName} on ${booking.dateLabel}`,
    text: `Hi ${firstName},

Your lesson is confirmed.

Course:   ${booking.courseName}${booking.courseCode ? ` (${booking.courseCode})` : ""}
Tutor:    ${booking.tutorName}
When:     ${booking.dateLabel} at ${booking.timeLabel}
Length:   ${booking.durationLabel}
Type:     ${booking.modeLabel}
Total:    ${booking.totalLabel}
Reference: ${booking.reference}

View the details: ${baseUrl()}/bookings/${booking.id}

— The ${SITE.name} team`,
  }),

  bookingCancelled: ({ firstName, booking, refundLabel }) => ({
    subject: `Lesson cancelled — ${booking.courseName} on ${booking.dateLabel}`,
    text: `Hi ${firstName},

The lesson below has been cancelled.

Course: ${booking.courseName}
When:   ${booking.dateLabel} at ${booking.timeLabel}
Refund: ${refundLabel}

Reference: ${booking.reference}

— The ${SITE.name} team`,
  }),

  applicationSubmitted: ({ firstName }) => ({
    subject: `We've received your ${SITE.name} tutor application`,
    text: `Hi ${firstName},

Thanks for applying to tutor with ${SITE.name}. Our team reviews applications and verification documents within two business days.

You can check your status any time: ${baseUrl()}/tutor/verification

— The ${SITE.name} team`,
  }),

  applicationApproved: ({ firstName }) => ({
    subject: `You're approved to tutor on ${SITE.name}`,
    text: `Hi ${firstName},

Your application has been approved and your profile is now live in search.

Set your availability so parents can book you: ${baseUrl()}/tutor/calendar

— The ${SITE.name} team`,
  }),

  applicationNeedsAttention: ({ firstName, message, approved }) => ({
    subject: approved
      ? `An update on your ${SITE.name} application`
      : `We need a little more for your ${SITE.name} application`,
    text: `Hi ${firstName},

${message}

Continue here: ${baseUrl()}/tutor/onboarding

— The ${SITE.name} team`,
  }),
};
