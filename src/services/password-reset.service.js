import "server-only";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { User, AuthToken, AUTH_TOKEN_PURPOSE } from "@/models";
import { USER_STATUS, AUDIT_ACTIONS, EMAIL_CATEGORIES, PASSWORD_RESET } from "@/constants";
import { hashPassword } from "@/lib/auth/password";
import { createToken, hashToken } from "@/lib/auth/tokens";
import { keyedDigest, signState, verifyState } from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/rate-limit";
import { AppError, RateLimitError, ValidationError } from "@/lib/api/errors";
import { sendEmail, brandedEmailTemplates } from "./external/email-provider";
import { recordAudit } from "./audit.service";
import { notifyPasswordChanged } from "./auth.service";

/**
 * Forgot password, by emailed code (§9, §36).
 *
 *   request  — email in; a signed *request handle* out, and (for a real
 *              account) a six-digit code in the inbox.
 *   verify   — handle + code in; a single-use *reset authorisation* out.
 *   reset    — authorisation + new password in; every session ended.
 *
 * Three different secrets, each proving one thing, and none of them a claim
 * the browser makes about itself.
 *
 * **Nothing here reveals whether an address has an account.** That property
 * is easy to keep on the first screen and easy to lose on the second: an
 * endpoint that says "that code expired" for a real account and "invalid" for
 * an unknown one has just answered the question. So every limit and every
 * expiry is carried by the *request handle* — which is issued identically for
 * any address — rather than by the stored code, which only exists for a real
 * one. An unknown address gets the same handle, the same cooldown, the same
 * five guesses and the same expiry; its codes are simply never right. The
 * slow part (finding the account, writing the code, talking to the mail
 * server) can be handed to `defer` so it runs after the response, and a
 * stopwatch learns nothing either.
 *
 * **The code is never stored.** Only an HMAC under `AUTH_SECRET`, bound to the
 * account and the request, so a copy of the database is not a copy of the
 * codes, and a code is meaningless outside the request it was sent for.
 *
 * **Development is not a different path.** With no mail server the same code
 * is generated, stored and checked; the console transport prints it and keeps
 * it in the development mailbox. There is no "any code works" mode.
 */

const REQUEST_LABEL = "aplus:password-reset-request";
const CODE_LABEL = "aplus:password-reset-code";
const ADDRESS_LABEL = "aplus:password-reset-address";

const MINUTE = 60_000;

const RESET_PURPOSES = [
  AUTH_TOKEN_PURPOSE.PASSWORD_RESET,
  AUTH_TOKEN_PURPOSE.PASSWORD_RESET_AUTHORIZATION,
];

/** How long the browser's handle lives, for the route that sets the cookie. */
export const PASSWORD_RESET_REQUEST_MAX_AGE_SECONDS = PASSWORD_RESET.requestTtlMinutes * 60;

/**
 * Per-client limits, applied by the routes on top of the per-address and
 * per-request limits below. Requesting and resending share one window.
 */
export const PASSWORD_RESET_CLIENT_LIMITS = {
  request: { limit: 5, windowMs: 15 * MINUTE },
  verify: { limit: 20, windowMs: 15 * MINUTE },
};

// --- Errors ------------------------------------------------------------------

function codeExpired() {
  return new AppError("This verification code has expired. Please request a new code.", {
    status: 410,
    code: "CODE_EXPIRED",
  });
}

function tooManyAttempts() {
  return new AppError("Too many verification attempts. Please request a new code.", {
    status: 429,
    code: "TOO_MANY_ATTEMPTS",
  });
}

function invalidCode() {
  return new ValidationError(
    { fieldErrors: { code: ["The verification code is invalid."] } },
    "The verification code is invalid.",
  );
}

function requestExpired() {
  return new AppError("Your reset request has expired. Enter your email to start again.", {
    status: 410,
    code: "RESET_REQUEST_EXPIRED",
  });
}

function authorizationExpired() {
  return new AppError("Your reset session has expired. Please request a new code.", {
    status: 410,
    code: "RESET_EXPIRED",
  });
}

// --- Helpers -----------------------------------------------------------------

/** "amara@example.com" -> "a***@example.com". Built from what was typed. */
export function maskEmail(email) {
  const [local = "", domain = ""] = String(email ?? "").split("@");
  return `${local.slice(0, 1) || "*"}***@${domain}`;
}

function codeDigest(userId, requestId, code) {
  return keyedDigest(`${userId}:${requestId}:${code}`, CODE_LABEL);
}

function digestsMatch(a, b) {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A rate-limit key for an address that does not put the address in the database. */
function addressKey(email) {
  return keyedDigest(email, ADDRESS_LABEL).slice(0, 32);
}

function readRequest(requestToken) {
  const request = verifyState(requestToken, { label: REQUEST_LABEL });
  if (!request?.rid || !request?.email || !request?.cx) return null;
  return request;
}

/**
 * What the code screen shows. Durations are relative to now rather than
 * timestamps, so a browser whose clock is wrong still counts down correctly.
 */
function describe(request) {
  const secondsUntil = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / 1000));
  return {
    maskedEmail: maskEmail(request.email),
    expiresInMinutes: PASSWORD_RESET.codeTtlMinutes,
    codeExpiresInSeconds: secondsUntil(request.cx),
    resendInSeconds: secondsUntil(request.iat + PASSWORD_RESET.resendCooldownSeconds * 1000),
  };
}

/**
 * Per-address limits, applied before anything is looked up — so an unknown
 * address is throttled exactly like a real one, and a 429 says nothing.
 * The per-client limit sits in the route; this one follows the address
 * whichever client asks.
 */
async function throttleCodes(email) {
  const key = addressKey(email);

  const cooldown = await rateLimit(`password-reset:cooldown:${key}`, {
    limit: 1,
    windowMs: PASSWORD_RESET.resendCooldownSeconds * 1000,
  });
  if (!cooldown.allowed) {
    throw new AppError(
      `Please wait ${cooldown.retryAfterSeconds} seconds before requesting another code.`,
      {
        status: 429,
        code: "RESEND_COOLDOWN",
        details: { retryAfterSeconds: cooldown.retryAfterSeconds },
      },
    );
  }

  const hourly = await rateLimit(`password-reset:hourly:${key}`, {
    limit: PASSWORD_RESET.maxCodesPerHour,
    windowMs: 60 * MINUTE,
  });
  if (!hourly.allowed) {
    const minutes = Math.ceil(hourly.retryAfterSeconds / 60);
    throw new RateLimitError(
      `Too many codes have been requested for this email. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
    );
  }
}

/**
 * The account-dependent half of a request. Never throws: a failure here only
 * ever happens for an address that exists, so surfacing it would be the very
 * oracle the rest of this module avoids. It is logged instead.
 */
async function issueCode({ email, requestId, expiresAt, ip }) {
  try {
    const user = await User.findOne({ email }).select("_id email firstName deletedAt").lean();
    if (!user || user.deletedAt) return;

    // A new code voids the previous one — two live codes would double the
    // guesses — and any authorisation not yet spent: the newest request is
    // the only one in play.
    await AuthToken.updateMany(
      { userId: user._id, purpose: { $in: RESET_PURPOSES }, consumedAt: null },
      { $set: { consumedAt: new Date() } },
    );

    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await AuthToken.create({
      userId: user._id,
      purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET,
      tokenHash: codeDigest(user._id, requestId, code),
      subject: requestId,
      expiresAt,
      requestedIp: ip,
    });

    await sendEmail(
      {
        to: user.email,
        ...(await brandedEmailTemplates()).passwordResetCode({
          firstName: user.firstName,
          code,
          expiresInMinutes: PASSWORD_RESET.codeTtlMinutes,
        }),
      },
      // Security mail has no platform switch (§26, §36).
      { category: EMAIL_CATEGORIES.SECURITY },
    );
  } catch (error) {
    console.error("[password-reset] could not issue a code:", error.message);
  }
}

const runNow = (task) => task();

// --- The flow ----------------------------------------------------------------

/**
 * Start (or restart) a reset for an address.
 *
 * Returns the same shape for every address. `requestToken` belongs in an
 * httpOnly cookie; the rest is what the screen shows.
 *
 * @param {string} email  Already normalised by the shared `email` schema.
 * @param {{ ip?: string, defer?: (task: () => Promise<void>) => unknown }} [options]
 *   `defer` runs the account-dependent work; the route passes Next's
 *   `after()` so it happens once the response has gone.
 */
export async function requestPasswordReset(email, { ip, defer = runNow } = {}) {
  await throttleCodes(email);

  const now = Date.now();
  const requestId = randomBytes(16).toString("base64url");
  const codeExpiresAt = now + PASSWORD_RESET.codeTtlMinutes * MINUTE;
  const request = { rid: requestId, email, iat: now, cx: codeExpiresAt };

  const requestToken = signState(request, {
    label: REQUEST_LABEL,
    ttlSeconds: PASSWORD_RESET_REQUEST_MAX_AGE_SECONDS,
  });

  await defer(() => issueCode({ email, requestId, expiresAt: new Date(codeExpiresAt), ip }));

  return { requestToken, ...describe(request) };
}

/** A new code for the request the browser already holds. */
export async function resendPasswordResetCode(requestToken, options) {
  const request = readRequest(requestToken);
  if (!request) throw requestExpired();
  return requestPasswordReset(request.email, options);
}

/** What the code screen needs to resume after a refresh, or null. */
export function describePasswordResetRequest(requestToken) {
  const request = readRequest(requestToken);
  return request ? describe(request) : null;
}

/**
 * Exchange a correct code for a reset authorisation.
 *
 * The guess count lives on the request, not the stored code, so an unknown
 * address locks out after the same five tries a real one does. For a real
 * account the stored code carries its own count too, and is burned with it.
 */
export async function verifyPasswordResetCode({ requestToken, code }) {
  const request = readRequest(requestToken);
  if (!request || Date.now() > request.cx) throw codeExpired();

  const user = await User.findOne({ email: request.email }).select("_id deletedAt").lean();
  const live =
    user && !user.deletedAt
      ? await AuthToken.findOne({
          userId: user._id,
          purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET,
          subject: request.rid,
          consumedAt: null,
          expiresAt: { $gt: new Date() },
        })
      : null;

  const attempt = await rateLimit(`password-reset:verify:${request.rid}`, {
    limit: PASSWORD_RESET.maxAttempts,
    windowMs: PASSWORD_RESET_REQUEST_MAX_AGE_SECONDS * 1000,
  });
  if (!attempt.allowed || (live && live.attempts >= PASSWORD_RESET.maxAttempts)) {
    if (live) await AuthToken.updateOne({ _id: live._id }, { $set: { consumedAt: new Date() } });
    throw tooManyAttempts();
  }

  if (!live || !digestsMatch(live.tokenHash, codeDigest(user._id, request.rid, code))) {
    if (live) await AuthToken.updateOne({ _id: live._id }, { $inc: { attempts: 1 } });
    throw invalidCode();
  }

  // Claimed, not merely read: two tabs submitting the same right code get
  // one authorisation between them.
  const claimed = await AuthToken.findOneAndUpdate(
    { _id: live._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );
  if (!claimed) throw invalidCode();

  const { raw, hash } = createToken();
  try {
    await AuthToken.updateMany(
      {
        userId: user._id,
        purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET_AUTHORIZATION,
        consumedAt: null,
      },
      { $set: { consumedAt: new Date() } },
    );
    await AuthToken.create({
      userId: user._id,
      purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET_AUTHORIZATION,
      tokenHash: hash,
      subject: request.rid,
      expiresAt: new Date(Date.now() + PASSWORD_RESET.authorizationTtlMinutes * MINUTE),
    });
  } catch (error) {
    // The person typed the right code; a failure to record that is ours, not
    // theirs. Release the claim so the same code still works on a retry.
    await AuthToken.updateOne({ _id: live._id }, { $set: { consumedAt: null } }).catch(() => {});
    throw error;
  }

  return { resetToken: raw, expiresInMinutes: PASSWORD_RESET.authorizationTtlMinutes };
}

/**
 * Set the new password.
 *
 * The authorisation is claimed with a conditional update before anything
 * changes, so a double-submitted form sets the password once. Every session
 * issued before this moment stops working (`tokenVersion`), and the account
 * owner is told by email.
 *
 * Deliberately does not sign the person in: they are sent to the sign-in page
 * to use the password they just chose.
 */
export async function resetPassword({ token, password }, { request } = {}) {
  const record = await AuthToken.findOneAndUpdate(
    {
      tokenHash: hashToken(token),
      purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET_AUTHORIZATION,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { consumedAt: new Date() } },
  );
  if (!record) throw authorizationExpired();

  const user = await User.findById(record.userId);
  if (!user || user.deletedAt) throw authorizationExpired();

  user.passwordHash = await hashPassword(password);
  // Invalidate every session issued before the reset.
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  if (user.status === USER_STATUS.PENDING_VERIFICATION && user.emailVerifiedAt) {
    user.status = USER_STATUS.ACTIVE;
  }
  await user.save();

  await AuthToken.updateMany(
    { userId: user._id, purpose: { $in: RESET_PURPOSES }, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );

  await notifyPasswordChanged(user);
  await recordAudit({
    actor: user,
    action: AUDIT_ACTIONS.USER_PASSWORD_RESET,
    entityType: "User",
    entityId: user._id,
    request,
  });

  return { reset: true };
}
