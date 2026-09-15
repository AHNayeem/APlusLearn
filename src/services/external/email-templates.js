import { SITE } from "@/constants/config";

/**
 * Transactional email templates (§28, §38).
 *
 * Each template is a pure function of an already-prepared payload: it decides
 * wording and layout, never policy. Refund amounts, cancellation outcomes and
 * names are resolved by the services and arrive here pre-formatted, so a copy
 * change can never move a business rule.
 *
 * Every template returns `{ subject, text, html }`. The text part is not a
 * fallback afterthought — it is what plain-text clients, screen readers in
 * text mode and spam filters read.
 */

const baseUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "");

const BRAND = {
  ink: "#12172b",
  muted: "#5b6478",
  line: "#e3e6ee",
  accent: "#2f5bea",
  canvas: "#f6f7fb",
};

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The one branded shell every email uses.
 *
 * Deliberately old-fashioned HTML: tables, inline styles and no external
 * assets, because that is what renders consistently in Outlook, Gmail and
 * Apple Mail. `preheader` is the grey preview line clients show next to the
 * subject; hiding it visually while leaving it in the DOM is the standard
 * technique and keeps it available to screen readers.
 */
export function layout({ preheader, heading, body = [], details = [], cta, footnote }) {
  const rows = details.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;border:1px solid ${BRAND.line};border-radius:12px;border-collapse:separate;overflow:hidden">
        ${details
          .map(
            ([label, value], index) => `<tr>
              <th align="left" scope="row" style="padding:12px 16px;font:500 13px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.muted};font-weight:500;background:${index % 2 ? "#ffffff" : BRAND.canvas};width:38%">${escapeHtml(label)}</th>
              <td style="padding:12px 16px;font:600 14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.ink};background:${index % 2 ? "#ffffff" : BRAND.canvas}">${escapeHtml(value)}</td>
            </tr>`,
          )
          .join("")}
      </table>`
    : "";

  const button = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td style="border-radius:10px;background:${BRAND.accent}">
        <a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:13px 26px;font:600 15px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#ffffff;text-decoration:none;border-radius:10px">${escapeHtml(cta.label)}</a>
      </td></tr></table>
      <p style="margin:0 0 24px;font:400 13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.muted}">
        If the button doesn't work, copy this link into your browser:<br>
        <a href="${escapeHtml(cta.href)}" style="color:${BRAND.accent};word-break:break-all">${escapeHtml(cta.href)}</a>
      </p>`
    : "";

  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.canvas};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(preheader ?? "")}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.canvas};padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;border:1px solid ${BRAND.line}">
  <tr><td style="padding:28px 28px 0">
    <a href="${baseUrl()}" style="font:700 18px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.ink};text-decoration:none">${escapeHtml(SITE.name)}</a>
  </td></tr>
  <tr><td style="padding:20px 28px 28px">
    <h1 style="margin:0 0 16px;font:700 22px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.ink}">${escapeHtml(heading)}</h1>
    ${body.map((p) => `<p style="margin:0 0 14px;font:400 15px/1.65 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.ink}">${escapeHtml(p)}</p>`).join("")}
    ${rows}
    ${button}
    ${footnote ? `<p style="margin:0;font:400 13px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.muted}">${escapeHtml(footnote)}</p>` : ""}
  </td></tr>
</table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
  <tr><td style="padding:20px 28px;font:400 12px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:${BRAND.muted}" align="center">
    ${escapeHtml(SITE.name)} · ${escapeHtml(SITE.tagline)}<br>
    Questions? <a href="mailto:${escapeHtml(SITE.supportEmail)}" style="color:${BRAND.muted}">${escapeHtml(SITE.supportEmail)}</a>
    · <a href="${baseUrl()}/settings/notifications" style="color:${BRAND.muted}">Email preferences</a>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

/** The plain-text twin of `layout`, built from the same pieces. */
function plain({ heading, body = [], details = [], cta, footnote }) {
  return [
    heading,
    "",
    ...body,
    details.length ? "" : null,
    ...details.map(([label, value]) => `${label}: ${value}`),
    cta ? `\n${cta.label}: ${cta.href}` : null,
    footnote ? `\n${footnote}` : null,
    `\n— The ${SITE.name} team`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/** Build both parts from one description, so they can never drift apart. */
function email(subject, parts) {
  return { subject, text: plain(parts), html: layout(parts) };
}

export const emailTemplates = {
  // --- Authentication ------------------------------------------------------

  verifyEmail: ({ firstName, token }) =>
    email(`Confirm your ${SITE.name} account`, {
      preheader: "One click and your account is ready.",
      heading: `Welcome, ${firstName}`,
      body: [
        `Confirm your email address to finish setting up your ${SITE.name} account.`,
      ],
      cta: { label: "Confirm my email", href: `${baseUrl()}/verify-email?token=${token}` },
      footnote:
        "This link expires in 24 hours and can be used once. If you didn't create an account, you can ignore this email.",
    }),

  resetPassword: ({ firstName, token }) =>
    email(`Reset your ${SITE.name} password`, {
      preheader: "Choose a new password.",
      heading: "Reset your password",
      body: [`Hi ${firstName},`, "We received a request to reset your password. Choose a new one below."],
      cta: { label: "Choose a new password", href: `${baseUrl()}/reset-password?token=${token}` },
      footnote:
        "This link expires in one hour and can be used once. If you didn't request this, nothing has changed and you can safely ignore this email.",
    }),

  /** Security notification — sent after the fact, never carries a token. */
  passwordChanged: ({ firstName, whenLabel }) =>
    email(`Your ${SITE.name} password was changed`, {
      preheader: "A security notification about your account.",
      heading: "Your password was changed",
      body: [
        `Hi ${firstName},`,
        `The password on your ${SITE.name} account was changed${whenLabel ? ` on ${whenLabel}` : ""}. You have been signed out everywhere else.`,
        "If this was you, there is nothing to do.",
      ],
      cta: { label: "Review your account", href: `${baseUrl()}/settings/security` },
      footnote: `If this wasn't you, reset your password immediately and contact ${SITE.supportEmail}.`,
    }),

  // --- Bookings ------------------------------------------------------------

  bookingConfirmed: ({ firstName, booking }) =>
    email(`Lesson confirmed — ${booking.courseName} on ${booking.dateLabel}`, {
      preheader: `${booking.dateLabel} at ${booking.timeLabel}`,
      heading: "Your lesson is confirmed",
      body: [`Hi ${firstName},`, "Everything is booked. Here are the details."],
      details: [
        ["Course", `${booking.courseName}${booking.courseCode ? ` (${booking.courseCode})` : ""}`],
        ["With", booking.tutorName],
        ["When", `${booking.dateLabel} at ${booking.timeLabel}`],
        ["Length", booking.durationLabel],
        ["Type", booking.modeLabel],
        ["Total", booking.totalLabel],
        ["Reference", booking.reference],
      ],
      cta: { label: "View the lesson", href: `${baseUrl()}/bookings/${booking.id}` },
      footnote: booking.joinNote ?? "You'll find the joining details on the lesson page.",
    }),

  bookingCancelled: ({ firstName, booking, refundLabel }) =>
    email(`Lesson cancelled — ${booking.courseName} on ${booking.dateLabel}`, {
      preheader: refundLabel ? `Refund: ${refundLabel}` : "This lesson is no longer scheduled.",
      heading: "Your lesson was cancelled",
      body: [`Hi ${firstName},`, "The lesson below has been cancelled."],
      details: [
        ["Course", booking.courseName],
        ["When", `${booking.dateLabel} at ${booking.timeLabel}`],
        ["Refund", refundLabel ?? "None"],
        ["Reference", booking.reference],
      ],
      cta: { label: "Find another time", href: `${baseUrl()}/bookings` },
      footnote: "Refunds are returned to the original payment method and usually arrive within 5–10 business days.",
    }),

  bookingRescheduled: ({ firstName, booking, previousLabel, reason }) =>
    email(`Lesson moved — ${booking.courseName} is now ${booking.dateLabel}`, {
      preheader: `New time: ${booking.dateLabel} at ${booking.timeLabel}`,
      heading: "Your lesson has moved",
      body: [
        `Hi ${firstName},`,
        reason ? `The lesson below was rescheduled. Reason given: ${reason}` : "The lesson below was rescheduled.",
      ],
      details: [
        ["Course", booking.courseName],
        ["Was", previousLabel],
        ["Now", `${booking.dateLabel} at ${booking.timeLabel}`],
        ["Length", booking.durationLabel],
        ["Reference", booking.reference],
      ],
      cta: { label: "View the lesson", href: `${baseUrl()}/bookings/${booking.id}` },
    }),

  refundIssued: ({ firstName, amountLabel, reason, reference }) =>
    email(`${amountLabel} refunded`, {
      preheader: "Your refund is on its way.",
      heading: "A refund has been issued",
      body: [`Hi ${firstName},`, `We've refunded ${amountLabel} to your original payment method.`],
      details: [
        ["Amount", amountLabel],
        ["Reason", reason ?? "Cancellation"],
        ["Reference", reference],
      ],
      cta: { label: "View your payments", href: `${baseUrl()}/payments` },
      footnote: "Refunds usually arrive within 5–10 business days, depending on your bank.",
    }),

  // --- Tutor lifecycle -----------------------------------------------------

  applicationSubmitted: ({ firstName }) =>
    email(`We've received your ${SITE.name} tutor application`, {
      preheader: "We review applications within two business days.",
      heading: "Application received",
      body: [
        `Hi ${firstName},`,
        `Thanks for applying to tutor with ${SITE.name}. Our team reviews applications and verification documents within two business days.`,
      ],
      cta: { label: "Check your status", href: `${baseUrl()}/tutor/verification` },
    }),

  applicationApproved: ({ firstName }) =>
    email(`You're approved to tutor on ${SITE.name}`, {
      preheader: "Your profile is live in search.",
      heading: "You're approved",
      body: [
        `Hi ${firstName},`,
        "Your application has been approved and your profile is now live in search.",
        "Set your availability so parents can start booking you.",
      ],
      cta: { label: "Set your availability", href: `${baseUrl()}/tutor/calendar` },
    }),

  applicationNeedsAttention: ({ firstName, message, approved }) =>
    email(
      approved
        ? `An update on your ${SITE.name} application`
        : `We need a little more for your ${SITE.name} application`,
      {
        preheader: approved ? "An update on your application." : "One more thing before we can approve you.",
        heading: approved ? "An update on your application" : "We need a little more information",
        body: [`Hi ${firstName},`, message],
        cta: { label: "Continue your application", href: `${baseUrl()}/tutor/onboarding` },
      },
    ),

  // --- Payouts -------------------------------------------------------------

  payoutOnboardingRequired: ({ firstName, requirements = [] }) =>
    email(`Finish your ${SITE.name} payout setup`, {
      preheader: "A few details are needed before we can pay you.",
      heading: "Finish your payout setup",
      body: [
        `Hi ${firstName},`,
        requirements.length
          ? "Our payments partner still needs a few details before your earnings can be paid out."
          : "Your payout setup is not finished yet, so your earnings are being held.",
      ],
      details: requirements.length ? [["Still needed", requirements.join(", ")]] : [],
      cta: { label: "Finish payout setup", href: `${baseUrl()}/tutor/payouts` },
      footnote: "Your earnings are safe in the meantime — they're paid out as soon as setup is complete.",
    }),

  payoutsEnabled: ({ firstName }) =>
    email(`Payouts are enabled on your ${SITE.name} account`, {
      preheader: "You're all set to be paid.",
      heading: "Payouts are enabled",
      body: [
        `Hi ${firstName},`,
        "Your payout account is verified. Earnings are paid out automatically once each lesson clears its hold period.",
      ],
      cta: { label: "View your earnings", href: `${baseUrl()}/tutor/payouts` },
    }),

  payoutSent: ({ firstName, amountLabel, lessonCountLabel, reference }) =>
    email(`${amountLabel} is on its way`, {
      preheader: "Your payout has been sent.",
      heading: "Your payout is on its way",
      body: [`Hi ${firstName},`, `We've sent ${amountLabel} to your payout account.`],
      details: [
        ["Amount", amountLabel],
        ["Covering", lessonCountLabel],
        ["Reference", reference],
      ],
      cta: { label: "View your earnings", href: `${baseUrl()}/tutor/payouts` },
      footnote: "Bank transfers usually settle within 2–3 business days.",
    }),
};
