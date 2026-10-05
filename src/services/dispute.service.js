import "server-only";
import { Dispute, Booking, User, Payment } from "@/models";
import {
  DISPUTE_STATUS,
  DISPUTE_STATUS_LABELS,
  OPEN_DISPUTE_STATUSES,
  RESOLVED_DISPUTE_STATUSES,
  BOOKING_STATUS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
} from "@/constants";
import { NotFoundError, AuthorizationError, BusinessRuleError, ConflictError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicReference } from "@/lib/auth/tokens";
import { formatMoney } from "@/lib/utils/format";
import { refundLessonValue, refundableOnBooking } from "./payment.service";
import { getSettings } from "./settings.service";
import { disputeEligibility, disputeOutcomeStatus, SETTLED_PAYMENT_STATUSES } from "@/lib/booking/policy";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";
import { checkDisputePattern } from "./risk.service";

/** Disputes and admin adjudication (§26). */

export async function createDispute(input, actor) {
  const booking = await Booking.findById(input.bookingId);
  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  const isParty =
    String(booking.purchaserId) === String(actor.id) ||
    String(booking.tutorUserId) === String(actor.id);
  if (!isParty) throw new AuthorizationError("You are not part of this lesson.");

  const existing = await Dispute.findOne({
    bookingId: booking._id,
    status: { $in: OPEN_DISPUTE_STATUSES },
  }).lean();
  if (existing) throw new ConflictError("A dispute for this lesson is already open.");

  // Only a lesson whose outcome a dispute can change, inside the window, and
  // that was actually paid for — never an unpaid, cancelled or expired one,
  // which a rejected dispute used to turn into a "completed" lesson (S4).
  const [settings, payment] = await Promise.all([
    getSettings(),
    booking.paymentId ? Payment.findById(booking.paymentId).select("status").lean() : null,
  ]);
  const eligible = disputeEligibility(booking, { settings, payment });
  if (!eligible.ok) throw new BusinessRuleError(eligible.message, eligible.code);

  const maxRefundable = await refundableOn(booking);
  if (input.requestedRefundCents && input.requestedRefundCents > maxRefundable) {
    throw new BusinessRuleError(
      `The most that can be refunded on this lesson is ${formatMoney(maxRefundable)}.`,
    );
  }

  const againstUserId =
    String(booking.purchaserId) === String(actor.id) ? booking.tutorUserId : booking.purchaserId;

  const dispute = await Dispute.create({
    reference: publicReference("DIS"),
    bookingId: booking._id,
    raisedBy: actor.id,
    raisedByRole: actor.role,
    againstUserId,
    reason: input.reason,
    description: input.description,
    requestedRefundCents: input.requestedRefundCents,
  });

  // Remembered so a decision that changes nothing puts the lesson back as it
  // was, instead of rewriting it as something it never was (S4).
  booking.preDisputeStatus = booking.status;
  booking.status = BOOKING_STATUS.DISPUTED;
  await booking.save();

  // Counted against the person the dispute is *about*. Raising one is a
  // right, so the person who raised it is never the subject (§41 Phase 2).
  await checkDisputePattern({ againstUserId, disputeId: dispute._id });

  await notify({
    userId: againstUserId,
    type: NOTIFICATION_TYPES.DISPUTE_UPDATED,
    title: "A dispute was opened about a lesson",
    body: `${booking.courseName} — our team will review it and be in touch.`,
    href:
      String(againstUserId) === String(booking.tutorUserId)
        ? `/tutor/bookings/${booking._id}`
        : `/bookings/${booking._id}`,
    entityType: "Dispute",
    entityId: dispute._id,
  });

  return toPlain(dispute);
}

export async function listDisputes(actor, { status, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = {};

  if (actor.role !== ROLES.ADMIN) {
    query.$or = [{ raisedBy: actor.id }, { againstUserId: actor.id }];
  }
  if (status) query.status = status;

  const [items, total] = await Promise.all([
    Dispute.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("bookingId", "reference courseName courseCode startAt price status")
      .populate("raisedBy", "firstName lastName email role")
      .populate("againstUserId", "firstName lastName email role")
      .lean(),
    Dispute.countDocuments(query),
  ]);

  return { items: toPlain(items), total, page, pageSize: size };
}

export async function getDispute(id, actor) {
  const dispute = await Dispute.findById(id)
    .populate("bookingId")
    .populate("raisedBy", "firstName lastName email role")
    .populate("againstUserId", "firstName lastName email role")
    .lean();

  if (!dispute) throw new NotFoundError("That dispute no longer exists.");

  const allowed =
    actor.role === ROLES.ADMIN ||
    String(dispute.raisedBy?._id ?? dispute.raisedBy) === String(actor.id) ||
    String(dispute.againstUserId?._id ?? dispute.againstUserId) === String(actor.id);
  if (!allowed) throw new AuthorizationError("You do not have access to this dispute.");

  const plain = toPlain(dispute);
  // Internal admin notes stay internal.
  if (actor.role !== ROLES.ADMIN) delete plain.adminNotes;
  return plain;
}

export async function addDisputeNote(id, note, admin) {
  const dispute = await Dispute.findById(id);
  if (!dispute) throw new NotFoundError("That dispute no longer exists.");

  dispute.adminNotes.push({ adminId: admin.id, note });
  if (dispute.status === DISPUTE_STATUS.OPEN) dispute.status = DISPUTE_STATUS.UNDER_REVIEW;
  await dispute.save();

  return toPlain(dispute);
}

/**
 * What is still refundable on the lesson behind a dispute.
 *
 * Both halves matter. `cancellation.refundCents` is what a cancellation or a
 * no-show already sent back, and the disputes settled against the same
 * booking are the other way money leaves it — an earlier partial refund has
 * to narrow what a later decision may award, or two disputes can between them
 * refund more than was ever collected. The payment ledger refuses that
 * outright (`REFUND_EXCEEDS_BALANCE`), which protects the money; this is what
 * keeps the dispute records agreeing with it.
 */
/**
 * What can still be given back on this lesson: its value less everything
 * already refunded on it by any path (`Booking.refundedCents`), capped by
 * what the payment actually collected, account credit included (R16.7).
 */
async function refundableOn(booking) {
  return refundableOnBooking(booking);
}

/**
 * Decide a dispute (§26).
 *
 * A decision is terminal. The dispute is claimed on its *open* statuses with
 * a conditional update before any money moves, so a second decision — a
 * double-submitted form, two administrators in the queue at once, a replayed
 * request — finds nothing to claim and is refused. That ordering is the whole
 * guard: checking the status and then saving would let two concurrent calls
 * both read `UNDER_REVIEW` and both go on to refund.
 *
 * If the refund itself fails the claim is released, because a dispute that
 * was never actually settled must stay decidable. Nothing else is touched
 * before the refund succeeds, so a refusal leaves the booking, the ledger and
 * the dispute exactly as they were.
 */
export async function resolveDispute(id, { resolution, refundCents, note }, admin) {
  const dispute = await Dispute.findById(id);
  if (!dispute) throw new NotFoundError("That dispute no longer exists.");

  if (RESOLVED_DISPUTE_STATUSES.includes(dispute.status)) {
    throw alreadyDecided(dispute);
  }

  const booking = await Booking.findById(dispute.bookingId);
  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  const status = DISPUTE_STATUS[resolution] ?? DISPUTE_STATUS.REJECTED;
  const refundable = await refundableOn(booking);

  let issued = 0;
  if (resolution === "RESOLVED_REFUND") issued = refundable;
  else if (resolution === "RESOLVED_PARTIAL_REFUND") issued = Math.min(refundCents ?? 0, refundable);

  // The claim, not the check above, is what makes this safe to run twice at
  // once. Whichever request changes the status is the one that decides; the
  // other gets nothing back and is refused below.
  const claimed = await Dispute.findOneAndUpdate(
    { _id: dispute._id, status: { $in: OPEN_DISPUTE_STATUSES } },
    {
      $set: {
        status,
        resolvedAt: new Date(),
        resolvedBy: admin.id,
        resolutionNote: note,
        refundIssuedCents: 0,
      },
    },
    { returnDocument: "after" },
  );

  if (!claimed) {
    throw alreadyDecided(await Dispute.findById(id).select("status").lean());
  }

  if (issued > 0 && booking.paymentId) {
    try {
      // Attributed to the lesson, so its payable share is netted — or, if it
      // was already paid out, carried to the tutor's next payout (S3, S4).
      const result = await refundLessonValue(booking.paymentId, {
        allocations: [{ bookingId: booking._id, valueCents: issued }],
        reason: `Dispute ${dispute.reference} — ${note}`,
        issuedBy: admin.id,
      });
      issued = result.refundedCents;
    } catch (error) {
      // Nothing was sent back, so the decision never happened. Put the
      // dispute where it was and let the administrator try again.
      await Dispute.updateOne(
        { _id: dispute._id, status },
        {
          $set: { status: dispute.status, refundIssuedCents: dispute.refundIssuedCents ?? 0 },
          $unset: { resolvedAt: "", resolvedBy: "", resolutionNote: "" },
        },
      );
      throw error;
    }

    await Dispute.updateOne({ _id: dispute._id }, { $set: { refundIssuedCents: issued } });
    claimed.refundIssuedCents = issued;
  }

  // The lesson leaves the disputed queue as what the decision says it was:
  // the status the dispute interrupted, unless the decision changed the
  // outcome (an upheld tutor no-show, a full refund). A partial refund keeps
  // the real status; the refunded share is already on the booking, so the
  // payout pays only what was kept (S4, R27.6).
  const payment = booking.paymentId ? await Payment.findById(booking.paymentId).select("status").lean() : null;
  booking.status = disputeOutcomeStatus({
    reason: dispute.reason,
    resolution,
    preDisputeStatus: booking.preDisputeStatus,
    fullyRefunded: issued > 0 && issued >= refundable,
    paid: Boolean(booking.packagePurchaseId) || SETTLED_PAYMENT_STATUSES.includes(payment?.status),
  });
  booking.preDisputeStatus = undefined;
  await booking.save();

  for (const userId of [claimed.raisedBy, claimed.againstUserId]) {
    await notify({
      userId,
      type: NOTIFICATION_TYPES.DISPUTE_UPDATED,
      title: `Dispute ${claimed.reference} resolved`,
      body: issued > 0 ? `${formatMoney(issued)} has been refunded. ${note}` : note,
      href: String(userId) === String(booking.tutorUserId) ? "/tutor/bookings" : "/bookings",
      entityType: "Dispute",
      entityId: claimed._id,
    });
  }

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.DISPUTE_RESOLVED,
    entityType: "Dispute",
    entityId: claimed._id,
    metadata: { resolution, refundCents: issued, note },
  });

  return toPlain(claimed);
}

/** One refusal, so both the pre-check and the lost claim read the same. */
function alreadyDecided(dispute) {
  return new ConflictError(
    `This dispute was already decided (${DISPUTE_STATUS_LABELS[dispute?.status] ?? "resolved"}). ` +
      "A decision is final — open a new dispute if something else needs looking at.",
  );
}
