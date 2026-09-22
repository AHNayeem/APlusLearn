import "server-only";
import { createHash, randomInt } from "node:crypto";
import { SmsMessage, User, AuthToken, AUTH_TOKEN_PURPOSE } from "@/models";
import {
  SMS_STATUS,
  SMS_SKIP_REASONS,
  SMS_OPT_OUT_KEYWORDS,
  SMS_OPT_IN_KEYWORDS,
  NOTIFICATION_CHANNELS,
  AUDIT_ACTIONS,
  PAGE_SIZES,
} from "@/constants";
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { getSmsProvider, smsConfigured } from "./external/sms-provider";
import {
  smsBodyFor,
  verificationSmsBody,
  hasSmsTemplate,
  segmentCount,
} from "./external/sms-templates";
import { getAppConfig, getSettings } from "./settings.service";
import { recordAudit } from "./audit.service";

/**
 * Text messaging (§28, §41 Phase 2).
 *
 * Every text the platform sends leaves through `deliverSms` below, and
 * `deliverSms` writes a row to `SmsMessage` whichever way it ends — sent,
 * failed, simulated or deliberately skipped. That single choke point is what
 * makes the three guarantees hold:
 *
 *   **Consent.** A text is only sent to a number its owner proved, on an
 *   account that asked for texts, that has not replied STOP, on a platform
 *   where the channel is switched on. Each gate that stops a message records
 *   *which* gate, so "why no text?" is answerable from the log.
 *
 *   **Idempotency.** A caller passes a `dedupeKey` derived from the event, not
 *   from the clock. A unique index turns the second write into a refusal, so a
 *   redelivered webhook or a job run twice cannot text anybody twice.
 *
 *   **Honesty in development.** With no provider configured, the message is
 *   printed and recorded as SIMULATED. Nothing reports it as delivered, and
 *   the notification record does not gain the SMS channel.
 */

/** Wrong codes before a verification attempt is burned. */
const MAX_VERIFICATION_ATTEMPTS = 5;
const VERIFICATION_TTL_MINUTES = 10;

// --- The one send path -----------------------------------------------------

/**
 * Send one text, recording the outcome whatever it is.
 *
 * @param {object}  args
 * @param {object}  [args.user]        The recipient's user record. Required for
 *                                     a notification; absent for a code sent to
 *                                     a number being verified.
 * @param {string}  args.to            E.164 destination.
 * @param {string}  args.body          The rendered message.
 * @param {"NOTIFICATION"|"VERIFICATION"} [args.kind]
 * @param {string}  [args.dedupeKey]   Stable key for this event.
 * @param {object}  [args.notification] `{ id, type }` when this is a notification.
 * @returns {Promise<{ sent: boolean, status: string, skipReason?: string }>}
 */
export async function deliverSms({
  user,
  to,
  body,
  kind = "NOTIFICATION",
  dedupeKey,
  notification,
}) {
  if (!to || !body) {
    return record({ user, to, body, kind, notification, status: SMS_STATUS.SKIPPED, skipReason: SMS_SKIP_REASONS.NO_PHONE });
  }

  // Claim the key *before* calling the provider. If two workers race, the
  // loser's insert is refused and it never reaches the carrier at all — the
  // alternative, checking first and inserting after, has a window in which
  // both send.
  let claimed = null;
  if (dedupeKey) {
    try {
      claimed = await SmsMessage.create({
        userId: user?._id ?? user?.id,
        to,
        kind,
        notificationId: notification?.id,
        notificationType: notification?.type,
        bodyPreview: preview(kind, body),
        segments: segmentCount(body),
        status: SMS_STATUS.QUEUED,
        dedupeKey,
      });
    } catch (error) {
      if (error?.code === 11000) {
        return { sent: false, status: SMS_STATUS.SKIPPED, skipReason: SMS_SKIP_REASONS.DUPLICATE };
      }
      throw error;
    }
  }

  // Per-number ceiling, checked after the dedupe claim so a retry of an
  // already-recorded message is not counted twice against the limit.
  const limited = await exceedsSendRate(to);
  if (limited) {
    await finish(claimed, { status: SMS_STATUS.SKIPPED, skipReason: SMS_SKIP_REASONS.RATE_LIMITED });
    if (!claimed) {
      await record({ user, to, body, kind, notification, status: SMS_STATUS.SKIPPED, skipReason: SMS_SKIP_REASONS.RATE_LIMITED });
    }
    return { sent: false, status: SMS_STATUS.SKIPPED, skipReason: SMS_SKIP_REASONS.RATE_LIMITED };
  }

  try {
    const result = await (await getSmsProvider()).send({ to, body, idempotencyKey: dedupeKey });

    const status = result.simulated
      ? SMS_STATUS.SIMULATED
      : result.delivered
        ? SMS_STATUS.SENT
        : SMS_STATUS.FAILED;

    const patch = {
      status,
      provider: result.provider,
      providerMessageId: result.messageId ?? undefined,
      providerStatus: result.status,
      segments: result.segments ?? segmentCount(body),
      sentAt: status === SMS_STATUS.SENT ? new Date() : undefined,
    };

    if (claimed) await finish(claimed, patch);
    else await record({ user, to, body, kind, notification, ...patch });

    return { sent: status === SMS_STATUS.SENT, status, simulated: Boolean(result.simulated) };
  } catch (error) {
    // An operator switching the module off is a decision, not a fault. It is
    // recorded as a skip with its own reason so the delivery log tells "we
    // chose not to" apart from "we tried and it broke" — which is the whole
    // point of keeping deliberate non-sends as first-class rows (§28).
    if (error?.code === "MODULE_DISABLED") {
      const patch = { status: SMS_STATUS.SKIPPED, skipReason: SMS_SKIP_REASONS.MODULE_DISABLED };
      if (claimed) await finish(claimed, patch);
      else await record({ user, to, body, kind, notification, ...patch });
      return { sent: false, status: SMS_STATUS.SKIPPED, skipReason: patch.skipReason };
    }

    // A failed text never breaks the thing it was announcing: the lesson is
    // still booked, the code is still valid through the in-app path. The
    // reason is logged; the body never is (§36).
    console.error(`[sms] delivery failed (${notification?.type ?? kind}):`, error.message);

    const patch = {
      status: SMS_STATUS.FAILED,
      errorCode: error.code ?? "SMS_DELIVERY_FAILED",
      errorMessage: String(error.message).slice(0, 300),
    };
    if (claimed) await finish(claimed, patch);
    else await record({ user, to, body, kind, notification, ...patch });

    return { sent: false, status: SMS_STATUS.FAILED, error: patch.errorCode };
  }
}

/**
 * Text a notification to its recipient, if every consent gate allows it.
 *
 * Called from `notification.service` for every notification, so a new call
 * site cannot forget the gates. The `dedupeKey` is the notification's own id:
 * one notification, at most one text, however many times delivery is retried.
 */
export async function sendNotificationSms(notification, user) {
  const skip = async (reason) => {
    await record({
      user,
      to: user?.phoneE164,
      kind: "NOTIFICATION",
      notification: { id: notification._id ?? notification.id, type: notification.type },
      status: SMS_STATUS.SKIPPED,
      skipReason: reason,
    });
    return { sent: false, status: SMS_STATUS.SKIPPED, skipReason: reason };
  };

  if (!hasSmsTemplate(notification.type)) return skip(SMS_SKIP_REASONS.NO_TEMPLATE);
  if (!user?.phoneE164) return skip(SMS_SKIP_REASONS.NO_PHONE);
  if (!user.phoneVerifiedAt) return skip(SMS_SKIP_REASONS.PHONE_UNVERIFIED);
  if (user.smsOptOutAt) return skip(SMS_SKIP_REASONS.OPTED_OUT);
  if (user.notificationPreferences?.[NOTIFICATION_CHANNELS.SMS] !== true) {
    return skip(SMS_SKIP_REASONS.CHANNEL_DISABLED);
  }

  const config = await getAppConfig();
  if (config.notifications?.smsEnabled === false) {
    return skip(SMS_SKIP_REASONS.PLATFORM_DISABLED);
  }

  const body = smsBodyFor(
    notification.type,
    { title: notification.title, body: notification.body },
    config.branding.appName,
  );
  if (!body) return skip(SMS_SKIP_REASONS.NO_TEMPLATE);

  return deliverSms({
    user,
    to: user.phoneE164,
    body,
    kind: "NOTIFICATION",
    dedupeKey: `notification:${notification._id ?? notification.id}`,
    notification: { id: notification._id ?? notification.id, type: notification.type },
  });
}

// --- Phone verification ----------------------------------------------------

/**
 * Send a confirmation code to a number.
 *
 * The number is bound to the token rather than written to the account, so a
 * code in flight cannot be redirected: confirming proves the holder of *that*
 * number, and only then does it reach the user record.
 */
export async function startPhoneVerification(userId, { phone, phoneE164 }, { ip } = {}) {
  const user = await User.findById(userId).select("firstName phoneE164 phoneVerifiedAt smsOptOutAt");
  if (!user) throw new NotFoundError("We couldn't find your account.");

  if (user.phoneE164 === phoneE164 && user.phoneVerifiedAt) {
    throw new ConflictError("That number is already confirmed on your account.");
  }

  // One number, one account. Without this a second account could claim a
  // number and start receiving another family's lesson reminders.
  const taken = await User.exists({
    _id: { $ne: user._id },
    phoneE164,
    phoneVerifiedAt: { $ne: null },
    deletedAt: null,
  });
  if (taken) {
    throw new ConflictError("That mobile number is already confirmed on another account.");
  }

  // A number that replied STOP cannot be texted again until the carrier
  // forwards START, whichever account asks.
  const optedOut = await User.exists({ phoneE164, smsOptOutAt: { $ne: null } });
  if (optedOut) {
    throw new BusinessRuleError(
      "That number has opted out of text messages. Text START to our number to opt back in.",
      "SMS_OPTED_OUT",
    );
  }

  const settings = await getSettings();
  const perHour = settings.notifications?.smsPerNumberHourlyLimit ?? 5;
  const recent = await AuthToken.countDocuments({
    userId: user._id,
    purpose: AUTH_TOKEN_PURPOSE.PHONE_VERIFICATION,
    createdAt: { $gte: new Date(Date.now() - 3600_000) },
  });
  if (recent >= perHour) {
    throw new RateLimitError("Too many confirmation codes requested. Try again in an hour.");
  }

  // Any code already in flight is void — otherwise two live codes double the
  // guesses an attacker gets.
  await AuthToken.updateMany(
    { userId: user._id, purpose: AUTH_TOKEN_PURPOSE.PHONE_VERIFICATION, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await AuthToken.create({
    userId: user._id,
    purpose: AUTH_TOKEN_PURPOSE.PHONE_VERIFICATION,
    tokenHash: hashCode(code),
    subject: phoneE164,
    expiresAt: new Date(Date.now() + VERIFICATION_TTL_MINUTES * 60_000),
    requestedIp: ip,
  });

  // The number is held unverified on the account so the settings screen can
  // show what is being confirmed. Nothing is ever texted to it until
  // `phoneVerifiedAt` is set.
  user.phone = phone;
  user.phoneE164 = phoneE164;
  user.phoneVerifiedAt = null;
  await user.save();

  const config = await getAppConfig();
  const delivery = await deliverSms({
    user,
    to: phoneE164,
    body: verificationSmsBody(code, config.branding.appName),
    kind: "VERIFICATION",
    // No dedupe key: each request is a new code and must actually go out.
  });

  return {
    sent: delivery.sent,
    simulated: Boolean(delivery.simulated),
    expiresInMinutes: VERIFICATION_TTL_MINUTES,
    /** Honest about a deployment with no carrier behind it. */
    providerConfigured: await smsConfigured(),
  };
}

/** Confirm a code. The number comes from the token, never from the request. */
export async function confirmPhoneVerification(userId, { code }, actor) {
  const token = await AuthToken.findOne({
    userId,
    purpose: AUTH_TOKEN_PURPOSE.PHONE_VERIFICATION,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  if (!token) {
    throw new BusinessRuleError(
      "That code has expired. Ask for a new one.",
      "CODE_EXPIRED",
    );
  }

  if (token.attempts >= MAX_VERIFICATION_ATTEMPTS) {
    await AuthToken.updateOne({ _id: token._id }, { $set: { consumedAt: new Date() } });
    throw new RateLimitError("Too many wrong codes. Ask for a new one.");
  }

  if (token.tokenHash !== hashCode(String(code))) {
    await AuthToken.updateOne({ _id: token._id }, { $inc: { attempts: 1 } });
    throw new ValidationError(
      { fieldErrors: { code: ["That code is not right."] } },
      "That code is not right.",
    );
  }

  await AuthToken.updateOne({ _id: token._id }, { $set: { consumedAt: new Date() } });

  // Re-checked at confirmation time: another account could have confirmed the
  // same number while this code was in flight.
  const taken = await User.exists({
    _id: { $ne: userId },
    phoneE164: token.subject,
    phoneVerifiedAt: { $ne: null },
    deletedAt: null,
  });
  if (taken) {
    throw new ConflictError("That mobile number is already confirmed on another account.");
  }

  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        phoneE164: token.subject,
        phoneVerifiedAt: new Date(),
        smsOptOutAt: null,
        // Confirming a number is the clearest possible statement that the
        // person wants texts, so the channel is switched on with it. They can
        // turn it back off in settings at any time.
        [`notificationPreferences.${NOTIFICATION_CHANNELS.SMS}`]: true,
      },
    },
    { returnDocument: "after" },
  ).select("phone phoneE164 phoneVerifiedAt notificationPreferences smsOptOutAt");

  await recordAudit({
    actor: actor ?? { id: userId },
    action: AUDIT_ACTIONS.PHONE_VERIFIED,
    entityType: "User",
    entityId: userId,
    metadata: { phone: maskNumber(token.subject) },
  });

  return toPlain(user);
}

/** Take the number off the account, which also stops every text. */
export async function removePhone(userId, actor) {
  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        phone: undefined,
        phoneE164: undefined,
        phoneVerifiedAt: null,
        [`notificationPreferences.${NOTIFICATION_CHANNELS.SMS}`]: false,
      },
    },
    { returnDocument: "after" },
  ).select("phone phoneE164 phoneVerifiedAt notificationPreferences");

  if (!user) throw new NotFoundError("We couldn't find your account.");

  await AuthToken.updateMany(
    { userId, purpose: AUTH_TOKEN_PURPOSE.PHONE_VERIFICATION, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );

  await recordAudit({
    actor: actor ?? { id: userId },
    action: AUDIT_ACTIONS.PHONE_REMOVED,
    entityType: "User",
    entityId: userId,
  });

  return toPlain(user);
}

// --- Opt-out ---------------------------------------------------------------

/**
 * Apply an inbound keyword a carrier forwarded (STOP, START).
 *
 * Opting out is applied to every account holding that number, not just one:
 * the person who replied STOP owns the handset, not an account row. Honouring
 * it is a legal duty, so it outranks the per-account preference and is not
 * undone by turning the channel back on in settings.
 */
export async function applySmsKeyword({ from, body }) {
  const keyword = String(body ?? "").trim().toUpperCase().split(/\s+/)[0];

  if (SMS_OPT_OUT_KEYWORDS.includes(keyword)) {
    const result = await User.updateMany(
      { phoneE164: from },
      {
        $set: {
          smsOptOutAt: new Date(),
          [`notificationPreferences.${NOTIFICATION_CHANNELS.SMS}`]: false,
        },
      },
    );
    await recordAudit({
      actor: { role: "SYSTEM" },
      action: AUDIT_ACTIONS.SMS_OPTED_OUT,
      entityType: "User",
      metadata: { phone: maskNumber(from), keyword, accounts: result.modifiedCount },
    });
    return { action: "OPT_OUT", accounts: result.modifiedCount };
  }

  if (SMS_OPT_IN_KEYWORDS.includes(keyword)) {
    // Opting back in clears the block but does not switch the channel on:
    // that stays the account holder's decision, made in settings.
    const result = await User.updateMany({ phoneE164: from }, { $set: { smsOptOutAt: null } });
    return { action: "OPT_IN", accounts: result.modifiedCount };
  }

  return { action: "IGNORED", accounts: 0 };
}

// --- Reads -----------------------------------------------------------------

/** The delivery log, for the admin support view (§28). */
export async function listSmsMessages({ status, kind, search, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = {};
  if (status) query.status = status;
  if (kind) query.kind = kind;
  if (search) query.to = new RegExp(String(search).replace(/[^\d+]/g, ""));

  const [items, total, counts] = await Promise.all([
    SmsMessage.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("userId", "firstName lastName email role")
      .lean(),
    SmsMessage.countDocuments(query),
    SmsMessage.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
  ]);

  return {
    items: toPlain(items).map((row) => ({ ...row, to: maskNumber(row.to) })),
    total,
    page,
    pageSize: size,
    counts: Object.fromEntries(counts.map((c) => [c._id, c.count])),
    providerConfigured: await smsConfigured(),
  };
}

// --- Internals -------------------------------------------------------------

async function exceedsSendRate(to) {
  const settings = await getSettings().catch(() => null);
  const limit = settings?.notifications?.smsPerNumberHourlyLimit ?? 5;
  if (!limit) return false;

  const sent = await SmsMessage.countDocuments({
    to,
    status: { $in: [SMS_STATUS.QUEUED, SMS_STATUS.SENT, SMS_STATUS.DELIVERED] },
    createdAt: { $gte: new Date(Date.now() - 3600_000) },
  });
  // The row claimed moments ago by this very send counts itself, hence `>`.
  return sent > limit;
}

function record({ user, to, body, kind, notification, ...rest }) {
  return SmsMessage.create({
    userId: user?._id ?? user?.id,
    to: to ?? "unknown",
    kind,
    notificationId: notification?.id,
    notificationType: notification?.type,
    bodyPreview: body ? preview(kind, body) : undefined,
    segments: body ? segmentCount(body) : undefined,
    ...rest,
  }).catch((error) => {
    // The log must never be the thing that breaks a send.
    console.error("[sms] could not record delivery:", error.message);
    return null;
  });
}

function finish(claimed, patch) {
  if (!claimed) return Promise.resolve();
  return SmsMessage.updateOne({ _id: claimed._id }, { $set: patch }).catch((error) => {
    console.error("[sms] could not update delivery record:", error.message);
  });
}

/** A one-time code is never previewed, however convenient support would find it. */
function preview(kind, body) {
  if (kind === "VERIFICATION") return "Confirmation code (not stored)";
  return body.slice(0, 160);
}

function hashCode(code) {
  return createHash("sha256").update(code).digest("hex");
}

/** "+14165550142" -> "+1416•••0142". Enough to recognise, not enough to dial. */
export function maskNumber(value) {
  if (!value || value.length < 8) return value ?? "";
  return `${value.slice(0, 5)}•••${value.slice(-4)}`;
}
