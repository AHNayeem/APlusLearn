import "server-only";
import { Dispute, Booking, User } from "@/models";
import {
  DISPUTE_STATUS,
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
import { refundPayment } from "./payment.service";
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
    status: { $in: [DISPUTE_STATUS.OPEN, DISPUTE_STATUS.UNDER_REVIEW] },
  }).lean();
  if (existing) throw new ConflictError("A dispute for this lesson is already open.");

  if (new Date(booking.endAt) > new Date()) {
    throw new BusinessRuleError("You can open a dispute once the lesson has finished.");
  }

  const alreadyRefunded = booking.cancellation?.refundCents ?? 0;
  const maxRefundable = booking.price.totalCents - alreadyRefunded;
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

export async function resolveDispute(id, { resolution, refundCents, note }, admin) {
  const dispute = await Dispute.findById(id);
  if (!dispute) throw new NotFoundError("That dispute no longer exists.");

  const booking = await Booking.findById(dispute.bookingId);
  if (!booking) throw new NotFoundError("That lesson no longer exists.");

  let issued = 0;
  const alreadyRefunded = booking.cancellation?.refundCents ?? 0;
  const refundable = booking.price.totalCents - alreadyRefunded;

  if (resolution === "RESOLVED_REFUND") issued = refundable;
  else if (resolution === "RESOLVED_PARTIAL_REFUND") issued = Math.min(refundCents ?? 0, refundable);

  if (issued > 0 && booking.paymentId) {
    await refundPayment(booking.paymentId, {
      amountCents: issued,
      reason: `Dispute ${dispute.reference} — ${note}`,
      issuedBy: admin.id,
    });
  }

  dispute.status = DISPUTE_STATUS[resolution] ?? DISPUTE_STATUS.REJECTED;
  dispute.resolvedAt = new Date();
  dispute.resolvedBy = admin.id;
  dispute.resolutionNote = note;
  dispute.refundIssuedCents = issued;
  await dispute.save();

  // Return the booking to a settled state so it leaves the disputed queue.
  booking.status =
    issued >= booking.price.totalCents
      ? BOOKING_STATUS.CANCELLED_BY_ADMIN
      : BOOKING_STATUS.COMPLETED;
  await booking.save();

  for (const userId of [dispute.raisedBy, dispute.againstUserId]) {
    await notify({
      userId,
      type: NOTIFICATION_TYPES.DISPUTE_UPDATED,
      title: `Dispute ${dispute.reference} resolved`,
      body: issued > 0 ? `${formatMoney(issued)} has been refunded. ${note}` : note,
      href: String(userId) === String(booking.tutorUserId) ? "/tutor/bookings" : "/bookings",
      entityType: "Dispute",
      entityId: dispute._id,
    });
  }

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.DISPUTE_RESOLVED,
    entityType: "Dispute",
    entityId: dispute._id,
    metadata: { resolution, refundCents: issued, note },
  });

  return toPlain(dispute);
}
