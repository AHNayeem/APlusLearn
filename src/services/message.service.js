import "server-only";
import { Conversation, Message, TutorProfile, User, Booking } from "@/models";
import {
  NOTIFICATION_TYPES,
  PAGE_SIZES,
  ROLES,
  REPORT_STATUS,
  ACTIVE_REPORT_STATUSES,
  AUDIT_ACTIONS,
} from "@/constants";
import { NotFoundError, AuthorizationError, BusinessRuleError } from "@/lib/api/errors";
import { requireVerifiedEmail } from "@/lib/auth/assert";
import { toPlain } from "@/lib/utils/serialize";
import { publicName, truncate } from "@/lib/utils/format";
import { sanitizeMultiline } from "@/lib/security/sanitize";
import { toPublicAttachment } from "@/models/Attachment";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";
import {
  ATTACHMENT_LIMITS,
  storeAttachments,
  discardAttachments,
  readAttachmentBytes,
} from "./attachment.service";

/** Where a browser asks for a message attachment's bytes. */
const MESSAGE_ATTACHMENT_HREF = "/api/messages/attachments";

/**
 * Messaging (§21).
 *
 * A conversation is a learner/tutor pair. Every read and write checks
 * participation against the stored document, never against a client claim.
 */

export async function getOrCreateConversation({ learnerUserId, tutorProfileId, bookingId, requestId }) {
  const tutor = await TutorProfile.findById(tutorProfileId).select("userId isSearchable").lean();
  if (!tutor) throw new NotFoundError("That tutor is no longer available.");

  const tutorUserId = tutor.userId;
  if (String(tutorUserId) === String(learnerUserId)) {
    throw new BusinessRuleError("You cannot message yourself.");
  }

  const participantIds = [learnerUserId, tutorUserId]
    .map(String)
    .sort()
    .map((id) => id);

  const conversation = await Conversation.findOneAndUpdate(
    { learnerUserId, tutorUserId },
    {
      $setOnInsert: {
        participantIds,
        learnerUserId,
        tutorUserId,
        tutorProfileId,
        bookingId,
        requestId,
        lastMessageAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  return conversation;
}

/**
 * Send a message, with or without files attached (§21, §41 Phase 3).
 *
 * `input.files` is a list of web `File`s from a multipart request; JSON
 * callers simply do not send it, and every rule below holds either way. This
 * is deliberately the *only* function that creates a message: the attachment
 * route uploads and then calls this, rather than writing a second creation
 * path that would have to remember blocking, unread counts, response-time
 * tracking and the recipient's notification.
 *
 * Files are stored before the message row exists, so everything that could
 * refuse the message — a blocked thread, a conversation the sender is not in
 * — is checked *first*, and anything that still goes wrong afterwards takes
 * the stored objects back out. The one thing this cannot do is make the
 * upload and the insert a single transaction; what it can do is guarantee
 * that a failure leaves no orphan and no half-message, and that is what the
 * `discardAttachments` on the failure path is for.
 */
export async function sendMessage(input, actor) {
  // Messaging reaches another member — and often a minor's guardian — so the
  // sender's address must be a confirmed one (§9, §35).
  requireVerifiedEmail(actor, "Confirm your email address before messaging a tutor.");

  const files = input.files ?? [];
  const body = sanitizeMultiline(input.body, { maxLength: 4000 });
  // A message is text, or a file, or both — but not nothing.
  if (!body && !files.length) throw new BusinessRuleError("Write a message first.");

  let conversation;

  if (input.conversationId) {
    conversation = await Conversation.findById(input.conversationId);
    if (!conversation) throw new NotFoundError("That conversation no longer exists.");
    assertParticipant(conversation, actor);
  } else {
    // A learner starting a thread from a tutor profile.
    if (actor.role === ROLES.TUTOR) {
      throw new BusinessRuleError("Tutors can only reply to existing conversations.");
    }
    conversation = await getOrCreateConversation({
      learnerUserId: actor.id,
      tutorProfileId: input.tutorProfileId,
      bookingId: input.bookingId,
      requestId: input.requestId,
    });
  }

  // Blocking is one-directional: the blocker stops receiving messages (§21).
  if (conversation.blockedBy?.some((id) => String(id) !== String(actor.id))) {
    throw new BusinessRuleError(
      "You can no longer send messages in this conversation.",
      "CONVERSATION_BLOCKED",
    );
  }

  // Nothing is uploaded until the thread has accepted the message: a sender
  // who is blocked, or who is not a participant, never reaches the store.
  const attachments = await storeAttachments(files, actor, {
    max: ATTACHMENT_LIMITS.maxPerMessage,
    label: "attachment",
  });

  let message;
  try {
    message = await Message.create({
      conversationId: conversation._id,
      senderId: actor.id,
      body,
      attachments,
      readBy: [actor.id],
    });
  } catch (error) {
    await discardAttachments(attachments);
    throw error;
  }

  const recipientId = String(conversation.participantIds.find((id) => String(id) !== String(actor.id)));

  conversation.lastMessageAt = message.createdAt;
  // A file with no note still has to read as something in the thread list.
  conversation.lastMessagePreview = truncate(
    body || attachmentPreview(attachments),
    140,
  );
  conversation.lastMessageSenderId = actor.id;
  conversation.unreadCounts.set(recipientId, (conversation.unreadCounts.get(recipientId) ?? 0) + 1);
  conversation.unreadCounts.set(String(actor.id), 0);
  // Re-surface an archived thread for the recipient.
  conversation.archivedBy = (conversation.archivedBy ?? []).filter(
    (id) => String(id) !== recipientId,
  );
  await conversation.save();

  await updateTutorResponseTime(conversation, actor, message);

  // Recorded because a file one member sent another is evidence in any later
  // safeguarding complaint, and "who put this here" has to outlive the
  // message. Names and types only — never the key, never the bytes (§35).
  if (attachments.length) {
    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.MESSAGE_ATTACHMENT_ADDED,
      entityType: "Message",
      entityId: message._id,
      metadata: {
        conversationId: String(conversation._id),
        count: attachments.length,
        files: attachments.map((a) => ({
          fileName: a.fileName,
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
        })),
      },
    });
  }

  const sender = await User.findById(actor.id).select("firstName lastName").lean();
  await notify({
    userId: recipientId,
    type: NOTIFICATION_TYPES.MESSAGE_RECEIVED,
    title: `New message from ${publicName(sender?.firstName ?? "", sender?.lastName ?? "")}`,
    body: truncate(body || attachmentPreview(attachments), 120),
    href:
      String(recipientId) === String(conversation.tutorUserId)
        ? `/tutor/messages/${conversation._id}`
        : `/messages/${conversation._id}`,
    entityType: "Conversation",
    entityId: conversation._id,
  });

  return {
    message: publicMessage(toPlain(message)),
    conversationId: String(conversation._id),
  };
}

/** How a message with no text reads in a thread list or a notification. */
function attachmentPreview(attachments = []) {
  if (!attachments.length) return "";
  return attachments.length === 1
    ? `Sent a file: ${attachments[0].fileName}`
    : `Sent ${attachments.length} files`;
}

/**
 * A message on its way to a browser.
 *
 * `storageKey` and `checksum` are `select: false`, so a lean read never has
 * them — but a message created in this process is a hydrated document that
 * *does*, and `toPlain()` would serialise it straight into the response. This
 * function is what stands between those two facts: every attachment is
 * rebuilt as the public shape, so the only way to the bytes is the id and the
 * route that checks who is asking.
 */
export function publicMessage(message) {
  if (!message) return message;
  return {
    ...message,
    attachments: (message.attachments ?? []).map((attachment) =>
      toPublicAttachment(attachment, MESSAGE_ATTACHMENT_HREF),
    ),
  };
}

/**
 * Track how quickly a tutor replies — shown on their profile as a trust
 * signal, and used by the matching service (§15, §22).
 */
async function updateTutorResponseTime(conversation, actor, message) {
  if (String(actor.id) !== String(conversation.tutorUserId)) return;

  const previous = await Message.findOne({
    conversationId: conversation._id,
    senderId: { $ne: actor.id },
    createdAt: { $lt: message.createdAt },
  })
    .sort({ createdAt: -1 })
    .select("createdAt")
    .lean();

  if (!previous) return;

  const minutes = Math.round((message.createdAt - previous.createdAt) / 60000);
  const profile = await TutorProfile.findOne({ userId: actor.id }).select("stats").lean();
  if (!profile) return;

  // Running average, weighted so recent behaviour dominates.
  const current = profile.stats?.responseTimeMinutes;
  const next = current ? Math.round(current * 0.7 + minutes * 0.3) : minutes;

  await TutorProfile.updateOne(
    { userId: actor.id },
    { $set: { "stats.responseTimeMinutes": next, "stats.lastActiveAt": new Date() } },
  );
}

function assertParticipant(conversation, actor) {
  if (actor.role === ROLES.ADMIN) return;
  const isParticipant = conversation.participantIds.some(
    (id) => String(id) === String(actor.id),
  );
  if (!isParticipant) throw new AuthorizationError("You do not have access to this conversation.");
}

export async function listConversations(actor, { page = 1, pageSize, includeArchived = false } = {}) {
  const size = pageSize ?? 20;
  const query = { participantIds: actor.id };
  if (!includeArchived) query.archivedBy = { $ne: actor.id };

  const [items, total] = await Promise.all([
    Conversation.find(query)
      .sort({ lastMessageAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("learnerUserId", "firstName lastName avatarUrl")
      .populate("tutorUserId", "firstName lastName avatarUrl")
      .populate("tutorProfileId", "slug headline")
      .populate("bookingId", "reference courseName startAt status")
      .lean(),
    Conversation.countDocuments(query),
  ]);

  const me = String(actor.id);
  return {
    items: toPlain(items).map((c) => {
      const other = String(c.learnerUserId?.id ?? c.learnerUserId) === me
        ? c.tutorUserId
        : c.learnerUserId;
      return {
        ...c,
        unreadCount: c.unreadCounts?.[me] ?? 0,
        otherParty: other
          ? {
              id: other.id ?? String(other),
              name: publicName(other.firstName ?? "", other.lastName ?? ""),
              avatarUrl: other.avatarUrl ?? null,
            }
          : null,
      };
    }),
    total,
    page,
    pageSize: size,
  };
}

export async function getConversation(id, actor, { page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.messages;

  const conversation = await Conversation.findById(id)
    .populate("learnerUserId", "firstName lastName avatarUrl")
    .populate("tutorUserId", "firstName lastName avatarUrl")
    .populate("tutorProfileId", "slug headline city province verifiedTypes hourlyRateCents stats")
    .populate("bookingId", "reference courseName courseCode startAt status mode")
    .lean();

  if (!conversation) throw new NotFoundError("That conversation no longer exists.");
  assertParticipant(conversation, actor);

  const [messages, total] = await Promise.all([
    Message.find({ conversationId: id, deletedAt: null })
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .lean(),
    Message.countDocuments({ conversationId: id, deletedAt: null }),
  ]);

  const me = String(actor.id);
  const other =
    String(conversation.learnerUserId?._id ?? conversation.learnerUserId) === me
      ? conversation.tutorUserId
      : conversation.learnerUserId;

  return {
    conversation: {
      ...toPlain(conversation),
      unreadCount: conversation.unreadCounts?.[me] ?? 0,
      otherParty: other
        ? {
            id: String(other._id ?? other),
            name: publicName(other.firstName ?? "", other.lastName ?? ""),
            avatarUrl: other.avatarUrl ?? null,
          }
        : null,
      isBlocked: (conversation.blockedBy ?? []).some((bid) => String(bid) === me),
    },
    // Oldest-first for rendering; the query paginates from newest.
    messages: toPlain(messages).map(publicMessage).reverse(),
    total,
    page,
    pageSize: size,
  };
}

export async function markConversationRead(id, actor) {
  const conversation = await Conversation.findById(id);
  if (!conversation) throw new NotFoundError("That conversation no longer exists.");
  assertParticipant(conversation, actor);

  conversation.unreadCounts.set(String(actor.id), 0);
  await conversation.save();

  await Message.updateMany(
    { conversationId: id, readBy: { $ne: actor.id } },
    { $addToSet: { readBy: actor.id }, $set: { readAt: new Date() } },
  );

  return { read: true };
}

export async function unreadMessageCount(userId) {
  if (!userId) return 0;
  const conversations = await Conversation.find({ participantIds: userId })
    .select("unreadCounts")
    .lean();
  return conversations.reduce(
    (sum, c) => sum + (c.unreadCounts?.[String(userId)] ?? 0),
    0,
  );
}

export async function blockConversation(id, actor, blocked = true) {
  const conversation = await Conversation.findById(id);
  if (!conversation) throw new NotFoundError("That conversation no longer exists.");
  assertParticipant(conversation, actor);

  const update = blocked
    ? { $addToSet: { blockedBy: actor.id } }
    : { $pull: { blockedBy: actor.id } };
  await Conversation.updateOne({ _id: id }, update);

  return { blocked };
}

export async function archiveConversation(id, actor, archived = true) {
  const conversation = await Conversation.findById(id);
  if (!conversation) throw new NotFoundError("That conversation no longer exists.");
  assertParticipant(conversation, actor);

  const update = archived
    ? { $addToSet: { archivedBy: actor.id } }
    : { $pull: { archivedBy: actor.id } };
  await Conversation.updateOne({ _id: id }, update);

  return { archived };
}

/**
 * Report a conversation to the moderation team (§21).
 *
 * This platform is used by children, so a report has to reach a person rather
 * than a database field. Reporting opens a case — `reportStatus` puts the
 * thread in the administrators' queue, where it stays until somebody rules on
 * it — and a second report on an open case is folded into the same one rather
 * than resetting it.
 */
export async function reportConversation(id, { reason }, actor) {
  const conversation = await Conversation.findById(id);
  if (!conversation) throw new NotFoundError("That conversation no longer exists.");
  assertParticipant(conversation, actor);

  const reopened = !ACTIVE_REPORT_STATUSES.includes(conversation.reportStatus);

  conversation.reportStatus = reopened ? REPORT_STATUS.OPEN : conversation.reportStatus;
  conversation.reportedAt = new Date();
  conversation.reportedBy = actor.id;
  conversation.reportReason = reason;
  conversation.reportCount = (conversation.reportCount ?? 0) + 1;
  conversation.moderationHistory.push({
    at: new Date(),
    byId: actor.id,
    byRole: actor.role,
    action: REPORT_STATUS.OPEN,
    note: reason,
  });
  await conversation.save();

  return { reported: true, reportStatus: conversation.reportStatus };
}

// --- Admin moderation queue (§21, §35) -------------------------------------

/**
 * Reported conversations, newest report first.
 *
 * Deliberately returns *no message content*: the queue is a triage list, and
 * a private exchange — often involving a minor — is opened deliberately, one
 * thread at a time, through `getReportedConversation`, which audits the read.
 */
export async function listReportedConversations(
  admin,
  { status, page = 1, pageSize = 20 } = {},
) {
  assertModerator(admin);

  const query = status
    ? { reportStatus: status }
    : { reportStatus: { $in: ACTIVE_REPORT_STATUSES } };

  const [items, total, openCount] = await Promise.all([
    Conversation.find(query)
      .sort({ reportedAt: -1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate("learnerUserId", "firstName lastName email role")
      .populate("tutorUserId", "firstName lastName email role")
      .populate("tutorProfileId", "slug headline")
      .populate("reportedBy", "firstName lastName role")
      .populate("bookingId", "reference courseName courseCode startAt status")
      .lean(),
    Conversation.countDocuments(query),
    Conversation.countDocuments({ reportStatus: { $in: ACTIVE_REPORT_STATUSES } }),
  ]);

  return {
    items: toPlain(items).map((c) => ({ ...c, messageCount: undefined })),
    total,
    openCount,
    page,
    pageSize,
  };
}

/**
 * One reported conversation, with the messages a moderator needs to judge it.
 *
 * Opening it is recorded. Reading two strangers' private messages is a real
 * act even when it is the right one, and §35 asks for it to leave a trail.
 */
export async function getReportedConversation(id, admin, { limit = 100 } = {}) {
  assertModerator(admin);

  const conversation = await Conversation.findById(id)
    .populate("learnerUserId", "firstName lastName email role createdAt")
    .populate("tutorUserId", "firstName lastName email role createdAt")
    .populate("tutorProfileId", "slug headline city province status")
    .populate("reportedBy", "firstName lastName role")
    .populate("moderatedBy", "firstName lastName")
    .populate({ path: "moderationHistory.byId", select: "firstName lastName role" })
    .lean();

  if (!conversation) throw new NotFoundError("That conversation no longer exists.");
  if (!conversation.reportStatus) {
    throw new NotFoundError("That conversation has not been reported.");
  }

  const [messages, bookings] = await Promise.all([
    Message.find({ conversationId: id, deletedAt: null })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean(),
    Booking.find({
      purchaserId: conversation.learnerUserId?._id ?? conversation.learnerUserId,
      tutorUserId: conversation.tutorUserId?._id ?? conversation.tutorUserId,
    })
      .select("reference courseName courseCode startAt status mode durationMinutes price.totalCents")
      .sort({ startAt: -1 })
      .limit(10)
      .lean(),
  ]);

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.CONVERSATION_REPORT_VIEWED,
    entityType: "Conversation",
    entityId: conversation._id,
    metadata: { reportStatus: conversation.reportStatus, messageCount: messages.length },
  });

  return {
    conversation: toPlain(conversation),
    // A moderator judging a reported thread has to be able to see what was
    // shared in it, not only what was typed.
    messages: toPlain(messages).map(publicMessage),
    bookings: toPlain(bookings),
  };
}

/**
 * Read one message attachment, for somebody entitled to it (§21, §35).
 *
 * The id names an attachment; the *message* holding it is what decides who
 * may read it, and that decision is made against the conversation as stored —
 * `assertParticipant` is the same check every other read in this file makes,
 * so a file cannot be reachable by anyone a message is not.
 *
 * The lookup is `attachments._id`, which means a guessed or stolen id
 * resolves to nothing unless it really is an attachment in a thread this
 * person belongs to. There is no path here that takes a storage key.
 */
export async function readMessageAttachment(attachmentId, actor) {
  // `+path` alone, with nothing else named: Mongo refuses a projection that
  // asks for both `attachments` and `attachments.storageKey`, and naming only
  // the deselected path returns the whole document with that path added.
  const message = await Message.findOne({ "attachments._id": attachmentId, deletedAt: null })
    .select("+attachments.storageKey")
    .lean();
  if (!message) throw new NotFoundError("That file is no longer available.");

  const conversation = await Conversation.findById(message.conversationId)
    .select("participantIds")
    .lean();
  if (!conversation) throw new NotFoundError("That file is no longer available.");
  assertParticipant(conversation, actor);

  const attachment = (message.attachments ?? []).find(
    (candidate) => String(candidate._id) === String(attachmentId),
  );
  if (!attachment) throw new NotFoundError("That file is no longer available.");

  // A participant opening a file in their own thread is the feature working.
  // An administrator opening one is an act worth being able to review later —
  // the same line `CONVERSATION_REPORT_VIEWED` draws (§35).
  if (actor.role === ROLES.ADMIN) {
    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.ATTACHMENT_ADMIN_VIEWED,
      entityType: "Message",
      entityId: message._id,
      metadata: {
        attachmentId: String(attachment._id),
        fileName: attachment.fileName,
        contentType: attachment.contentType,
      },
    });
  }

  const { buffer, contentType, fileName } = await readAttachmentBytes(attachment);
  return { buffer, contentType, fileName, sizeBytes: attachment.sizeBytes };
}

/**
 * Record a moderator's decision on a reported conversation.
 *
 * The decision itself is the state change; any action that follows — warning
 * or suspending an account — is taken through the user-management tools,
 * which have their own authorization and their own audit entries.
 */
export async function moderateConversation(id, { status, note }, admin) {
  assertModerator(admin);

  const conversation = await Conversation.findById(id);
  if (!conversation) throw new NotFoundError("That conversation no longer exists.");
  if (!conversation.reportStatus) {
    throw new BusinessRuleError("That conversation has not been reported.", "NOT_REPORTED");
  }

  conversation.reportStatus = status;
  conversation.moderatedAt = new Date();
  conversation.moderatedBy = admin.id;
  conversation.moderationNote = note;
  conversation.moderationHistory.push({
    at: new Date(),
    byId: admin.id,
    byRole: ROLES.ADMIN,
    action: status,
    note,
  });
  await conversation.save();

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.CONVERSATION_MODERATED,
    entityType: "Conversation",
    entityId: conversation._id,
    metadata: { status, note },
  });

  return toPlain(conversation);
}

/**
 * Moderation is administrator-only, re-checked here rather than trusted from
 * the route — the data behind it is private messages between two members, and
 * frequently a child's (§35, §42).
 */
function assertModerator(actor) {
  if (actor?.role !== ROLES.ADMIN) {
    throw new AuthorizationError("Only an administrator can review reported conversations.");
  }
}

/** Booking context shown inside a thread (§21). */
export async function conversationBookings(conversationId, actor) {
  const conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) throw new NotFoundError("That conversation no longer exists.");
  assertParticipant(conversation, actor);

  const bookings = await Booking.find({
    purchaserId: conversation.learnerUserId,
    tutorUserId: conversation.tutorUserId,
  })
    .select("reference courseName courseCode startAt status mode durationMinutes")
    .sort({ startAt: -1 })
    .limit(10)
    .lean();

  return toPlain(bookings);
}
