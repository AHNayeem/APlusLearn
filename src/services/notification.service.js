import "server-only";
import { Notification, User } from "@/models";
import { NOTIFICATION_CHANNELS, PAGE_SIZES } from "@/constants";
import { toPlain } from "@/lib/utils/serialize";
import { sendEmail } from "./external/email-provider";

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
    // delivery is best-effort and the in-app record stands either way.
    await dispatchEmail(notification._id, userId, email);
  }

  return toPlain(notification);
}

/** Respects the user's per-channel preference before sending (§28). */
async function dispatchEmail(notificationId, userId, email) {
  const user = await User.findById(userId).select("email firstName notificationPreferences").lean();
  if (!user) return;
  if (user.notificationPreferences?.[NOTIFICATION_CHANNELS.EMAIL] === false) return;

  const result = await sendEmail({ to: user.email, ...email });
  if (!result.delivered) return;

  await Notification.updateOne(
    { _id: notificationId },
    { $addToSet: { deliveredChannels: NOTIFICATION_CHANNELS.EMAIL } },
  );
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
