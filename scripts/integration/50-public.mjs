/**
 * Public SEO pages and public content (R32.1, R32.3, R32.5–R32.8, R2.17–R2.19,
 * R10.8, R11.7, R12.x, R33.x).
 *
 * The landing pages are only as good as the resolution behind them: every
 * segment comes from the database, an alias or code redirects to the
 * canonical slug, and anything that does not resolve is a 404. These assert
 * that resolution against the seeded curriculum — Ontario and British
 * Columbia live, the rest "coming soon" — and that the sitemap only lists
 * URLs that resolve and have tutors on them.
 *
 * The content checks read the policy builders and the page sources for the
 * hard-coded business values the audit found, so one cannot creep back in.
 */
import { readFile } from "node:fs/promises";

export default async function publicSuite({ section, check, skip, connectForSuite, randomUUID }) {
  section("Public pages — policy text is built from settings (R33.11–R33.16)");
  await legalContent({ check });

  section("Public pages — no hard-coded business values in copy (R2.17–R2.19, R10.8, R12.3, R33.4, R33.7)");
  await sourceScan({ check });

  section("Public pages — curriculum URLs resolve from the database (R32.5, R32.7)");
  if (!(await connectForSuite())) return skip("public landing pages", "MongoDB is not reachable");

  const { Province, Course, Grade, Subject } = await import("@/models");
  const ontario = await Province.findOne({ code: "ON", isActive: true }).lean();
  const bc = await Province.findOne({ code: "BC", isActive: true }).lean();
  const inactive = await Province.findOne({ isActive: false }).lean();
  const mhf4u = await Course.findOne({ code: "MHF4U", provinceCode: "ON" }).lean();
  const math = await Subject.findOne({ slug: "mathematics" }).lean();
  if (!ontario || !bc || !inactive || !mhf4u || !math || !(math.aliases ?? []).includes("math")) {
    return skip("public landing pages", "seeded curriculum missing — run `bun run seed` against this database");
  }

  await curriculumResolution({ check, ontario, bc, inactive, Course, Grade, Subject, randomUUID });

  section("Public pages — topic + city pages (R32.2–R32.4, R32.6, R32.8)");
  await topicCityResolution({ check });

  section("Public pages — sitemap and robots (R32.1)");
  await sitemapAndRobots({ check, inactive });
}

async function legalContent({ check }) {
  const { buildLegalPages, LEGAL_SLUGS, cookieInventory } = await import("@/constants");
  const policy = {
    commissionPercent: 17,
    freeCancellationWindowHours: 36,
    lateCancellationRefundPercent: 40,
    tutorNoShowRefundPercent: 100,
    studentNoShowRefundPercent: 0,
    cancellationAbuseThreshold: 5,
    cancellationAbuseWindowDays: 45,
    applicationReviewBusinessDays: 4,
    supportResponseBusinessDays: 3,
    payoutHoldDays: 6,
    verificationDocumentRetentionDays: 73,
  };
  const pages = buildLegalPages({
    appName: "Test Tutors",
    supportEmail: "help@example.test",
    contact: { legalName: "Test Tutors Inc.", province: "Nova Scotia" },
    policy,
  });
  const text = (slug) => JSON.stringify(pages[slug]);

  for (const slug of ["terms", "privacy", "cookies", "cancellation", "community-standards", "tutor-agreement", "accessibility"]) {
    check(`/legal/${slug} exists and is routable`, LEGAL_SLUGS.includes(slug) && Boolean(pages[slug]?.sections?.length));
  }
  check("terms quote the live commission, not the default", text("terms").includes("17%") && !text("terms").includes("15%"));
  check("cancellation quotes the live window and late refund", text("cancellation").includes("36 hours") && text("cancellation").includes("40%") &&
    !text("cancellation").includes("24 hours"));
  check("tutor agreement quotes the live review time and payout hold", text("tutor-agreement").includes("4 business days") &&
    text("tutor-agreement").includes("6 days"));
  check("governing law follows the operator's province, not a literal", text("terms").includes("Nova Scotia") && !text("terms").includes("Ontario"));
  check("privacy states the configured document retention period",
    text("privacy").includes("73 days") && !/deleted from storage when the badge it supports expires/.test(text("privacy")));
  check("the privacy policy says account deletion discards verification documents", /account is deleted/i.test(text("privacy")));

  const cookieNames = cookieInventory().cookies.map((c) => c.name);
  const sessionSource = await readFile(new URL("../../src/lib/auth/session.js", import.meta.url), "utf8");
  const setInSource = [...sessionSource.matchAll(/"(aplus_[a-z_]+)"/g)].map((m) => m[1]);
  const { SESSION } = await import("@/constants");
  for (const name of new Set([SESSION.cookieName, ...setInSource])) {
    check(`the cookie policy lists ${name}`, cookieNames.includes(name) && text("cookies").includes(name));
  }
  check("the cookie policy lists browser storage and the service-worker caches",
    text("cookies").includes("Local storage") && text("cookies").includes("aplus-static-"));

  const verification = await import("@/constants");
  check("the verification disclaimer is exported for every surface that needs it",
    typeof verification.VERIFICATION_DISCLAIMER === "string" && /not a guarantee/i.test(verification.VERIFICATION_DISCLAIMER));
}

async function sourceScan({ check }) {
  const read = (path) => readFile(new URL(`../../src/${path}`, import.meta.url), "utf8");
  const files = {
    sections: await read("components/home/Sections.jsx"),
    hero: await read("components/home/Hero.jsx"),
    footer: await read("components/layout/SiteFooter.jsx"),
    navigation: await read("constants/navigation.js"),
    becomeTutor: await read("app/(public)/become-a-tutor/page.js"),
    howItWorks: await read("app/(public)/how-it-works/page.js"),
    pricing: await read("app/(public)/pricing/page.js"),
    faq: await read("app/(public)/faq/page.js"),
    verification: await read("app/(public)/verification/page.js"),
    safety: await read("app/(public)/safety/page.js"),
    about: await read("app/(public)/about/page.js"),
    support: await read("app/(public)/support/page.js"),
    courses: await read("app/(public)/courses/page.js"),
    coursePage: await read("app/(public)/[province]/[grade]/[subject]/[course]/page.js"),
    cityPage: await read("app/(public)/tutors/[slug]/[city]/page.js"),
    messagePanel: await read("components/messaging/MessageTutorPanel.jsx"),
    profileBody: await read("components/tutor/TutorProfileBody.jsx"),
    legal: await read("constants/legal.js"),
  };

  const banned = [
    [/\b85%/, "a literal 85% tutor share"],
    [/\b15%/, "a literal 15% commission"],
    [/24 hours/, "a literal 24-hour cancellation window"],
    [/\b48h\b/, "a literal 48h review time"],
    [/live chat/i, "a live chat that does not exist"],
    [/replies within 4 hours/i, "a 4-hour reply promise"],
    [/Usually replies within a few hours/, "an invented reply time"],
    [/complete secondary course-code curriculum/i, "a 'complete curriculum' claim"],
    [/identity is checked before/i, "a mandatory-identity claim approval does not enforce"],
    [/province=ON\b/, "a literal province in a link"],
    [/\?\? "ON"|"ON" \?\?|provinceCode: "ON"|province: "ON"/, "a literal province default"],
    [/\$45 and \$85/, "an invented rate range"],
    [/two business days|one business day/i, "a literal service level"],
    [/1-888-555/, "a placeholder phone number"],
  ];
  for (const [name, source] of Object.entries(files)) {
    const hits = banned.filter(([pattern]) => pattern.test(source)).map(([, why]) => why);
    check(`${name}: no hard-coded business values`, hits.length === 0, hits.join("; "));
  }

  // "Ontario" may appear in comments and in the OCT badge's own name, which
  // comes from the domain constants — never in a sentence a page renders.
  const ontarioInCopy = (source) =>
    source
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .some((line) => /Ontario/.test(line));
  for (const name of ["sections", "hero", "footer", "becomeTutor", "howItWorks", "pricing", "faq", "verification",
    "safety", "about", "courses", "coursePage", "cityPage", "profileBody", "navigation"]) {
    check(`${name}: no literal province name in copy`, !ontarioInCopy(files[name]));
  }

  check("the message panel shows a measured reply time or nothing",
    files.messagePanel.includes("responseTimeMinutes") && !/few hours/.test(files.messagePanel));
  for (const name of ["verification", "safety", "profileBody"]) {
    check(`${name} carries the verification disclaimer (R11.7)`, files[name].includes("VERIFICATION_DISCLAIMER"));
  }

  const { homeFaqs, HOME_FAQS } = await import("@/constants");
  const faqs = homeFaqs({
    appName: "Test Tutors",
    policy: { freeCancellationWindowHours: 30, tutorNoShowRefundPercent: 100 },
    coverage: { provinces: [{ name: "Nova Scotia", courseCount: 12 }], courseCount: 12, comingSoon: 2 },
    rateRange: { lowCents: 4100, highCents: 7300, sampleSize: 9 },
  });
  const faqText = JSON.stringify(faqs);
  check("home FAQs quote the live cancellation window", faqText.includes("30 hours"));
  check("home FAQs name the live provinces from the catalogue", faqText.includes("Nova Scotia") && faqText.includes("12"));
  check("home FAQs quote a measured rate range", faqText.includes("$41") && faqText.includes("$73"));
  check("without data the FAQs make no numeric claim", !/\d+ hours|\$\d/.test(JSON.stringify(HOME_FAQS)));
}

async function curriculumResolution({ check, ontario, bc, inactive }) {
  const {
    resolveProvince, resolveProvinceSection, resolveGradeSubject, resolveCoursePath, normaliseSegment,
  } = await import("@/services/landing.service");

  // Province.
  const on = await resolveProvince(ontario.slug);
  check("a live province slug resolves canonically", on?.province.code === "ON" && on.canonical === true);
  const byCode = await resolveProvince(ontario.code.toLowerCase());
  check("its code resolves and asks for a redirect", byCode?.province.slug === ontario.slug && byCode.canonical === false);
  check("a second live province resolves too", (await resolveProvince(bc.slug))?.province.code === "BC");
  check("an inactive province does not resolve", (await resolveProvince(inactive.slug)) === null);
  for (const junk of ["help", "not-a-province", "__proto__", "on%2F..", "../etc", ""]) {
    check(`'${junk}' is not a province`, (await resolveProvince(junk)) === null);
  }
  check("segments are normalised before lookup", normaliseSegment("Ontario") === "ontario" && normaliseSegment("a b") === null);

  // Province + subject, province + grade.
  const ontarioMath = await resolveProvinceSection({ province: "ontario", section: "math" });
  check("/ontario/math resolves to Mathematics and redirects",
    ontarioMath?.kind === "SUBJECT" && ontarioMath.subject.slug === "mathematics" &&
      ontarioMath.canonical === false && ontarioMath.canonicalPath === "/ontario/mathematics");
  const ontarioMathematics = await resolveProvinceSection({ province: "ontario", section: "mathematics" });
  check("/ontario/mathematics is canonical", ontarioMathematics?.canonical === true);
  const bcMath = await resolveProvinceSection({ province: bc.slug, section: "mathematics" });
  check("/british-columbia/mathematics resolves from British Columbia's own courses",
    bcMath?.kind === "SUBJECT" && bcMath.province.code === "BC" && bcMath.canonical === true);
  const grade12 = await resolveProvinceSection({ province: "ontario", section: "grade-12" });
  check("/ontario/grade-12 resolves as a grade", grade12?.kind === "GRADE" && grade12.grade.level === 12 && grade12.canonical);
  check("an unknown second segment is a 404", (await resolveProvinceSection({ province: "ontario", section: "not-a-subject" })) === null);
  check("a subject under an inactive province is a 404",
    (await resolveProvinceSection({ province: inactive.slug, section: "mathematics" })) === null);

  // A subject the province has no live course in is a 404, not an empty page.
  const { Course, Subject } = await import("@/models");
  const taughtInBc = new Set((await Course.distinct("subjectId", { provinceCode: "BC", isActive: true })).map(String));
  const untaught = (await Subject.find({ isActive: true }).lean()).find((s) => !taughtInBc.has(String(s._id)));
  if (untaught) {
    check(`/british-columbia/${untaught.slug} (no BC courses) is a 404`,
      (await resolveProvinceSection({ province: bc.slug, section: untaught.slug })) === null);
  }

  // Grade + subject.
  const g12math = await resolveGradeSubject({ province: "ontario", grade: "grade-12", subject: "math" });
  check("/ontario/grade-12/math redirects to /ontario/grade-12/mathematics",
    g12math?.canonical === false && g12math.canonicalPath === "/ontario/grade-12/mathematics");
  check("/ontario/grade-12/mathematics is canonical",
    (await resolveGradeSubject({ province: "ontario", grade: "grade-12", subject: "mathematics" }))?.canonical === true);
  check("an unknown grade is a 404",
    (await resolveGradeSubject({ province: "ontario", grade: "grade-99", subject: "mathematics" })) === null);

  // Course paths — the spec URL R32.7.
  const spec = await resolveCoursePath({ province: "ontario", grade: "grade-12", subject: "math", course: "mhf4u" });
  check("the spec URL /ontario/grade-12/math/mhf4u resolves to MHF4U",
    spec?.course.code === "MHF4U" && spec.canonical === false &&
      spec.canonicalPath === "/ontario/grade-12/mathematics/mhf4u");
  const canonical = await resolveCoursePath({ province: "ontario", grade: "grade-12", subject: "mathematics", course: "mhf4u" });
  check("the canonical course URL renders without a redirect", canonical?.canonical === true);
  const upper = await resolveCoursePath({ province: "ON", grade: "grade-12", subject: "mathematics", course: "MHF4U" });
  check("a code-cased URL redirects to the lower-case canonical", upper?.canonical === false && upper.canonicalPath === canonical?.canonicalPath);
  const alias = await resolveCoursePath({ province: "ontario", grade: "grade-12", subject: "mathematics", course: "calculus" });
  check("a course alias resolves to its course and redirects", alias?.course.code === "MCV4U" && alias.canonical === false);
  const bcCalc = await resolveCoursePath({ province: bc.slug, grade: "grade-12", subject: "math", course: "calculus" });
  check("the same alias in another province is that province's course", Boolean(bcCalc) && bcCalc.course.provinceCode === "BC");
  check("an unknown course is a 404",
    (await resolveCoursePath({ province: "ontario", grade: "grade-12", subject: "mathematics", course: "not-a-course" })) === null);
  check("a real course under the wrong grade is a 404",
    (await resolveCoursePath({ province: "ontario", grade: "grade-11", subject: "mathematics", course: "mhf4u" })) === null);
  check("a real course under another province is a 404",
    (await resolveCoursePath({ province: bc.slug, grade: "grade-12", subject: "mathematics", course: "mhf4u" })) === null);
  check("a course under an inactive province is a 404",
    (await resolveCoursePath({ province: inactive.slug, grade: "grade-12", subject: "mathematics", course: "mhf4u" })) === null);
}

async function topicCityResolution({ check }) {
  const { resolveTopicCity, resolveCity, topicSearchParams } = await import("@/services/landing.service");
  const { searchTutors } = await import("@/services/search.service");
  const { TutorProfile } = await import("@/models");

  const toronto = await resolveCity("toronto");
  check("a city search can locate resolves with coordinates", toronto?.name === "Toronto" && Array.isArray(toronto.coordinates));
  check("an unknown place is not a city", (await resolveCity("zzz9z")) === null && (await resolveCity("atlantis")) === null);

  // A city outside the bundled table but on a tutor's profile.
  const located = new Set(["toronto", "scarborough", "north york", "etobicoke", "mississauga", "brampton", "markham",
    "vaughan", "richmond hill", "oakville", "burlington", "hamilton", "ottawa", "london", "kitchener", "waterloo",
    "windsor", "kingston", "barrie", "oshawa"]);
  const unlisted = (await TutorProfile.find({ isSearchable: true }).select("city province subjectSlugs").lean())
    .find((t) => t.city && !located.has(t.city.toLowerCase()) && t.subjectSlugs?.length);
  if (unlisted) {
    const slug = unlisted.city.toLowerCase().replace(/\s+/g, "-");
    const city = await resolveCity(slug);
    check(`an unlisted tutor city (${unlisted.city}) resolves without coordinates`,
      city?.name === unlisted.city && city.coordinates === null && city.provinceCode === unlisted.province);

    const hit = await resolveTopicCity({ topic: unlisted.subjectSlugs[0], city: slug });
    const results = hit && (await searchTutors({ ...topicSearchParams(hit), page: 1, pageSize: 50, sort: "RELEVANCE" }));
    check(`its page lists only tutors who give ${unlisted.city} as their city — no invented location`,
      results?.total > 0 && results.items.every((t) => t.city?.toLowerCase() === unlisted.city.toLowerCase()),
      results?.items.map((t) => t.city).join(", "));
  }

  const cases = [
    ["mhf4u", "toronto", { kind: "COURSE", path: "/tutors/mhf4u/toronto", canonical: true }],
    ["MHF4U", "Toronto", { kind: "COURSE", path: "/tutors/mhf4u/toronto", canonical: false }],
    ["eng4u", "toronto", { kind: "COURSE", path: "/tutors/eng4u/toronto", canonical: true }],
    ["mhf4u", "scarborough", { kind: "COURSE", path: "/tutors/mhf4u/scarborough", canonical: true }],
    ["math", "scarborough", { kind: "SUBJECT", path: "/tutors/mathematics/scarborough", canonical: false }],
    ["mathematics", "scarborough", { kind: "SUBJECT", path: "/tutors/mathematics/scarborough", canonical: true }],
    ["grade-12-math", "scarborough", { kind: "GRADE_SUBJECT", path: "/tutors/grade-12-mathematics/scarborough", canonical: false }],
    ["grade-12-mathematics", "scarborough", { kind: "GRADE_SUBJECT", path: "/tutors/grade-12-mathematics/scarborough", canonical: true }],
    ["calculus", "toronto", { kind: "COURSE", path: "/tutors/mcv4u/toronto", canonical: false }],
  ];
  for (const [topic, city, want] of cases) {
    const hit = await resolveTopicCity({ topic, city });
    check(`/tutors/${topic}/${city} → ${want.canonical ? "renders" : `308 ${want.path}`}`,
      hit?.topic.kind === want.kind && hit.canonicalPath === want.path && hit.canonical === want.canonical,
      hit ? `${hit.topic.kind} ${hit.canonicalPath} canonical=${hit.canonical}` : "null");
  }

  const vancouver = await resolveCity("vancouver");
  if (vancouver) {
    const calc = await resolveTopicCity({ topic: "calculus", city: "vancouver" });
    check("'calculus' in a British Columbia city is British Columbia's course",
      calc?.topic.course?.provinceCode === "BC" && calc.topic.course.code !== "MCV4U");
    check("an Ontario-only course code in a British Columbia city is a 404",
      (await resolveTopicCity({ topic: "mhf4u", city: "vancouver" })) === null);
  }

  for (const [topic, city] of [["zzz9z", "toronto"], ["nonexistent-slug-xyz", "toronto"], ["mhf4u", "zzz9z"], ["mhf4u", "atlantis"]]) {
    check(`/tutors/${topic}/${city} is a 404`, (await resolveTopicCity({ topic, city })) === null);
  }

  // The page's tutors are search's tutors (R32.3).
  const g12 = await resolveTopicCity({ topic: "grade-12-mathematics", city: "scarborough" });
  const params = topicSearchParams(g12);
  check("grade + subject + city searches in-person tutors for the subject, the grade and the city",
    params.mode === "IN_PERSON" && params.subject === "mathematics" && params.grade === "grade-12" && params.city === "Scarborough" &&
      params.province === "ON");
  const scarborough = await searchTutors({ ...params, page: 1, pageSize: 20, sort: "RELEVANCE" });
  check("Grade 12 math in Scarborough lists tutors", scarborough.total > 0);
  check("every one of them teaches mathematics at Grade 12",
    scarborough.items.every((t) => t.courses.some((c) => c.subjectSlug === "mathematics" && c.gradeLevel === 12)));
}

async function sitemapAndRobots({ check, inactive }) {
  const {
    landingSitemapEntries, resolveProvince, resolveProvinceSection, resolveGradeSubject, resolveCoursePath,
    resolveTopicCity, topicSearchParams,
  } = await import("@/services/landing.service");
  const { searchTutors } = await import("@/services/search.service");

  const entries = await landingSitemapEntries();
  const byKind = (kind) => entries.filter((e) => e.kind === kind);
  check("the sitemap lists province pages", byKind("PROVINCE").some((e) => e.path === "/ontario") &&
    byKind("PROVINCE").some((e) => e.path === "/british-columbia"));
  check("…province + subject pages", byKind("PROVINCE_SUBJECT").some((e) => e.path === "/ontario/mathematics"));
  check("…grade + subject pages", byKind("GRADE_SUBJECT").some((e) => e.path === "/ontario/grade-12/mathematics"));
  check("…canonical course pages", byKind("COURSE").some((e) => e.path === "/ontario/grade-12/mathematics/mhf4u"));
  check("…topic + city pages", byKind("COURSE_CITY").length > 0 && byKind("SUBJECT_CITY").length > 0);
  check("…and nothing under an inactive province", entries.every((e) => !e.path.startsWith(`/${inactive.slug}`)));
  check("no URL is listed twice", new Set(entries.map((e) => e.path)).size === entries.length);

  let unresolved = [];
  for (const entry of entries) {
    const [, a, b, c, d] = entry.path.split("/");
    let hit = null;
    if (entry.kind === "PROVINCE") hit = await resolveProvince(a);
    if (entry.kind === "PROVINCE_SUBJECT") hit = await resolveProvinceSection({ province: a, section: b });
    if (entry.kind === "GRADE_SUBJECT") hit = await resolveGradeSubject({ province: a, grade: b, subject: c });
    if (entry.kind === "COURSE") hit = await resolveCoursePath({ province: a, grade: b, subject: c, course: d });
    if (entry.kind === "COURSE_CITY" || entry.kind === "SUBJECT_CITY") hit = await resolveTopicCity({ topic: b, city: c });
    if (!hit || hit.canonical !== true) unresolved.push(entry.path);
  }
  check("every sitemap URL resolves canonically (no 404, no redirect)", unresolved.length === 0, unresolved.slice(0, 5).join(", "));

  const empty = [];
  for (const entry of entries.filter((e) => e.kind.endsWith("_CITY"))) {
    const [, , topic, city] = entry.path.split("/");
    const hit = await resolveTopicCity({ topic, city });
    const results = await searchTutors({ ...topicSearchParams(hit), page: 1, pageSize: 1, sort: "RELEVANCE" });
    if (!results.total) empty.push(entry.path);
  }
  check("every topic + city URL in the sitemap lists at least one tutor", empty.length === 0, empty.slice(0, 5).join(", "));

  const robots = (await import("@/app/robots")).default;
  const result = await robots();
  const disallow = result.rules?.[0]?.disallow ?? [];
  if (result.rules?.[0]?.disallow === "/") {
    check("robots: indexing switched off disallows everything", true);
  } else {
    for (const path of ["/insights", "/packages", "/progress", "/my-groups", "/referrals", "/admin/", "/tutor/", "/api/",
      "/dashboard", "/bookings", "/messages", "/settings"]) {
      check(`robots disallows ${path}`, disallow.includes(path));
    }
    check("robots names the sitemap with an absolute URL", /^https?:\/\/[^/]+\/sitemap\.xml$/.test(result.sitemap ?? ""));
    check("robots Host is a bare host name", Boolean(result.host) && !/^https?:\/\//.test(result.host) && !result.host.includes("/"));
  }
}
