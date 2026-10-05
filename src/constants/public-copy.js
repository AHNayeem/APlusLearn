/**
 * Copy the public pages share, worded from live data (§12, §33).
 *
 * Every business number a marketing page states — the cancellation window, a
 * refund percentage, a review time, a rate range, which provinces are live —
 * is a setting or a measurement. These helpers word a number they are given
 * and, when they are given nothing, word the sentence without one. None of
 * them holds a number of its own: a literal here would be a second copy of a
 * setting, and the first time an operator changed it the page would describe
 * a rule the platform no longer enforces.
 *
 * Pure functions with no imports, so server pages, the homepage sections and
 * the integration suite can all use them.
 */

/**
 * What a verification badge is, and is not (R11.7). Shown wherever badges
 * are explained — the verification and safety pages and the trust card on
 * every tutor profile — so no surface can imply more than the check covers.
 */
export const VERIFICATION_DISCLAIMER =
  "A badge means our team reviewed a specific document — an ID, a certificate, a transcript, a police check — and found it genuine and current at the time. It is not a guarantee of teaching quality, of results, or of anyone's safety, and it is not a substitute for your own judgement: meet the tutor, sit in on early lessons, and tell us if anything feels wrong.";

/** "1 hour", "36 hours". */
export function hoursLabel(n) {
  const value = Number(n);
  return `${value} ${value === 1 ? "hour" : "hours"}`;
}

/** "1 day", "3 days". */
export function daysLabel(n) {
  const value = Number(n);
  return `${value} ${value === 1 ? "day" : "days"}`;
}

/** "a full refund" / "a 50% refund" / "no refund". */
export function refundPhrase(percent) {
  const value = Number(percent);
  if (value >= 100) return "a full refund";
  if (value <= 0) return "no refund";
  return `a ${value}% refund`;
}

/**
 * The free-cancellation rule as one clause, e.g. "free cancellation up to 24
 * hours before a lesson" — or, with no policy to hand, a clause that points at
 * the policy instead of quoting a number.
 */
export function freeCancellationClause(policy) {
  const hours = Number(policy?.freeCancellationWindowHours);
  if (!Number.isFinite(hours)) return "free cancellation within the window shown when you book";
  if (hours <= 0) return "free cancellation at any time before a lesson starts";
  return `free cancellation up to ${hoursLabel(hours)} before a lesson`;
}

/** "Ontario and British Columbia" — an English list of names. */
export function listNames(names = []) {
  const list = names.filter(Boolean);
  if (list.length <= 1) return list[0] ?? "";
  return `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
}

/** "$45" from cents, without depending on the formatting module. */
function dollars(cents) {
  return `$${Math.round(Number(cents) / 100)}`;
}

/**
 * The homepage and FAQ-page questions, built from live data.
 *
 * @param {object} [input]
 * @param {string} [input.appName]
 * @param {object} [input.policy]    `getAppConfig().policy`
 * @param {object} [input.coverage]  `curriculumCoverage()` — live provinces and course counts
 * @param {object} [input.rateRange] `hourlyRateRange()` — the middle half of published rates
 */
export function homeFaqs({ appName, policy, coverage, rateRange } = {}) {
  const name = appName || "the platform";
  const live = coverage?.provinces?.filter((p) => p.courseCount > 0) ?? [];
  const tutorNoShow = Number(policy?.tutorNoShowRefundPercent);

  return [
    {
      q: "How much does tutoring cost?",
      a: rateRange
        ? `Tutors set their own rates. Half of the tutors on ${name} charge between ${dollars(rateRange.lowCents)} and ${dollars(rateRange.highCents)} an hour. You see the exact hourly rate on every profile before you contact anyone, and the price you see is the price you pay — our commission comes out of the tutor's side.`
        : `Tutors set their own rates, and every profile shows the exact hourly rate before you contact anyone. The price you see is the price you pay — our commission comes out of the tutor's side.`,
    },
    {
      q: "Do I need an account to search?",
      a: "No. You can search, filter, read reviews and view tutor profiles without signing up. You only need an account to message a tutor or make a booking, which is also when we ask about your child's grade and courses.",
    },
    {
      q: "How are tutors verified?",
      a: "Every application is reviewed by a person on our team before a profile can appear in search. Badges — identity, teaching certification, education, university enrolment and a Vulnerable Sector Check — are granted one at a time, only after the matching document has been reviewed, and each profile shows exactly which ones that tutor holds. A badge confirms a document was checked; it is not a guarantee of teaching quality or of safety.",
    },
    {
      q: "What if a lesson doesn't go well?",
      a: `Every booking comes with ${freeCancellationClause(policy)}. If a tutor doesn't show up, you receive ${Number.isFinite(tutorNoShow) ? refundPhrase(tutorNoShow) : "a refund under the cancellation policy"}. If something else goes wrong, you can open a dispute from the lesson page and our team reviews it.`,
    },
    {
      q: "Can I book the same tutor every week?",
      a: "Yes. When you book you can choose a weekly or every-two-weeks series, and the whole series is reserved on the tutor's calendar. You can also book a past tutor again from the lesson page in your dashboard.",
    },
    {
      q: "Which provinces do you cover?",
      a: live.length
        ? `${listNames(live.map((p) => p.name))} ${live.length === 1 ? "is" : "are"} live today, with ${coverage.courseCount} ${coverage.courseCount === 1 ? "course" : "courses"} in the catalogue — each one searchable by name${live.some((p) => p.usesCourseCodes) ? " or course code" : ""}.${coverage.comingSoon ? ` ${coverage.comingSoon} more ${coverage.comingSoon === 1 ? "province is" : "provinces are"} listed as coming soon.` : ""} Search and booking work the same way in every province.`
        : "The provinces that are live are listed in the course browser, each with its grades, subjects and courses. Search and booking work the same way in every province.",
    },
    {
      q: "How do online lessons work?",
      a: "When you book an online lesson, a meeting link is generated for Zoom, Google Meet or Microsoft Teams — whichever the tutor offers. The link appears on the lesson in your dashboard and in your confirmation email.",
    },
    {
      q: "Is my child's information private?",
      a: "Tutors only see what they need to teach: a first name and last initial, the grade, and the course. Full names, addresses and contact details are never shown on public pages, and an in-person address is only released to the tutor once a lesson is confirmed.",
    },
  ];
}

/** The same questions with nothing measured — every claim worded without a number. */
export const HOME_FAQS = homeFaqs();
