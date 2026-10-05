/**
 * Tutor requests and reviews (R18.9, R18.10, R18.11, R28.24, S17, R21.2, R21.5).
 *
 * Every fixture is built here — users, tutor profiles, a learner, requests,
 * completed bookings, reviews — and removed in `finally`, so the suite reads
 * nothing it did not write except one active course to hang requests off.
 *
 *   R18.9   a tutor who cannot serve a request cannot pitch to it
 *   R18.11  a request past `expiresAt` is expired everywhere, before the sweep
 *   S17     a tutor never receives the family's account, address or point
 *   R18.10  a booking from a request marks the match and closes the request
 *   R28.24  members can report a request; a moderator rules on it
 *   R21.2   a written review is optional
 *   R21.5   any member may report a published review; pending reviews are
 *           approved by a moderator and only then count towards the rating
 */
export default async function requestsAndReviews(kit) {
  const { section, check, skip, throws, connectForSuite, mongoose, randomUUID } = kit;

  section("Tutor requests & reviews — fixtures");
  if (!(await connectForSuite())) {
    return skip("tutor requests & reviews", "MongoDB is not reachable (set MONGODB_URI)");
  }

  const models = await import("@/models");
  const {
    User, TutorProfile, StudentProfile, Course, TutorRequest, TutorMatch, Notification,
    AuditLog, Booking, Review,
  } = models;
  const svc = await import("@/services/request.service");
  const reviews = await import("@/services/review.service");
  const eligibility = await import("@/lib/matching/eligibility");
  const validation = await import("@/lib/validation/engagement");
  const { getSettings } = await import("@/services/settings.service");
  const {
    ROLES, USER_STATUS, TUTOR_STATUS, REQUEST_STATUS, REQUEST_VISIBILITY, MATCH_STATUS,
    REPORT_STATUS, REVIEW_STATUS, BOOKING_STATUS, NOTIFICATION_TYPES, LESSON_MODES,
  } = await import("@/constants");

  const course = await Course.findOne({ isActive: true, subjectId: { $ne: null } }).lean();
  const otherCourse = course
    ? await Course.findOne({ isActive: true, subjectId: { $nin: [null, course.subjectId] } }).lean()
    : null;
  if (!course || !otherCourse) {
    return skip("tutor requests & reviews", "needs two active courses in different subjects — run `bun run seed`");
  }

  const run = randomUUID().slice(0, 8);
  const ids = {
    users: [], profiles: [], students: [], requests: [], bookings: [], reviews: [],
  };
  const oid = () => new mongoose.Types.ObjectId();

  const makeUser = async (role, first, last, over = {}) => {
    const user = await User.create({
      email: `it30-${run}-${ids.users.length}@example.test`,
      firstName: first,
      lastName: last,
      role,
      status: USER_STATUS.ACTIVE,
      emailVerifiedAt: new Date(),
      ...over,
    });
    ids.users.push(user._id);
    return user;
  };
  const actorOf = (user) => ({
    id: String(user._id),
    role: user.role,
    emailVerifiedAt: user.emailVerifiedAt,
  });
  const makeTutor = async (user, over = {}) => {
    const profile = await TutorProfile.create({
      userId: user._id,
      slug: `it30-${run}-${ids.profiles.length}`,
      hourlyRateCents: 6000,
      status: TUTOR_STATUS.APPROVED,
      isSearchable: true,
      acceptingNewStudents: true,
      lessonModes: [LESSON_MODES.ONLINE, LESSON_MODES.IN_PERSON],
      courseIds: [course._id],
      subjectIds: [course.subjectId],
      // Downtown Toronto.
      location: { type: "Point", coordinates: [-79.3832, 43.6532] },
      travelRadiusKm: 15,
      ...over,
    });
    ids.profiles.push(profile._id);
    return profile;
  };

  const errorIs = (code) => (e) => e?.code === code || e?.status === code;

  try {
    const ownerUser = await makeUser(ROLES.PARENT, "Olivia", "Ownerson");
    const strangerUser = await makeUser(ROLES.PARENT, "Sam", "Stranger");
    const adminUser = await makeUser(ROLES.ADMIN, "Ada", "Adminton");
    const tutorAUser = await makeUser(ROLES.TUTOR, "Theo", "Tutorova");
    const tutorBUser = await makeUser(ROLES.TUTOR, "Bea", "Busytutor");
    const tutorCUser = await makeUser(ROLES.TUTOR, "Cal", "Caller");

    const tutorA = await makeTutor(tutorAUser);
    const tutorB = await makeTutor(tutorBUser, { courseIds: [otherCourse._id], subjectIds: [otherCourse.subjectId] });
    const tutorC = await makeTutor(tutorCUser);

    const student = await StudentProfile.create({
      ownerId: ownerUser._id,
      firstName: "Lena",
      lastName: "Learnersson",
      gradeName: "Grade 11",
    });
    ids.students.push(student._id);

    const owner = actorOf(ownerUser);
    const stranger = actorOf(strangerUser);
    const admin = actorOf(adminUser);
    const tA = actorOf(tutorAUser);
    const tB = actorOf(tutorBUser);
    const tC = actorOf(tutorCUser);

    const brief = (over = {}) => ({
      studentProfileId: String(student._id),
      courseId: String(course._id),
      modes: [LESSON_MODES.ONLINE],
      maxDistanceKm: 25,
      preferredWindows: ["WEEKDAY_EVENING"],
      sessionsPerWeek: 1,
      preferredDurationMinutes: 60,
      budgetMaxCents: 9000,
      languages: [],
      preferredQualifications: [],
      urgency: "FLEXIBLE",
      visibility: REQUEST_VISIBILITY.PUBLIC,
      goal: `Integration 30 request ${run} — safe to delete.`,
      ...over,
    });
    const post = async (over = {}) => {
      const { request } = await svc.createTutorRequest(brief(over), owner);
      ids.requests.push(new mongoose.Types.ObjectId(request.id));
      return request;
    };
    const pitch = (requestId, actor) =>
      svc.expressInterest(requestId, { message: "I teach this course every term and have evenings free." }, actor);

    check("fixtures created", true);

    // --- R18.9: eligibility gates a pitch ----------------------------------
    section("R18.9 — a tutor who cannot serve a request cannot pitch to it");

    const req1 = await post();

    const wrongCourse = await throws(() => pitch(req1.id, tB), errorIs("NOT_ELIGIBLE_FOR_REQUEST"));
    check("a tutor who does not teach the course is refused",
      wrongCourse.threw && wrongCourse.matched, wrongCourse.error?.message);
    check("the refusal says why in the tutor's own terms",
      /do not teach the course/i.test(wrongCourse.error?.message ?? ""), wrongCourse.error?.message);

    const viewB = await svc.getRequestForTutor(req1.id, tB);
    check("the tutor view says they may not respond, and why",
      viewB.canRespond === false && /do not teach/i.test(viewB.eligibility?.reason ?? ""));

    await TutorProfile.updateOne({ _id: tutorB._id }, {
      $set: { courseIds: [course._id], subjectIds: [course.subjectId], acceptingNewStudents: false },
    });
    const notAccepting = await throws(() => pitch(req1.id, tB), errorIs("NOT_ELIGIBLE_FOR_REQUEST"));
    check("a tutor not taking new students is refused", notAccepting.threw && notAccepting.matched);

    await TutorProfile.updateOne({ _id: tutorB._id }, { $set: { acceptingNewStudents: true } });
    await User.updateOne({ _id: tutorBUser._id }, { $set: { status: USER_STATUS.SUSPENDED } });
    const suspended = await throws(() => pitch(req1.id, tB), errorIs("NOT_ELIGIBLE_FOR_REQUEST"));
    check("a suspended tutor is refused even though the profile is still searchable",
      suspended.threw && suspended.matched, suspended.error?.message);

    await User.updateOne({ _id: tutorBUser._id }, { $set: { status: USER_STATUS.ACTIVE } });
    await TutorProfile.updateOne({ _id: tutorB._id }, { $set: { lessonModes: [LESSON_MODES.IN_PERSON] } });
    const wrongMode = await throws(() => pitch(req1.id, tB), errorIs("NOT_ELIGIBLE_FOR_REQUEST"));
    check("a tutor who does not offer the lesson type asked for is refused",
      wrongMode.threw && wrongMode.matched);

    await TutorProfile.updateOne({ _id: tutorB._id }, { $set: { isSearchable: false } });
    const unlisted = await throws(() => pitch(req1.id, tB), errorIs("PROFILE_NOT_APPROVED"));
    check("an unsearchable profile is refused", unlisted.threw && unlisted.matched);
    await TutorProfile.updateOne({ _id: tutorB._id }, {
      $set: { isSearchable: true, lessonModes: [LESSON_MODES.ONLINE, LESSON_MODES.IN_PERSON] },
    });

    // In person only, an hour and a half's drive away: outside both radii.
    const farReq = await post();
    await TutorRequest.updateOne({ _id: farReq.id }, {
      $set: {
        modes: [LESSON_MODES.IN_PERSON],
        location: { type: "Point", coordinates: [-80.2482, 43.5448] }, // Guelph
        postalCode: "N1H 3T9",
        maxDistanceKm: 25,
      },
    });
    const tooFar = await throws(() => pitch(farReq.id, tA), errorIs("NOT_ELIGIBLE_FOR_REQUEST"));
    check("a tutor outside the travel radius is refused for an in-person-only request",
      tooFar.threw && tooFar.matched && /travel radius/i.test(tooFar.error?.message ?? ""),
      tooFar.error?.message);

    const okPitch = await pitch(req1.id, tA);
    check("an eligible tutor may pitch", okPitch?.status === MATCH_STATUS.TUTOR_INTERESTED);

    // --- S17: the tutor view is a whitelist --------------------------------
    section("S17 — what a tutor receives about a request");

    const nearReq = await post();
    await TutorRequest.updateOne({ _id: nearReq.id }, {
      $set: {
        modes: [LESSON_MODES.ONLINE, LESSON_MODES.IN_PERSON],
        postalCode: "M5V 2T6",
        city: "Toronto",
        location: { type: "Point", coordinates: [-79.3957, 43.6426] },
        moderationNote: "internal note",
      },
    });

    const leaks = (view) => {
      const json = JSON.stringify(view);
      return [
        "ownerId" in view && "ownerId",
        "postalCode" in view && "postalCode",
        "location" in view && "location",
        "moderationHistory" in view && "moderationHistory",
        "moderationNote" in view && "moderationNote",
        "reportHistory" in view && "reportHistory",
        "studentProfileId" in view && "studentProfileId",
        json.includes(String(ownerUser._id)) && "owner id value",
        json.includes("2T6") && "full postal code",
        json.includes("43.6426") && "coordinates",
        json.includes("Learnersson") && "learner surname",
        json.includes("internal note") && "moderation note",
      ].filter(Boolean);
    };

    const detail = await svc.getRequestForTutor(nearReq.id, tA);
    check("getRequestForTutor leaks nothing private", leaks(detail.request).length === 0,
      leaks(detail.request).join(", "));
    check("the location is narrowed to the postal prefix", detail.request.postalPrefix === "M5V");
    check("the learner is a first name and an initial", detail.request.student?.name === "Lena L.",
      JSON.stringify(detail.request.student));
    check("an approximate distance from the tutor is included",
      Number.isInteger(detail.request.distanceKm) && detail.request.distanceKm >= 1 && detail.request.distanceKm <= 5,
      String(detail.request.distanceKm));
    check("the view keeps what the page needs", detail.request.id === nearReq.id &&
      detail.request.goal && detail.request.budgetMaxCents === 9000);

    const board = await svc.listOpenRequestsForTutor(tA, { pageSize: 50 });
    const boardItem = board.items.find((r) => r.id === nearReq.id);
    check("the board lists the request", Boolean(boardItem));
    check("the board item leaks nothing private", boardItem && leaks(boardItem).length === 0,
      boardItem && leaks(boardItem).join(", "));
    check("no board item carries an owner, postcode or point",
      board.items.every((r) => !("ownerId" in r) && !("postalCode" in r) && !("location" in r)));

    const generic = await svc.getRequest(nearReq.id, tA);
    check("getRequest's tutor branch is the same whitelist", leaks(generic).length === 0,
      leaks(generic).join(", "));

    const ownerView = await svc.getRequest(nearReq.id, owner);
    check("the family still reads their own full request",
      ownerView.postalCode === "M5V 2T6" && String(ownerView.ownerId) === String(ownerUser._id));

    // --- R18.11: expiry is read from the clock ------------------------------
    section("R18.11 — an expired request is expired before the sweep runs");

    const lapsed = await post();
    await svc.inviteTutors(lapsed.id, { tutorProfileIds: [String(tutorC._id)] }, owner);
    await pitch(lapsed.id, tC);
    const lapsedMatch = await TutorMatch.findOne({ requestId: lapsed.id, tutorProfileId: tutorC._id }).lean();
    await TutorRequest.updateOne({ _id: lapsed.id }, { $set: { expiresAt: new Date(Date.now() - 60_000) } });
    const lapsedDoc = await TutorRequest.findById(lapsed.id).lean();

    check("the stored status still says OPEN (the sweep has not run)", lapsedDoc.status === REQUEST_STATUS.OPEN);
    check("isRequestLive says it is not live", eligibility.isRequestLive(lapsedDoc) === false);
    check("a request with no expiry is live", eligibility.isRequestLive({ status: "OPEN" }) === true);
    check("requestAcceptsMatches follows the clock", eligibility.requestAcceptsMatches(lapsedDoc) === false);

    const tutorLapsed = await svc.getRequestForTutor(lapsed.id, tA);
    check("a tutor sees it as EXPIRED and may not respond",
      tutorLapsed.request.status === REQUEST_STATUS.EXPIRED && tutorLapsed.canRespond === false);

    const boardAfter = await svc.listOpenRequestsForTutor(tA, { pageSize: 50 });
    check("it has left the tutor board", !boardAfter.items.some((r) => r.id === lapsed.id));

    const refusals = [
      ["a pitch", () => pitch(lapsed.id, tA)],
      ["an edit", () => svc.updateTutorRequest(lapsed.id, { goal: "Edited after it lapsed — refused." }, owner)],
      ["an invitation", () => svc.inviteTutors(lapsed.id, { tutorProfileIds: [String(tutorA._id)] }, owner)],
      ["a shortlist", () => svc.respondToMatch(String(lapsedMatch._id), { action: "SHORTLIST" }, owner)],
      ["closing it", () => svc.closeRequest(lapsed.id, { reason: "NO_LONGER_NEEDED" }, owner)],
      ["cancelling it", () => svc.cancelRequest(lapsed.id, {}, owner)],
      ["booking from it", () => svc.validateRequestForBooking({
        requestId: lapsed.id, purchaserId: String(ownerUser._id), tutorProfileId: String(tutorC._id),
      })],
    ];
    for (const [label, fn] of refusals) {
      const result = await throws(fn, errorIs("REQUEST_CLOSED"));
      check(`${label} is refused as closed`, result.threw && result.matched,
        result.error ? `${result.error.code}: ${result.error.message}` : "did not throw");
    }

    check("the matcher does nothing for it", (await svc.generateMatches(lapsedDoc)).length === 0);

    const ownerLapsed = await svc.getRequest(lapsed.id, owner);
    check("the family sees it as EXPIRED too", ownerLapsed.status === REQUEST_STATUS.EXPIRED);
    const ownerOpen = await svc.listRequests(owner, { status: REQUEST_STATUS.OPEN, pageSize: 50 });
    check("the family's OPEN filter excludes it", !ownerOpen.items.some((r) => r.id === lapsed.id));
    const ownerExpired = await svc.listRequests(owner, { status: REQUEST_STATUS.EXPIRED, pageSize: 50 });
    check("and their EXPIRED filter includes it", ownerExpired.items.some((r) => r.id === lapsed.id));

    // The cap: fill it with lapsed requests — none of them should count.
    const settings = await getSettings();
    const cap = settings.matching?.maxOpenRequestsPerOwner ?? 10;
    const capOwner = await makeUser(ROLES.PARENT, "Cara", "Capped");
    const capStudent = await StudentProfile.create({ ownerId: capOwner._id, firstName: "Kit" });
    ids.students.push(capStudent._id);
    const stub = (expiresAt) => ({
      reference: `REQ-IT30-${randomUUID().slice(0, 10)}`,
      ownerId: capOwner._id,
      studentProfileId: capStudent._id,
      courseId: course._id,
      status: REQUEST_STATUS.OPEN,
      goal: `Integration 30 request ${run} — cap stub.`,
      budgetMaxCents: 5000,
      expiresAt,
    });
    const lapsedStubs = await TutorRequest.insertMany(
      Array.from({ length: cap }, () => stub(new Date(Date.now() - 3600_000))),
    );
    ids.requests.push(...lapsedStubs.map((r) => r._id));
    const capActor = actorOf(capOwner);
    const capBrief = brief({ studentProfileId: String(capStudent._id) });
    const underCap = await svc.createTutorRequest(capBrief, capActor);
    ids.requests.push(new mongoose.Types.ObjectId(underCap.request.id));
    check(`${cap} lapsed-but-unswept requests do not count against the cap`,
      underCap.request.status === REQUEST_STATUS.OPEN);

    const liveStubs = await TutorRequest.insertMany(
      Array.from({ length: cap }, () => stub(new Date(Date.now() + 86_400_000))),
    );
    ids.requests.push(...liveStubs.map((r) => r._id));
    const overCap = await throws(() => svc.createTutorRequest(capBrief, capActor), errorIs("REQUEST_LIMIT_REACHED"));
    check("live requests still do", overCap.threw && overCap.matched);

    // --- R18.10: booking from a request -------------------------------------
    section("R18.10 — a booking from a request closes it and marks the match");

    const bookReq = await post();
    await pitch(bookReq.id, tB);
    await pitch(bookReq.id, tC);
    await svc.withdrawFromRequest(bookReq.id, { action: "WITHDRAW" }, tC);
    const matchB = await TutorMatch.findOne({ requestId: bookReq.id, tutorProfileId: tutorB._id }).lean();
    const matchC = await TutorMatch.findOne({ requestId: bookReq.id, tutorProfileId: tutorC._id }).lean();

    const strangerBooks = await throws(() => svc.validateRequestForBooking({
      requestId: bookReq.id, purchaserId: String(strangerUser._id), tutorProfileId: String(tutorB._id),
    }), errorIs(403));
    check("only the family who posted it can book from it", strangerBooks.threw && strangerBooks.matched);

    const notOnIt = await throws(() => svc.validateRequestForBooking({
      requestId: bookReq.id, purchaserId: String(ownerUser._id), tutorProfileId: String(oid()),
    }), errorIs("MATCH_NOT_FOUND"));
    check("a tutor who is not on the request is refused", notOnIt.threw && notOnIt.matched);

    const withdrawnBooks = await throws(() => svc.validateRequestForBooking({
      requestId: bookReq.id, purchaserId: String(ownerUser._id), tutorProfileId: String(tutorC._id),
    }), errorIs("MATCH_CLOSED"));
    check("a tutor who withdrew is refused", withdrawnBooks.threw && withdrawnBooks.matched);

    const shortlistWithdrawn = await throws(
      () => svc.respondToMatch(String(matchC._id), { action: "SHORTLIST" }, owner),
      errorIs("MATCH_CLOSED"),
    );
    check("the family cannot shortlist a tutor who withdrew", shortlistWithdrawn.threw && shortlistWithdrawn.matched);

    const closeWithStranger = await throws(
      () => svc.closeRequest(bookReq.id, { reason: "BOOKED", bookedTutorProfileId: String(oid()) }, owner),
      errorIs("MATCH_NOT_FOUND"),
    );
    check("closing as BOOKED with a tutor who is not on the request is refused",
      closeWithStranger.threw && closeWithStranger.matched);
    const closeWithWithdrawn = await throws(
      () => svc.closeRequest(bookReq.id, { reason: "BOOKED", bookedTutorProfileId: String(tutorC._id) }, owner),
      errorIs("MATCH_CLOSED"),
    );
    check("closing as BOOKED with a tutor who withdrew is refused",
      closeWithWithdrawn.threw && closeWithWithdrawn.matched);

    const link = await svc.validateRequestForBooking({
      requestId: bookReq.id, purchaserId: String(ownerUser._id), tutorProfileId: String(tutorB._id),
    });
    check("a valid booking returns the stored request and match ids",
      link.requestId === bookReq.id && link.tutorMatchId === String(matchB._id));

    // A third tutor who pitched and is still waiting hears it was filled.
    await pitch(bookReq.id, tA);
    const bookingId = oid();
    const first = await svc.recordRequestBooking({ ...link, bookingId, tutorProfileId: String(tutorB._id) });
    check("recording the booking marks the match and closes the request",
      first?.matchBooked === true && first?.requestClosed === true, JSON.stringify(first));

    const afterBook = await TutorRequest.findById(bookReq.id).lean();
    check("the request is MATCHED, closed as BOOKED, with this tutor",
      afterBook.status === REQUEST_STATUS.MATCHED && afterBook.closeReason === "BOOKED" &&
        String(afterBook.bookedTutorProfileId) === String(tutorB._id));
    const bookedMatch = await TutorMatch.findById(matchB._id).lean();
    check("the match is BOOKED", bookedMatch.status === MATCH_STATUS.BOOKED && Boolean(bookedMatch.bookedAt));

    const filledNotices = () => Notification.countDocuments({
      userId: tutorAUser._id, entityId: afterBook._id, type: NOTIFICATION_TYPES.REQUEST_CLOSED,
    });
    check("the other interested tutor is told it was filled", (await filledNotices()) === 1);
    const bookedTutorNotices = await Notification.countDocuments({
      userId: tutorBUser._id, entityId: afterBook._id, type: NOTIFICATION_TYPES.REQUEST_CLOSED,
    });
    check("the booked tutor is not told it was filled by someone else", bookedTutorNotices === 0);

    const replay = await svc.recordRequestBooking({ ...link, bookingId, tutorProfileId: String(tutorB._id) });
    check("recording it again changes nothing",
      replay?.matchBooked === false && replay?.requestClosed === false, JSON.stringify(replay));
    check("and notifies nobody twice", (await filledNotices()) === 1);

    const again = await svc.validateRequestForBooking({
      requestId: bookReq.id, purchaserId: String(ownerUser._id), tutorProfileId: String(tutorB._id),
    });
    check("a further lesson with the hired tutor may still be booked from it", again.tutorMatchId === String(matchB._id));
    const otherAfter = await throws(() => svc.validateRequestForBooking({
      requestId: bookReq.id, purchaserId: String(ownerUser._id), tutorProfileId: String(tutorA._id),
    }), errorIs("REQUEST_CLOSED"));
    check("but not with a different tutor", otherAfter.threw && otherAfter.matched);

    const broken = await svc.recordRequestBooking({
      requestId: "not-an-id", tutorMatchId: "nope", bookingId, tutorProfileId: "x",
    });
    check("recordRequestBooking never throws into its caller", broken === null);

    const auditClosed = await AuditLog.countDocuments({
      entityId: afterBook._id, action: "REQUEST_CLOSED",
    });
    check("the booking close is audited once", auditClosed === 1, String(auditClosed));

    // --- R28.24: reporting a request ----------------------------------------
    section("R28.24 — reporting a tutor request");

    const reportReq = await post();
    const privateReq = await post({ visibility: REQUEST_VISIBILITY.INVITE_ONLY });

    const ownReport = await throws(
      () => svc.reportRequest(reportReq.id, { reason: "SPAM" }, owner), errorIs(403),
    );
    check("the family cannot report their own request", ownReport.threw && ownReport.matched);

    const strangerReport = await throws(
      () => svc.reportRequest(reportReq.id, { reason: "SPAM" }, stranger), errorIs(403),
    );
    check("a member who cannot see the request cannot report it", strangerReport.threw && strangerReport.matched);

    const uninvitedReport = await throws(
      () => svc.reportRequest(privateReq.id, { reason: "SPAM" }, tA), errorIs(404),
    );
    check("an uninvited tutor cannot report an invite-only request", uninvitedReport.threw && uninvitedReport.matched);

    check("the reason must be one of the listed reasons",
      validation.reportRequestSchema.safeParse({ reason: "BECAUSE" }).success === false &&
        validation.reportRequestSchema.safeParse({ reason: "CONTACT_DETAILS", note: "Phone number in notes." }).success);

    const adminNotices = () => Notification.countDocuments({
      userId: adminUser._id, entityId: new mongoose.Types.ObjectId(reportReq.id),
      type: NOTIFICATION_TYPES.CONTENT_REPORTED,
    });

    const reported = await svc.reportRequest(reportReq.id, { reason: "CONTACT_DETAILS", note: "Phone in notes." }, tA);
    check("a tutor who can see it may report it",
      reported.reported === true && reported.reportStatus === REPORT_STATUS.OPEN && reported.stillVisible === true);
    let stored = await TutorRequest.findById(reportReq.id).lean();
    check("the case is open with one report",
      stored.reportStatus === REPORT_STATUS.OPEN && stored.reportCount === 1 && Boolean(stored.reportedAt));
    check("the request itself stays OPEN", stored.status === REQUEST_STATUS.OPEN);
    check("active administrators are told", (await adminNotices()) === 1);

    const dup = await throws(
      () => svc.reportRequest(reportReq.id, { reason: "SPAM" }, tA), errorIs(409),
    );
    check("the same member cannot report it twice while the case is open", dup.threw && dup.matched);

    await svc.reportRequest(reportReq.id, { reason: "NOT_GENUINE" }, tB);
    stored = await TutorRequest.findById(reportReq.id).lean();
    check("a second member's report joins the case", stored.reportCount === 2 && stored.reportHistory.length === 2);
    check("administrators are told once per case, not once per report", (await adminNotices()) === 1);

    const reportAudit = await AuditLog.countDocuments({
      entityId: stored._id, action: "REQUEST_REPORTED",
    });
    check("every report is audited", reportAudit === 2, String(reportAudit));

    const tutorSees = await svc.getRequestForTutor(reportReq.id, tB);
    check("the tutor view does not carry the report trail",
      !("reportHistory" in tutorSees.request) && !("reportStatus" in tutorSees.request));

    const queue = await svc.listAllRequests({ reported: true, pageSize: 50 });
    const queued = queue.items.find((r) => r.id === reportReq.id);
    check("the request reaches the admin Reported queue", Boolean(queued));
    check("with each reporter named for the moderator",
      queued?.reportHistory?.some((h) => h.reporterId?.firstName === "Theo"));

    const dismissed = await svc.moderateRequest(reportReq.id, { action: "DISMISS_REPORT", note: "Not a contact detail." }, admin);
    check("a moderator can dismiss the report",
      dismissed.reportStatus === REPORT_STATUS.DISMISSED && dismissed.reportCount === 0 &&
        dismissed.status === REQUEST_STATUS.OPEN);
    check("every report in the case is stamped resolved", dismissed.reportHistory.every((h) => h.resolvedAt));
    const dismissAudit = await AuditLog.findOne({
      entityId: stored._id, action: "REQUEST_MODERATED", "metadata.action": "DISMISS_REPORT",
    }).lean();
    check("the dismissal is audited", Boolean(dismissAudit));

    const dismissTwice = await throws(
      () => svc.moderateRequest(reportReq.id, { action: "DISMISS_REPORT", note: "Again." }, admin), errorIs(409),
    );
    check("a report cannot be dismissed when none is open", dismissTwice.threw && dismissTwice.matched);

    await svc.reportRequest(reportReq.id, { reason: "INAPPROPRIATE" }, tA);
    stored = await TutorRequest.findById(reportReq.id).lean();
    check("after a ruling the same member may report again, opening a new case",
      stored.reportStatus === REPORT_STATUS.OPEN && stored.reportCount === 1);
    check("which tells administrators again", (await adminNotices()) === 2);

    const removed = await svc.moderateRequest(reportReq.id, { action: "REMOVE", note: "Upheld: inappropriate." }, admin);
    check("removing a reported request upholds the report",
      removed.status === REQUEST_STATUS.REMOVED && removed.reportStatus === REPORT_STATUS.RESOLVED);

    // --- R21.2: the written review is optional --------------------------------
    section("R21.2 — a written review is optional");

    const reviewBase = {
      bookingId: String(oid()), rating: 5, knowledge: 5, communication: 5, reliability: 5, teaching: 5,
    };
    const parse = (over) => validation.createReviewSchema.safeParse({ ...reviewBase, ...over });
    check("stars alone are a valid review", parse({}).success);
    check("an empty body is treated as no body", parse({ body: "" }).success && parse({ body: "" }).data.body === undefined);
    check("a whitespace body is treated as no body", parse({ body: "    " }).data?.body === undefined);
    const short = parse({ body: "Great!" });
    check("a body under 10 characters is refused",
      short.success === false && /at least 10 characters/.test(short.error.issues[0].message));
    check("spaces do not count towards the ten", parse({ body: "a b c d e f" }).success === false);
    check("ten real characters are enough", parse({ body: "Very clear" }).success === false && parse({ body: "Very clear!" }).success);
    check("a rating is still required", parse({ rating: undefined }).success === false);

    const makeCompletedBooking = async () => {
      const startAt = new Date(Date.now() - 7 * 86_400_000);
      const booking = await Booking.create({
        reference: `APL-IT30${randomUUID().slice(0, 6).toUpperCase()}`,
        purchaserId: ownerUser._id,
        studentProfileId: student._id,
        tutorProfileId: tutorA._id,
        tutorUserId: tutorAUser._id,
        courseId: course._id,
        courseName: course.name,
        courseCode: course.code,
        mode: LESSON_MODES.ONLINE,
        startAt,
        endAt: new Date(startAt.getTime() + 3600_000),
        durationMinutes: 60,
        status: BOOKING_STATUS.COMPLETED,
        completedAt: new Date(startAt.getTime() + 3600_000),
        price: {
          hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000, commissionPercent: 15,
          commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000,
        },
      });
      ids.bookings.push(booking._id);
      return booking;
    };

    const b1 = await makeCompletedBooking();
    const starsOnly = await reviews.createReview(
      validation.createReviewSchema.parse({ ...reviewBase, bookingId: String(b1._id), rating: 4 }),
      owner,
    );
    ids.reviews.push(new mongoose.Types.ObjectId(starsOnly.id));
    const storedReview = await Review.findById(starsOnly.id).lean();
    check("a stars-only review is stored", storedReview?.rating === 4);
    check("with no body field at all (never an empty string)", !("body" in storedReview));

    // --- R21.5: reporting reviews, and approval ------------------------------
    section("R21.5 — any member may report a published review; approval");

    // Make sure the review under test is published whatever the platform's
    // auto-moderation setting is, and take the rating from there. The tutor
    // is a fixture, so this is their only review.
    const { refreshTutorStats } = await import("@/services/tutor.service");
    await Review.updateOne({ _id: starsOnly.id }, { $set: { status: REVIEW_STATUS.PUBLISHED } });
    await refreshTutorStats(tutorA._id);
    const baseline = (await TutorProfile.findById(tutorA._id).lean()).stats;
    check("a published stars-only review counts towards the rating",
      baseline.ratingCount === 1 && baseline.ratingAverage === 4, JSON.stringify(baseline));

    const reviewNotices = () => Notification.countDocuments({
      userId: adminUser._id, entityId: storedReview._id, type: NOTIFICATION_TYPES.CONTENT_REPORTED,
    });

    const memberReport = await reviews.reportReview(starsOnly.id, { reason: "This review is not about this tutor at all." }, stranger);
    check("a member who is neither party may report a published review",
      memberReport.reported === true && memberReport.stillVisible === true);
    check("administrators are told", (await reviewNotices()) === 1);

    const memberAgain = await throws(
      () => reviews.reportReview(starsOnly.id, { reason: "Reporting the same review again." }, stranger), errorIs(409),
    );
    check("the same member is refused a duplicate while the case is open", memberAgain.threw && memberAgain.matched);

    const tutorReport = await reviews.reportReview(starsOnly.id, { reason: "The tutor objects to this review." }, tA);
    check("another member (the reviewed tutor) may still add a report", tutorReport.reported === true);
    check("administrators are told once per case", (await reviewNotices()) === 1);

    const reviewAudit = await AuditLog.countDocuments({ entityId: storedReview._id, action: "REVIEW_REPORTED" });
    check("every review report is audited", reviewAudit === 2, String(reviewAudit));

    const stillCounted = (await TutorProfile.findById(tutorA._id).lean()).stats.ratingCount;
    check("a member's report does not move the rating", stillCounted === baseline.ratingCount);

    const kept = await reviews.moderateReview(starsOnly.id, { status: REVIEW_STATUS.PUBLISHED, note: "Fine." }, admin);
    check("dismissing keeps it published", kept.status === REVIEW_STATUS.PUBLISHED && kept.reportStatus === REPORT_STATUS.DISMISSED);

    const noop = await throws(
      () => reviews.moderateReview(starsOnly.id, { status: REVIEW_STATUS.PUBLISHED }, admin), errorIs(409),
    );
    check("a ruling that changes nothing is refused", noop.threw && noop.matched);

    // A review awaiting approval.
    const b2 = await makeCompletedBooking();
    const pending = await Review.create({
      bookingId: b2._id,
      tutorProfileId: tutorA._id,
      tutorUserId: tutorAUser._id,
      authorId: ownerUser._id,
      studentProfileId: student._id,
      courseId: course._id,
      rating: 1,
      knowledge: 1,
      communication: 1,
      reliability: 1,
      teaching: 1,
      body: "Integration 30 pending review — safe to delete.",
      status: REVIEW_STATUS.PENDING_MODERATION,
    });
    ids.reviews.push(pending._id);
    await refreshTutorStats(tutorA._id);
    const beforeApproval = (await TutorProfile.findById(tutorA._id).lean()).stats;

    const hiddenReport = await throws(
      () => reviews.reportReview(String(pending._id), { reason: "A member reporting an unpublished review." }, stranger),
      errorIs(404),
    );
    check("a member cannot report a review that is not public", hiddenReport.threw && hiddenReport.matched);

    const queuePending = await reviews.listReviews(admin, { status: REVIEW_STATUS.PENDING_MODERATION, pageSize: 50 });
    check("the Awaiting approval queue lists it", queuePending.items.some((r) => r.id === String(pending._id)));
    check("a pending review is not in the rating", beforeApproval.ratingCount === baseline.ratingCount);

    const approved = await reviews.moderateReview(String(pending._id), { status: REVIEW_STATUS.PUBLISHED, note: "Approved." }, admin);
    check("a moderator can approve a pending review", approved.status === REVIEW_STATUS.PUBLISHED);
    const afterApproval = (await TutorProfile.findById(tutorA._id).lean()).stats;
    check("approving it refreshes the rating aggregates",
      afterApproval.ratingCount === beforeApproval.ratingCount + 1 &&
        afterApproval.ratingAverage < beforeApproval.ratingAverage,
      `${beforeApproval.ratingAverage}/${beforeApproval.ratingCount} -> ${afterApproval.ratingAverage}/${afterApproval.ratingCount}`);
    const approvalAudit = await AuditLog.findOne({
      entityId: pending._id, action: "REVIEW_MODERATED", "metadata.approved": true,
    }).lean();
    check("the approval is audited as one", Boolean(approvalAudit));

    const b3 = await makeCompletedBooking();
    const pending2 = await Review.create({
      bookingId: b3._id, tutorProfileId: tutorA._id, tutorUserId: tutorAUser._id,
      authorId: ownerUser._id, courseId: course._id, rating: 2,
      status: REVIEW_STATUS.PENDING_MODERATION,
    });
    ids.reviews.push(pending2._id);
    const rejected = await reviews.moderateReview(String(pending2._id), { status: REVIEW_STATUS.REMOVED, note: "Not about the lesson." }, admin);
    const afterReject = (await TutorProfile.findById(tutorA._id).lean()).stats;
    check("removing a pending review keeps it out of the rating",
      rejected.status === REVIEW_STATUS.REMOVED && afterReject.ratingCount === afterApproval.ratingCount);
  } finally {
    const requestIds = ids.requests;
    const entityIds = [...requestIds, ...ids.reviews, ...ids.bookings];
    await TutorMatch.deleteMany({ requestId: { $in: requestIds } });
    await Notification.deleteMany({ $or: [{ entityId: { $in: entityIds } }, { userId: { $in: ids.users } }] });
    await AuditLog.deleteMany({ entityId: { $in: entityIds } });
    await TutorRequest.deleteMany({ $or: [{ _id: { $in: requestIds } }, { ownerId: { $in: ids.users } }] });
    await Review.deleteMany({ _id: { $in: ids.reviews } });
    await Booking.deleteMany({ _id: { $in: ids.bookings } });
    await StudentProfile.deleteMany({ _id: { $in: ids.students } });
    await TutorProfile.deleteMany({ _id: { $in: ids.profiles } });
    await User.deleteMany({ _id: { $in: ids.users } });
  }
}
