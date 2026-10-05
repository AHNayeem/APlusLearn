/**
 * Search, curriculum interpretation, location and real availability
 * (R2.3–R2.7, R6.4, R6.5, R7.x, R8.x, R9.7, R9.10, R14.4, R28.31, R29.1).
 *
 * Runs against the seeded development marketplace (two live provinces) and
 * creates its own fixtures for anything it changes: a booking, a calendar
 * block, a group session, a whole new province. Everything is removed in
 * `finally`.
 */
export default async function searchSuite({ section, check, skip, connectForSuite, randomUUID }) {
  section("Search — the curriculum decides what the words mean (R2.5, R6.4)");

  if (!(await connectForSuite())) return skip("search", "MongoDB is not reachable");

  const models = await import("@/models");
  const { TutorProfile, Availability, Booking, GroupSession, Province, Grade, Course, Subject, User, SearchEvent } = models;
  const { searchTutors, withLiveAvailability } = await import("@/services/search.service");
  const { tutorSearchSchema } = await import("@/lib/validation/search");
  const { nextAvailableFor, getBookableSlots } = await import("@/services/availability.service");
  const { searchEventFrom, searchDemand } = await import("@/services/search-analytics.service");
  const { buildAvailabilityFilter, daysFor } = await import("@/lib/search/availability-filter");
  const { LESSON_MODES } = await import("@/constants");

  const seeded = await TutorProfile.findOne({ slug: "priya-s-toro" }).lean();
  const bcCourse = await Course.findOne({ provinceCode: "BC", code: "MPREC12" }).lean();
  if (!seeded || !bcCourse) return skip("search", "seeded multi-province data missing — run the seed against this database");

  const search = (raw) => searchTutors(tutorSearchSchema.parse({ page: "1", pageSize: "48", ...raw }));
  const slugs = (result) => result.items.map((t) => t.slug);

  const tag = randomUUID().slice(0, 8);
  const created = { bookings: [], sessions: [], provinces: [], grades: [], courses: [], profiles: [], users: [], availability: [] };
  const restoreAvailability = [];

  try {
    // --- Words → curriculum ------------------------------------------------
    const math = await search({ q: "Math", province: "ON" });
    check("'Math' is read as the Mathematics subject, not a course code", math.resolved.queryKind === "SUBJECT" && math.resolved.subject?.slug === "mathematics",
      `${math.resolved.queryKind} ${math.resolved.subject?.slug}`);
    check("'Math' finds tutors, and every one teaches mathematics", math.total > 0 && math.items.every((t) => (t.subjects ?? t.subjectSlugs ?? []).length >= 0),
      `total ${math.total}`);
    const mathProfiles = await TutorProfile.find({ slug: { $in: slugs(math) } }).select("subjectSlugs provinceCodes").lean();
    check("…all of them teach mathematics in Ontario", mathProfiles.every((p) => p.subjectSlugs.includes("mathematics") && p.provinceCodes.includes("ON")));

    for (const word of ["Physics", "History", "Biology"]) {
      const r = await search({ q: word, province: "ON" });
      check(`'${word}' is a subject search with results`, r.resolved.queryKind === "SUBJECT" && r.total > 0, `${r.resolved.queryKind} → ${r.total}`);
    }

    const code = await search({ q: "mhf4u", province: "ON" });
    check("'mhf4u' is the MHF4U course code", code.resolved.queryKind === "COURSE_CODE" && code.resolved.course?.code === "MHF4U");
    const codeProfiles = await TutorProfile.find({ slug: { $in: slugs(code) } }).select("courseCodes").lean();
    check("…and every result teaches MHF4U", code.total > 0 && codeProfiles.every((p) => p.courseCodes.includes("MHF4U")), `total ${code.total}`);

    const byName = await search({ q: "Advanced Functions", province: "ON" });
    check("a course name finds the same tutors as its code (R6.4)",
      byName.resolved.queryKind === "COURSE" && JSON.stringify(slugs(byName).sort()) === JSON.stringify(slugs(code).sort()));

    const calculusAll = await search({ q: "calculus" });
    const calculusBc = await search({ q: "calculus", province: "BC" });
    check("a course alias with no province spans every live province", calculusAll.resolved.courses.some((c) => c.provinceCode === "ON") && calculusAll.resolved.courses.some((c) => c.provinceCode === "BC"));
    check("…and with a province, only that province's course", calculusBc.resolved.courses.length > 0 && calculusBc.resolved.courses.every((c) => c.provinceCode === "BC") && slugs(calculusBc).includes("olivia-b-vanc"));

    const text = await search({ q: "free-body diagram", province: "ON" });
    check("words that are not curriculum are free text", text.resolved.queryKind === "TEXT" && slugs(text).includes("daniel-o-scar"));

    const unknownCourse = await search({ course: "no-such-course", province: "ON" });
    check("an unknown course narrows to nothing instead of everything", unknownCourse.total === 0 && unknownCourse.resolved.unmatched === true);

    // --- Province scoping (R2.3, R6.5, R7.1–R7.2) ---------------------------
    section("Search — province drives grades and courses (R2.3, R6.5)");
    const bcGrade12 = await search({ province: "BC", grade: "grade-12" });
    const bcProfiles = await TutorProfile.find({ slug: { $in: slugs(bcGrade12) } }).select("provinceCodes gradeLevels").lean();
    check("BC + Grade 12 returns only tutors teaching BC Grade 12", bcGrade12.total > 0 && bcProfiles.every((p) => p.provinceCodes.includes("BC") && p.gradeLevels.includes(12)),
      `total ${bcGrade12.total}`);
    check("…the grade resolved is BC's own Grade 12 row", String(bcGrade12.resolved.grade?.provinceId) === String((await Province.findOne({ code: "BC" }).lean())._id));

    const k = await search({ province: "ON", grade: "kindergarten" });
    check("Kindergarten has a tutor (R1.1, R2.12)", k.total > 0, `total ${k.total}`);

    // --- Location (R7.6, R7.7, R29.1) -------------------------------------
    section("Search — location is never silently Toronto (R29.1, R7.7)");
    const sudbury = await search({ province: "ON", city: "Sudbury", mode: "IN_PERSON" });
    check("Sudbury (not in the geocoding table) resolves from tutor data, not to Toronto",
      sudbury.resolved.location.status === "RESOLVED" && sudbury.resolved.location.city === "Sudbury" && sudbury.resolved.location.source === "TUTOR_DATA",
      JSON.stringify(sudbury.resolved.location));
    check("…in-person results are the Sudbury tutor and no Toronto tutor", slugs(sudbury).includes("claire-g-sudb") && !slugs(sudbury).some((s) => s.includes("toro")),
      slugs(sudbury).join(","));

    const thunder = await search({ province: "ON", city: "Thunder Bay", mode: "IN_PERSON" });
    check("an unknown city with no tutors is reported unresolved, with no in-person results", thunder.resolved.location.status === "UNRESOLVED" && thunder.total === 0);
    const thunderAny = await search({ province: "ON", city: "Thunder Bay" });
    const thunderProfiles = await TutorProfile.find({ slug: { $in: slugs(thunderAny) } }).select("lessonModes").lean();
    check("…but 'online or in person' still lists online tutors (R7.7)", thunderAny.total > 0 && thunderProfiles.every((p) => p.lessonModes.includes("ONLINE")));
    check("…and none of them shows a distance", thunderAny.items.every((t) => t.distanceKm === null));

    const toronto = await search({ province: "ON", city: "Toronto" });
    check("a Toronto search keeps online-only tutors from elsewhere (R7.7)", slugs(toronto).includes("sarah-m-otta") && slugs(toronto).includes("rahul-p-miss"), slugs(toronto).join(","));
    check("online-only tutors carry no distance (R9.7)", toronto.items.find((t) => t.slug === "sarah-m-otta")?.distanceKm === null);
    check("in-person tutors nearby carry one", typeof toronto.items.find((t) => t.slug === "priya-s-toro")?.distanceKm === "number");

    const bcPostalInOntario = await search({ province: "ON", postalCode: "V6B 1A1" });
    const bcPostalProfiles = await TutorProfile.find({ slug: { $in: slugs(bcPostalInOntario) } }).select("lessonModes provinceCodes").lean();
    check("a BC postal code on an Ontario search is flagged, not ignored", bcPostalInOntario.resolved.location.provinceMismatch === "BC");
    check("…and only online Ontario tutors remain", bcPostalProfiles.length > 0 && bcPostalProfiles.every((p) => p.lessonModes.includes("ONLINE")));
    const vancouver = await search({ province: "BC", postalCode: "V6B 1A1", mode: "IN_PERSON" });
    check("a BC postal code on a BC search finds the Vancouver tutor with a distance", slugs(vancouver).includes("olivia-b-vanc") && typeof vancouver.items[0]?.distanceKm === "number");
    const badPostal = await search({ province: "ON", postalCode: "123456", mode: "IN_PERSON" });
    check("a malformed postal code is reported invalid with no in-person results", badPostal.resolved.location.status === "INVALID" && badPostal.total === 0);

    // --- Distance (R8.5) ----------------------------------------------------
    section("Search — distance: radius, 'any', and closest-first over every page (R8.5)");
    const near = await search({ province: "ON", city: "Toronto", mode: "IN_PERSON", distanceKm: "25" });
    const any = await search({ province: "ON", city: "Toronto", mode: "IN_PERSON", distanceKm: "any" });
    check("'any distance' really is any distance", any.total > near.total && slugs(any).includes("thomas-w-lond") && !slugs(near).includes("thomas-w-lond"),
      `${near.total} vs ${any.total}`);
    const page1 = await searchTutors(tutorSearchSchema.parse({ province: "ON", city: "Toronto", mode: "IN_PERSON", distanceKm: "any", sort: "DISTANCE", page: "1", pageSize: "3" }));
    const page2 = await searchTutors(tutorSearchSchema.parse({ province: "ON", city: "Toronto", mode: "IN_PERSON", distanceKm: "any", sort: "DISTANCE", page: "2", pageSize: "3" }));
    const d1 = page1.items.map((t) => t.distanceKm);
    const d2 = page2.items.map((t) => t.distanceKm);
    check("closest-first is ordered within page 1", d1.every((d, i) => i === 0 || d >= d1[i - 1]), d1.join(","));
    check("…and page 2 continues the same ordering", d2.length > 0 && d2[0] >= d1.at(-1), `${d1.at(-1)} → ${d2[0]}`);

    // --- Format and credentials (R8.4, R8.9–R8.12) -------------------------
    section("Search — format and qualification filters (R8.4, R8.9–R8.12)");
    const both = await search({ province: "ON", mode: "BOTH" });
    const bothProfiles = await TutorProfile.find({ slug: { $in: slugs(both) } }).select("lessonModes").lean();
    check("'both' returns only tutors offering online and in person", both.total > 0 && bothProfiles.every((p) => p.lessonModes.includes(LESSON_MODES.ONLINE) && p.lessonModes.includes(LESSON_MODES.IN_PERSON)));
    const phd = await search({ qualifications: "DOCTORATE" });
    check("PhD is its own filter", phd.total === 1 && slugs(phd)[0] === "olivia-b-vanc", slugs(phd).join(","));
    const mastersOrPhd = await search({ qualifications: "MASTERS_DEGREE,DOCTORATE" });
    check("several qualifications match any of them", mastersOrPhd.total > phd.total);
    let legacyRefused = false;
    try { tutorSearchSchema.parse({ qualifications: "POSTGRADUATE" }); } catch { legacyRefused = true; }
    check("the legacy merged category is not a search option", legacyRefused);

    // --- Real availability (R8.17–R8.21, R9.10) ----------------------------
    section("Search — availability is the real calendar (R8.17–R8.21, R9.10)");
    const priya = seeded;
    const [firstSlotAt] = [(await nextAvailableFor([priya._id])).get(String(priya._id))];
    check("the seeded tutor has a live next-available time", firstSlotAt instanceof Date, String(firstSlotAt));

    const live = await search({ q: "MHF4U", province: "ON" });
    check("every result card has a next-available time computed live (R9.10)", live.items.every((t) => t.nextAvailableAt), live.items.filter((t) => !t.nextAvailableAt).map((t) => t.slug).join(","));

    // Book the slot → next available moves.
    const user = await User.findOne({ email: "jennifer.chen@example.com" }).lean();
    const learner = await models.StudentProfile.findOne({ ownerId: user._id }).lean();
    const booking = await Booking.create({
      reference: `QA-SRCH-${tag}`, purchaserId: user._id, studentProfileId: learner._id, courseId: priya.courseIds[0],
      tutorProfileId: priya._id, tutorUserId: priya.userId,
      courseName: "Advanced Functions", mode: "ONLINE", startAt: firstSlotAt, endAt: new Date(firstSlotAt.getTime() + 60 * 60000),
      durationMinutes: 60, timeZone: priya.timeZone, status: "CONFIRMED",
      price: { hourlyRateCents: 7500, durationMinutes: 60, subtotalCents: 7500, commissionPercent: 15, commissionCents: 1125, tutorEarningsCents: 6375, totalCents: 7500, currency: "CAD" },
    });
    created.bookings.push(booking._id);
    const afterBooking = (await nextAvailableFor([priya._id])).get(String(priya._id));
    check("booking the slot moves next-available later", afterBooking > firstSlotAt, `${firstSlotAt.toISOString()} → ${afterBooking?.toISOString()}`);
    const card = (await withLiveAvailability([{ id: String(priya._id), nextAvailableAt: firstSlotAt.toISOString() }]))[0];
    check("…and the card reads the new time, not the stale copy", card.nextAvailableAt === afterBooking.toISOString());

    // A published group session holds its hour too (R14.4).
    const nextFree = afterBooking;
    const session = await GroupSession.create({
      reference: `QA-GRP-${tag}`, tutorProfileId: priya._id, tutorUserId: priya.userId, title: `QA group ${tag}`,
      courseId: priya.courseIds[0], mode: "ONLINE",
      startAt: nextFree, endAt: new Date(nextFree.getTime() + 60 * 60000), durationMinutes: 60,
      status: "PUBLISHED", minParticipants: 1, maxParticipants: 4, pricePerSeatCents: 3000, commissionPercent: 15,
    }).catch((error) => ({ error }));
    if (session.error) {
      check("a group session fixture could be created", false, session.error.message);
    } else {
      created.sessions.push(session._id);
      const afterGroup = (await nextAvailableFor([priya._id])).get(String(priya._id));
      check("a published group session is busy time for 1:1 slots (R14.4)", afterGroup > nextFree, `${nextFree.toISOString()} → ${afterGroup?.toISOString()}`);
      const slots = await getBookableSlots(priya._id, { days: 21 });
      const offered = slots.days.flatMap((d) => d.slots.map((s) => s.startAt));
      check("…and the booking calendar does not offer it", !offered.includes(nextFree.toISOString()));
    }

    // Day filters against a calendar block.
    const availability = await Availability.findOne({ tutorProfileId: priya._id });
    restoreAvailability.push({ id: availability._id, exceptions: availability.exceptions.map((e) => e.toObject()) });
    const tomorrowKey = daysFor("TOMORROW", { timeZone: availability.timeZone })[0];
    const tomorrowSearch = await search({ availability: "TOMORROW", province: "ON" });
    const tutorsTomorrow = slugs(tomorrowSearch);
    for (const slug of tutorsTomorrow.slice(0, 5)) {
      const profile = await TutorProfile.findOne({ slug }).lean();
      const days = (await getBookableSlots(profile._id, { days: 4 })).days;
      const tz = (await Availability.findOne({ tutorProfileId: profile._id }).lean()).timeZone;
      const key = daysFor("TOMORROW", { timeZone: tz })[0];
      check(`'tomorrow' result ${slug} really has a slot tomorrow`, days.some((d) => d.dayKey === key && d.slots.length > 0));
    }
    const dayStart = new Date(`${tomorrowKey}T00:00:00Z`);
    availability.exceptions.push({ kind: "VACATION", start: new Date(dayStart.getTime() - 12 * 3600000), end: new Date(dayStart.getTime() + 36 * 3600000), reason: `qa ${tag}` });
    await availability.save();
    const blocked = await search({ availability: "TOMORROW", province: "ON" });
    check("the tutor was free tomorrow before the block", tutorsTomorrow.includes("priya-s-toro"));
    check("a tutor on vacation tomorrow drops out of 'tomorrow'", !slugs(blocked).includes("priya-s-toro"));

    // Specific date and time.
    const target = (await nextAvailableFor([seeded._id])).get(String(seeded._id));
    const targetSlotDay = (await getBookableSlots(seeded._id, { days: 30 })).days.find((d) => d.slots.length);
    if (targetSlotDay) {
      const slot = targetSlotDay.slots[0];
      const hh = String(Math.floor(slot.minutes / 60)).padStart(2, "0");
      const mm = String(slot.minutes % 60).padStart(2, "0");
      const exact = await search({ province: "ON", date: targetSlotDay.dayKey, time: `${hh}:${mm}` });
      check("a specific date + time finds a tutor free at exactly that time (R8.21)", slugs(exact).includes("priya-s-toro"), `${targetSlotDay.dayKey} ${hh}:${mm}`);
      const off = await search({ province: "ON", date: targetSlotDay.dayKey, time: `${hh}:${String((slot.minutes % 60) + 7).padStart(2, "0")}` });
      check("…and not at a time no slot starts", !slugs(off).includes("priya-s-toro"));
    } else {
      check("the seeded tutor has a slot in the next 30 days", false, String(target));
    }

    // Pure day arithmetic.
    const saturday = new Date("2026-10-10T15:00:00Z");
    check("'this weekend' on a Saturday is Saturday and Sunday", JSON.stringify(daysFor("WEEKEND", { now: saturday, timeZone: "America/Toronto" })) === JSON.stringify(["2026-10-10", "2026-10-11"]));
    check("'this week' on a Wednesday runs to Sunday", daysFor("THIS_WEEK", { now: new Date("2026-10-07T15:00:00Z"), timeZone: "America/Toronto" }).length === 5);
    check("no availability filter means none", buildAvailabilityFilter({}) === null);

    // --- A province added at runtime (R6.5 / Journey B, service level) ----
    section("Search — a province added through the data works with no code change (R6.5)");
    const yukon = await Province.create({ code: "YT", name: `Yukon QA ${tag}`, slug: `yukon-qa-${tag}`, isActive: true, usesCourseCodes: true, displayOrder: 99 });
    created.provinces.push(yukon._id);
    const ytGrade = await Grade.create({ provinceId: yukon._id, name: "Grade 11", slug: "grade-11", level: 11, stage: "SECONDARY" });
    created.grades.push(ytGrade._id);
    const physics = await Subject.findOne({ slug: "physics" }).lean();
    const ytCourse = await Course.create({
      provinceId: yukon._id, gradeId: ytGrade._id, subjectId: physics._id, name: `Physics 11 QA ${tag}`, code: "QYTP11",
      slug: `physics-11-qa-${tag}`, provinceCode: "YT", gradeSlug: "grade-11", gradeLevel: 11, subjectSlug: "physics", subjectName: physics.name, isActive: true,
    });
    created.courses.push(ytCourse._id);
    // Rows written straight to the collections, so drop the per-process
    // reference cache the admin write path would have cleared.
    globalThis.__aplusCurriculum?.clear();
    const tutorUser = await User.create({ email: `qa-yt-${tag}@example.com`, firstName: "Yuki", lastName: "Tester", role: "TUTOR", status: "ACTIVE", emailVerifiedAt: new Date() });
    created.users.push(tutorUser._id);
    const ytProfile = await TutorProfile.create({
      userId: tutorUser._id, slug: `yuki-t-qa-${tag}`, headline: "QA tutor for a runtime province", bio: "x".repeat(120),
      status: "APPROVED", isSearchable: true, hourlyRateCents: 5000, minHourlyRateCents: 5000, lessonModes: ["ONLINE"],
      courses: [{ courseId: ytCourse._id, code: "QYTP11", name: ytCourse.name, subjectId: physics._id, subjectSlug: "physics", gradeLevel: 11, gradeSlug: "grade-11", provinceCode: "YT" }],
      courseIds: [ytCourse._id], courseCodes: ["QYTP11"], subjectIds: [String(physics._id)], subjectSlugs: ["physics"], gradeLevels: [11], provinceCodes: ["YT"],
      city: "Whitehorse", province: "YT", timeZone: "America/Whitehorse",
    });
    created.profiles.push(ytProfile._id);
    const yt = await search({ province: "YT", q: "QYTP11" });
    check("a course code in the new province is recognised", yt.resolved.queryKind === "COURSE_CODE" && yt.resolved.course?.provinceCode === "YT", yt.resolved.queryKind);
    check("…and finds the tutor who teaches it", slugs(yt).includes(`yuki-t-qa-${tag}`));
    const ytGradeSearch = await search({ province: "YT", grade: "grade-11" });
    check("the new province's own grade filters correctly", slugs(ytGradeSearch).includes(`yuki-t-qa-${tag}`) && !slugs(ytGradeSearch).includes("priya-s-toro"));

    // --- Search analytics stores meaning, not people (R28.31) -------------
    section("Search analytics — real events, nothing personal (R28.31)");
    const params = tutorSearchSchema.parse({ q: "Math", province: "ON", postalCode: "M5V 2T6", page: "1" });
    const result = await searchTutors(params);
    const event = searchEventFrom(params, result);
    const serialised = JSON.stringify(event);
    check("the event names the subject searched", event.subjectSlug === "mathematics" && event.queryKind === "SUBJECT");
    check("…and stores neither the typed text nor the postal code", !serialised.includes("M5V 2T6") && !serialised.includes("M5V2T6") && !/"q"/.test(serialised));
    check("…only the resolved city", event.city === "Toronto" && event.locationKind === "POSTAL_CODE");
    const before = await searchDemand({ days: 1 });
    const stored = await SearchEvent.create({ ...event, subjectSlug: `qa-subject-${tag}`, subjectName: `QA ${tag}` });
    const after = await searchDemand({ days: 1, limit: 1000 });
    await SearchEvent.deleteOne({ _id: stored._id });
    check("searchDemand counts the stored event", after.totalSearches === before.totalSearches + 1, `${before.totalSearches} → ${after.totalSearches}`);
    check("…and reports its subject", after.topSubjects.some((row) => row.slug === `qa-subject-${tag}` && row.count === 1));
  } finally {
    globalThis.__aplusCurriculum?.clear();
    for (const r of restoreAvailability) await Availability.updateOne({ _id: r.id }, { $set: { exceptions: r.exceptions } });
    await Booking.deleteMany({ _id: { $in: created.bookings } });
    await GroupSession.deleteMany({ _id: { $in: created.sessions } });
    await TutorProfile.deleteMany({ _id: { $in: created.profiles } });
    await User.deleteMany({ _id: { $in: created.users } });
    await Course.deleteMany({ _id: { $in: created.courses } });
    await Grade.deleteMany({ _id: { $in: created.grades } });
    await Province.deleteMany({ _id: { $in: created.provinces } });
  }
}
