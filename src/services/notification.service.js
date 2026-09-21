import "server-only";
import { Notification, User } from "@/models";
import {
  NOTIFICATION_CHANNELS, NOTIFICATION_TYPES, EMAIL_CATEGORIES, PAGE_SIZES,
} from "@/constants";
import { toPlain } from "@/lib/utils/serialize";
import { sendEmail } from "./external/email-provider";
import { sendNotificationSms } from "./sms.service";
import { hasSmsTemplate } from "./external/sms-templates";

/**
 * Which platform switch each notification's email belongs to (§26).
 *
 * Derived from the notification type rather than passed by every call site, so
 * a new notification cannot accidentally escape the operator's controls — and
 * anything unmapped falls through to ANNOUNCEMENT rather than to "unswitchable".
 */
const EMAIL_CATEGORY_BY_TYPE = {
  [NOTIFICATION_TYPES.BOOKING_CREATED]: EMAIL_CATEGORIES.BOOKING,
  [NOTIFICATION_TYPES.BOOKING_CONFIRMED]: EMAIL_CATEGORIES.BOOKING,
  [NOTIFICATION_TYPES.BOOKING_CHANGED]: EMAIL_CATEGORIES.BOOKING,
  [NOTIFICATION_TYPES.BOOKING_CANCELLED]: EMAIL_CATEGORIES.BOOKING,
  [NOTIFICATION_TYPES.BOOKING_REMINDER]: EMAIL_CATEGORIES.BOOKING,
  [NOTIFICATION_TYPES.MEETING_UPDATED]: EMAIL_CATEGORIES.BOOKING,
  [NOTIFICATION_TYPES.BOOKING_COMPLETED]: EMAIL_CATEGORIES.BOOKING,
  [NOTIFICATION_TYPES.BOOKING_EXPIRED]: EMAIL_CATEGORIES.BOOKING,
  [NOTIFICATION_TYPES.REFUND_ISSUED]: EMAIL_CATEGORIES.BOOKING,
  [NOTIFICATION_TYPES.APPLICATION_SUBMITTED]: EMAIL_CATEGORIES.APPLICATION,
  [NOTIFICATION_TYPES.APPLICATION_APPROVED]: EMAIL_CATEGORIES.APPLICATION,
  [NOTIFICATION_TYPES.APPLICATION_REJECTED]: EMAIL_CATEGORIES.APPLICATION,
  [NOTIFICATION_TYPES.APPLICATION_INFO_REQUESTED]: EMAIL_CATEGORIES.APPLICATION,
  [NOTIFICATION_TYPES.VERIFICATION_UPDATED]: EMAIL_CATEGORIES.APPLICATION,
  [NOTIFICATION_TYPES.REVIEW_RECEIVED]: EMAIL_CATEGORIES.REVIEW,
  [NOTIFICATION_TYPES.PAYOUT_UPDATED]: EMAIL_CATEGORIES.PAYOUT,
};

function emailCategoryFor(type) {
  return EMAIL_CATEGORY_BY_TYPE[type] ?? EMAIL_CATEGORIES.ANNOUNCEMENT;
}

/**
 * Notification delivery (§28).
 *
 * Everything writes an IN_APP record. Other channels are dispatched through
 * the same call once the user has opted in and a provider is configured, so
 * adding email/SMS/push later needs no changes at the call sites.
 */

export async function notify({
  userId,
  type,
  title,
  body,
  href,
  entityType,
  entityId,
  channels = [NOTIFICATION_CHANNELS.IN_APP],
  email,
}) {
  if (!userId) return null;

  const notification = await Notification.create({
    userId,
    type,
    title,
    body,
    href,
    entityType,
    entityId,
    deliveredChannels: [NOTIFICATION_CHANNELS.IN_APP],
  });

  if (channels.includes(NOTIFICATION_CHANNELS.EMAIL) && email) {
    // A bounced notification must never undo the thing it is announcing, so
    // delivery is best-effort and the in-app record stands either way. The
    // same is true when an operator has this category switched off: the person
    // still sees it in the app, they just don't get mail about it.
    await dispatchEmail(notification._id, userId, email, emailCategoryFor(type));
  }

  // SMS is attempted for *every* notification rather than only where a caller
  // asked for it, because whether a text is appropriate is a property of the
  // notification type and the recipient's consent — not of the call site. The
  // gates all live in `sms.service`, which records why it declined when it
  // does, so no future caller can accidentally sidestep them (§28, §41).
  await dispatchSms(notification);

  return toPlain(notification);
}

/**
 * Respects both gates before sending (§28, §26): the person's own per-channel
 * preference, and the operator's platform switch for this kind of mail.
 */
async function dispatchEmail(notificationId, userId, email, category) {
  const user = await User.findById(userId).select("email firstName notificationPreferences").lean();
  if (!user) return;
  if (user.notificationPreferences?.[NOTIFICATION_CHANNELS.EMAIL] === false) return;

  const result = await sendEmail({ to: user.email, ...email }, { category });
  if (!result.delivered) return;

  await Notification.updateOne(
    { _id: notificationId },
    { $addToSet: { deliveredChannels: NOTIFICATION_CHANNELS.EMAIL } },
  );
}

/**
 * Text the notification, if the type has a text version and the recipient
 * consented. Never throws: an SMS failure must not undo the notification.
 */
async function dispatchSms(notification) {
  if (!hasSmsTemplate(notification.type)) return;

  try {
    const user = await User.findById(notification.userId)
      .select("phoneE164 phoneVerifiedAt smsOptOutAt notificationPreferences")
      .lean();
    if (!user) return;

    const result = await sendNotificationSms(notification, user);
    if (!result?.sent) return;

    await Notification.updateOne(
      { _id: notification._id },
      { $addToSet: { deliveredChannels: NOTIFICATION_CHANNELS.SMS } },
    );
  } catch (error) {
    console.error("[notification] SMS dispatch failed:", error.message);
  }
}

/** Notify several people about the same event. */
export async function notifyMany(userIds, payload) {
  return Promise.all(userIds.filter(Boolean).map((userId) => notify({ ...payload, userId })));
}

export async function listNotifications(userId, { unreadOnly = false, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.notifications;
  const query = { userId };
  if (unreadOnly) query.readAt = null;

  const [items, total, unreadCount] = await Promise.all([
    Notification.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .lean(),
    Notification.countDocuments(query),
    Notification.countDocuments({ userId, readAt: null }),
  ]);

  return { items: toPlain(items), total, unreadCount, page, pageSize: size };
}

export async function unreadNotificationCount(userId) {
  if (!userId) return 0;
  return Notification.countDocuments({ userId, readAt: null });
}

export async function markNotificationsRead(userId, { ids, all = false }) {
  const query = { userId, readAt: null };
  if (!all && ids?.length) query._id = { $in: ids };
  else if (!all) return { modified: 0 };

  const result = await Notification.updateMany(query, { $set: { readAt: new Date() } });
  return { modified: result.modifiedCount };
}

export async function deleteNotification(userId, id) {
  await Notification.deleteOne({ _id: id, userId });
  return { deleted: true };
}
