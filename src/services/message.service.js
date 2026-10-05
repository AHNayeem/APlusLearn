import "server-only";
import { createHash } from "node:crypto";
import { Conversation, Message, TutorProfile, TutorRequest, User, Booking } from "@/models";
import {
  NOTIFICATION_TYPES,
  PAGE_SIZES,
  ROLES,
  LEARNER_ROLES,
  USER_STATUS,
  BOOKING_STATUS,
  REPORT_STATUS,
  ACTIVE_REPORT_STATUSES,
  AUDIT_ACTIONS,
  MESSAGE_SYSTEM_EVENTS,
} from "@/constants";
import { NotFoundError, AuthorizationError, BusinessRuleError } from "@/lib/api/errors";
import { requireVerifiedEmail } from "@/lib/auth/assert";
import { toPlain } from "@/lib/utils/serialize";
import { publicName, truncate } from "@/lib/utils/format";
import { sanitizeMultiline } from "@/lib/security/sanitize";
import { detectOffPlatformContact, OFF_PLATFORM_WARNING } from "@/lib/messaging/contact-detection";
import { toPublicAttachment } from "@/models/Attachment";
import { notify, notifyMany } from "./notification.service";
import { recordAudit } from "./audit.service";
import { reportOffPlatformContact } from "./risk.service";
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
 *
 * Only the two participants are ever "in" a thread. An administrator is not
 * a participant: the moderation queue (`getReportedConversation`) and the
 * audited attachment read are the only ways an administrator sees message
 * content, and there is no way for one to post into a thread (S8).
 */

/**
 * Bookings that make a tutor and a family people who already deal with each
 * other (R17.1, R23.6) — the lesson was paid for, and happened or was meant
 * to. An unpaid, expired or cancelled booking is not here: an abandoned
 * checkout does not entitle a tutor to open a conversation with a family.
 */
const MESSAGEABLE_BOOKING_STATUSES = [
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.COMPLETED,
  BOOKING_STATUS.NO_SHOW_STUDENT,
  BOOKING_STATUS.NO_SHOW_TUTOR,
  BOOKING_STATUS.DISPUTED,
];

/**
 * The learner's thread with a tutor, created on first contact (R17.1).
 *
 * An existing thread is always returned — a family can keep talking to a
 * tutor whose profile has since been hidden. A *new* thread needs a tutor a
 * family could have found (`isSearchable`, the same gate as search) or a
 * lesson already booked between them, so an unapproved or suspended profile
 * cannot be reached by guessing its id.
 *
 * `bookingId` and `requestId` are context shown in the thread, and both are
 * checked against this pair before they are written: a client cannot pin
 * somebody else's booking to its conversation.
 */
export async function getOrCreateConversation({ learnerUserId, tutorProfileId, bookingId, requestId }) {
  const tutor = await TutorProfile.findById(tutorProfileId).select("userId isSearchable").lean();
  if (!tutor) throw new NotFoundError("That tutor is no longer available.");

  const tutorUserId = tutor.userId;
  if (String(tutorUserId) === String(learnerUserId)) {
    throw new BusinessRuleError("You cannot message yourself.");
  }

  const context = await verifiedContext({ learnerUserId, tutorUserId, bookingId, requestId });

  const existing = await Conversation.findOne({ learnerUserId, tutorUserId });
  if (existing) return existing;

  if (!tutor.isSearchable && !(await hasMessageableBooking(learnerUserId, tutorUserId))) {
    throw new NotFoundError("That tutor is no longer available.");
  }

  return upsertConversation({ learnerUserId, tutorUserId, tutorProfileId: tutor._id, ...context });
}

/**
 * A tutor's thread with the family behind one of their bookings (R17.1, R23.6).
 *
 * A tutor never names the family: the recipient is the booking's purchaser,
 * read from the stored booking, and the booking has to be this tutor's and in
 * a status that means a lesson was really arranged. That is the whole of a
 * tutor's ability to start a conversation — there is no search for learners.
 */
export async function getOrCreateTutorConversation({ tutorUserId, bookingId, requestId }) {
  const booking = await Booking.findOne({ _id: bookingId, tutorUserId })
    .select("purchaserId tutorProfileId status")
    .lean();
  if (!booking) throw new NotFoundError("That booking could not be found.");
  if (!MESSAGEABLE_BOOKING_STATUSES.includes(booking.status)) {
    throw new BusinessRuleError(
      "You can message a family once a lesson with them is confirmed.",
      "BOOKING_NOT_MESSAGEABLE",
    );
  }

  const learnerUserId = booking.purchaserId;
  const context = await verifiedContext({
    learnerUserId,
    tutorUserId,
    bookingId: booking._id,
    requestId,
  });

  const existing = await Conversation.findOne({ learnerUserId, tutorUserId });
  if (existing) return existing;

  return upsertConversation({
    learnerUserId,
    tutorUserId,
    tutorProfileId: booking.tutorProfileId,
    ...context,
  });
}

/**
 * What the tutor's "Message family" page needs about one booking: who it is
 * for, whether it allows a first message, and the thread if there is one.
 */
export async function tutorBookingThread(bookingId, actor) {
  if (actor?.role !== ROLES.TUTOR) {
    throw new AuthorizationError("Only the tutor on a booking can message the family from it.");
  }
  const booking = await Booking.findOne({ _id: bookingId, tutorUserId: actor.id })
    .select("reference courseName courseCode startAt status purchaserId timeZone")
    .populate("purchaserId", "firstName lastName")
    .lean();
  if (!booking) throw new NotFoundError("That booking could not be found.");

  const conversation = await Conversation.findOne({
    learnerUserId: booking.purchaserId?._id ?? booking.purchaserId,
    tutorUserId: actor.id,
  })
    .select("_id")
    .lean();

  const family = booking.purchaserId;
  return {
    booking: {
      ...toPlain({ ...booking, purchaserId: undefined }),
      familyName: family ? publicName(family.firstName ?? "", family.lastName ?? "") : null,
    },
    conversationId: conversation ? String(conversation._id) : null,
    canMessage: MESSAGEABLE_BOOKING_STATUSES.includes(booking.status),
  };
}

/** Booking and request context, kept only when it belongs to this pair. */
async function verifiedContext({ learnerUserId, tutorUserId, bookingId, requestId }) {
  const context = {};
  if (bookingId) {
    const booking = await Booking.findOne({ _id: bookingId, purchaserId: learnerUserId, tutorUserId })
      .select("_id")
      .lean();
    if (!booking) {
      throw new BusinessRuleError(
        "That booking isn't between these two accounts.",
        "BOOKING_NOT_IN_CONVERSATION",
      );
    }
    context.bookingId = booking._id;
  }
  if (requestId) {
    const request = await TutorRequest.findOne({ _id: requestId, ownerId: learnerUserId })
      .select("_id")
      .lean();
    if (!request) {
      throw new BusinessRuleError(
        "That request isn't one this family made.",
        "REQUEST_NOT_IN_CONVERSATION",
      );
    }
    context.requestId = request._id;
  }
  return context;
}

async function hasMessageableBooking(learnerUserId, tutorUserId) {
  return Boolean(
    await Booking.exists({
      purchaserId: learnerUserId,
      tutorUserId,
      status: { $in: MESSAGEABLE_BOOKING_STATUSES },
    }),
  );
}

/**
 * Find-or-create in one round trip; the unique `{ learnerUserId, tutorUserId }`
 * index makes two first messages racing land in one thread.
 */
async function upsertConversation({ learnerUserId, tutorUserId, tutorProfileId, bookingId, requestId }) {
  const participantIds = [learnerUserId, tutorUserId].map(String).sort();
  return Conversation.findOneAndUpdate(
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
}

/**
 * Who may open a thread (R17.1, R23.6): a learner, with a tutor; a tutor,
 * from a booking with that family. Nobody else — an administrator included —
 * starts conversations.
 */
async function startConversation(input, actor) {
  if (LEARNER_ROLES.includes(actor.role)) {
    let tutorProfileId = input.tutorProfileId;
    // From a booking page the booking names the tutor; it still has to be
    // this learner's booking, which `verifiedContext` checks.
    if (!tutorProfileId && input.bookingId) {
      const booking = await Booking.findOne({ _id: input.bookingId, purchaserId: actor.id })
        .select("tutorProfileId")
        .lean();
      if (!booking) throw new NotFoundError("That booking could not be found.");
      tutorProfileId = booking.tutorProfileId;
    }
    if (!tutorProfileId) throw new BusinessRuleError("We need to know who this message is for.");
    return getOrCreateConversation({
      learnerUserId: actor.id,
      tutorProfileId,
      bookingId: input.bookingId,
      requestId: input.requestId,
    });
  }

  if (actor.role === ROLES.TUTOR) {
    if (!input.bookingId) {
      throw new BusinessRuleError(
        "Tutors can start a conversation only from a booking with that family.",
        "TUTOR_START_NEEDS_BOOKING",
      );
    }
    return getOrCreateTutorConversation({
      tutorUserId: actor.id,
      bookingId: input.bookingId,
      requestId: input.requestId,
    });
  }

  throw new AuthorizationError("Only families, students and tutors can start a conversation.");
}

/**
 * Run a body past the off-platform check (§17, R17.7).
 *
 * Detection must never break sending: anything thrown here is logged and the
 * message goes ahead as typed — a missed flag is a gap in a report, a refused
 * message is a family who cannot reach their tutor.
 */
function screenBody(body) {
  if (!body) return { body, kinds: [], masked: false };
  try {
    const result = detectOffPlatformContact(body);
    if (!result.findings.length) return { body, kinds: [], masked: false };
    const masked = result.masked !== body;
    return {
      body: masked ? result.masked.slice(0, 4000) : body,
      kinds: result.kinds,
      masked,
      moderation: { flagged: true, kinds: result.kinds, maskedAt: masked ? new Date() : undefined },
    };
  } catch (error) {
    console.warn("[messages] off-platform check failed:", error.message);
    return { body, kinds: [], masked: false };
  }
}

/** What the sender is told about a flagged message; null for a clean one. */
function senderWarning(moderation) {
  if (!moderation?.flagged) return null;
  return {
    ...OFF_PLATFORM_WARNING,
    kinds: moderation.kinds ?? [],
    masked: Boolean(moderation.maskedAt),
  };
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
  const typed = sanitizeMultiline(input.body, { maxLength: 4000 });
  // A message is text, or a file, or both — but not nothing.
  if (!typed && !files.length) throw new BusinessRuleError("Write a message first.");

  // A retry of a send that already landed — the response was lost, the tab
  // went to sleep mid-request — is answered with what was stored. Looked up
  // before anything is written or uploaded, so a replay creates no second
  // message, no second notification and no second unread increment. The
  // unique index on `{ senderId, clientId }` covers two copies racing.
  if (input.clientId) {
    const replayed = await findSentMessage(actor, input.clientId);
    if (replayed) return replayed;
  }

  let conversation;

  if (input.conversationId) {
    conversation = await Conversation.findById(input.conversationId);
    if (!conversation) throw new NotFoundError("That conversation no longer exists.");
    assertParticipant(conversation, actor);
  } else {
    conversation = await startConversation(input, actor);
  }

  // Blocking is one-directional: the blocker stops receiving messages (§21).
  if (conversation.blockedBy?.some((id) => String(id) !== String(actor.id))) {
    throw new BusinessRuleError(
      "You can no longer send messages in this conversation.",
      "CONVERSATION_BLOCKED",
    );
  }

  // Contact details are removed before the body is stored, so the original
  // never exists anywhere but in the sender's own browser (R17.7). Payment
  // language is flagged but kept word for word.
  const screening = screenBody(typed);
  const body = screening.body;

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
      clientId: input.clientId,
      readBy: [actor.id],
      moderation: screening.moderation,
    });
  } catch (error) {
    await discardAttachments(attachments);
    // The other copy of this very send won the insert; it is the answer.
    if (error?.code === 11000 && input.clientId) {
      const replayed = await findSentMessage(actor, input.clientId);
      if (replayed) return replayed;
    }
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

  if (screening.moderation) {
    // Recorded, never acted on: an administrator decides what a pattern of
    // these means (risk.service). Its own try/catch is inside.
    await reportOffPlatformContact({
      userId: actor.id,
      conversationId: conversation._id,
      messageId: message._id,
      kinds: screening.kinds,
    });
  }

  const warning = senderWarning(screening.moderation);
  return {
    message: publicMessage(toPlain(message)),
    conversationId: String(conversation._id),
    ...(warning ? { warning } : {}),
  };
}

/** The message this sender already stored under `clientId`, shaped as a send returns it. */
async function findSentMessage(actor, clientId) {
  const existing = await Message.findOne({ senderId: actor.id, clientId }).lean();
  if (!existing) return null;
  const warning = senderWarning(existing.moderation);
  return {
    message: publicMessage(toPlain(existing)),
    conversationId: String(existing.conversationId),
    ...(warning ? { warning } : {}),
  };
}

/**
 * Narrate a booking event inside the family's thread with the tutor (§21,
 * R17.3) — "Lesson confirmed for Tuesday 4:30 pm", and the like.
 *
 * Called by the booking paths after the event has happened, so it is built to
 * be harmless to them:
 *
 *   - It never throws. A lesson is confirmed whether or not the thread hears
 *     about it; anything that goes wrong is logged and `null` is returned.
 *   - It is idempotent. One event writes one message: the key is the event,
 *     the booking and `dedupeKey` (by default a hash of the body, so a second
 *     reschedule to a *different* time is a second message and a replay of
 *     the same one is not).
 *   - It is not a member's message. There is no sender, so no verified-email
 *     requirement, no block check (a block stops a person writing, and the
 *     platform recording what happened to a lesson is not that) and no
 *     response-time update.
 *   - It does not touch unread counts. The booking flow already notifies both
 *     people through the notification centre; counting the same event again
 *     on the messages badge would make every confirmation two alerts. The
 *     thread's `lastMessageAt` does move, so the thread surfaces in the inbox
 *     and an open conversation catches up through the realtime stream.
 *
 * @param {object} input
 * @param {string} input.learnerUserId  The booking's purchaser.
 * @param {string} input.tutorUserId    The booking's tutor (a User id).
 * @param {string} [input.bookingId]    Checked against the pair before use.
 * @param {string} input.event          One of `MESSAGE_SYSTEM_EVENTS`.
 * @param {string} input.body           What the thread shows. Plain text.
 * @param {string} [input.dedupeKey]    Overrides the default idempotency key.
 * @returns {Promise<object|null>} the stored message, public shape, or null.
 */
export async function postSystemMessage({
  learnerUserId,
  tutorUserId,
  bookingId,
  event,
  body,
  dedupeKey,
} = {}) {
  try {
    if (!Object.values(MESSAGE_SYSTEM_EVENTS).includes(event)) {
      throw new Error(`unknown system event "${event}"`);
    }
    const text = sanitizeMultiline(body, { maxLength: 1000 });
    if (!learnerUserId || !tutorUserId || !text) throw new Error("a pair and a body are required");

    if (bookingId) {
      const belongs = await Booking.exists({ _id: bookingId, purchaserId: learnerUserId, tutorUserId });
      if (!belongs) throw new Error("that booking is not between these two accounts");
    }

    const systemKey = [
      event,
      bookingId ?? "-",
      dedupeKey ?? createHash("sha256").update(text).digest("hex").slice(0, 24),
    ].join(":");

    const already = await Message.findOne({ systemKey }).lean();
    if (already) return publicMessage(toPlain(already));

    const profile = await TutorProfile.findOne({ userId: tutorUserId }).select("_id").lean();
    const conversation = await upsertConversation({
      learnerUserId,
      tutorUserId,
      tutorProfileId: profile?._id,
      bookingId: bookingId || undefined,
    });

    let message;
    try {
      message = await Message.create({
        conversationId: conversation._id,
        kind: "SYSTEM",
        systemEvent: event,
        bookingId: bookingId || undefined,
        systemKey,
        body: text,
        readBy: [],
      });
    } catch (error) {
      // The same event, posted twice at once: the other one is the answer.
      if (error?.code === 11000) {
        const raced = await Message.findOne({ systemKey }).lean();
        if (raced) return publicMessage(toPlain(raced));
      }
      throw error;
    }

    await Conversation.updateOne(
      { _id: conversation._id },
      {
        $max: { lastMessageAt: message.createdAt },
        $set: { lastMessagePreview: truncate(text, 140) },
        $unset: { lastMessageSenderId: 1 },
      },
    );

    return publicMessage(toPlain(message));
  } catch (error) {
    console.error("[messages] system message not posted:", error.message);
    return null;
  }
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
export function publicMessage(message, { withModeration = false } = {}) {
  if (!message) return message;
  // What the off-platform check found is between the sender and moderators:
  // the recipient sees the masked text, not a label on the person who sent it.
  // `systemKey` is bookkeeping for idempotency and means nothing to a browser.
  const { moderation, systemKey: _systemKey, ...rest } = message;
  return {
    ...rest,
    ...(withModeration && moderation ? { moderation } : {}),
    attachments: (rest.attachments ?? []).map((attachment) =>
      toPublicAttachment(attachment, MESSAGE_ATTACHMENT_HREF),
    ),
  };
}

/**
 * Track how quickly a tutor replies — shown on their profile as a trust
 * signal, and used by the matching service (§15, §22).
 *
 * A message is a *reply* only when the message before it was the learner's
 * (R10.8). A tutor's second and third messages in a row answer nothing, and
 * counting them — as this once did, against the learner's last message —
 * dragged the average toward whatever gap there was between the tutor's own
 * messages. SYSTEM messages are nobody's turn and are skipped.
 *
 * The time is measured from the *first* learner message the tutor had not yet
 * answered: a family who wrote at 9:00 and again at 9:50 waited an hour for a
 * 10:00 reply, not ten minutes.
 */
async function updateTutorResponseTime(conversation, actor, message) {
  if (String(actor.id) !== String(conversation.tutorUserId)) return;

  const inThread = {
    conversationId: conversation._id,
    _id: { $ne: message._id },
    kind: { $ne: "SYSTEM" },
    createdAt: { $lte: message.createdAt },
  };

  const previous = await Message.findOne(inThread)
    .sort({ createdAt: -1, _id: -1 })
    .select("senderId createdAt")
    .lean();
  if (!previous || String(previous.senderId) !== String(conversation.learnerUserId)) return;

  const lastTutorMessage = await Message.findOne({ ...inThread, senderId: actor.id })
    .sort({ createdAt: -1, _id: -1 })
    .select("createdAt")
    .lean();
  const firstUnanswered = await Message.findOne({
    ...inThread,
    senderId: conversation.learnerUserId,
    ...(lastTutorMessage
      ? { createdAt: { $gt: lastTutorMessage.createdAt, $lte: message.createdAt } }
      : {}),
  })
    .sort({ createdAt: 1, _id: 1 })
    .select("createdAt")
    .lean();
  const waitingSince = firstUnanswered?.createdAt ?? previous.createdAt;

  const minutes = Math.max(0, Math.round((message.createdAt - waitingSince) / 60000));
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

/**
 * The one access rule for a thread: you are one of its two participants.
 *
 * There is deliberately no administrator exception (S8). One used to sit
 * here, and it meant every participant route — read, post, mark read, block,
 * report — also served any administrator, unaudited, on any thread. The
 * moderation paths below are how an administrator reads a thread, and they
 * record that they did.
 */
function assertParticipant(conversation, actor) {
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

/**
 * How far behind `since` a catch-up read reaches.
 *
 * `createdAt` is stamped by whichever server instance wrote the message, so a
 * message from an instance whose clock runs slightly behind can carry a time
 * just before the newest one this browser already holds. Reading a little
 * further back costs a few duplicates, which the browser drops by id.
 */
const SINCE_OVERLAP_MS = 5_000;

/**
 * Messages in a thread from `since` onwards, oldest first (docs/REALTIME.md).
 *
 * This is how a browser catches up — after a realtime hint that the thread
 * changed, or after a reconnect in which it may have missed any number of
 * them. The realtime stream never carries a message; this read, with the same
 * participant check as every other one in this file, is the only way in.
 */
export async function messagesSince(id, actor, since, { limit = 100 } = {}) {
  const conversation = await Conversation.findById(id)
    .select("participantIds unreadCounts")
    .lean();
  if (!conversation) throw new NotFoundError("That conversation no longer exists.");
  assertParticipant(conversation, actor);

  const from = new Date(new Date(since).getTime() - SINCE_OVERLAP_MS);
  const messages = await Message.find({
    conversationId: id,
    deletedAt: null,
    createdAt: { $gte: from },
  })
    .sort({ createdAt: 1 })
    .limit(limit)
    .lean();

  return {
    messages: toPlain(messages).map(publicMessage),
    unreadCount: conversation.unreadCounts?.[String(actor.id)] ?? 0,
    // A full page means there may be more; the browser reloads the thread.
    complete: messages.length < limit,
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

  // The reason itself lives on the case, in `moderationHistory`, where only a
  // moderator reads it; the audit row records that a report was made.
  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.CONVERSATION_REPORTED,
    entityType: "Conversation",
    entityId: conversation._id,
    metadata: {
      reportStatus: conversation.reportStatus,
      reportCount: conversation.reportCount,
      opened: reopened,
    },
  });

  // A report has to reach a person (R17.6). Administrators are told when a
  // case opens — a first report, or one on a thread that had been resolved.
  // A further report on a case already in the queue is folded into it and
  // does not page every administrator again.
  if (reopened) await notifyModerators(conversation, actor);

  return { reported: true, reportStatus: conversation.reportStatus };
}

/**
 * In-app notice to every active administrator. The report is already saved
 * and in the queue, so a failure here is logged rather than turned into an
 * error the reporter would retry — which would only report the thread twice.
 */
async function notifyModerators(conversation, actor) {
  try {
    const admins = await User.find({ role: ROLES.ADMIN, status: USER_STATUS.ACTIVE })
      .select("_id")
      .lean();
    await notifyMany(
      admins.map((admin) => admin._id),
      {
        type: NOTIFICATION_TYPES.CONVERSATION_REPORTED,
        title: "A conversation was reported",
        body: `A ${String(actor.role ?? "member").toLowerCase()} reported a conversation. It is waiting in the moderation queue.`,
        href: `/admin/moderation/${conversation._id}`,
        entityType: "Conversation",
        entityId: conversation._id,
      },
    );
  } catch (error) {
    console.error("[messages] could not notify moderators of a report:", error.message);
  }
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
    // shared in it, not only what was typed — and what the off-platform check
    // found in it.
    messages: toPlain(messages).map((m) => publicMessage(m, { withModeration: true })),
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
    .select("participantIds reportStatus")
    .lean();
  if (!conversation) throw new NotFoundError("That file is no longer available.");
  // An administrator is not a participant (S8). The only administrator path
  // into a thread's files is the one into its messages: the conversation has
  // been reported, so it is in the moderation queue, and the read is audited
  // below. Everybody else must be in the thread.
  const isParticipant = conversation.participantIds.some((id) => String(id) === String(actor.id));
  if (!isParticipant) {
    if (actor.role !== ROLES.ADMIN || !conversation.reportStatus) {
      throw new AuthorizationError("You do not have access to this conversation.");
    }
  }
  const viaModeration = !isParticipant;

  const attachment = (message.attachments ?? []).find(
    (candidate) => String(candidate._id) === String(attachmentId),
  );
  if (!attachment) throw new NotFoundError("That file is no longer available.");

  // A participant opening a file in their own thread is the feature working.
  // An administrator opening one is an act worth being able to review later —
  // the same line `CONVERSATION_REPORT_VIEWED` draws (§35).
  if (viaModeration) {
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
