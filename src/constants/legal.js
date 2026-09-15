import { SITE, DEFAULT_SETTINGS } from "./config.js";

/**
 * Legal and policy pages (§33, §42).
 *
 * Kept as structured content so each page renders through one component and
 * the cancellation terms stay in step with the platform defaults they describe.
 *
 * The *content* stays here, in version control, deliberately: a Terms of
 * Service that any administrator can rewrite from a web form is not a document
 * anyone can rely on, and changing it needs review, not a save button. What is
 * substituted from platform settings is only the identity the document refers
 * to — the operating name and the address to write to (§26) — so renaming the
 * application does not leave the legal pages naming something that no longer
 * exists.
 */

const LAST_UPDATED = "15 September 2026";

/**
 * Build the policy set for one operator identity.
 *
 * @param {{ appName?: string, supportEmail?: string }} [identity]
 */
export function buildLegalPages(identity = {}) {
  const SITE = {
    ...DEFAULT_IDENTITY,
    name: identity.appName || DEFAULT_IDENTITY.name,
    supportEmail: identity.supportEmail || DEFAULT_IDENTITY.supportEmail,
  };

  return {
    terms: {
      title: "Terms of Service",
      description: `The agreement between you and ${SITE.name} when you use the platform.`,
      lastUpdated: LAST_UPDATED,
      sections: [
        {
          heading: "1. What APlus Learn is",
          body: [
            `${SITE.name} is a marketplace that connects families seeking tutoring with independent tutors. We are not a tutoring company and we do not employ tutors. Tutors set their own rates, choose which courses they teach, and control their own availability.`,
            "Our role is to verify tutors before they appear, host their profiles, process payments, and apply a consistent cancellation policy. The teaching relationship is between the family and the tutor.",
          ],
        },
        {
          heading: "2. Accounts",
          body: [
            "You must be at least 18 to hold an account. Parents and guardians may create learner profiles for children under 18; students aged 18 or over may hold their own account.",
            "You are responsible for keeping your password secure and for activity on your account. Tell us immediately if you believe someone else has accessed it.",
            "You must give accurate information. Misrepresenting qualifications, identity or credentials leads to permanent removal from the platform.",
          ],
        },
        {
          heading: "3. Bookings and payment",
          body: [
            "Booking a lesson creates a contract between you and the tutor for that lesson. Payment is taken at the point of booking and held until the lesson is complete.",
            `${SITE.name} charges tutors a commission on each completed lesson. Families pay the hourly rate shown on the tutor's profile — there are no booking fees or service charges added to your total.`,
            "All prices are in Canadian dollars. Totals and commission are calculated by us, server-side, from the tutor's stored rate.",
          ],
        },
        {
          heading: "4. Cancellations and refunds",
          body: [
            `Our cancellation policy is set out in full on the Cancellation and refunds page and applies to every booking. In summary: free cancellation more than ${DEFAULT_SETTINGS.freeCancellationWindowHours} hours before a lesson, a ${DEFAULT_SETTINGS.lateCancellationRefundPercent}% refund inside that window, and a full refund whenever a tutor cancels or fails to attend.`,
            "If you believe a lesson was not delivered as agreed, you can open a dispute from the lesson page. Our team reviews the evidence and decides on any refund.",
          ],
        },
        {
          heading: "5. Conduct",
          body: [
            "Treat other people on the platform with respect. Harassment, discrimination, threatening behaviour and dishonesty are grounds for immediate removal.",
            "Keep communication and payment on the platform. Arranging lessons or payment off-platform removes the protections described in these terms, and we cannot help with disputes we have no record of.",
            "Do not use the platform to advertise unrelated services, collect personal data, or contact people for purposes other than tutoring.",
          ],
        },
        {
          heading: "6. Tutors as independent contractors",
          body: [
            `Tutors on ${SITE.name} are independent contractors, not employees, agents or partners. They are responsible for their own taxes, insurance and professional obligations.`,
            "Verification badges confirm that we reviewed a specific document at a point in time. They are not a guarantee of teaching quality, a professional endorsement, or a warranty of any kind.",
          ],
        },
        {
          heading: "7. Content you provide",
          body: [
            "You keep ownership of what you write — profiles, messages and reviews. By posting it you grant us a licence to display it on the platform for the purpose of operating the service.",
            "Reviews must describe a lesson that actually took place. We remove reviews that are fabricated, abusive, or not about the tutoring received.",
          ],
        },
        {
          heading: "8. Suspension and termination",
          body: [
            "We may suspend or remove an account that breaches these terms, poses a safety risk, or repeatedly cancels or fails to attend lessons.",
            "You can close your account at any time from Settings. Lesson and payment records are retained in anonymised form where accounting and tax rules require it.",
          ],
        },
        {
          heading: "9. Liability",
          body: [
            `To the extent permitted by law, ${SITE.name}'s liability in connection with the platform is limited to the amounts you paid through it in the twelve months before the claim arose.`,
            "We do not exclude liability for death or personal injury caused by negligence, fraud, or anything else that cannot lawfully be excluded.",
          ],
        },
        {
          heading: "10. Changes and governing law",
          body: [
            "We may update these terms. Material changes will be notified in the platform before they take effect, and continuing to use the service means you accept them.",
            "These terms are governed by the laws of the Province of Ontario and the federal laws of Canada that apply there.",
          ],
        },
      ],
    },

    privacy: {
      title: "Privacy Policy",
      description: "What we collect, why we collect it, and the control you have over it.",
      lastUpdated: LAST_UPDATED,
      sections: [
        {
          heading: "1. What we collect",
          body: [
            "**Account information**: your name, email address, phone number where you provide one, and the city and postal code you give us. Passwords are stored only as a bcrypt hash — we never hold them in a readable form.",
            "**Learner profiles**: a child's first name, last name where you provide it, year of birth, grade, school, and any notes you write about what they need help with. We deliberately ask for a year of birth rather than a full date.",
            "**Tutor information**: qualifications, education history, the courses taught, rates and availability. Verification documents are stored separately and privately.",
            "**Activity**: bookings, messages, reviews, payments and the pages you visit while signed in.",
          ],
        },
        {
          heading: "2. What tutors can see",
          body: [
            "A tutor sees your first name and last initial, the learner's first name and last initial, the grade, the course, and whatever you write in the lesson notes.",
            "Full surnames are hidden by default. You can choose to share a learner's full name from their profile, but nothing on the platform requires it.",
            "For an in-person lesson you booked, the address you provide is released to that tutor once the lesson is confirmed — never before, and never on any public page.",
          ],
        },
        {
          heading: "3. What appears publicly",
          body: [
            "Tutor profiles show a first name and last initial, an approximate location (city and a rough distance), the courses taught, rates, verification badges and reviews.",
            "We never publish exact addresses, full surnames, email addresses, phone numbers or any learner's details on a public page.",
            "Reviews show the reviewer's first name and last initial, never a full name or contact details.",
          ],
        },
        {
          heading: "4. Why we process your information",
          body: [
            "To operate the service you asked for: matching you with tutors, taking bookings, processing payments and applying our policies.",
            "To keep the platform safe: verifying tutors, investigating reports and detecting misuse.",
            "To meet legal obligations: retaining financial records for the period tax law requires.",
            "We do not sell personal information, and we do not share it with advertisers or data brokers.",
          ],
        },
        {
          heading: "5. Verification documents",
          body: [
            "Documents tutors upload for verification are stored privately, outside anything publicly reachable. They can only be opened by our verification team, through an internal route that records who viewed what and when.",
            "They are never shown on a profile, never shared with families, and are deleted when the badge they support expires or is withdrawn.",
          ],
        },
        {
          heading: "6. Who else is involved",
          body: [
            "**Payment processing**: card details go directly to our payment provider and are never stored on our systems. We hold only the card brand and last four digits, so you can recognise a transaction.",
            "**Email delivery**: transactional emails such as booking confirmations are sent through an email provider.",
            "**Video meetings**: online lessons take place on Zoom, Google Meet or Microsoft Teams. Those platforms have their own privacy policies, and we do not record lessons.",
          ],
        },
        {
          heading: "7. Your rights",
          body: [
            "You can access and correct most of your information directly in Settings.",
            "You can delete your account at any time. We remove your personal details and anonymise the account. Lesson and payment records are retained in anonymised form because tax and accounting rules require it.",
            "You can turn off non-essential email from your notification settings. We will still send transactional messages such as booking confirmations.",
            `To ask about anything else, email ${SITE.supportEmail}.`,
          ],
        },
        {
          heading: "8. Children's information",
          body: [
            "Accounts are held by adults. Learner profiles for children under 18 are created and controlled by a parent or guardian, who can edit or remove them at any time.",
            "We collect the minimum a tutor needs to teach effectively: a first name, a grade, the course, and whatever context the parent chooses to share.",
          ],
        },
        {
          heading: "9. Security",
          body: [
            "Passwords are hashed with bcrypt. Sessions are held in signed, httpOnly cookies and can be revoked. Access to personal data inside the platform is restricted by role, and administrative actions are recorded in an audit log.",
            "No system is perfectly secure. If a breach affects you, we will tell you and the relevant authority as the law requires.",
          ],
        },
        {
          heading: "10. Changes",
          body: [
            "We will notify you in the platform before a material change to this policy takes effect. The date at the top of this page shows when it was last revised.",
          ],
        },
      ],
    },

    cookies: {
      title: "Cookie Policy",
      description: "The small number of cookies we use and what each one does.",
      lastUpdated: LAST_UPDATED,
      sections: [
        {
          heading: "What we use",
          body: [
            `${SITE.name} uses a deliberately small number of cookies. We do not use advertising cookies, and we do not allow third parties to track you across other websites.`,
          ],
        },
        {
          heading: "Strictly necessary cookies",
          body: [
            "**Session cookie** — keeps you signed in. It is httpOnly, meaning scripts on the page cannot read it, and it is signed so it cannot be forged. It expires after 14 days or when you sign out.",
            "These cookies are essential. The platform cannot work without them, so they are set whether or not you accept optional cookies.",
          ],
        },
        {
          heading: "What we don't use",
          body: [
            "No advertising or retargeting cookies.",
            "No cross-site tracking pixels.",
            "No third-party analytics that identify you personally.",
          ],
        },
        {
          heading: "Managing cookies",
          body: [
            "You can clear or block cookies in your browser settings. Blocking the session cookie will sign you out and prevent you from signing back in.",
          ],
        },
      ],
    },

    cancellation: {
      title: "Cancellation & Refunds",
      description: "Exactly what happens when a lesson is cancelled, by either side.",
      lastUpdated: LAST_UPDATED,
      sections: [
        {
          heading: "The short version",
          body: [
            `Cancel more than ${DEFAULT_SETTINGS.freeCancellationWindowHours} hours before a lesson and you are refunded in full, automatically.`,
            `Cancel inside ${DEFAULT_SETTINGS.freeCancellationWindowHours} hours and ${DEFAULT_SETTINGS.lateCancellationRefundPercent}% is refunded — the remainder compensates the tutor for time they held for you.`,
            "If a tutor cancels, or does not attend, you are refunded in full regardless of notice.",
          ],
        },
        {
          heading: "When a student cancels",
          body: [
            `**More than ${DEFAULT_SETTINGS.freeCancellationWindowHours} hours before the lesson**: full refund, issued automatically to your original payment method.`,
            `**Inside ${DEFAULT_SETTINGS.freeCancellationWindowHours} hours**: ${DEFAULT_SETTINGS.lateCancellationRefundPercent}% refund. The tutor set that time aside and usually cannot fill it at short notice.`,
            "**After the lesson has started**: no refund, unless the tutor failed to attend or the lesson could not go ahead for a reason within their control.",
            "Cancelling a recurring booking cancels every remaining lesson in that series, and each is refunded according to how far ahead it was.",
          ],
        },
        {
          heading: "When a tutor cancels",
          body: [
            "You are refunded in full, whatever the notice period. This is applied automatically — you do not need to ask.",
            "Repeated cancellations by a tutor are tracked. Tutors who cancel frequently receive a warning and may be removed from search.",
          ],
        },
        {
          heading: "No-shows",
          body: [
            "**The tutor does not attend**: report it from the lesson page once the scheduled end time has passed. You are refunded in full.",
            `**The student does not attend**: the tutor can mark the lesson as a student no-show. ${DEFAULT_SETTINGS.studentNoShowRefundPercent === 0 ? "No refund applies, as the tutor was present and ready to teach." : `${DEFAULT_SETTINGS.studentNoShowRefundPercent}% is refunded.`}`,
            "If you believe a no-show was reported incorrectly, open a dispute and our team will review it.",
          ],
        },
        {
          heading: "Disputes",
          body: [
            "If a lesson was not delivered as agreed, open a dispute from the lesson page within a reasonable period. Describe what happened in as much detail as you can.",
            "Our team reviews the booking record, the messages between you, and both accounts. We then decide on a full refund, a partial refund, or no refund, and explain the reasoning to both parties.",
          ],
        },
        {
          heading: "Repeated cancellations",
          body: [
            `Cancelling ${DEFAULT_SETTINGS.cancellationAbuseThreshold} or more lessons within ${DEFAULT_SETTINGS.cancellationAbuseWindowDays} days triggers a warning. Continued cancellations after that lead to an account review and possible restriction.`,
            "This applies to families and tutors alike. The marketplace only works if people can rely on booked lessons happening.",
          ],
        },
        {
          heading: "How refunds are issued",
          body: [
            "Refunds go back to the original payment method. Depending on your bank, they typically appear within five to ten business days.",
            "Every refund is recorded on the payment's receipt in your Payments page, showing the amount and the reason.",
          ],
        },
      ],
    },

    accessibility: {
      title: "Accessibility",
      description: "Our commitment to an accessible platform, and how to tell us when we fall short.",
      lastUpdated: LAST_UPDATED,
      sections: [
        {
          heading: "Our commitment",
          body: [
            `${SITE.name} aims to meet WCAG 2.1 Level AA. Education should not be harder to access because of how a website is built.`,
            "Accessibility is part of how we build, not something added afterwards. Every component in the platform is built to be usable by keyboard and understandable to a screen reader before it ships.",
          ],
        },
        {
          heading: "What we've built in",
          body: [
            "**Keyboard navigation**: every interactive element is reachable and operable by keyboard, with a visible focus indicator. Dialogs trap focus while open and return it when closed.",
            "**Screen readers**: semantic HTML throughout, with labels, descriptions and error messages properly associated with their controls. Status changes are announced politely.",
            "**Reduced motion**: animation respects your operating system's reduced-motion setting. Nothing essential is conveyed by motion alone.",
            "**Contrast and text**: text meets AA contrast ratios and resizes without breaking layout. Nothing relies on colour alone to convey meaning.",
            "**Responsive layout**: the platform works from small phones to large desktops without horizontal scrolling.",
          ],
        },
        {
          heading: "Accessibility needs in tutoring",
          body: [
            "Every learner profile has a field for accessibility and learning needs. What you write there is shared with tutors you book, so they can adapt their approach before the first lesson.",
            "Many tutors have experience with specific needs — ADHD, dyslexia, anxiety — and describe it in their profiles. Message a tutor before booking if you want to check.",
          ],
        },
        {
          heading: "Telling us about a problem",
          body: [
            `If something on the platform is difficult or impossible to use, email ${SITE.supportEmail} with the page and what went wrong. We treat accessibility reports as bugs, not feature requests.`,
            "We aim to acknowledge within one business day and to tell you what we're doing about it.",
          ],
        },
      ],
    },
  };
}

/** The identity the shipped copy was written against. */
const DEFAULT_IDENTITY = SITE;

/** Bound to the built-in identity — used by the sitemap and route generation. */
export const LEGAL_PAGES = buildLegalPages();

export const LEGAL_SLUGS = Object.keys(LEGAL_PAGES);
