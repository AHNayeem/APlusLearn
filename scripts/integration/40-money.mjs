/**
 * Money integrity (S2, S3, S4, R16.4, R16.7, R22.2, R27.2, R27.5, R27.6,
 * R28.19).
 *
 * A fixture tutor with a payout account, a fixture family and lessons in
 * every state the rules care about, all created here and removed in
 * `finally`. The development payment provider moves no real money.
 */
export default async function moneySuite({ section, check, skip, throws, connectForSuite, randomUUID }) {
  section("Money — fixtures");
  if (!(await connectForSuite())) return skip("money", "MongoDB is not reachable");

  process.env.PAYMENT_PROVIDER = "development";
  const models = await import("@/models");
  const { User, TutorProfile, StudentProfile, Booking, Payment, Payout, PayoutAccount, PayoutAdjustment, Dispute, Course } = models;
  const { createPayout, updatePayoutStatus } = await import("@/services/payout.service");
  const { cancelBooking, reportNoShow, completeEndedLessons, listBookings } = await import("@/services/booking.service");
  const { createDispute, resolveDispute } = await import("@/services/dispute.service");
  const { netTutorEarnings } = await import("@/lib/booking/pricing");
  const { getSettings } = await import("@/services/settings.service");
  const { BOOKING_STATUS, PAYMENT_STATUS } = await import("@/constants");

  const course = await Course.findOne({ code: "MHF4U" }).lean();
  if (!course) return skip("money", "seeded curriculum missing");

  const tag = randomUUID().slice(0, 8);
  const made = { users: [], profiles: [], students: [], bookings: [], payments: [], payouts: [], accounts: [] };
  const HOUR = 3600000;
  const DAY = 24 * HOUR;
  const settings = await getSettings();

  try {
    const tutorUser = await User.create({ email: `qa-money-t-${tag}@example.com`, firstName: "Mona", lastName: "Tutor", role: "TUTOR", status: "ACTIVE", emailVerifiedAt: new Date() });
    made.users.push(tutorUser._id);
    const parentUser = await User.create({ email: `qa-money-p-${tag}@example.com`, firstName: "Paul", lastName: "Parent", role: "PARENT", status: "ACTIVE", emailVerifiedAt: new Date() });
    made.users.push(parentUser._id);
    const stranger = await User.create({ email: `qa-money-s-${tag}@example.com`, firstName: "Sam", lastName: "Stranger", role: "PARENT", status: "ACTIVE", emailVerifiedAt: new Date() });
    made.users.push(stranger._id);
    const profile = await TutorProfile.create({
      userId: tutorUser._id, slug: `mona-t-qa-${tag}`, headline: "QA money tutor headline", bio: "x".repeat(120),
      status: "APPROVED", isSearchable: false, hourlyRateCents: 6000, minHourlyRateCents: 6000, lessonModes: ["ONLINE"],
      courseIds: [course._id], courseCodes: ["MHF4U"], provinceCodes: ["ON"], timeZone: "America/Toronto",
    });
    made.profiles.push(profile._id);
    const child = await StudentProfile.create({ ownerId: parentUser._id, firstName: "Kid", lastName: "Parent", isMinor: true });
    made.students.push(child._id);
    const account = await PayoutAccount.create({
      tutorUserId: tutorUser._id, provider: "MOCK", providerAccountId: `acct_qa_${tag}`,
      onboardingStatus: "COMPLETE", payoutsEnabled: true, chargesEnabled: true,
    });
    made.accounts.push(account._id);

    const parent = { id: String(parentUser._id), role: "PARENT" };
    const tutor = { id: String(tutorUser._id), role: "TUTOR" };
    const admin = { id: String(tutorUser._id), role: "ADMIN" };
    const price = { hourlyRateCents: 6000, durationMinutes: 60, subtotalCents: 6000, commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100, totalCents: 6000, currency: "CAD" };

    let n = 0;
    const lesson = async ({ status, endAgoMs = 2 * HOUR, paid = true, completedAgoMs, creditAppliedCents = 0 }) => {
      n += 1;
      const endAt = new Date(Date.now() - endAgoMs);
      const booking = await Booking.create({
        reference: `QA-M-${tag}-${n}`, purchaserId: parentUser._id, studentProfileId: child._id,
        tutorProfileId: profile._id, tutorUserId: tutorUser._id, courseId: course._id, courseName: course.name,
        mode: "ONLINE", startAt: new Date(endAt.getTime() - HOUR), endAt, durationMinutes: 60,
        timeZone: "America/Toronto", status, price,
        ...(completedAgoMs !== undefined ? { completedAt: new Date(Date.now() - completedAgoMs) } : {}),
      });
      made.bookings.push(booking._id);
      const payment = await Payment.create({
        bookingId: booking._id, purchaserId: parentUser._id, tutorUserId: tutorUser._id,
        subtotalCents: 6000, commissionPercent: 15, commissionCents: 900, tutorEarningsCents: 5100,
        totalCents: 6000 - creditAppliedCents, creditAppliedCents, provider: "MOCK",
        status: paid ? PAYMENT_STATUS.PAID : PAYMENT_STATUS.REQUIRES_PAYMENT,
        ...(paid ? { paidAt: new Date(endAt.getTime() - 2 * DAY), receiptNumber: `RCPT-QA-${tag}-${n}` } : {}),
      });
      made.payments.push(payment._id);
      await Booking.updateOne({ _id: booking._id }, { $set: { paymentId: payment._id } });
      return Booking.findById(booking._id);
    };

    // --- S2 / R27.5 no-show ------------------------------------------------
    section("S2 / R27.5 — a no-show report cannot refund a lesson by itself");
    const done = await lesson({ status: BOOKING_STATUS.COMPLETED, completedAgoMs: HOUR });
    const onCompleted = await throws(() => reportNoShow(done._id, { party: "TUTOR", note: "never came" }, parent));
    check("a completed lesson cannot be reported as a tutor no-show", onCompleted.threw && /completed/i.test(onCompleted.error?.message ?? ""), onCompleted.error?.message);

    const stale = await lesson({ status: BOOKING_STATUS.CONFIRMED, endAgoMs: (settings.noShowReportWindowHours + 2) * HOUR });
    const late = await throws(() => reportNoShow(stale._id, { party: "TUTOR", note: "never came" }, parent));
    check("outside the window a no-show report is refused", late.threw && late.error?.code === "WINDOW_CLOSED", late.error?.code);

    const strangerTry = await throws(() => reportNoShow(stale._id, { party: "TUTOR", note: "never came" }, { id: String(stranger._id), role: "PARENT" }));
    check("someone outside the lesson cannot report it", strangerTry.threw && strangerTry.error?.name === "AuthorizationError", strangerTry.error?.name);

    const missed = await lesson({ status: BOOKING_STATUS.CONFIRMED });
    const report = await reportNoShow(missed._id, { party: "TUTOR", note: "The tutor never joined." }, parent);
    const afterReport = await Booking.findById(missed._id).lean();
    const missedPayment = await Payment.findById(afterReport.paymentId).lean();
    check("a learner's tutor no-show opens a dispute", Boolean(report.disputeId) && afterReport.status === BOOKING_STATUS.DISPUTED);
    check("…remembering what it interrupted", afterReport.preDisputeStatus === BOOKING_STATUS.CONFIRMED);
    check("…and refunds nothing until it is decided", (missedPayment.refundedCents ?? 0) === 0 && (afterReport.refundedCents ?? 0) === 0);

    const upheld = await resolveDispute(report.disputeId, { resolution: "RESOLVED_REFUND", note: "Tutor confirmed they missed it." }, admin);
    const afterUpheld = await Booking.findById(missed._id).lean();
    check("an upheld tutor no-show settles as NO_SHOW_TUTOR with the money back", afterUpheld.status === BOOKING_STATUS.NO_SHOW_TUTOR && afterUpheld.refundedCents === 6000 && upheld.refundIssuedCents === 6000,
      `${afterUpheld.status} ${afterUpheld.refundedCents}`);

    const studentMissed = await lesson({ status: BOOKING_STATUS.CONFIRMED });
    await reportNoShow(studentMissed._id, { party: "STUDENT", note: "Nobody joined the call." }, tutor);
    const afterStudent = await Booking.findById(studentMissed._id).lean();
    const expectedRefund = Math.round((6000 * (settings.studentNoShowRefundPercent ?? 0)) / 100);
    check("a tutor's student no-show applies the policy and records it on the lesson", afterStudent.status === BOOKING_STATUS.NO_SHOW_STUDENT && (afterStudent.refundedCents ?? 0) === expectedRefund,
      `${afterStudent.status} ${afterStudent.refundedCents} vs ${expectedRefund}`);
    const twice = await throws(() => reportNoShow(studentMissed._id, { party: "STUDENT", note: "again please" }, tutor));
    check("a lesson cannot be reported twice", twice.threw);

    // --- S4 disputes ----------------------------------------------------------
    section("S4 / R27.6 — disputes keep the lesson's real outcome");
    const unpaid = await lesson({ status: BOOKING_STATUS.EXPIRED, paid: false });
    const onUnpaid = await throws(() => createDispute({ bookingId: unpaid._id, reason: "LESSON_QUALITY", description: "x".repeat(30) }, parent));
    check("an unpaid, expired lesson cannot be disputed", onUnpaid.threw, onUnpaid.error?.message);

    const quality = await lesson({ status: BOOKING_STATUS.COMPLETED, completedAgoMs: HOUR });
    const dispute = await createDispute({ bookingId: quality._id, reason: "LESSON_QUALITY", description: "The lesson ended twenty minutes early." }, parent);
    await resolveDispute(dispute.id, { resolution: "RESOLVED_PARTIAL_REFUND", refundCents: 3000, note: "Half refunded." }, admin);
    const afterPartial = await Booking.findById(quality._id).lean();
    check("a partial refund keeps the lesson COMPLETED", afterPartial.status === BOOKING_STATUS.COMPLETED);
    check("…with the refund recorded on the booking", afterPartial.refundedCents === 3000, String(afterPartial.refundedCents));
    check("…so the tutor's share is netted", netTutorEarnings(afterPartial.price, afterPartial.refundedCents) === 2550);

    const rejectedLesson = await lesson({ status: BOOKING_STATUS.COMPLETED, completedAgoMs: HOUR });
    const rejected = await createDispute({ bookingId: rejectedLesson._id, reason: "CONDUCT", description: "Something felt wrong about the lesson." }, parent);
    await resolveDispute(rejected.id, { resolution: "REJECTED", note: "No evidence." }, admin);
    check("a rejected dispute restores the status it interrupted", (await Booking.findById(rejectedLesson._id).lean()).status === BOOKING_STATUS.COMPLETED);
    const decidedTwice = await throws(() => resolveDispute(rejected.id, { resolution: "RESOLVED_REFUND", note: "changed mind" }, admin));
    check("a dispute decision is terminal", decidedTwice.threw);

    // --- S3 payouts -------------------------------------------------------------
    section("S3 / R16.4 / R28.19 — payouts pay each lesson once, net of refunds");
    const holdMs = ((settings.payoutHoldDays ?? 3) + 1) * DAY;
    // Every payable lesson above is past its hold only if completed long
    // enough ago, so settle the fixtures that should be payable now.
    await Booking.updateMany({ _id: { $in: made.bookings }, status: { $in: [BOOKING_STATUS.COMPLETED, BOOKING_STATUS.NO_SHOW_STUDENT] } }, { $set: { completedAt: new Date(Date.now() - holdMs) } });
    const fresh = await lesson({ status: BOOKING_STATUS.COMPLETED, completedAgoMs: holdMs });

    const runs = await Promise.allSettled([createPayout(tutor.id, admin), createPayout(tutor.id, admin)]);
    const succeeded = runs.filter((r) => r.status === "fulfilled").map((r) => r.value);
    for (const p of succeeded) made.payouts.push(p.id ?? p._id);
    const payouts = await Payout.find({ tutorUserId: tutorUser._id }).lean();
    made.payouts.push(...payouts.map((p) => p._id));
    const paidBookings = await Booking.find({ _id: { $in: made.bookings }, payoutId: { $exists: true } }).lean();
    const totalPaid = payouts.reduce((sum, p) => sum + (p.amountCents ?? 0), 0);
    const expectedTotal = paidBookings.reduce((sum, b) => sum + netTutorEarnings(b.price, b.refundedCents), 0);
    check("two simultaneous payout runs pay every lesson exactly once", totalPaid === expectedTotal && paidBookings.some((b) => String(b._id) === String(fresh._id)),
      `paid ${totalPaid} vs owed ${expectedTotal} over ${payouts.length} payout(s)`);
    check("the half-refunded lesson is paid half its share", paidBookings.some((b) => String(b._id) === String(quality._id)));

    const firstPayout = payouts[0];
    await updatePayoutStatus(firstPayout._id, { status: "FAILED", note: "bank rejected" }, admin);
    const failedToPaid = await throws(() => updatePayoutStatus(firstPayout._id, { status: "PAID", note: "oops" }, admin));
    check("a FAILED payout can never become PAID", failedToPaid.threw && failedToPaid.error?.code === "INVALID_PAYOUT_TRANSITION", failedToPaid.error?.code);
    const released = await Booking.countDocuments({ payoutId: firstPayout._id });
    check("…and its lessons are released for a new payout", released === 0, `${released} still attached`);

    const second = await createPayout(tutor.id, admin);
    made.payouts.push(second.id ?? second._id);
    await updatePayoutStatus(second.id ?? second._id, { status: "PAID", note: "sent" }, admin);
    const paidLesson = await Booking.findOne({ _id: fresh._id }).lean();
    // A refund after the payout is carried to the next one.
    const lateDispute = await createDispute({ bookingId: fresh._id, reason: "LESSON_QUALITY", description: "Found out later it was the wrong course." }, parent);
    await resolveDispute(lateDispute.id, { resolution: "RESOLVED_PARTIAL_REFUND", refundCents: 2000, note: "Partial." }, admin);
    const adjustment = await PayoutAdjustment.findOne({ bookingId: fresh._id }).lean();
    check("a refund after payout becomes a deduction on the next payout", Boolean(paidLesson.payoutId) && adjustment?.status === "OPEN" && adjustment.amountCents === 5100 - netTutorEarnings(price, 2000),
      JSON.stringify(adjustment && { s: adjustment.status, a: adjustment.amountCents }));

    // --- R27.2 / R16.7 cancellations ------------------------------------------
    section("R27.2 / R16.7 — cancellations refund what was collected, and unpaid ones void");
    const future = async (paid, creditAppliedCents = 0) => {
      const b = await lesson({ status: paid ? BOOKING_STATUS.CONFIRMED : BOOKING_STATUS.PENDING_PAYMENT, endAgoMs: -5 * DAY, paid, creditAppliedCents });
      return b;
    };
    const pending = await future(false);
    const cancelledUnpaid = await cancelBooking(pending._id, { reason: "changed plans" }, parent);
    const voided = await Payment.findById(pending.paymentId).lean();
    check("cancelling an unpaid lesson refunds nothing", cancelledUnpaid.refundCents === 0);
    check("…and voids its checkout", voided.status === PAYMENT_STATUS.FAILED, voided.status);

    const withCredit = await future(true, 2000);
    const credited = await cancelBooking(withCredit._id, { reason: "changed plans" }, parent);
    const creditPayment = await Payment.findById(withCredit.paymentId).lean();
    check("a credit-applied lesson cancels without exceeding what the card paid", credited.refundCents === 6000 && (creditPayment.refundedCents ?? 0) <= 4000,
      `${credited.refundCents} total, ${creditPayment.refundedCents} to card`);
    check("…and the lesson records the whole refund", (await Booking.findById(withCredit._id).lean()).refundedCents === 6000);

    // --- R22.2 ended lessons ---------------------------------------------------
    section("R22.2 — ended lessons are past at once, and complete after the window");
    const justEnded = await lesson({ status: BOOKING_STATUS.CONFIRMED, endAgoMs: HOUR });
    const past = await listBookings(parent, { scope: "PAST", page: 1, pageSize: 50 });
    const upcoming = await listBookings(parent, { scope: "UPCOMING", page: 1, pageSize: 50 });
    check("an ended, unmarked lesson is listed as past", past.items.some((b) => String(b.id) === String(justEnded._id)));
    check("…and not as upcoming", !upcoming.items.some((b) => String(b.id) === String(justEnded._id)));
    const old = await lesson({ status: BOOKING_STATUS.CONFIRMED, endAgoMs: (settings.noShowReportWindowHours + 1) * HOUR });
    await completeEndedLessons();
    await completeEndedLessons();
    check("after the no-show window an unmarked lesson completes", (await Booking.findById(old._id).lean()).status === BOOKING_STATUS.COMPLETED);
    check("…but not one still inside it", (await Booking.findById(justEnded._id).lean()).status === BOOKING_STATUS.CONFIRMED);
  } finally {
    await Dispute.deleteMany({ bookingId: { $in: made.bookings } });
    await PayoutAdjustment.deleteMany({ bookingId: { $in: made.bookings } });
    await Payout.deleteMany({ tutorUserId: { $in: made.users } });
    await Payment.deleteMany({ _id: { $in: made.payments } });
    await Booking.deleteMany({ _id: { $in: made.bookings } });
    await PayoutAccount.deleteMany({ _id: { $in: made.accounts } });
    await StudentProfile.deleteMany({ _id: { $in: made.students } });
    await TutorProfile.deleteMany({ _id: { $in: made.profiles } });
    await User.deleteMany({ _id: { $in: made.users } });
  }
}
