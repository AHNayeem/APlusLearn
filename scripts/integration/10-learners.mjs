/**
 * Learners, registration and minor privacy (R3.2, R3.4, R4.6–R4.11, R5.x,
 * R5.12, R23.5, R30.7, S5, S6, S7).
 *
 * Every rule here is asserted against the service that owns it, with
 * fixture rows this suite creates and removes itself.
 */
export default async function learnerSuite({ section, check, skip, throws, connectForSuite, mongoose, randomUUID }) {
  section("Learner profiles — fields, isolation and the curriculum they name (R5)");

  if (!(await connectForSuite())) return skip("learner profiles", "MongoDB is not reachable");

  const { User, StudentProfile, Province, Grade, Course, Subject, Booking, TutorProfile, AuthToken, AUTH_TOKEN_PURPOSE } =
    await import("@/models");
  const { createStudent, updateStudent, listStudents, getStudent, listTutorRoster } = await import(
    "@/services/student.service"
  );
  const { registerSchema } = await import("@/lib/validation/auth");
  const { updateStudentProfileSchema } = await import("@/lib/validation/users");
  const { verifyEmail } = await import("@/services/auth.service");
  const { hashToken } = await import("@/lib/auth/tokens");
  const { listBookings, getBooking } = await import("@/services/booking.service");
  const { BOOKING_STATUS, USER_STATUS } = await import("@/constants");
  const { isMinorByBirthYear, latestStudentBirthYear } = await import("@/lib/utils/age");

  const ontario = await Province.findOne({ code: "ON" }).lean();
  const otherProvince = await Province.findOne({ code: { $ne: "ON" } }).lean();
  const ontarioGrade = ontario && (await Grade.findOne({ provinceId: ontario._id, slug: "grade-12" }).lean());
  const ontarioCourse = ontario && (await Course.findOne({ provinceId: ontario._id, code: "MHF4U" }).lean());
  const otherCourse = ontario && (await Course.findOne({ provinceId: ontario._id, code: "ENG4U" }).lean());
  const math = await Subject.findOne({ slug: "mathematics" }).lean();
  if (!ontario || !ontarioGrade || !ontarioCourse || !otherCourse || !math || !otherProvince) {
    return skip("learner profiles", "seeded curriculum missing — run `bun run seed`");
  }

  const created = { users: [], students: [], bookings: [], grades: [] };
  const tag = randomUUID().slice(0, 8);
  const makeUser = async (role, extra = {}) => {
    const user = await User.create({
      email: `qa-learner-${tag}-${created.users.length}@example.com`,
      firstName: "Qa",
      lastName: "Parent",
      role,
      status: USER_STATUS.ACTIVE,
      emailVerifiedAt: new Date(),
      ...extra,
    });
    created.users.push(user._id);
    return { id: String(user._id), role, firstName: user.firstName };
  };

  try {
    const parentA = await makeUser("PARENT");
    const parentB = await makeUser("PARENT");

    // A grade belonging to another province, to prove it cannot be mixed in.
    const foreignGrade = await Grade.create({
      provinceId: otherProvince._id,
      name: `QA Grade ${tag}`,
      slug: `qa-grade-${tag}`,
      level: 12,
      stage: "SECONDARY",
    });
    created.grades.push(foreignGrade._id);

    const childA = await createStudent(
      {
        firstName: "Ava",
        lastName: "Thompson",
        birthYear: new Date().getFullYear() - 16,
        provinceCode: "ON",
        gradeId: String(ontarioGrade._id),
        currentCourses: [String(ontarioCourse._id)],
        subjectsOfInterest: [String(math._id)],
        lessonModePreference: "ONLINE",
        currentMark: 72,
        targetMark: 85,
        learningGoals: [{ label: "Reach 85% in Advanced Functions", achieved: false }],
        areasForImprovement: "Multi-step problems",
        learningPreferences: "Visual examples first",
        notes: "Exams in January",
        shareFullNameWithTutor: false,
      },
      parentA,
    );
    created.students.push(childA.id);

    check("every §5 field is stored", childA.provinceCode === "ON" &&
      String(childA.gradeId) === String(ontarioGrade._id) &&
      childA.currentCourses.length === 1 && childA.subjectsOfInterest.length === 1 &&
      childA.lessonModePreference === "ONLINE" && childA.currentMark === 72 && childA.targetMark === 85 &&
      childA.learningGoals.length === 1 && childA.areasForImprovement === "Multi-step problems" &&
      childA.learningPreferences === "Visual examples first", JSON.stringify(childA));
    check("grade name and level are derived from the grade, not supplied", childA.gradeName === ontarioGrade.name && childA.gradeLevel === 12);
    check("a 16-year-old is a minor", childA.isMinor === true);

    const childB = await createStudent(
      { firstName: "Ben", provinceCode: "ON", currentCourses: [String(otherCourse._id)], lessonModePreference: "IN_PERSON" },
      parentA,
    );
    created.students.push(childB.id);

    const listed = await listStudents(parentA);
    const a = listed.find((s) => s.id === childA.id);
    const b = listed.find((s) => s.id === childB.id);
    check("each child keeps their own courses", a.currentCourses.map((c) => c.code).join() === "MHF4U" &&
      b.currentCourses.map((c) => c.code).join() === "ENG4U");
    check("and their own preferences and goals", a.lessonModePreference === "ONLINE" && b.lessonModePreference === "IN_PERSON" &&
      b.learningGoals.length === 0 && b.currentMark === undefined);
    check("course names are resolved for display", a.currentCourses[0]?.name === ontarioCourse.name);

    const otherFamily = await throws(() => getStudent(childA.id, parentB));
    check("another family cannot read the child", otherFamily.threw && otherFamily.error.status === 403);
    const otherEdit = await throws(() => updateStudent(childA.id, { notes: "x" }, parentB));
    check("or edit them", otherEdit.threw && otherEdit.error.status === 403);
    check("and does not see them in their list", (await listStudents(parentB)).every((s) => s.id !== childA.id));

    // PATCH semantics: naming one field must not reset the others (R5.5).
    const patched = await updateStudent(childA.id, updateStudentProfileSchema.parse({ school: "Northern SS" }), parentA);
    check("a one-field PATCH keeps the course list", patched.currentCourses.length === 1, JSON.stringify(patched.currentCourses));
    check("and the subjects, goals and name-sharing choice", patched.subjectsOfInterest.length === 1 &&
      patched.learningGoals.length === 1 && patched.shareFullNameWithTutor === false);

    const cleared = await updateStudent(childA.id, updateStudentProfileSchema.parse({ school: null, currentMark: null }), parentA);
    check("null clears an optional field", cleared.school === undefined && cleared.currentMark === undefined, JSON.stringify({ school: cleared.school, mark: cleared.currentMark }));
    check("without touching the rest", cleared.targetMark === 85);

    const goals = await updateStudent(
      childA.id,
      { learningGoals: [{ label: "Reach 85% in Advanced Functions", achieved: true }, { label: "Finish summative" }] },
      parentA,
    );
    check("goals can be added and ticked off", goals.learningGoals.length === 2 && Boolean(goals.learningGoals[0].achievedAt) && !goals.learningGoals[1].achievedAt);

    const wrongGrade = await throws(() => updateStudent(childA.id, { gradeId: String(foreignGrade._id) }, parentA));
    check("a grade from another province is refused", wrongGrade.threw && wrongGrade.error.code === "GRADE_PROVINCE_MISMATCH");
    check("with a field error the form can show", Boolean(wrongGrade.error?.details?.fieldErrors?.gradeId));

    const wrongCourse = await throws(() =>
      updateStudent(childA.id, { provinceCode: otherProvince.code, gradeId: null, currentCourses: [String(ontarioCourse._id)] }, parentA),
    );
    check("a course from another province is refused", wrongCourse.threw && wrongCourse.error.code === "COURSE_PROVINCE_MISMATCH",
      wrongCourse.error?.code);
    const strandedGrade = await throws(() => updateStudent(childA.id, { provinceCode: otherProvince.code }, parentA));
    check("moving province without re-choosing the grade is refused, not silently mixed",
      strandedGrade.threw && strandedGrade.error.code === "GRADE_PROVINCE_MISMATCH");
    const fake = await throws(() =>
      createStudent({ firstName: "X", provinceCode: "ON", currentCourses: [String(new mongoose.Types.ObjectId())] }, parentA),
    );
    check("a course that does not exist is refused", fake.threw && fake.error.code === "COURSE_PROVINCE_MISMATCH");
    const studentCannotAdd = await throws(() => createStudent({ firstName: "X" }, { id: parentA.id, role: "STUDENT" }));
    check("only a parent account can add a child", studentCannotAdd.threw && studentCannotAdd.error.status === 403);

    section("Registration — §4 fields and the age a student gives (R4.6–R4.10, S6)");

    const base = {
      role: "PARENT", firstName: "Qa", lastName: "Reg", email: `qa-reg-${tag}@example.com`,
      password: "AplusLearn2024!", confirmPassword: "AplusLearn2024!", acceptTerms: true,
      phone: "416-555-0123", provinceCode: "ON", city: "Toronto", postalCode: "M5V 2T6",
    };
    check("a complete registration validates", registerSchema.safeParse(base).success);
    for (const field of ["phone", "provinceCode", "city", "postalCode"]) {
      const { [field]: _omit, ...rest } = base;
      check(`registration without ${field} is refused`, !registerSchema.safeParse(rest).success);
    }
    check("a postal code from another province is refused",
      !registerSchema.safeParse({ ...base, postalCode: "V6B 1A1" }).success);
    check("Nunavut and the NWT share the X prefix",
      registerSchema.safeParse({ ...base, provinceCode: "NU", postalCode: "X0A 0H0" }).success &&
        registerSchema.safeParse({ ...base, provinceCode: "NT", postalCode: "X1A 2P8" }).success);
    check("a student must give a birth year",
      !registerSchema.safeParse({ ...base, role: "STUDENT" }).success);
    check("a student under the minimum age is sent to a parent",
      !registerSchema.safeParse({ ...base, role: "STUDENT", birthYear: new Date().getFullYear() - 8 }).success);
    check("a student at the minimum age may register",
      registerSchema.safeParse({ ...base, role: "STUDENT", birthYear: latestStudentBirthYear() }).success);
    const year = new Date().getFullYear();
    check("someone who may still be 17 is treated as a minor", isMinorByBirthYear(year - 18) === true);
    check("someone certainly 18 is an adult", isMinorByBirthYear(year - 19) === false);
    check("an unknown age is treated as a minor", isMinorByBirthYear(undefined) === true);

    section("Email verification cannot lift a suspension (S7)");

    const suspended = await User.create({
      email: `qa-suspended-${tag}@example.com`, firstName: "Qa", lastName: "Suspended",
      role: "PARENT", status: USER_STATUS.SUSPENDED,
    });
    created.users.push(suspended._id);
    const raw = `qa-${randomUUID()}`;
    await AuthToken.create({
      userId: suspended._id, purpose: AUTH_TOKEN_PURPOSE.EMAIL_VERIFICATION,
      tokenHash: hashToken(raw), expiresAt: new Date(Date.now() + 60_000),
    });
    await verifyEmail(raw);
    const after = await User.findById(suspended._id).lean();
    check("the address is marked verified", Boolean(after.emailVerifiedAt));
    check("but the account stays suspended", after.status === USER_STATUS.SUSPENDED, after.status);

    const pending = await User.create({
      email: `qa-pending-${tag}@example.com`, firstName: "Qa", lastName: "Pending",
      role: "PARENT", status: USER_STATUS.PENDING_VERIFICATION,
    });
    created.users.push(pending._id);
    const raw2 = `qa-${randomUUID()}`;
    await AuthToken.create({
      userId: pending._id, purpose: AUTH_TOKEN_PURPOSE.EMAIL_VERIFICATION,
      tokenHash: hashToken(raw2), expiresAt: new Date(Date.now() + 60_000),
    });
    await verifyEmail(raw2);
    check("a pending account is still activated by verifying",
      (await User.findById(pending._id).lean()).status === USER_STATUS.ACTIVE);
    await AuthToken.deleteMany({ userId: { $in: [suspended._id, pending._id] } });

    section("Tutor roster and minor privacy — server-side (R23.5, R5.12, S5)");

    const tutor = await TutorProfile.findOne({ isSearchable: true }).lean();
    if (!tutor) return skip("tutor roster", "no seeded tutor");
    const tutorActor = { id: String(tutor.userId), role: "TUTOR" };

    const lesson = (status, startOffsetDays, extra = {}) => ({
      reference: `APL-L${randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase()}`,
      purchaserId: new mongoose.Types.ObjectId(parentA.id),
      studentProfileId: new mongoose.Types.ObjectId(childA.id),
      tutorProfileId: tutor._id,
      tutorUserId: tutor.userId,
      courseId: ontarioCourse._id,
      courseName: ontarioCourse.name,
      courseCode: ontarioCourse.code,
      mode: "ONLINE",
      meetingProvider: "GOOGLE_MEET",
      startAt: new Date(Date.now() + startOffsetDays * 86_400_000),
      endAt: new Date(Date.now() + startOffsetDays * 86_400_000 + 3_600_000),
      durationMinutes: 60,
      status,
      price: {
        hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000, commissionPercent: 15,
        commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
      },
      ...extra,
    });

    // Only an abandoned checkout: not a student relationship.
    const abandoned = await Booking.create(lesson(BOOKING_STATUS.EXPIRED, 400));
    created.bookings.push(abandoned._id);
    let roster = await listTutorRoster(tutorActor);
    check("an abandoned checkout does not put a learner on the roster", roster.every((r) => r.id !== childA.id));

    const done = await Booking.create(lesson(BOOKING_STATUS.COMPLETED, -400, { completedAt: new Date() }));
    const refunded = await Booking.create(lesson(BOOKING_STATUS.COMPLETED, -401, { completedAt: new Date(), refundedCents: 3000 }));
    const cancelled = await Booking.create(lesson(BOOKING_STATUS.CANCELLED_BY_STUDENT, -402));
    created.bookings.push(done._id, refunded._id, cancelled._id);

    roster = await listTutorRoster(tutorActor);
    const entry = roster.find((r) => r.id === childA.id);
    check("a completed lesson does", Boolean(entry));
    check("earnings are completed lessons net of refunds", entry?.earningsCents === 5100 + 2550, String(entry?.earningsCents));
    check("a minor's surname is an initial in the roster", entry?.lastName === "T." && !JSON.stringify(entry).includes("Thompson"));
    check("the family's learning details reach a tutor who taught them", entry?.learning?.courses?.includes("MHF4U") &&
      entry?.learning?.targetMark === 85);

    const tutorList = await listBookings(tutorActor, { page: 1, studentProfileId: childA.id });
    check("a tutor's booking list never carries the minor's surname",
      tutorList.items.length > 0 && !JSON.stringify(tutorList.items).includes("Thompson"));
    const tutorView = await getBooking(String(done._id), tutorActor);
    check("nor does a single booking", !JSON.stringify(tutorView).includes("Thompson") && tutorView.studentProfileId?.lastName === "T.");
    const parentView = await getBooking(String(done._id), parentA);
    check("the family still sees the full name", parentView.studentProfileId?.lastName === "Thompson");
    check("and nobody receives the tutor's email or phone in the booking",
      !("email" in (parentView.tutorProfileId?.userId ?? {})) && !("phone" in (parentView.tutorProfileId?.userId ?? {})));

    await StudentProfile.updateOne({ _id: childA.id }, { $set: { shareFullNameWithTutor: true } });
    const optedIn = await getBooking(String(done._id), tutorActor);
    check("once the family opts in, the tutor sees the full name", optedIn.studentProfileId?.lastName === "Thompson");
  } finally {
    await Booking.deleteMany({ _id: { $in: created.bookings } });
    await StudentProfile.deleteMany({ _id: { $in: created.students } });
    await Grade.deleteMany({ _id: { $in: created.grades } });
    await User.deleteMany({ _id: { $in: created.users } });
  }
}
