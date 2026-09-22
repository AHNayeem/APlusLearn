import "server-only";
import {
  TutorPackage,
  PackagePurchase,
  TutorProfile,
  StudentProfile,
  Course,
  Booking,
} from "@/models";
import {
  PACKAGE_STATUS,
  PURCHASABLE_PACKAGE_STATUSES,
  PACKAGE_PURCHASE_STATUS,
  USABLE_PACKAGE_STATUSES,
  BOOKING_STATUS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
} from "@/constants";
import {
  NotFoundError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
} from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicReference } from "@/lib/auth/tokens";
import { addDays } from "@/lib/utils/time";
import { formatMoney } from "@/lib/utils/format";
import { rateForCourse } from "@/lib/booking/pricing";
import {
  packageBreakdown,
  assessPackagePrice,
  unusedPackageValue,
} from "@/lib/booking/packages";
import { getSettings } from "./settings.service";
import { createPaymentForPackage, refundPayment } from "./payment.service";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";

/**
 * Tutor packages (§41 Phase 2).
 *
 * A package is a block of lessons bought up front. The rules that matter:
 *
 *   **One payment system.** A purchase creates an ordinary `Payment` and
 *   settles through the same webhook, refund and receipt paths as any lesson.
 *   Nothing here talks to a payment provider.
 *
 *   **One booking lifecycle.** A lesson drawn from a package is an ordinary
 *   `Booking` — same availability check, same cancellation policy, same
 *   payout. What differs is only that it is already paid for.
 *
 *   **A lesson cannot be drawn twice.** Consumption is a single conditional
 *   update on the purchase document, so two bookings made at the same instant
 *   cannot take the same last session, and no booking can push a balance past
 *   what was bought.
 *
 * The prices are the tutor's. The only rule imposed on them is that a package
 * may not cost more per hour than the same lessons booked individually — see
 * `lib/booking/packages`.
 */

// --- The offer -------------------------------------------------------------

export async function listPackagesForTutor(actor, { status } = {}) {
  const profile = await tutorProfileFor(actor.id);
  if (!profile) return { packages: [] };

  const query = { tutorProfileId: profile._id };
  if (status) query.status = status;
  else query.status = { $ne: PACKAGE_STATUS.ARCHIVED };

  const packages = await TutorPackage.find(query).sort({ createdAt: -1 }).lean();
  return { packages: toPlain(packages) };
}

/** The packages a family can actually buy from one tutor. */
export async function listPublicPackages(tutorProfileId) {
  const settings = await getSettings();
  if (settings.packages?.enabled === false) return [];

  const packages = await TutorPackage.find({
    tutorProfileId,
    status: { $in: PURCHASABLE_PACKAGE_STATUSES },
  })
    .sort({ sessionCount: 1 })
    .lean();

  return toPlain(packages);
}

export async function createPackage(input, actor) {
  const settings = await getSettings();
  if (settings.packages?.enabled === false) {
    throw new BusinessRuleError("Packages are not available on this platform.", "PACKAGES_DISABLED");
  }

  const profile = await TutorProfile.findOne({ userId: actor.id }).lean();
  if (!profile) throw new NotFoundError("You do not have a tutor profile.");

  const course = await Course.findById(input.courseId).lean();
  if (!course) throw new NotFoundError("That course is no longer available.");

  // A tutor can only sell a package for a course they teach — the same rule
  // that governs an ordinary booking (§42).
  const teaches = (profile.courses ?? []).some((c) => String(c.courseId) === String(course._id));
  if (!teaches) {
    throw new BusinessRuleError("You do not teach that course.", "COURSE_NOT_TAUGHT");
  }
  if (!profile.lessonModes?.includes(input.mode)) {
    throw new BusinessRuleError("You do not offer that lesson type.", "MODE_NOT_OFFERED");
  }

  assertSessionBounds(input.sessionCount, settings);

  const active = await TutorPackage.countDocuments({
    tutorProfileId: profile._id,
    status: PACKAGE_STATUS.ACTIVE,
  });
  if (active >= (settings.packages?.maxActivePerTutor ?? 10)) {
    throw new BusinessRuleError(
      `You can have ${settings.packages.maxActivePerTutor} packages on sale at once.`,
      "PACKAGE_LIMIT_REACHED",
    );
  }

  const pricing = priceOrThrow(input, profile, settings);

  const created = await TutorPackage.create({
    tutorProfileId: profile._id,
    tutorUserId: actor.id,
    title: input.title,
    description: input.description,
    courseId: course._id,
    courseCode: course.code,
    courseName: course.name,
    subjectName: course.subjectName,
    sessionCount: input.sessionCount,
    sessionDurationMinutes: input.sessionDurationMinutes,
    mode: input.mode,
    priceCents: input.priceCents,
    perSessionCents: pricing.perSessionCents,
    effectiveHourlyRateCents: pricing.effectiveHourlyRateCents,
    savingPercent: pricing.savingPercent,
    validityDays: input.validityDays,
    status: PACKAGE_STATUS.DRAFT,
  });

  return toPlain(created);
}

/**
 * Edit an offer.
 *
 * Terms already bought are untouched by this: a purchase carries its own copy
 * of everything, so raising a price changes what new buyers pay and nothing
 * about anybody's existing balance.
 */
export async function updatePackage(id, input, actor) {
  const settings = await getSettings();
  const pkg = await ownedPackage(id, actor);

  if (pkg.status === PACKAGE_STATUS.ARCHIVED) {
    throw new BusinessRuleError("An archived package cannot be edited.", "PACKAGE_ARCHIVED");
  }

  const profile = await TutorProfile.findById(pkg.tutorProfileId).lean();

  for (const field of ["title", "description", "validityDays"]) {
    if (input[field] !== undefined) pkg[field] = input[field];
  }

  const repriced =
    input.priceCents !== undefined ||
    input.sessionCount !== undefined ||
    input.sessionDurationMinutes !== undefined;

  if (repriced) {
    if (input.sessionCount !== undefined) assertSessionBounds(input.sessionCount, settings);

    const next = {
      priceCents: input.priceCents ?? pkg.priceCents,
      sessionCount: input.sessionCount ?? pkg.sessionCount,
      sessionDurationMinutes: input.sessionDurationMinutes ?? pkg.sessionDurationMinutes,
      courseId: pkg.courseId,
    };
    const pricing = priceOrThrow(next, profile, settings);

    pkg.priceCents = next.priceCents;
    pkg.sessionCount = next.sessionCount;
    pkg.sessionDurationMinutes = next.sessionDurationMinutes;
    pkg.perSessionCents = pricing.perSessionCents;
    pkg.effectiveHourlyRateCents = pricing.effectiveHourlyRateCents;
    pkg.savingPercent = pricing.savingPercent;
  }

  await pkg.save();
  return toPlain(pkg);
}

/** Put a package on sale, take it off, or retire it for good. */
export async function setPackageStatus(id, { status }, actor) {
  const pkg = await ownedPackage(id, actor);

  if (pkg.status === PACKAGE_STATUS.ARCHIVED) {
    throw new ConflictError("That package has already been archived.");
  }

  if (status === PACKAGE_STATUS.ACTIVE) {
    const settings = await getSettings();
    const active = await TutorPackage.countDocuments({
      tutorProfileId: pkg.tutorProfileId,
      status: PACKAGE_STATUS.ACTIVE,
      _id: { $ne: pkg._id },
    });
    if (active >= (settings.packages?.maxActivePerTutor ?? 10)) {
      throw new BusinessRuleError(
        `You can have ${settings.packages.maxActivePerTutor} packages on sale at once.`,
        "PACKAGE_LIMIT_REACHED",
      );
    }
    if (!pkg.publishedAt) pkg.publishedAt = new Date();
  }

  if (status === PACKAGE_STATUS.ARCHIVED) pkg.archivedAt = new Date();

  pkg.status = status;
  await pkg.save();

  await recordAudit({
    actor,
    action:
      status === PACKAGE_STATUS.ARCHIVED
        ? AUDIT_ACTIONS.PACKAGE_ARCHIVED
        : AUDIT_ACTIONS.PACKAGE_PUBLISHED,
    entityType: "TutorPackage",
    entityId: pkg._id,
    metadata: { title: pkg.title, status },
  });

  return toPlain(pkg);
}

// --- Buying ----------------------------------------------------------------

/**
 * Buy a package.
 *
 * Creates the purchase in PENDING_PAYMENT and an ordinary `Payment` beside
 * it. Nothing is usable until that payment settles — the same rule a booking
 * follows, and for the same reason.
 */
export async function purchasePackage(input, actor) {
  const settings = await getSettings();
  if (settings.packages?.enabled === false) {
    throw new BusinessRuleError("Packages are not available on this platform.", "PACKAGES_DISABLED");
  }

  const [pkg, student] = await Promise.all([
    TutorPackage.findById(input.packageId).lean(),
    StudentProfile.findById(input.studentProfileId).lean(),
  ]);

  if (!pkg) throw new NotFoundError("That package is no longer available.");
  if (!student) throw new NotFoundError("Choose who the lessons are for.");

  // Ownership against the loaded record, never a request field (§42).
  if (String(student.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("You can only buy packages for your own students.");
  }
  if (!PURCHASABLE_PACKAGE_STATUSES.includes(pkg.status)) {
    throw new BusinessRuleError("That package is not on sale.", "PACKAGE_NOT_ON_SALE");
  }

  const tutor = await TutorProfile.findById(pkg.tutorProfileId)
    .select("isSearchable acceptingNewStudents userId")
    .lean();
  if (!tutor?.isSearchable) {
    throw new BusinessRuleError("This tutor is not currently accepting bookings.", "TUTOR_UNAVAILABLE");
  }

  // Terms are captured now. A price change tomorrow does not reach back.
  const breakdown = packageBreakdown({
    priceCents: pkg.priceCents,
    sessionCount: pkg.sessionCount,
    durationMinutes: pkg.sessionDurationMinutes,
    commissionPercent: settings.commissionPercent,
  });

  const validityDays = pkg.validityDays ?? settings.packages?.defaultValidityDays ?? 180;

  const purchase = await PackagePurchase.create({
    reference: publicReference("PKG"),
    packageId: pkg._id,
    purchaserId: actor.id,
    studentProfileId: student._id,
    tutorProfileId: pkg.tutorProfileId,
    tutorUserId: pkg.tutorUserId,
    title: pkg.title,
    courseId: pkg.courseId,
    courseCode: pkg.courseCode,
    courseName: pkg.courseName,
    mode: pkg.mode,
    sessionDurationMinutes: pkg.sessionDurationMinutes,
    sessionsTotal: pkg.sessionCount,
    priceCents: pkg.priceCents,
    perSessionCents: breakdown.perSessionCents,
    commissionPercent: settings.commissionPercent,
    perSessionCommissionCents: breakdown.perSessionCommissionCents,
    perSessionTutorEarningsCents: breakdown.perSessionTutorEarningsCents,
    status: PACKAGE_PURCHASE_STATUS.PENDING_PAYMENT,
    // Counted from activation, not from now: a purchase that sits unpaid for
    // an hour should not lose an hour of its validity.
    expiresAt: undefined,
  });

  const payment = await createPaymentForPackage({
    purchase,
    purchaserId: actor.id,
    tutorUserId: pkg.tutorUserId,
  });

  await PackagePurchase.updateOne({ _id: purchase._id }, { $set: { paymentId: payment.id } });

  return {
    purchase: toPlain(await PackagePurchase.findById(purchase._id).lean()),
    payment,
    validityDays,
  };
}

/**
 * Activate a purchase once its payment has settled.
 *
 * Called from the same place a booking is confirmed, so a package and a
 * lesson settle through one path. Idempotent: the update is conditional on
 * the purchase still being unpaid.
 */
export async function activatePackagePurchase(paymentId) {
  const purchase = await PackagePurchase.findOne({
    paymentId,
    status: PACKAGE_PURCHASE_STATUS.PENDING_PAYMENT,
  });
  if (!purchase) return { activated: 0 };

  const settings = await getSettings();
  const pkg = await TutorPackage.findById(purchase.packageId).select("validityDays").lean();
  const validityDays = pkg?.validityDays ?? settings.packages?.defaultValidityDays ?? 180;
  const now = new Date();

  const claimed = await PackagePurchase.updateOne(
    { _id: purchase._id, status: PACKAGE_PURCHASE_STATUS.PENDING_PAYMENT },
    {
      $set: {
        status: PACKAGE_PURCHASE_STATUS.ACTIVE,
        activatedAt: now,
        expiresAt: addDays(now, validityDays),
      },
    },
  );
  if (!claimed.modifiedCount) return { activated: 0 };

  await TutorPackage.updateOne(
    { _id: purchase.packageId },
    { $inc: { "stats.purchases": 1, "stats.grossCents": purchase.priceCents } },
  );

  await notify({
    userId: purchase.purchaserId,
    type: NOTIFICATION_TYPES.PACKAGE_PURCHASED,
    title: `${purchase.title} is ready to use`,
    body: `${purchase.sessionsTotal} lessons, usable until ${addDays(now, validityDays).toLocaleDateString("en-CA")}. Book them whenever suits you.`,
    href: "/packages",
    entityType: "PackagePurchase",
    entityId: purchase._id,
  });

  await notify({
    userId: purchase.tutorUserId,
    type: NOTIFICATION_TYPES.PACKAGE_PURCHASED,
    title: "A family bought one of your packages",
    body: `${purchase.title} — ${purchase.sessionsTotal} lessons.`,
    href: "/tutor/packages",
    entityType: "PackagePurchase",
    entityId: purchase._id,
  });

  await recordAudit({
    actor: { role: "SYSTEM" },
    action: AUDIT_ACTIONS.PACKAGE_PURCHASED,
    entityType: "PackagePurchase",
    entityId: purchase._id,
    metadata: { reference: purchase.reference, priceCents: purchase.priceCents },
  });

  return { activated: 1, purchase: toPlain(purchase) };
}

// --- Drawing lessons from a balance ---------------------------------------

/**
 * Take one session from a purchase, for a booking being created.
 *
 * The whole safety property of packages is in this one update. It is
 * conditional on the purchase still being active, still in date, and still
 * having an unused session, and it increments the counter in the same atomic
 * operation. Two bookings made at the same instant therefore cannot both take
 * the last lesson, and nothing can push `sessionsUsed` past `sessionsTotal` —
 * no read-then-write window exists for them to race in.
 *
 * @returns {Promise<object>} the purchase as it is *after* the draw.
 */
export async function consumePackageSession({ purchaseId, actor, tutorProfileId, courseId, durationMinutes, mode }) {
  const purchase = await PackagePurchase.findById(purchaseId).lean();
  if (!purchase) throw new NotFoundError("That package no longer exists.");

  if (String(purchase.purchaserId) !== String(actor.id)) {
    throw new AuthorizationError("That package is not yours.");
  }
  if (!USABLE_PACKAGE_STATUSES.includes(purchase.status)) {
    throw new BusinessRuleError(
      purchase.status === PACKAGE_PURCHASE_STATUS.PENDING_PAYMENT
        ? "That package has not been paid for yet."
        : "That package can no longer be used.",
      "PACKAGE_NOT_USABLE",
    );
  }
  if (purchase.expiresAt && new Date(purchase.expiresAt) <= new Date()) {
    throw new BusinessRuleError("That package has expired.", "PACKAGE_EXPIRED");
  }

  // The lesson has to be the one that was bought.
  if (String(purchase.tutorProfileId) !== String(tutorProfileId)) {
    throw new BusinessRuleError("That package is for a different tutor.", "PACKAGE_WRONG_TUTOR");
  }
  if (String(purchase.courseId) !== String(courseId)) {
    throw new BusinessRuleError("That package is for a different course.", "PACKAGE_WRONG_COURSE");
  }
  if (purchase.sessionDurationMinutes !== durationMinutes) {
    throw new BusinessRuleError(
      `Lessons in this package are ${purchase.sessionDurationMinutes} minutes.`,
      "PACKAGE_WRONG_DURATION",
    );
  }
  if (purchase.mode && mode && purchase.mode !== mode) {
    throw new BusinessRuleError("That package is for a different lesson type.", "PACKAGE_WRONG_MODE");
  }

  const drawn = await PackagePurchase.findOneAndUpdate(
    {
      _id: purchase._id,
      status: PACKAGE_PURCHASE_STATUS.ACTIVE,
      $expr: { $lt: ["$sessionsUsed", "$sessionsTotal"] },
    },
    { $inc: { sessionsUsed: 1 } },
    { returnDocument: "after" },
  );

  if (!drawn) {
    throw new ConflictError("That package has no lessons left.");
  }

  return drawn;
}

/** Record which booking a drawn session became, once it exists. */
export async function linkPackageBooking(purchaseId, bookingId) {
  await PackagePurchase.updateOne(
    { _id: purchaseId },
    { $addToSet: { bookingIds: bookingId } },
  );

  const purchase = await PackagePurchase.findById(purchaseId).lean();
  if (!purchase) return;

  await TutorPackage.updateOne(
    { _id: purchase.packageId },
    { $inc: { "stats.sessionsDelivered": 1 } },
  );

  if (purchase.sessionsUsed >= purchase.sessionsTotal) {
    await PackagePurchase.updateOne(
      { _id: purchaseId, status: PACKAGE_PURCHASE_STATUS.ACTIVE },
      { $set: { status: PACKAGE_PURCHASE_STATUS.COMPLETED, completedAt: new Date() } },
    );
  } else if (purchase.sessionsTotal - purchase.sessionsUsed === 1) {
    await notify({
      userId: purchase.purchaserId,
      type: NOTIFICATION_TYPES.PACKAGE_LOW_BALANCE,
      title: "One lesson left in your package",
      body: `${purchase.title} has one lesson remaining.`,
      href: "/packages",
      entityType: "PackagePurchase",
      entityId: purchase._id,
    });
  }
}

/**
 * Give a session back to the package.
 *
 * Called when a lesson drawn from a package is cancelled in circumstances the
 * cancellation policy would have refunded in full. No money moves: the block
 * was bought as a block, so the lesson simply returns to the balance, which is
 * both simpler and better for the family than a partial refund they did not
 * ask for.
 *
 * Bounded at zero so a double cancellation cannot mint a lesson.
 */
export async function returnPackageSession(purchaseId, bookingId) {
  const returned = await PackagePurchase.findOneAndUpdate(
    { _id: purchaseId, sessionsUsed: { $gt: 0 }, bookingIds: bookingId },
    {
      $inc: { sessionsUsed: -1 },
      $pull: { bookingIds: bookingId },
      // A completed package with a lesson back is usable again.
      $set: { status: PACKAGE_PURCHASE_STATUS.ACTIVE },
      $unset: { completedAt: "" },
    },
    { returnDocument: "after" },
  );

  if (!returned) return { returned: false };

  await TutorPackage.updateOne(
    { _id: returned.packageId },
    { $inc: { "stats.sessionsDelivered": -1 } },
  );

  return { returned: true, sessionsRemaining: returned.sessionsTotal - returned.sessionsUsed };
}

// --- Reads -----------------------------------------------------------------

/**
 * A family's packages.
 *
 * `expiringSoon` and `sessionsRemaining` are derived here rather than in the
 * page, so "soon" means the window the operator actually configured for the
 * warning email rather than a number picked in a component.
 */
export async function listPurchases(actor, { status, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.bookings;
  const query = { purchaserId: actor.id };
  if (status) query.status = status;

  const [items, total, settings] = await Promise.all([
    PackagePurchase.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("studentProfileId", "firstName gradeName")
      .populate({ path: "tutorProfileId", populate: { path: "userId", select: "firstName lastName avatarUrl" } })
      .lean(),
    PackagePurchase.countDocuments(query),
    getSettings(),
  ]);

  const horizon = addDays(new Date(), settings.packages?.expiryWarningDays ?? 14);

  return {
    items: toPlain(items).map((purchase) => ({
      ...purchase,
      sessionsRemaining: Math.max(0, purchase.sessionsTotal - purchase.sessionsUsed),
      expiringSoon:
        purchase.status === PACKAGE_PURCHASE_STATUS.ACTIVE &&
        Boolean(purchase.expiresAt) &&
        new Date(purchase.expiresAt) < horizon,
    })),
    total,
    page,
    pageSize: size,
  };
}

/**
 * The balances that could pay for a specific lesson.
 *
 * Used by the booking form, so a family is offered the package they already
 * paid for rather than being charged twice.
 */
export async function usablePackagesFor(actor, { tutorProfileId, courseId, durationMinutes, mode }) {
  const query = {
    purchaserId: actor.id,
    tutorProfileId,
    courseId,
    status: PACKAGE_PURCHASE_STATUS.ACTIVE,
    $expr: { $lt: ["$sessionsUsed", "$sessionsTotal"] },
    $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
  };
  if (durationMinutes) query.sessionDurationMinutes = durationMinutes;
  if (mode) query.$and = [{ $or: [{ mode: null }, { mode }] }];

  const purchases = await PackagePurchase.find(query).sort({ expiresAt: 1 }).lean();
  return toPlain(purchases);
}

export async function getPurchase(id, actor) {
  const purchase = await PackagePurchase.findById(id)
    .populate("studentProfileId", "firstName gradeName")
    .populate({ path: "tutorProfileId", populate: { path: "userId", select: "firstName lastName avatarUrl" } })
    .lean();
  if (!purchase) throw new NotFoundError("That package no longer exists.");

  const isOwner = String(purchase.purchaserId) === String(actor.id);
  const isTutor = String(purchase.tutorUserId) === String(actor.id);
  if (!isOwner && !isTutor && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("You do not have access to this package.");
  }

  const bookings = await Booking.find({ _id: { $in: purchase.bookingIds ?? [] } })
    .select("reference startAt endAt status courseName courseCode")
    .sort({ startAt: 1 })
    .lean();

  return { purchase: toPlain(purchase), bookings: toPlain(bookings), canCancel: isOwner };
}

/** The tutor's view: who is holding lessons with them. */
export async function listPurchasesForTutor(actor, { page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.bookings;
  const query = { tutorUserId: actor.id, status: { $ne: PACKAGE_PURCHASE_STATUS.PENDING_PAYMENT } };

  const [items, total] = await Promise.all([
    PackagePurchase.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("studentProfileId", "firstName lastName gradeName isMinor shareFullNameWithTutor")
      .lean(),
    PackagePurchase.countDocuments(query),
  ]);

  return { items: toPlain(items), total, page, pageSize: size };
}

// --- Endings ---------------------------------------------------------------

/**
 * Cancel a package and refund what was not used.
 *
 * Only unused lessons are refunded: the delivered ones were taught, and the
 * tutor has already earned them. Lessons already booked out of the package
 * stay booked — cancelling the balance is not a way to cancel lessons without
 * going through the cancellation policy (§26).
 */
export async function cancelPurchase(id, { reason }, actor) {
  const purchase = await PackagePurchase.findById(id);
  if (!purchase) throw new NotFoundError("That package no longer exists.");

  const isOwner = String(purchase.purchaserId) === String(actor.id);
  if (!isOwner && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("That package is not yours to cancel.");
  }

  if (![PACKAGE_PURCHASE_STATUS.ACTIVE, PACKAGE_PURCHASE_STATUS.PENDING_PAYMENT].includes(purchase.status)) {
    throw new ConflictError("That package can no longer be cancelled.");
  }

  const refundCents = unusedPackageValue(purchase);

  // Claim it before any money moves, so a double submit refunds once.
  const claimed = await PackagePurchase.updateOne(
    { _id: purchase._id, status: purchase.status },
    {
      $set: {
        status: refundCents > 0 ? PACKAGE_PURCHASE_STATUS.REFUNDED : PACKAGE_PURCHASE_STATUS.CANCELLED,
        cancelledAt: new Date(),
        cancelledBy: actor.id,
        cancellationReason: reason,
      },
    },
  );
  if (!claimed.modifiedCount) throw new ConflictError("That package has already been cancelled.");

  if (refundCents > 0 && purchase.paymentId) {
    await refundPayment(purchase.paymentId, {
      amountCents: refundCents,
      reason: `Package cancelled — ${purchase.sessionsTotal - purchase.sessionsUsed} unused lessons`,
      issuedBy: actor.id,
    });
    await PackagePurchase.updateOne(
      { _id: purchase._id },
      { $inc: { refundedCents: refundCents } },
    );
  }

  await notify({
    userId: purchase.tutorUserId,
    type: NOTIFICATION_TYPES.PACKAGE_EXPIRED,
    title: "A package was cancelled",
    body: `${purchase.title} was cancelled with ${purchase.sessionsTotal - purchase.sessionsUsed} lessons unused.`,
    href: "/tutor/packages",
    entityType: "PackagePurchase",
    entityId: purchase._id,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.PACKAGE_CANCELLED,
    entityType: "PackagePurchase",
    entityId: purchase._id,
    metadata: { reference: purchase.reference, refundCents, reason },
  });

  return { ...toPlain(await PackagePurchase.findById(purchase._id).lean()), refundCents };
}

/**
 * Expire packages that have run out of time, and warn the ones about to.
 *
 * `expiryRefundPercent` ships at 100 — nothing is kept for lessons that were
 * never delivered. §41 sets no forfeiture rule, so the conservative default
 * is the one that cannot be accused of taking money for nothing, and an
 * operator who wants stricter terms sets them deliberately.
 */
export async function expirePackages({ now = new Date(), limit = 200 } = {}) {
  const settings = await getSettings();
  const refundPercent = settings.packages?.expiryRefundPercent ?? 100;

  const due = await PackagePurchase.find({
    status: PACKAGE_PURCHASE_STATUS.ACTIVE,
    expiresAt: { $lt: now },
  })
    .limit(limit)
    .lean();

  let expired = 0;
  let refundedCents = 0;

  for (const purchase of due) {
    const claimed = await PackagePurchase.updateOne(
      { _id: purchase._id, status: PACKAGE_PURCHASE_STATUS.ACTIVE },
      { $set: { status: PACKAGE_PURCHASE_STATUS.EXPIRED } },
    );
    if (!claimed.modifiedCount) continue;
    expired += 1;

    const unused = unusedPackageValue(purchase);
    const refund = Math.floor((unused * refundPercent) / 100);

    if (refund > 0 && purchase.paymentId) {
      await refundPayment(purchase.paymentId, {
        amountCents: refund,
        reason: "Package expired with unused lessons",
      }).catch((error) => console.warn("[package] expiry refund failed:", error.message));

      await PackagePurchase.updateOne(
        { _id: purchase._id },
        { $inc: { refundedCents: refund } },
      );
      refundedCents += refund;
    }

    await notify({
      userId: purchase.purchaserId,
      type: NOTIFICATION_TYPES.PACKAGE_EXPIRED,
      title: `${purchase.title} has expired`,
      body:
        refund > 0
          ? `${formatMoney(refund)} for the lessons you didn't use has been refunded.`
          : "The lessons you didn't use are no longer available.",
      href: "/packages",
      entityType: "PackagePurchase",
      entityId: purchase._id,
    });
  }

  const warned = await warnExpiringPackages({ now, settings });

  if (expired) {
    await recordAudit({
      actor: { role: "SYSTEM" },
      action: AUDIT_ACTIONS.PACKAGE_EXPIRED,
      entityType: "PackagePurchase",
      metadata: { expired, refundedCents, refundPercent },
    });
  }

  return { expired, refundedCents, warned, examined: due.length };
}

async function warnExpiringPackages({ now, settings }) {
  const leadDays = settings.packages?.expiryWarningDays ?? 14;
  if (leadDays <= 0) return 0;

  const soon = await PackagePurchase.find({
    status: PACKAGE_PURCHASE_STATUS.ACTIVE,
    expiryWarnedAt: null,
    expiresAt: { $gt: now, $lte: addDays(now, leadDays) },
    $expr: { $lt: ["$sessionsUsed", "$sessionsTotal"] },
  })
    .limit(200)
    .lean();

  let warned = 0;
  for (const purchase of soon) {
    // Claiming the stamp first is what makes the warning exactly-once.
    const claimed = await PackagePurchase.updateOne(
      { _id: purchase._id, expiryWarnedAt: null },
      { $set: { expiryWarnedAt: now } },
    );
    if (!claimed.modifiedCount) continue;
    warned += 1;

    const remaining = purchase.sessionsTotal - purchase.sessionsUsed;
    await notify({
      userId: purchase.purchaserId,
      type: NOTIFICATION_TYPES.PACKAGE_EXPIRING,
      title: `${remaining} lesson${remaining === 1 ? "" : "s"} left to use`,
      body: `${purchase.title} expires soon. Book the rest while you can.`,
      href: "/packages",
      entityType: "PackagePurchase",
      entityId: purchase._id,
    });
  }

  return warned;
}

// --- Admin -----------------------------------------------------------------

export async function listAllPurchases({ status, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = {};
  if (status) query.status = status;

  const [items, total, totals] = await Promise.all([
    PackagePurchase.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("purchaserId", "firstName lastName email")
      .populate("tutorUserId", "firstName lastName email")
      .lean(),
    PackagePurchase.countDocuments(query),
    PackagePurchase.aggregate([
      { $match: { status: { $ne: PACKAGE_PURCHASE_STATUS.PENDING_PAYMENT } } },
      {
        $group: {
          _id: null,
          grossCents: { $sum: "$priceCents" },
          refundedCents: { $sum: "$refundedCents" },
          sessionsSold: { $sum: "$sessionsTotal" },
          sessionsUsed: { $sum: "$sessionsUsed" },
        },
      },
    ]),
  ]);

  return {
    items: toPlain(items),
    total,
    page,
    pageSize: size,
    totals: totals[0] ?? { grossCents: 0, refundedCents: 0, sessionsSold: 0, sessionsUsed: 0 },
  };
}

// --- Internals -------------------------------------------------------------

function priceOrThrow(input, profile, settings) {
  const standardHourlyRateCents = rateForCourse(profile, input.courseId);
  const assessment = assessPackagePrice({
    priceCents: input.priceCents,
    sessionCount: input.sessionCount,
    durationMinutes: input.sessionDurationMinutes,
    standardHourlyRateCents,
    settings,
  });

  if (!assessment.ok) throw new BusinessRuleError(assessment.message, assessment.code);
  return assessment;
}

function assertSessionBounds(sessionCount, settings) {
  const min = settings.packages?.minSessions ?? 2;
  const max = settings.packages?.maxSessions ?? 50;
  if (sessionCount < min || sessionCount > max) {
    throw new BusinessRuleError(
      `A package must contain between ${min} and ${max} lessons.`,
      "SESSION_COUNT_OUT_OF_RANGE",
    );
  }
}

async function ownedPackage(id, actor) {
  const pkg = await TutorPackage.findById(id);
  if (!pkg) throw new NotFoundError("That package no longer exists.");
  // Checked against the loaded record (§42).
  if (String(pkg.tutorUserId) !== String(actor.id)) {
    throw new AuthorizationError("That package is not yours.");
  }
  return pkg;
}

function tutorProfileFor(userId) {
  return TutorProfile.findOne({ userId }).select("_id").lean();
}
