/**
 * Tutor onboarding end to end, through the services the wizard and the
 * admin review call (R13.2, R13.5, R13.6, R13.11, R13.13, R11.1, R11.5,
 * R28.2, R28.8, R29.1, S9).
 *
 * A fresh applicant registers nothing but a User row; every step is saved
 * through `saveOnboardingStep` after the same Zod parse the route applies.
 */
export default async function onboardingSuite({ section, check, skip, throws, connectForSuite, fakePdf, randomUUID }) {
  section("Onboarding — a first-time applicant, step by step");
  if (!(await connectForSuite())) return skip("onboarding", "MongoDB is not reachable");

  const models = await import("@/models");
  const { User, TutorProfile, TutorApplication, VerificationRecord, VerificationDocument, Course, Availability } = models;
  const tutors = await import("@/services/tutor.service");
  const verification = await import("@/services/verification.service");
  const { onboardingStepSchemas } = await import("@/lib/validation/tutors");
  const { ONBOARDING_STEPS, USER_STATUS, VERIFICATION_TYPES } = await import("@/constants");

  const bcCourse = await Course.findOne({ provinceCode: "BC", code: "MPREC12" }).lean();
  if (!bcCourse) return skip("onboarding", "seeded BC curriculum missing");

  const tag = randomUUID().slice(0, 8);
  const userIds = [];
  const admin = { id: null, role: "ADMIN" };

  const save = async (userId, step, data) => {
    const parsed = onboardingStepSchemas[step].parse(data);
    return tutors.saveOnboardingStep(String(userId), { step, data: parsed });
  };

  const applicant = async (suffix, { city, postalCode, province = "BC" }) => {
    const user = await User.create({
      email: `qa-onb-${suffix}-${tag}@example.com`, firstName: "Ola", lastName: `Applicant${suffix}`,
      role: "TUTOR", status: USER_STATUS.ACTIVE, emailVerifiedAt: new Date(), province, city, phone: "6045550199",
      // Submission requires the photo families will see (R13.2).
      avatarUrl: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4",
    });
    userIds.push(user._id);
    await tutors.getOrCreateApplication(String(user._id));
    await save(user._id, "PERSONAL", { firstName: "Ola", lastName: `Applicant${suffix}`, phone: "604-555-0199", timeZone: "America/Vancouver", province, city });
    await save(user._id, "PROFILE", { headline: "BC Pre-calculus tutor who explains why", bio: "I teach senior mathematics and love it. ".repeat(5), languages: ["English"] });
    await save(user._id, "EDUCATION", { education: [{ institution: "University of British Columbia", credential: "BSc", fieldOfStudy: "Mathematics", startYear: 2014, endYear: 2018 }] });
    await save(user._id, "QUALIFICATIONS", { qualifications: ["BACHELORS_DEGREE"], otherCredentials: ["BC Teacher Certificate"], yearsExperience: 5, experience: [] });
    return user;
  };

  try {
    const user = await applicant("a", { city: "Vancouver", postalCode: "V6B 1A1" });

    // R13.11 — the document goes up before any profile exists.
    check("the applicant has no tutor profile yet", !(await TutorProfile.exists({ userId: user._id })));
    const file = new File([fakePdf(2048)], "id.pdf", { type: "application/pdf" });
    const uploaded = await verification.uploadVerificationDocument({ type: VERIFICATION_TYPES.IDENTITY, file }, { id: String(user._id), role: "TUTOR" });
    const draftRecord = await VerificationRecord.findOne({ userId: user._id, type: VERIFICATION_TYPES.IDENTITY }).lean();
    const draftDocs = await VerificationDocument.find({ verificationRecordId: draftRecord?._id }).lean();
    check("a first-time applicant can upload an identity document (R13.11)", Boolean(uploaded) && draftDocs.length === 1, String(draftDocs.length));
    check("…held out of the review queue until the application is submitted", draftRecord.status === "NOT_SUBMITTED");

    // R13.6 — a course from another province, by id from the curriculum.
    const bogus = await throws(() => save(user._id, "COURSES", { courses: [{ courseId: "0123456789abcdef01234567", hourlyRateCents: 6000 }] }));
    check("a course id that does not exist is refused", bogus.threw, bogus.error?.message);
    await save(user._id, "COURSES", { courses: [{ courseId: String(bcCourse._id), hourlyRateCents: 6500, yearsTeaching: 3 }] });
    await save(user._id, "LESSON_TYPE", { lessonModes: ["ONLINE", "IN_PERSON"], onlineMeetingProviders: ["ZOOM"], inPersonLocationTypes: ["LIBRARY"] });
    await save(user._id, "LOCATION", { city: "Vancouver", province: "BC", postalCode: "V6B 1A1", travelRadiusKm: 15 });
    await save(user._id, "PRICING", { hourlyRateCents: 6500, offersFreeIntro: false, acceptingNewStudents: true });
    await save(user._id, "AVAILABILITY", { weeklyRules: [{ weekday: 2, startMinutes: 960, endMinutes: 1200 }] });
    await save(user._id, "DOCUMENTS", { requestedBadges: [VERIFICATION_TYPES.IDENTITY] });
    const app = await TutorApplication.findOne({ userId: user._id }).lean();
    const missing = ONBOARDING_STEPS.filter((s) => s !== "REVIEW" && !app.completedSteps.includes(s));
    check("every wizard step is saved", missing.length === 0, missing.join(","));

    await tutors.submitApplication(String(user._id));
    const profile = await TutorProfile.findOne({ userId: user._id }).lean();
    const submittedRecord = await VerificationRecord.findOne({ _id: draftRecord._id }).lean();
    check("submission creates the profile on the reserved id, keeping the document", profile && String(profile._id) === String(app.tutorProfileId) && String(submittedRecord.tutorProfileId) === String(profile._id));
    check("…and puts the document in the review queue", submittedRecord.status === "PENDING", submittedRecord.status);
    check("the BC course lands on the profile as BC curriculum", profile.provinceCodes.length === 1 && profile.provinceCodes[0] === "BC" && profile.courseCodes.includes("MPREC12"));
    check("other credentials are kept (R13.5)", profile.otherCredentials?.includes("BC Teacher Certificate"));
    check("the applicant is not searchable before approval (R13.13)", profile.isSearchable === false);
    check("a known postal code gives an approximate location", Array.isArray(profile.location?.coordinates));

    const review = await tutors.getApplicationForReview(String(app._id));
    check("the reviewer sees the uploaded document (R28.5)", review.verification.some((r) => r.type === "IDENTITY" && r.documents?.length === 1));

    // R11.1 — identity is required to approve.
    const adminUser = await User.create({ email: `qa-onb-admin-${tag}@example.com`, firstName: "Ada", lastName: "Admin", role: "ADMIN", status: "ACTIVE", emailVerifiedAt: new Date() });
    userIds.push(adminUser._id);
    admin.id = String(adminUser._id);
    const noId = await throws(() => tutors.reviewApplication(String(app._id), { decision: "APPROVED", grantBadges: [] }, admin));
    check("approval without an approved identity check is refused (R11.1)", noId.threw && noId.error?.code === "IDENTITY_REQUIRED", noId.error?.code);
    await tutors.reviewApplication(String(app._id), { decision: "APPROVED", grantBadges: [VERIFICATION_TYPES.IDENTITY, VERIFICATION_TYPES.BACKGROUND_CHECK] }, admin);
    const approved = await TutorProfile.findById(profile._id).lean();
    check("approval with the identity badge makes the tutor searchable", approved.isSearchable === true && approved.verifiedTypes.includes("IDENTITY"));
    const bg = (approved.verificationBadges ?? []).find((b) => b.type === "BACKGROUND_CHECK");
    check("a background-check badge always gets an expiry (R11.5)", bg?.expiresAt instanceof Date && bg.expiresAt > new Date(), String(bg?.expiresAt));

    // R13.13 / R28.2 — account status governs search.
    await User.updateOne({ _id: user._id }, { $set: { status: USER_STATUS.SUSPENDED } });
    await tutors.syncSearchableForUser(String(user._id));
    check("a suspended tutor leaves search", (await TutorProfile.findById(profile._id).lean()).isSearchable === false);
    await User.updateOne({ _id: user._id }, { $set: { status: USER_STATUS.ACTIVE } });
    await tutors.syncSearchableForUser(String(user._id));
    check("reinstating re-derives search visibility", (await TutorProfile.findById(profile._id).lean()).isSearchable === true);

    // R28.8 — remove and restore to search.
    await tutors.setTutorSearchable(String(profile._id), false, admin, "Quality review in progress");
    check("an administrator can remove a tutor from search", (await TutorProfile.findById(profile._id).lean()).isSearchable === false);
    await tutors.setTutorSearchable(String(profile._id), true, admin);
    check("…and restore them (R28.8)", (await TutorProfile.findById(profile._id).lean()).isSearchable === true);

    // R13.9 — the minimum rate holds on later edits too.
    const tooCheap = await throws(() => tutors.updateTutorProfile(String(user._id), { hourlyRateCents: 100 }));
    check("a profile edit below the minimum rate is refused (R13.9)", tooCheap.threw);

    // R29.1 — an address that does not geocode gives no location at all.
    const unknown = await applicant("b", { city: "Nowhereville" });
    await save(unknown._id, "COURSES", { courses: [{ courseId: String(bcCourse._id), hourlyRateCents: 6000 }] });
    await save(unknown._id, "LESSON_TYPE", { lessonModes: ["ONLINE"], onlineMeetingProviders: ["ZOOM"] });
    await save(unknown._id, "LOCATION", { city: "Nowhereville", province: "BC", postalCode: "V0N 9Z9", travelRadiusKm: 10 });
    await save(unknown._id, "PRICING", { hourlyRateCents: 6000 });
    await save(unknown._id, "AVAILABILITY", { weeklyRules: [{ weekday: 3, startMinutes: 960, endMinutes: 1200 }] });
    await save(unknown._id, "DOCUMENTS", { requestedBadges: [VERIFICATION_TYPES.IDENTITY] });
    await tutors.submitApplication(String(unknown._id));
    const nowhere = await TutorProfile.findOne({ userId: unknown._id }).lean();
    check("a place that does not geocode is stored with no location — never Toronto (R29.1)", nowhere && !nowhere.location?.coordinates, JSON.stringify(nowhere?.location));

    // S9 — documents can be discarded with the account.
    await verification.discardVerificationDocuments({ userId: String(user._id), actor: admin });
    const discarded = await VerificationRecord.findOne({ _id: draftRecord._id }).lean();
    const discardedDocs = await VerificationDocument.find({ verificationRecordId: draftRecord._id }).select("+storageKey").lean();
    check("discarding an account's documents removes the files and keeps the decision",
      Boolean(discarded.documentsDiscardedAt) && discardedDocs.every((d) => d.discardedAt && !d.storageKey),
      JSON.stringify(discardedDocs.map((d) => ({ at: d.discardedAt, key: Boolean(d.storageKey) }))));
  } finally {
    const profiles = await TutorProfile.find({ userId: { $in: userIds } }).select("_id").lean();
    const records = await VerificationRecord.find({ userId: { $in: userIds } }).select("_id").lean();
    await VerificationDocument.deleteMany({ verificationRecordId: { $in: records.map((r) => r._id) } });
    await VerificationRecord.deleteMany({ userId: { $in: userIds } });
    await Availability.deleteMany({ tutorProfileId: { $in: profiles.map((p) => p._id) } });
    await TutorProfile.deleteMany({ userId: { $in: userIds } });
    await TutorApplication.deleteMany({ userId: { $in: userIds } });
    await User.deleteMany({ _id: { $in: userIds } });
  }
}
