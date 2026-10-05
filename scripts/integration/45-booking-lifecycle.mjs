/**
 * Booking lifecycle (R14.4, R17.3, R18.10, R26.5, R24.1, R24.7–R24.9, R3.2,
 * R25.1, R16.6, §37 steps 11 and 18).
 *
 * Every fixture — users, a tutor profile and its availability, learners, a
 * tutor request, group sessions, bookings, payments — is created here with a
 * unique tag and removed in `finally`. Payments use the development provider;
 * nothing here can reach Stripe.
 *
 *   R14.4   a 1:1 lesson cannot be sold over a published group session, a
 *           group cannot be published (or moved) over a 1:1 lesson, and a
 *           reschedule is checked against the same busy time, less itself
 *   R17.3   confirming and rescheduling write one SYSTEM message each into
 *           the pair's thread, pinned to the booking; a replay writes nothing
 *   R18.10  a booking carries a request only if it is the purchaser's own and
 *           the tutor is on it; confirmation closes it and books the match
 *   R26.5   OTHER needs a description, the type must be one the tutor offers,
 *           and the description is released like an address
 *   R24.x   confirmation emails: the tutor's link, where, the amount actually
 *           paid for a series, and the policy read from Settings
 *   R3.2    a parent's list filters by child and never reaches another's
 *   R25.1   production issues no fabricated meeting link
 *   R16.6   a tutor sees the payment's status and nothing about the card
 */
export default async function bookingLifecycle(kit) {
  const { section, check, skip, throws, connectForSuite, mongoose, randomUUID } = kit;

  section("Booking lifecycle — fixtures");
  if (!(await connectForSuite())) {
    return skip("booking lifecycle", "MongoDB is not reachable (set MONGODB_URI)");
  }

  // Never a real payment provider, whatever .env.local says.
  process.env.PAYMENT_PROVIDER = "development";

  const models = await import("@/models");
  const {
    User, TutorProfile, StudentProfile, Course, Availability, Booking, BookingSlotLock, Payment,
    GroupSession, GroupEnrolment, Conversation, Message, Notification, AuditLog, TutorRequest,
    TutorMatch,
  } = models;
  const bookings = await import("@/services/booking.service");
  const groups = await import("@/services/group.service");
  const requests = await import("@/services/request.service");
  const bookingMessages = await import("@/services/booking-messages.service");
  const { markPaymentPaid } = await import("@/services/payment.service");
  const { getSettings } = await import("@/services/settings.service");
  const { createBookingSchema } = await import("@/lib/validation/bookings");
  const { readDevMail, devMailboxAllowed } = await import("@/services/external/dev-mailbox");
  const { getMeetingProvider, resetMeetingProviders } = await import("@/services/external/meeting-provider");
  const { provisionMeeting } = await import("@/services/meeting.service");
  const { bookingWidgetHref, readBookingWidgetParams } = await import("@/lib/booking/widget-params");
  const { internalPath } = await import("@/lib/utils/url");
  const { formatMoney } = await import("@/lib/utils/format");
  const {
    ROLES, USER_STATUS, TUTOR_STATUS, LESSON_MODES, MEETING_PROVIDERS, IN_PERSON_LOCATIONS,
    BOOKING_STATUS, GROUP_SESSION_STATUS, RECURRENCE, REQUEST_VISIBILITY, REQUEST_STATUS,
    MATCH_STATUS, MESSAGE_SYSTEM_EVENTS, PAYMENT_STATUS,
  } = await import("@/constants");

  const course = await Course.findOne({ isActive: true, subjectId: { $ne: null } }).lean();
  if (!course) return skip("booking lifecycle", "needs an active course — run `bun run seed`");

  const run = randomUUID().slice(0, 8);
  const ids = { users: [], profiles: [], students: [], requests: [] };
  const errorIs = (code) => (e) => e?.code === code || e?.status === code;

  const makeUser = async (role, first, last) => {
    const user = await User.create({
      email: `it45-${run}-${ids.users.length}@example.test`,
      firstName: first,
      lastName: last,
      role,
      status: USER_STATUS.ACTIVE,
      emailVerifiedAt: new Date(),
    });
    ids.users.push(user._id);
    return user;
  };
  const actorOf = (user) => ({ id: String(user._id), role: user.role, emailVerifiedAt: user.emailVerifiedAt });
  const makeStudent = async (owner, first) => {
    const student = await StudentProfile.create({ ownerId: owner._id, firstName: first, lastName: "Learner", gradeName: "Grade 11" });
    ids.students.push(student._id);
    return student;
  };

  // Whole hours, days ahead: well past the notice window, inside the horizon.
  const base = new Date();
  base.setUTCDate(base.getUTCDate() + 6);
  base.setUTCHours(14, 0, 0, 0);
  const at = (dayOffset, hour, minute = 0) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + dayOffset);
    d.setUTCHours(hour, minute, 0, 0);
    return d.toISOString();
  };

  try {
    const tutorUser = await makeUser(ROLES.TUTOR, "Tess", "Tutorson");
    const parentUser = await makeUser(ROLES.PARENT, "Paula", "Parentson");
    const otherParentUser = await makeUser(ROLES.PARENT, "Omar", "Otherparent");
    const tutor = await TutorProfile.create({
      userId: tutorUser._id,
      slug: `it45-${run}`,
      hourlyRateCents: 6000,
      status: TUTOR_STATUS.APPROVED,
      isSearchable: true,
      acceptingNewStudents: true,
      lessonModes: [LESSON_MODES.ONLINE, LESSON_MODES.IN_PERSON],
      inPersonLocationTypes: [IN_PERSON_LOCATIONS.LIBRARY, IN_PERSON_LOCATIONS.OTHER],
      onlineMeetingProviders: [MEETING_PROVIDERS.ZOOM],
      courses: [{ courseId: course._id, code: course.code, name: course.name, subjectId: course.subjectId }],
      courseIds: [course._id],
      subjectIds: [course.subjectId],
      location: { type: "Point", coordinates: [-79.3832, 43.6532] },
      travelRadiusKm: 15,
      timeZone: "America/Toronto",
    });
    ids.profiles.push(tutor._id);
    await Availability.create({
      tutorProfileId: tutor._id,
      userId: tutorUser._id,
      timeZone: "America/Toronto",
      weeklyRules: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinutes: 0, endMinutes: 1440 })),
      bufferMinutes: 0,
      minNoticeHours: 0,
    });

    const childA = await makeStudent(parentUser, "Ava");
    const childB = await makeStudent(parentUser, "Ben");
    const foreignChild = await makeStudent(otherParentUser, "Cleo");

    const tutorActor = actorOf(tutorUser);
    const parent = actorOf(parentUser);
    const otherParent = actorOf(otherParentUser);
    const settings = await getSettings();

    const lesson = (over = {}) => ({
      tutorProfileId: String(tutor._id),
      studentProfileId: String(childA._id),
      courseId: String(course._id),
      mode: LESSON_MODES.ONLINE,
      meetingProvider: MEETING_PROVIDERS.ZOOM,
      durationMinutes: 60,
      recurrence: RECURRENCE.NONE,
      occurrences: 1,
      ...over,
    });
    const settle = async (paymentId) => {
      await markPaymentPaid(paymentId, { paidAt: new Date() });
      return bookings.confirmBookings(paymentId);
    };

    check("fixtures created", true);

    // --- R14.4: group sessions and 1:1 lessons share one calendar ----------
    section("R14.4 — group sessions and one-to-one lessons cannot overlap");

    const groupStart = at(0, 15);
    const draft = await groups.createGroupSession(
      {
        title: `IT45 group ${run}`,
        courseId: String(course._id),
        mode: LESSON_MODES.ONLINE,
        meetingProvider: MEETING_PROVIDERS.ZOOM,
        startAt: groupStart,
        durationMinutes: 60,
        minParticipants: 2,
        maxParticipants: 4,
        pricePerSeatCents: 2500,
      },
      tutorActor,
    );
    const published = await groups.publishGroupSession(draft.id, tutorActor);
    check("a group session publishes into a free hour", published.status === GROUP_SESSION_STATUS.PUBLISHED);

    const overGroup = await throws(
      () => bookings.createBooking(lesson({ startAt: at(0, 15, 30) }), parent),
      errorIs(409),
    );
    check("a 1:1 lesson overlapping a published group session is refused",
      overGroup.threw && overGroup.matched, overGroup.error?.message);
    check("…and no booking row was written",
      !(await Booking.exists({ tutorProfileId: tutor._id, startAt: new Date(at(0, 15, 30)) })));

    const beside = await bookings.createBooking(lesson({ startAt: at(0, 16) }), parent);
    check("a lesson starting as the group session ends is accepted", beside.bookings.length === 1);

    // The reverse: a 1:1 hold first, then a group on top of it.
    const held = await bookings.createBooking(lesson({ startAt: at(1, 14) }), parent);
    const draft2 = await groups.createGroupSession(
      {
        title: `IT45 group two ${run}`,
        courseId: String(course._id),
        mode: LESSON_MODES.ONLINE,
        meetingProvider: MEETING_PROVIDERS.ZOOM,
        startAt: at(1, 14, 30),
        durationMinutes: 60,
        minParticipants: 2,
        maxParticipants: 4,
        pricePerSeatCents: 2500,
      },
      tutorActor,
    );
    const overLesson = await throws(() => groups.publishGroupSession(draft2.id, tutorActor), errorIs(409));
    check("publishing a group session over a held 1:1 lesson is refused",
      overLesson.threw && overLesson.matched, overLesson.error?.message);
    check("…and the session stays a draft",
      (await GroupSession.findById(draft2.id).lean()).status === GROUP_SESSION_STATUS.DRAFT);

    const moveOnto = await throws(
      () => groups.updateGroupSession(published.id, { startAt: at(1, 14) }, tutorActor),
      errorIs(409),
    );
    const afterMove = await GroupSession.findById(published.id).lean();
    check("moving a live group session onto a 1:1 lesson is refused",
      moveOnto.threw && moveOnto.matched, moveOnto.error?.message);
    check("…and its stored hour is unchanged",
      afterMove.startAt.toISOString() === groupStart && afterMove.status === GROUP_SESSION_STATUS.PUBLISHED);

    const nudged = await groups.updateGroupSession(published.id, { startAt: at(0, 14, 30) }, tutorActor);
    check("moving a live session within its own hour is not a clash with itself",
      new Date(nudged.startAt).toISOString() === at(0, 14, 30));
    await groups.updateGroupSession(published.id, { startAt: groupStart }, tutorActor);

    // --- R17.3 + R16.6 + R24: confirmation ----------------------------------
    section("R17.3 / R24.1 / R24.7–R24.9 / R16.6 — what confirmation writes and sends");

    const heldBooking = held.bookings[0];
    const confirmed = await settle(held.payment.id);
    check("the held lesson confirms on payment", confirmed.confirmed === 1);

    const systemMessages = await Message.find({ bookingId: heldBooking.id, kind: "SYSTEM" }).lean();
    check("one SYSTEM message narrates the confirmation, pinned to the booking",
      systemMessages.length === 1 && systemMessages[0].systemEvent === MESSAGE_SYSTEM_EVENTS.BOOKING_CONFIRMED,
      `found ${systemMessages.length}`);
    const thread = await Conversation.findOne({ learnerUserId: parentUser._id, tutorUserId: tutorUser._id }).lean();
    check("the pair's thread exists and is associated with the booking",
      thread && String(thread.bookingId) === heldBooking.id &&
        String(systemMessages[0]?.conversationId) === String(thread._id));

    const reconfirmed = await bookings.confirmBookings(held.payment.id);
    await bookingMessages.announceBookingConfirmed([await Booking.findById(heldBooking.id).lean()]);
    check("a replayed confirmation writes no second message",
      reconfirmed.confirmed === 0 &&
        (await Message.countDocuments({ bookingId: heldBooking.id, systemEvent: MESSAGE_SYSTEM_EVENTS.BOOKING_CONFIRMED })) === 1);

    await bookingMessages.announceBookingCancelled([await Booking.findById(heldBooking.id).lean()], "TUTOR");
    await bookingMessages.announceBookingCancelled([await Booking.findById(heldBooking.id).lean()], "TUTOR");
    check("the cancellation helper (for every cancel path) posts once per lesson",
      (await Message.countDocuments({ bookingId: heldBooking.id, systemEvent: MESSAGE_SYSTEM_EVENTS.BOOKING_CANCELLED })) === 1);
    await Message.deleteMany({ bookingId: heldBooking.id, systemEvent: MESSAGE_SYSTEM_EVENTS.BOOKING_CANCELLED });

    const tutorView = await bookings.getBooking(heldBooking.id, tutorActor);
    const tutorPayment = tutorView.paymentId ?? {};
    check("the tutor sees the payment as paid (R16.6)", tutorPayment.status === PAYMENT_STATUS.PAID);
    check("…and nothing about the card, the purchaser or the checkout",
      ["paymentMethodLast4", "paymentMethodBrand", "purchaserId", "providerCheckoutUrl", "providerPaymentIntentId", "totalCents"]
        .every((key) => tutorPayment[key] === undefined),
      Object.keys(tutorPayment).join(","));
    const parentView = await bookings.getBooking(heldBooking.id, parent);
    check("the purchaser still sees their full payment", parentView.paymentId?.totalCents > 0);

    // A weekly series, so "amount paid" has to be the payment, not one lesson.
    const series = await bookings.createBooking(
      lesson({ startAt: at(2, 18), recurrence: RECURRENCE.WEEKLY, occurrences: 2, studentProfileId: String(childB._id) }),
      parent,
    );
    const seriesPayment = await Payment.findById(series.payment.id).lean();
    await settle(series.payment.id);

    if (!devMailboxAllowed()) {
      skip("confirmation email content", "the development mailbox is disabled in this process");
    } else {
      const toParent = readDevMail({ to: parentUser.email }).find((m) => m.text.includes(series.bookings[0].reference));
      const toTutor = readDevMail({ to: tutorUser.email }).find((m) => m.text.includes(series.bookings[0].reference));
      if (!toParent || !toTutor) {
        skip("confirmation email content", "mail did not go through the console transport in this process");
      } else {
        check("the parent's email states the amount actually charged for the series (R24.8)",
          toParent.text.includes(`Amount paid: ${formatMoney(seriesPayment.totalCents)} for 2 lessons`), toParent.text);
        check("the parent's email says where — the platform, link on the lesson page (R24.7)",
          toParent.text.includes("Where: Online — Zoom") && /lesson page/i.test(toParent.text));
        check("the parent's email carries the policy read from Settings (R24.9)",
          toParent.text.includes(`${settings.freeCancellationWindowHours} hours`) &&
            toParent.text.includes(`${settings.lateCancellationRefundPercent}%`));
        check("the parent's link is the family lesson page",
          toParent.text.includes(`/bookings/${series.bookings[0].id}`) && !toParent.text.includes("/tutor/bookings/"));
        check("the tutor's link is the tutor's lesson page (R24.1)",
          toTutor.text.includes(`/tutor/bookings/${series.bookings[0].id}`));
        check("the tutor is told their earnings, not the family's card total",
          toTutor.text.includes("Your earnings:") && !toTutor.text.includes("Amount paid:"));
        check("no email carries a join link", !/zoom\.us\/j\//.test(toParent.text + toTutor.text));
      }
    }

    // --- Reschedule ----------------------------------------------------------
    section("R14.4 / R17.3 — reschedule uses the same busy time, less itself");

    const ontoGroup = await throws(
      () => bookings.rescheduleBooking(heldBooking.id, { startAt: at(0, 15, 30) }, parent),
      errorIs(409),
    );
    check("rescheduling onto a published group session is refused",
      ontoGroup.threw && ontoGroup.matched, ontoGroup.error?.message);
    check("…and the lesson keeps its time",
      (await Booking.findById(heldBooking.id).lean()).startAt.toISOString() === at(1, 14));

    const moved = await bookings.rescheduleBooking(heldBooking.id, { startAt: at(1, 14, 30) }, parent);
    check("moving a lesson into an overlap with only its own old hour is allowed",
      new Date(moved.startAt).toISOString() === at(1, 14, 30));
    check("the move is narrated once in the thread",
      (await Message.countDocuments({ bookingId: heldBooking.id, systemEvent: MESSAGE_SYSTEM_EVENTS.BOOKING_RESCHEDULED })) === 1);

    // --- R26.5 ----------------------------------------------------------------
    section("R26.5 — an OTHER location says where, and is private until confirmed");

    const schemaNoWhere = createBookingSchema.safeParse({
      ...lesson({ startAt: at(3, 15), mode: LESSON_MODES.IN_PERSON, meetingProvider: undefined }),
      location: { type: IN_PERSON_LOCATIONS.OTHER },
    });
    check("the request schema refuses OTHER without a description",
      !schemaNoWhere.success && schemaNoWhere.error.issues.some((i) => i.path.join(".") === "location.description"));

    const inPerson = (location, over = {}) =>
      lesson({ startAt: at(3, 15), mode: LESSON_MODES.IN_PERSON, meetingProvider: undefined, location, ...over });

    const notOffered = await throws(
      () => bookings.createBooking(inPerson({ type: IN_PERSON_LOCATIONS.STUDENT_HOME, addressLine: "1 Main St" }), parent),
      errorIs("LOCATION_NOT_OFFERED"),
    );
    check("a location type the tutor does not offer is refused by the service",
      notOffered.threw && notOffered.matched, notOffered.error?.message);
    const noWhere = await throws(
      () => bookings.createBooking(inPerson({ type: IN_PERSON_LOCATIONS.OTHER, description: "  " }), parent),
      errorIs("LOCATION_DESCRIPTION_REQUIRED"),
    );
    check("the service refuses OTHER without a description, whatever skipped the schema",
      noWhere.threw && noWhere.matched, noWhere.error?.message);

    const where = `Study room 2, Yorkville library ${run}`;
    const other = await bookings.createBooking(
      inPerson({ type: IN_PERSON_LOCATIONS.OTHER, description: where, label: "Tutor's studio" }),
      parent,
    );
    const otherId = other.bookings[0].id;
    const stored = await Booking.findById(otherId).select("+location.description").lean();
    check("the description is stored on the booking's location, with a derived label",
      stored.location.description === where && stored.location.label !== "Tutor's studio");
    check("it is not selected by default", (await Booking.findById(otherId).lean()).location.description === undefined);
    check("the payload returned at checkout does not carry it", !JSON.stringify(other.bookings).includes(where));
    const beforeConfirm = await bookings.getBooking(otherId, tutorActor);
    check("the tutor cannot read it before the lesson is confirmed", beforeConfirm.location?.description === undefined);
    await settle(other.payment.id);
    const afterConfirm = await bookings.getBooking(otherId, tutorActor);
    check("the tutor reads it once the lesson is confirmed", afterConfirm.location?.description === where);
    if (devMailboxAllowed()) {
      const mail = readDevMail({ to: tutorUser.email }).find((m) => m.text.includes(other.bookings[0].reference));
      if (mail) check("the confirmation says where an OTHER lesson is (R24.7)", mail.text.includes(where));
    }

    // --- R18.10 ---------------------------------------------------------------
    section("R18.10 — a booking from a request is checked, then closes it on payment");

    const { request } = await requests.createTutorRequest(
      {
        studentProfileId: String(childA._id),
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
        goal: `Integration 45 request ${run} — safe to delete.`,
      },
      parent,
    );
    ids.requests.push(new mongoose.Types.ObjectId(request.id));
    await requests.expressInterest(request.id, { message: "I teach this course every term and have evenings free." }, tutorActor);
    const match = await TutorMatch.findOne({ requestId: request.id, tutorProfileId: tutor._id }).lean();

    const strangerBooks = await throws(
      () => bookings.createBooking(
        lesson({ startAt: at(4, 15), studentProfileId: String(foreignChild._id), requestId: request.id }),
        otherParent,
      ),
      errorIs(403),
    );
    check("another family cannot attach somebody else's request", strangerBooks.threw && strangerBooks.matched,
      strangerBooks.error?.message);
    check("…and nothing was written",
      !(await Booking.exists({ tutorProfileId: tutor._id, startAt: new Date(at(4, 15)) })));

    const fromRequest = await bookings.createBooking(
      // An injected match id is not the client's to set.
      { ...lesson({ startAt: at(4, 15), requestId: request.id }), tutorMatchId: String(new mongoose.Types.ObjectId()) },
      parent,
    );
    const reqBooking = await Booking.findById(fromRequest.bookings[0].id).lean();
    check("the booking carries the request and the match the server resolved",
      String(reqBooking.requestId) === request.id && String(reqBooking.tutorMatchId) === String(match._id));
    check("checkout alone does not close the request",
      (await TutorRequest.findById(request.id).lean()).status === REQUEST_STATUS.OPEN);

    await settle(fromRequest.payment.id);
    const closedRequest = await TutorRequest.findById(request.id).lean();
    const bookedMatch = await TutorMatch.findById(match._id).lean();
    check("paying for it closes the request as booked with this tutor",
      closedRequest.status === REQUEST_STATUS.MATCHED && String(closedRequest.bookedTutorProfileId) === String(tutor._id));
    check("…and marks the tutor's match booked", bookedMatch.status === MATCH_STATUS.BOOKED);

    // --- R3.2 -------------------------------------------------------------------
    section("R3.2 — a parent's lessons filter by child, within their own account");

    const forBen = await bookings.listBookings(parent, { scope: "ALL", page: 1, studentProfileId: String(childB._id) });
    check("filtering by a child returns only that child's lessons",
      forBen.total === 2 && forBen.items.every((b) => String(b.studentProfileId?.id ?? b.studentProfileId) === String(childB._id)),
      `total ${forBen.total}`);
    const forAva = await bookings.listBookings(parent, { scope: "ALL", page: 1, studentProfileId: String(childA._id) });
    check("…and the other child's lessons are not among them", forAva.total >= 3 &&
      !forAva.items.some((b) => String(b.studentProfileId?.id ?? b.studentProfileId) === String(childB._id)));
    const foreign = await bookings.listBookings(parent, { scope: "ALL", page: 1, studentProfileId: String(foreignChild._id) });
    check("naming another family's child returns nothing", foreign.total === 0);

    // --- R25.1 ---------------------------------------------------------------------
    section("R25.1 — production never fabricates a meeting link");

    const savedAppEnv = process.env.APP_ENV;
    const savedMeeting = process.env.MEETING_PROVIDER;
    try {
      // Production never guesses a provider, so the deployment names the
      // development stand-in explicitly — the case R25.1 is about.
      process.env.APP_ENV = "production";
      process.env.MEETING_PROVIDER = "development";
      resetMeetingProviders();
      const prodProvider = getMeetingProvider(MEETING_PROVIDERS.ZOOM);
      const room = await provisionMeeting({
        reference: `IT45-${run}`,
        courseName: course.name,
        startAt: new Date(at(5, 15)),
        durationMinutes: 60,
        timeZone: "America/Toronto",
        meetingProvider: MEETING_PROVIDERS.ZOOM,
      });
      check("with no provider configured, production issues no room", prodProvider.name === "NONE" && room === undefined,
        `${prodProvider.name} / ${JSON.stringify(room)}`);
    } finally {
      if (savedAppEnv === undefined) delete process.env.APP_ENV;
      else process.env.APP_ENV = savedAppEnv;
      if (savedMeeting === undefined) delete process.env.MEETING_PROVIDER;
      else process.env.MEETING_PROVIDER = savedMeeting;
      resetMeetingProviders();
    }
    check("development keeps its stand-in links", getMeetingProvider(MEETING_PROVIDERS.ZOOM).name === "MOCK");

    // --- §37 steps 11 and 18 ---------------------------------------------------------
    section("§37 steps 11 and 18 — the widget's selection survives a link and sign-in");

    const selection = {
      courseId: String(course._id),
      studentProfileId: String(childA._id),
      mode: LESSON_MODES.IN_PERSON,
      durationMinutes: 90,
      locationType: IN_PERSON_LOCATIONS.OTHER,
      meetingProvider: MEETING_PROVIDERS.ZOOM,
      startAt: at(5, 15),
      requestId: request.id,
    };
    const href = bookingWidgetHref(tutor.slug, selection);
    const next = internalPath(href);
    check("the link is an internal path that survives the sign-in `next` sanitiser and limit",
      next === href && href.length <= 300 && href.endsWith("#availability"), href);
    const back = readBookingWidgetParams(new URL(`http://x${href}`).searchParams);
    check("reading it back yields the same selection",
      Object.entries(selection).every(([key, value]) => back[key] === value), JSON.stringify(back));
  } finally {
    const profileIds = ids.profiles;
    const bookingRows = await Booking.find({ tutorProfileId: { $in: profileIds } }).select("_id paymentId").lean();
    const bookingIds = bookingRows.map((b) => b._id);
    const sessionIds = (await GroupSession.find({ tutorProfileId: { $in: profileIds } }).select("_id").lean()).map((s) => s._id);
    const conversationIds = (await Conversation.find({ tutorUserId: { $in: ids.users } }).select("_id").lean()).map((c) => c._id);
    await Message.deleteMany({ conversationId: { $in: conversationIds } });
    await Conversation.deleteMany({ _id: { $in: conversationIds } });
    await BookingSlotLock.deleteMany({ bookingId: { $in: bookingIds } });
    await Payment.deleteMany({ purchaserId: { $in: ids.users } });
    await Booking.deleteMany({ _id: { $in: bookingIds } });
    await GroupEnrolment.deleteMany({ sessionId: { $in: sessionIds } });
    await GroupSession.deleteMany({ _id: { $in: sessionIds } });
    await TutorMatch.deleteMany({ requestId: { $in: ids.requests } });
    await TutorRequest.deleteMany({ $or: [{ _id: { $in: ids.requests } }, { ownerId: { $in: ids.users } }] });
    await Notification.deleteMany({ userId: { $in: ids.users } });
    await AuditLog.deleteMany({ entityId: { $in: [...bookingIds, ...sessionIds, ...ids.requests] } });
    await Availability.deleteMany({ tutorProfileId: { $in: profileIds } });
    await StudentProfile.deleteMany({ _id: { $in: ids.students } });
    await TutorProfile.deleteMany({ _id: { $in: profileIds } });
    await User.deleteMany({ _id: { $in: ids.users } });
  }
}
