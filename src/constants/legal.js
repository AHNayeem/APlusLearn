import {
  SITE, DEFAULT_SETTINGS, SESSION, PASSWORD_RESET, LOGIN_VERIFICATION, AGE_RULES,
} from "./config.js";

/**
 * Legal and policy pages (§33, §42).
 *
 * Kept as structured content so each page renders through one component.
 *
 * The *wording* stays here, in version control, deliberately: a Terms of
 * Service that any administrator can rewrite from a web form is not a document
 * anyone can rely on, and changing it needs review, not a save button. What is
 * substituted at render time is everything the wording *refers to*:
 *
 *   - the operator's identity — application name, registered name, address,
 *     contact addresses (§26);
 *   - every policy number — commission, cancellation window, refund
 *     percentages, payout hold, cancellation-abuse threshold, review times —
 *     read from the same Settings document the booking engine applies
 *     (`getAppConfig().policy`). A literal here would be a second copy of a
 *     setting, and the first time an operator changed the setting the policy
 *     page would describe a rule the platform no longer enforces.
 *
 * `DEFAULT_SETTINGS` is used only for the build-time `LEGAL_PAGES` export,
 * which the sitemap and route generation read for the slugs — never for a
 * page a visitor is shown.
 */

const LAST_UPDATED = "1 October 2026";

/** "1 hour", "36 hours". */
function hours(n) {
  return `${n} ${Number(n) === 1 ? "hour" : "hours"}`;
}

function days(n) {
  return `${n} ${Number(n) === 1 ? "day" : "days"}`;
}

function businessDays(n) {
  return `${n} business ${Number(n) === 1 ? "day" : "days"}`;
}

/** "a full refund" / "a 50% refund" / "no refund". */
function refundPhrase(percent) {
  if (percent >= 100) return "a full refund";
  if (percent <= 0) return "no refund";
  return `a ${percent}% refund`;
}

/**
 * Every cookie the platform sets, and every key it writes to browser storage.
 *
 * The names are the ones in `lib/auth/session.js` and the components that use
 * storage; lifetimes come from the same constants those modules use. The
 * integration suite reads those source files and fails if one of them sets a
 * name this list does not describe — a cookie policy that omits a cookie is
 * the defect this list exists to prevent (§33).
 */
export function cookieInventory() {
  const sessionDays = Math.round(SESSION.maxAgeSeconds / 86_400);
  const transientHours = Math.round(SESSION.transientMaxAgeSeconds / 3_600);

  return {
    cookies: [
      {
        name: SESSION.cookieName,
        purpose: "Keeps you signed in.",
        lifetime: `${days(sessionDays)} when you choose “Keep me signed in”; otherwise it is removed when you close the browser, and the session inside it expires after ${hours(transientHours)} regardless. Deleted when you sign out.`,
      },
      {
        name: "aplus_device",
        purpose:
          "Recognises a browser you have already confirmed with an emailed code, so a correct password from it does not ask for a code again. It holds a random value; we store only a hash of it.",
        lifetime: `${days(LOGIN_VERIFICATION.trustedDeviceDays)}. It stays after you sign out, which is what lets the next sign-in skip the code. Changing your password or signing out everywhere ends its trust immediately.`,
      },
      {
        name: "aplus_login_challenge",
        purpose:
          "Holds the step between a correct password and the emailed sign-in code on a browser we don't recognise yet.",
        lifetime: `Up to ${LOGIN_VERIFICATION.challengeTtlMinutes} minutes, and deleted as soon as the code is accepted.`,
      },
      {
        name: "aplus_password_reset",
        purpose: "Holds your place in the forgot-password flow between the emailed code and choosing a new password.",
        lifetime: `Up to ${PASSWORD_RESET.requestTtlMinutes} minutes, and deleted when the password is changed.`,
      },
      {
        name: "aplus_oauth_tx",
        purpose:
          "Set only when you sign in with Google or Apple. It protects that round trip against forgery and is sent only to our sign-in endpoints.",
        lifetime: "Deleted when the sign-in finishes; it expires on its own within minutes if it doesn't.",
      },
    ],
    storage: [
      {
        name: "aplus:settings-view",
        where: "Local storage",
        purpose: "Remembers whether you prefer the grid or list layout in your account settings.",
      },
      {
        name: "aplus:install-prompt-dismissed",
        where: "Local storage",
        purpose: "Remembers when you chose “Not now” on the install-the-app prompt, so it doesn't reappear straight away.",
      },
      {
        name: "aplus:install-prompt-accepted",
        where: "Session storage",
        purpose: "Remembers, for this browser tab only, that you installed the app, so you aren't asked again.",
      },
      {
        name: "aplus-static-*, aplus-shell-*",
        where: "Cache storage (service worker)",
        purpose:
          "Copies of the site's own scripts, styles, icons and the offline page, so the site loads quickly and can tell you when you're offline. Pages with your account, bookings, messages or payments are never stored here.",
      },
    ],
  };
}

/**
 * Build the policy set for one operator and one set of policy numbers.
 *
 * @param {object} [input]
 * @param {string} [input.appName]
 * @param {string} [input.supportEmail]
 * @param {object} [input.contact]  The `contact` settings group (legal name, address).
 * @param {object} [input.policy]   `getAppConfig().policy` — the live numbers.
 */
/** Canada's provinces and territories, for naming the operator's jurisdiction. */
const JURISDICTIONS = {
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick",
  NL: "Newfoundland and Labrador", NS: "Nova Scotia", NT: "the Northwest Territories",
  NU: "Nunavut", ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec",
  SK: "Saskatchewan", YT: "Yukon",
};

export function buildLegalPages(input = {}) {
  const appName = input.appName || SITE.name;
  const contact = input.contact ?? {};
  const supportEmail = input.supportEmail || contact.supportEmail || SITE.supportEmail;
  const operator = contact.legalName?.trim() || appName;
  const address = [contact.addressLine, contact.city, contact.province, contact.postalCode]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(", ");

  // The law is the operator's: the province (or territory) they gave as
  // their address in settings — never a literal (§33).
  const region = String(contact.province ?? "").trim();
  const regionName = JURISDICTIONS[region.toUpperCase()] ?? region;
  const governingLaw = regionName
    ? `the laws of ${/^the /.test(regionName) || ["Nunavut", "Yukon"].includes(regionName) ? regionName : `the Province of ${regionName}`} and the federal laws of Canada that apply there`
    : "the laws of the Canadian province or territory in which the operator is established, and the federal laws of Canada that apply there";

  const p = { ...DEFAULT_SETTINGS, ...(input.policy ?? {}) };
  const retentionDays = p.verificationDocumentRetentionDays;
  const H = p.freeCancellationWindowHours;
  const late = p.lateCancellationRefundPercent;
  const studentNoShow = p.studentNoShowRefundPercent;
  const tutorNoShow = p.tutorNoShowRefundPercent;
  const commission = p.commissionPercent;

  /** The free-cancellation rule, worded for a window of any size (including none). */
  const freeRule =
    H > 0
      ? `free cancellation up to ${hours(H)} before a lesson starts`
      : "free cancellation at any time before a lesson starts";
  const lateRule =
    H > 0 ? `${refundPhrase(late)} if you cancel inside those ${hours(H)}` : null;

  const { cookies, storage } = cookieInventory();

  return {
    terms: {
      title: "Terms of Service",
      description: `The agreement between you and ${operator} when you use ${appName}.`,
      lastUpdated: LAST_UPDATED,
      sections: [
        {
          heading: `1. Who we are and what ${appName} is`,
          body: [
            `${appName} is operated by ${operator}${address ? `, ${address}` : ""}. You can reach us at ${supportEmail}.`,
            `${appName} is a marketplace that connects families seeking tutoring with independent tutors. We are not a tutoring company and we do not employ tutors. Tutors set their own rates, choose which courses they teach, and control their own availability.`,
            "Our role is to review tutors before they appear, host their profiles, process payments, and apply one cancellation policy to every booking. The teaching relationship is between the family and the tutor.",
          ],
        },
        {
          heading: "2. Accounts",
          body: [
            `Parent, guardian and tutor accounts are for adults aged ${AGE_RULES.adultAge} or over. Students aged ${AGE_RULES.minimumStudentAge} or over may hold their own student account; younger learners are added to a parent or guardian's account, which controls their profile.`,
            "You are responsible for keeping your password secure and for activity on your account. Tell us immediately if you believe someone else has accessed it.",
            "You must give accurate information. Misrepresenting qualifications, identity or credentials leads to permanent removal from the platform.",
          ],
        },
        {
          heading: "3. Bookings and payment",
          body: [
            "Booking a lesson creates an agreement between you and the tutor for that lesson. Payment is taken when you book and held until the lesson is complete.",
            `${appName} charges tutors a commission of ${commission}% on each paid lesson. Families pay the hourly rate shown on the tutor's profile — there are no booking fees or service charges added to your total.`,
            "All prices are in Canadian dollars. Totals and commission are calculated by us, server-side, from the tutor's stored rate.",
          ],
        },
        {
          heading: "4. Cancellations and refunds",
          body: [
            `Our [cancellation policy](/legal/cancellation) applies to every booking. In summary: ${freeRule}${lateRule ? `, ${lateRule}` : ""}, a full refund whenever a tutor cancels, and ${refundPhrase(tutorNoShow)} if a tutor fails to attend.`,
            "If you believe a lesson was not delivered as agreed, you can open a dispute from the lesson page. Our team reviews the evidence and decides on any refund.",
          ],
        },
        {
          heading: "5. Conduct",
          body: [
            `Everyone on ${appName} agrees to our [community standards](/legal/community-standards). Harassment, discrimination, threatening behaviour and dishonesty are grounds for immediate removal.`,
            "Keep communication and payment on the platform. Arranging lessons or payment off-platform removes the protections described in these terms, and we cannot help with disputes we have no record of.",
            "Do not use the platform to advertise unrelated services, collect personal data, or contact people for purposes other than tutoring.",
          ],
        },
        {
          heading: "6. Tutors as independent contractors",
          body: [
            `Tutors on ${appName} are independent contractors, not employees, agents or partners. They are responsible for their own taxes, insurance and professional obligations. The [tutor agreement](/legal/tutor-agreement) sets out the terms that apply to tutors in full.`,
            "Verification badges confirm that our team reviewed a specific document at a point in time. They are not a guarantee of teaching quality or of anyone's safety, a professional endorsement, or a warranty of any kind.",
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
            "You can close your account at any time from Settings, once any upcoming lessons are cancelled. Lesson and payment records are kept in anonymised form where accounting and tax rules require it.",
          ],
        },
        {
          heading: "9. Liability",
          body: [
            `To the extent permitted by law, ${operator}'s liability in connection with the platform is limited to the amounts you paid through it in the twelve months before the claim arose.`,
            "We do not exclude liability for death or personal injury caused by negligence, fraud, or anything else that cannot lawfully be excluded.",
          ],
        },
        {
          heading: "10. Changes and governing law",
          body: [
            "We may update these terms. We will tell you about a material change before it takes effect, and continuing to use the service afterwards means you accept it. The date at the top of this page shows when it was last revised.",
            `These terms are governed by ${governingLaw}.`,
          ],
        },
      ],
    },

    privacy: {
      title: "Privacy Policy",
      description: "What we collect, why we collect it, how long we keep it, and the control you have over it.",
      lastUpdated: LAST_UPDATED,
      sections: [
        {
          heading: "1. Who is responsible",
          body: [
            `${operator} is responsible for the personal information collected through ${appName}${address ? ` and can be written to at ${address}` : ""}.`,
            `We handle personal information under Canada's Personal Information Protection and Electronic Documents Act (PIPEDA) and, where they apply, provincial private-sector privacy laws such as Quebec's Act respecting the protection of personal information in the private sector (Law 25).`,
            `Questions, access requests and complaints about privacy go to our privacy contact at ${supportEmail}. Put “Privacy” in the subject line so it reaches the right person.`,
          ],
        },
        {
          heading: "2. What we collect",
          body: [
            "**Account information**: your name, email address, phone number, province, city and postal code. Passwords are stored only as a bcrypt hash — we never hold them in a readable form.",
            "**Learner profiles**: a child's first name, last name where you provide it, year of birth, grade, school, and any notes you write about what they need help with. We deliberately ask for a year of birth rather than a full date.",
            "**Tutor information**: qualifications, education history, the courses taught, rates and availability. Verification documents are stored separately and privately (see section 6).",
            "**Activity**: bookings, messages, reviews, payments, disputes and the messages you send our support team.",
            "**Security records**: when you last signed in, the browsers you have confirmed, and the network address and browser type recorded with sign-ins and administrative actions. These exist to protect your account and to investigate misuse.",
          ],
        },
        {
          heading: "3. What tutors can see",
          body: [
            "A tutor sees your first name and last initial, the learner's first name and last initial, the grade, the course, and whatever you write in the lesson notes.",
            "Learner surnames are hidden from tutors by default. You can choose to share a learner's full name from their profile, but nothing on the platform requires it.",
            "For an in-person lesson you booked, the address you provide is released to that tutor once the lesson is confirmed — never before, and never on any public page.",
          ],
        },
        {
          heading: "4. What appears publicly",
          body: [
            "Tutor profiles show a first name and last initial, an approximate location (city and a rough distance), the courses taught, rates, verification badges and reviews.",
            "We never publish exact addresses, full surnames, email addresses, phone numbers or any learner's details on a public page.",
            "Reviews show the reviewer's first name and last initial, never a full name or contact details.",
          ],
        },
        {
          heading: "5. Why we process your information",
          body: [
            "To operate the service you asked for: matching you with tutors, taking bookings, processing payments and applying our policies.",
            "To keep the platform safe: verifying tutors, investigating reports, answering support requests and detecting misuse.",
            "To meet legal obligations: retaining financial records for the period tax law requires.",
            "We do not sell personal information, and we do not share it with advertisers or data brokers.",
          ],
        },
        {
          heading: "6. Verification documents",
          body: [
            "Documents tutors upload for verification are stored privately, outside anything publicly reachable. They can only be opened by our verification team, through an internal route that records who viewed what and when.",
            `They are never shown on a profile and never shared with families. The file behind a badge that was declined or has expired is deleted from storage ${retentionDays ? `${retentionDays} days` : "a set period"} after that decision, and every document is deleted when the tutor's account is deleted. What remains is the record of the decision — the badge type, the outcome and its dates — not the document.`,
          ],
        },
        {
          heading: "7. How long we keep information",
          body: [
            "**Your account** is kept while it is open. When you delete it, your name, email address, phone number, photo, address details and sign-in methods are removed straight away and the account is anonymised.",
            "**Lesson and payment records** are kept in anonymised form for as long as Canadian tax and accounting rules require, generally six years.",
            "**Messages** stay in the other participant's conversation history after you delete your account, shown under an anonymised name, so that a report or dispute can still be investigated.",
            "**Learner profiles** are archived when the account that owns them is deleted and are no longer shown to anyone.",
            "**Verification documents** are deleted as described in section 6.",
            "**Support requests** are kept with the history of how they were handled, so a complaint can be followed up.",
            `**Security records** expire on their own: sign-in and password-reset codes after ${PASSWORD_RESET.codeTtlMinutes} minutes, a confirmed browser after ${days(LOGIN_VERIFICATION.trustedDeviceDays)}. Records of administrative actions are kept as an audit trail.`,
          ],
        },
        {
          heading: "8. Who else is involved",
          body: [
            "**Payment processing**: card details go to our payment provider and are not stored on our systems. We hold only the card brand and last four digits, so you can recognise a transaction.",
            "**Email delivery**: messages such as booking confirmations and sign-in codes are sent through an email provider.",
            "**Video meetings**: online lessons take place on Zoom, Google Meet or Microsoft Teams. Those platforms have their own privacy policies, and we do not record lessons.",
            "These providers may process information outside your province or outside Canada. They act on our instructions and only for the purpose of providing their service to us.",
          ],
        },
        {
          heading: "9. Your rights",
          body: [
            "You can see and correct most of your information directly in Settings, and you can ask us for a copy of the personal information we hold about you.",
            "You can delete your account at any time from Settings, as described in section 7.",
            "You can turn off non-essential email from your notification settings. We will still send transactional messages such as booking confirmations and sign-in codes.",
            `To make a request or a complaint, email ${supportEmail}. If you are not satisfied with our answer, you can complain to the Office of the Privacy Commissioner of Canada, or in Quebec to the Commission d'accès à l'information.`,
          ],
        },
        {
          heading: "10. Children's information",
          body: [
            `Learner profiles for children are created and controlled by a parent or guardian, who can edit or remove them at any time. Students aged ${AGE_RULES.minimumStudentAge} or over may hold their own account.`,
            "We collect the minimum a tutor needs to teach effectively: a first name, a grade, the course, and whatever context the parent chooses to share.",
          ],
        },
        {
          heading: "11. Security",
          body: [
            "Passwords are hashed with bcrypt. Sessions are held in signed, httpOnly cookies and can be revoked. A correct password from a browser we don't recognise also needs a code sent to your email. Access to personal data inside the platform is restricted by role, and administrative actions are recorded in an audit log.",
            "No system is perfectly secure. If a breach creates a real risk of significant harm to you, we will tell you and report it to the Privacy Commissioner as the law requires.",
          ],
        },
        {
          heading: "12. Cookies",
          body: [
            "The cookies and browser storage we use are listed one by one in our [cookie policy](/legal/cookies).",
          ],
        },
        {
          heading: "13. Changes",
          body: [
            "We will tell you about a material change to this policy before it takes effect. The date at the top of this page shows when it was last revised.",
          ],
        },
      ],
    },

    cookies: {
      title: "Cookie Policy",
      description: "Every cookie and browser-storage item we use, what each one does, and how long it lasts.",
      lastUpdated: LAST_UPDATED,
      sections: [
        {
          heading: "What we use",
          body: [
            `${appName} uses only the cookies and browser storage it needs to work. We do not use advertising cookies, we do not use third-party analytics, and we do not allow third parties to track you across other websites. Because every item below is needed for the feature it supports, there is no optional category to accept or decline.`,
          ],
        },
        {
          heading: "Cookies",
          body: [
            "All of these are first-party, httpOnly cookies — scripts on the page cannot read them — and none of them is used for tracking.",
            ...cookies.map((c) => `**${c.name}** — ${c.purpose} Lasts: ${c.lifetime}`),
          ],
        },
        {
          heading: "Browser storage",
          body: [
            "A few preferences are kept in your browser rather than in a cookie. They never leave your device and are not sent to us.",
            ...storage.map((s) => `**${s.name}** (${s.where}) — ${s.purpose}`),
          ],
        },
        {
          heading: "Other sites",
          body: [
            "If you pay on our payment provider's own checkout page, or join a lesson on Zoom, Google Meet or Microsoft Teams, those services may set cookies on their own sites under their own policies. We do not receive or control them.",
          ],
        },
        {
          heading: "Managing cookies",
          body: [
            "You can clear or block cookies and site data in your browser settings. Blocking the session cookie will sign you out and prevent you from signing back in; clearing the device cookie means the next sign-in from that browser asks for an emailed code again.",
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
            H > 0
              ? `Cancel more than ${hours(H)} before a lesson and you are refunded in full, automatically.`
              : "Cancel at any time before a lesson starts and you are refunded in full, automatically.",
            ...(H > 0
              ? [
                  late >= 100
                    ? `Cancel inside ${hours(H)} and you are still refunded in full.`
                    : late > 0
                      ? `Cancel inside ${hours(H)} and ${late}% is refunded — the remainder compensates the tutor for time they held for you.`
                      : `Cancel inside ${hours(H)} and the lesson is not refunded — the tutor held that time for you.`,
                ]
              : []),
            `If a tutor cancels you are refunded in full, regardless of notice. If a tutor does not attend, you receive ${refundPhrase(tutorNoShow)}.`,
          ],
        },
        {
          heading: "When a student cancels",
          body: [
            H > 0
              ? `**More than ${hours(H)} before the lesson**: full refund, issued automatically to your original payment method.`
              : "**Before the lesson starts**: full refund, issued automatically to your original payment method.",
            ...(H > 0
              ? [
                  `**Inside ${hours(H)}**: ${refundPhrase(late)}.${late < 100 ? " The tutor set that time aside and usually cannot fill it at short notice." : ""}`,
                ]
              : []),
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
            `**The tutor does not attend**: report it from the lesson page once the scheduled end time has passed. You receive ${refundPhrase(tutorNoShow)}.`,
            `**The student does not attend**: the tutor can mark the lesson as a student no-show. ${
              studentNoShow <= 0
                ? "No refund applies, as the tutor was present and ready to teach."
                : `${studentNoShow}% is refunded.`
            }`,
            "If you believe a no-show was reported incorrectly, open a dispute and our team will review it.",
          ],
        },
        {
          heading: "Disputes",
          body: [
            "If a lesson was not delivered as agreed, open a dispute from the lesson page. Describe what happened in as much detail as you can.",
            "Our team reviews the booking record, the messages between you, and both accounts. We then decide on a full refund, a partial refund, or no refund, and explain the reasoning to both parties. A dispute decision is final once made.",
          ],
        },
        {
          heading: "Repeated cancellations",
          body: [
            `Cancelling ${p.cancellationAbuseThreshold} or more lessons within ${days(p.cancellationAbuseWindowDays)} triggers a warning. Continued cancellations after that lead to an account review and possible restriction.`,
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

    "community-standards": {
      title: "Community Standards",
      description: `How everyone on ${appName} — families, students and tutors — is expected to behave, and what happens when someone doesn't.`,
      lastUpdated: LAST_UPDATED,
      sections: [
        {
          heading: "Why these exist",
          body: [
            `${appName} brings adults and children who have never met into regular contact. These standards are the conditions under which that is acceptable. They apply to every account, every message, every lesson and every review, and they form part of our [terms of service](/legal/terms).`,
          ],
        },
        {
          heading: "1. Be respectful",
          body: [
            "Treat people the way you would in a classroom or a professional meeting. No harassment, bullying, threats, hate speech, or discrimination on the basis of race, ethnicity, religion, sex, gender identity, sexual orientation, disability, age or any other protected ground.",
            "No sexual content of any kind, and no comments about anyone's appearance. Lessons are about the course.",
            "Disagreements happen. Raise them calmly, in writing, on the platform — or open a dispute and let our team look at it.",
          ],
        },
        {
          heading: "2. Protect learners who are minors",
          body: [
            `Many learners are under ${AGE_RULES.adultAge}. A tutor's relationship is with the family: lessons are arranged through the account that booked them, and when a child is on a parent or guardian's account, every booking and message is visible to that adult.`,
            "Tutors must not ask a minor for personal contact details, social media accounts, photographs or meetings outside booked lessons, and must not offer gifts or favours.",
            "For in-person lessons, the first sessions should take place somewhere public or with another adult present. Lessons are not recorded by the platform; nobody may record a lesson involving a minor without the parent or guardian's consent.",
            "If a child may be in immediate danger, call 911 first. Then tell us, so we can act on the account straight away.",
          ],
        },
        {
          heading: "3. Keep contact and payment on the platform",
          body: [
            "Message, book and pay through the platform. That record is what lets us help when something goes wrong — we cannot investigate a conversation or refund a payment we never saw.",
            "Messages automatically hide phone numbers and email addresses, and messages asking to pay outside the platform are flagged to our team. Trying to get around this — spelling a number out, moving the conversation elsewhere, or offering a discount for paying directly — is a breach of these standards.",
            "Tutors must not take payment for lessons booked through the platform anywhere else, and must not ask a family to cancel a booking and pay them directly.",
          ],
        },
        {
          heading: "4. Be honest",
          body: [
            "Profiles must describe the real person. Qualifications, experience, and the documents submitted for verification must be genuine. A badge obtained with a false document is withdrawn and the account removed.",
            "Reviews must describe a lesson that actually took place. Do not review yourself, review a tutor you have a personal relationship with, offer or accept anything in exchange for a review, or pressure anyone to change one. Tutors may reply to a review; they may not ask for it to be removed in exchange for anything.",
            "Reports must be made in good faith. Reporting someone to harass them is itself a breach.",
          ],
        },
        {
          heading: "5. Be reliable",
          body: [
            `Turn up to lessons you have booked or agreed to teach, on time. Cancelling ${p.cancellationAbuseThreshold} or more lessons within ${days(p.cancellationAbuseWindowDays)} triggers a warning, and repeated no-shows are flagged to our team for review. The [cancellation policy](/legal/cancellation) sets out what each kind of cancellation costs.`,
          ],
        },
        {
          heading: "6. How to report something",
          body: [
            "**A conversation**: use the report option inside the thread. You can also block the other person from there.",
            "**A review**: use the report option on the review.",
            "**A lesson**: open a dispute from the lesson page.",
            `**Anything else, including a safety concern about a tutor**: contact [support](/support) and choose “Safety and conduct”, or email ${supportEmail}. Safety reports are placed at the top of our queue.`,
          ],
        },
        {
          heading: "7. What happens after a report",
          body: [
            "A person on our team reviews every report. Automated checks can flag something for review, but they never decide the outcome on their own.",
            "Depending on what happened, we may warn the account, remove a badge, remove a profile from search while we investigate, suspend the account, or remove it permanently. Where the law requires it, or a child may be at risk, we report to the police or child-protection authorities.",
          ],
        },
      ],
    },

    "tutor-agreement": {
      title: "Tutor Agreement",
      description: `The terms between you and ${operator} when you tutor on ${appName}. It applies alongside our terms of service and community standards.`,
      lastUpdated: LAST_UPDATED,
      sections: [
        {
          heading: "1. Your status",
          body: [
            `You tutor on ${appName} as an independent contractor. You are not an employee, agent or partner of ${operator}, and nothing in this agreement creates an employment relationship.`,
            "You decide whether to accept work, which courses you teach, when you are available and how you teach. You are responsible for your own income tax, for registering for and charging GST/HST if your earnings require it, and for any insurance, licence or professional obligation that applies to you.",
          ],
        },
        {
          heading: "2. Applying and verification",
          body: [
            `Applications are reviewed by a person. We aim to give a decision within ${businessDays(p.applicationReviewBusinessDays)} of a complete application, and we may approve, decline or ask for more information.`,
            "Every tutor's government-issued photo ID is reviewed before their profile is approved. Other badges — education, Ontario College of Teachers membership, university enrolment, background checks — are optional and reviewed one at a time. The [verification page](/verification) explains each one.",
            "Everything you submit must be genuine and current. Tell us when a credential lapses or changes. Some badges carry an expiry date; when it passes, the badge is removed until you supply a current document. A false or altered document means permanent removal.",
          ],
        },
        {
          heading: "3. Your rate and our commission",
          body: [
            `You set your own hourly rate, between $${p.minHourlyRate} and $${p.maxHourlyRate} an hour, and may set a different rate for individual courses. Families pay exactly the rate on your profile; nothing is added to their total.`,
            `${operator} keeps a commission of ${commission}% of each lesson's price. The rest is your earnings. When a family is refunded part of a lesson, the commission is reduced in the same proportion; when they are refunded in full, no commission is taken and nothing is earned.`,
            "The commission and policy that apply to a booking are the ones in force when it was made. Changes apply to new bookings only.",
          ],
        },
        {
          heading: "4. When you are paid",
          body: [
            `Earnings for a lesson become payable ${days(p.payoutHoldDays)} after it is completed. ${
              p.autoPayouts
                ? "Payable earnings are then paid out automatically to the bank account you connect."
                : "Payable earnings are then released by our team to the bank account you connect."
            } You must connect a payout account before anything can be transferred.`,
            "If a lesson is disputed, the earnings for it follow the outcome of the dispute. Every lesson, the commission taken and your running total are shown in your earnings dashboard.",
          ],
        },
        {
          heading: "5. Bookings, cancellations and no-shows",
          body: [
            `Families can book any time you have published, at least ${hours(p.minimumBookingNoticeHours)} ahead and up to ${days(p.bookingHorizonDays)} in advance. Keep your calendar current: a booked slot is a commitment.`,
            H > 0
              ? `**If a family cancels more than ${hours(H)} ahead**, they are refunded in full and nothing is earned. **Inside ${hours(H)}**, they receive ${refundPhrase(late)}${late < 100 ? ", and you earn your share of the rest" : ""}.`
              : "**If a family cancels before the lesson starts**, they are refunded in full and nothing is earned.",
            `**If a student does not attend**, mark the lesson as a student no-show once it should have ended. ${studentNoShow <= 0 ? "No refund applies and you earn your share of the lesson." : `The family receives ${studentNoShow}% back and you earn your share of the rest.`}`,
            `**If you cancel**, the family is refunded in full, whatever the notice. **If you do not attend**, the family receives ${refundPhrase(tutorNoShow)}. Cancelling ${p.cancellationAbuseThreshold} or more lessons within ${days(p.cancellationAbuseWindowDays)} triggers a warning, and repeated cancellations or no-shows can lead to removal from search.`,
            "Mark each lesson complete once it has taken place. Do not mark a lesson complete that did not happen.",
          ],
        },
        {
          heading: "6. Conduct",
          body: [
            "Our [community standards](/legal/community-standards) are part of this agreement. In particular: keep all contact and payment for platform bookings on the platform, follow the rules on working with minors, and never solicit or manipulate reviews.",
            "Families' personal information is shared with you only to teach. Do not copy it, keep it after you stop teaching that family, or use it for anything else.",
          ],
        },
        {
          heading: "7. Your profile and content",
          body: [
            "You keep ownership of your profile text, photos and materials. You grant us a licence to display them on the platform and in search results for the purpose of operating the service.",
            "We may decline or remove content that is inaccurate, breaches these terms or the community standards, or includes contact details.",
          ],
        },
        {
          heading: "8. Suspension and ending this agreement",
          body: [
            "You can stop tutoring at any time: stop accepting new students from your profile, or close your account from Settings once your upcoming lessons are cancelled.",
            "We may remove your profile from search, suspend or close your account if you breach this agreement, the terms of service or the community standards, if a required verification lapses or turns out to be false, if your cancellations or no-shows make you unreliable, or if we believe you pose a risk to anyone's safety.",
            "Ending this agreement does not cancel earnings already payable for lessons you completed. Contact support if a payout is outstanding.",
          ],
        },
        {
          heading: "9. Liability and governing law",
          body: [
            "You are responsible for the lessons you deliver. To the extent permitted by law, our liability to you is limited to the commission we earned from your lessons in the twelve months before the claim arose.",
            `This agreement is governed by ${governingLaw}. We will tell you about a material change before it takes effect.`,
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
            `${appName} aims to meet WCAG 2.1 Level AA. Education should not be harder to access because of how a website is built.`,
            "Accessibility is part of how we build, not something added afterwards. Components are built to be usable by keyboard and understandable to a screen reader before they ship.",
          ],
        },
        {
          heading: "What we've built in",
          body: [
            "**Keyboard navigation**: interactive elements are reachable and operable by keyboard, with a visible focus indicator. Dialogs trap focus while open and return it when closed.",
            "**Screen readers**: semantic HTML throughout, with labels, descriptions and error messages associated with their controls. Status changes are announced politely.",
            "**Reduced motion**: animation respects your operating system's reduced-motion setting. Nothing essential is conveyed by motion alone.",
            "**Contrast and text**: text is designed to meet AA contrast ratios and to resize without breaking layout. Nothing relies on colour alone to convey meaning.",
            "**Responsive layout**: the platform works from small phones to large desktops without horizontal scrolling.",
          ],
        },
        {
          heading: "Accessibility needs in tutoring",
          body: [
            "Every learner profile has a field for accessibility and learning needs. What you write there is shared with tutors you book, so they can adapt their approach before the first lesson.",
            "Many tutors describe experience with specific needs — ADHD, dyslexia, anxiety — in their profiles. Message a tutor before booking if you want to check.",
          ],
        },
        {
          heading: "Telling us about a problem",
          body: [
            `If something on the platform is difficult or impossible to use, email ${supportEmail} with the page and what went wrong. We treat accessibility reports as bugs, not feature requests.`,
            `We aim to reply within ${businessDays(p.supportResponseBusinessDays)} and to tell you what we're doing about it.`,
          ],
        },
      ],
    },
  };
}

/** Bound to the built-in identity — used by the sitemap and route generation. */
export const LEGAL_PAGES = buildLegalPages();

export const LEGAL_SLUGS = Object.keys(LEGAL_PAGES);
