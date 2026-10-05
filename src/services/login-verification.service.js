import "server-only";
import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { User, AuthToken, AUTH_TOKEN_PURPOSE, TrustedDevice } from "@/models";
import { BLOCKED_USER_STATUSES, AUDIT_ACTIONS, EMAIL_CATEGORIES, LOGIN_VERIFICATION } from "@/constants";
import { hashToken } from "@/lib/auth/tokens";
import {
  keyedDigest,
  signState,
  verifyState,
  encryptSecret,
  decryptSecret,
} from "@/lib/security/crypto";
import { rateLimit } from "@/lib/security/rate-limit";
import { isProduction } from "@/lib/config/env";
import { AppError, RateLimitError, ValidationError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { sendEmail, brandedEmailTemplates } from "./external/email-provider";
import { recordAudit } from "./audit.service";
import { recordSignIn } from "./auth.service";
import { maskEmail } from "./password-reset.service";

/**
 * New-device sign-in verification (§9, §36).
 *
 *   password  — right password, unrecognised browser: no session. A signed
 *               *challenge handle* out, and a six-digit code in the inbox.
 *   verify    — handle + code in; the browser is trusted, the session issued.
 *   resend    — a fresh code for the challenge the browser already holds.
 *
 * **A browser is recognised by a `TrustedDevice` row, never by a claim.** The
 * `aplus_device` cookie is a random value whose hash keys that row, and the
 * row carries the account's `tokenVersion` from the moment of trust — so the
 * events that already end every session (a password reset or change, "sign
 * out everywhere", a suspension) end every device's trust too, by the same
 * comparison, with nothing to remember at each call site.
 *
 * **The code is never stored.** Only an HMAC under `AUTH_SECRET`, bound to the
 * account and the challenge, exactly as forgot-password stores its code.
 *
 * **This flow does not have to hide who has an account**, unlike that one: a
 * challenge exists only after the password was right, so everything it says
 * is said to somebody who already proved they know it. What it has to hold is
 * narrower — five guesses per code, one live code per account, and a code
 * that opens exactly one session.
 *
 * **Development shows the code on screen.** In a development build on a
 * non-production deployment, the code comes back in the response and on the
 * code screen, so no mail transport is needed to sign in. It is the same code,
 * stored and checked the same way — there is no "any code works" mode.
 *
 * Social sign-in does not come through here: the identity provider has
 * already authenticated the person, with its own second factor if they set
 * one up. This step stands in for that on the password path only.
 */

const CHALLENGE_LABEL = "aplus:login-challenge";
const CODE_LABEL = "aplus:login-code";
const DEV_CODE_LABEL = "aplus:login-dev-code";

const MINUTE = 60_000;

/** What `randomBytes(32).toString("base64url")` produces, and nothing else. */
const DEVICE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** How long the browser's handles live, for the routes that set the cookies. */
export const LOGIN_CHALLENGE_MAX_AGE_SECONDS = LOGIN_VERIFICATION.challengeTtlMinutes * 60;
export const TRUSTED_DEVICE_MAX_AGE_SECONDS = LOGIN_VERIFICATION.trustedDeviceDays * 24 * 60 * 60;

/**
 * Per-client limits, applied by the routes on top of the per-code and
 * per-account limits below.
 */
export const LOGIN_VERIFICATION_CLIENT_LIMITS = {
  verify: { limit: 30, windowMs: 15 * MINUTE },
  resend: { limit: 5, windowMs: 15 * MINUTE },
};

/**
 * Whether the code may be put on screen. A development build (`NODE_ENV`)
 * *and* a deployment that does not say it is production (`APP_ENV`) — the two
 * locks the development mailbox holds to — so a staging build with
 * `next build` never shows one.
 */
export function codeShownOnScreen() {
  return process.env.NODE_ENV === "development" && !isProduction();
}

// --- Errors ------------------------------------------------------------------

function challengeExpired() {
  return new AppError("Your sign-in attempt has expired. Please sign in again.", {
    status: 410,
    code: "LOGIN_CHALLENGE_EXPIRED",
  });
}

function codeExpired() {
  return new AppError("This sign-in code has expired. Please send a new code.", {
    status: 410,
    code: "CODE_EXPIRED",
  });
}

function tooManyAttempts() {
  return new AppError("Too many incorrect codes. Please send a new code.", {
    status: 429,
    code: "TOO_MANY_ATTEMPTS",
  });
}

function invalidCode() {
  return new ValidationError(
    { fieldErrors: { code: ["That code isn't right. Check the email and try again."] } },
    "That code isn't right. Check the email and try again.",
  );
}

// --- Helpers -----------------------------------------------------------------

function codeDigest(userId, challengeId, code) {
  return keyedDigest(`${userId}:${challengeId}:${code}`, CODE_LABEL);
}

function digestsMatch(a, b) {
  const left = Buffer.from(String(a), "hex");
  const right = Buffer.from(String(b), "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

function readChallenge(challengeToken) {
  const challenge = verifyState(challengeToken, { label: CHALLENGE_LABEL });
  if (!challenge?.cid || !challenge?.uid || !challenge?.cx) return null;
  return challenge;
}

/**
 * The account a challenge was issued for, if it may still finish signing in.
 * A password reset or "sign out everywhere" since the challenge bumps
 * `tokenVersion`, and a challenge from before that is spent with it.
 */
async function challengeUser(challenge) {
  const user = await User.findById(challenge.uid).lean();
  if (!user || user.deletedAt || BLOCKED_USER_STATUSES.includes(user.status)) return null;
  if ((user.tokenVersion ?? 0) !== challenge.tv) return null;
  return user;
}

/**
 * What the code screen shows. Durations are relative to now rather than
 * timestamps, so a browser whose clock is wrong still counts down correctly.
 */
function describe(challenge) {
  const secondsUntil = (ms) => Math.max(0, Math.ceil((ms - Date.now()) / 1000));
  const devCode =
    codeShownOnScreen() && challenge.dc ? decryptSecret(challenge.dc, DEV_CODE_LABEL) : null;
  return {
    maskedEmail: challenge.me,
    expiresInMinutes: LOGIN_VERIFICATION.codeTtlMinutes,
    codeExpiresInSeconds: secondsUntil(challenge.cx),
    resendInSeconds: secondsUntil(challenge.iat + LOGIN_VERIFICATION.resendCooldownSeconds * 1000),
    ...(devCode ? { devCode } : {}),
  };
}

/**
 * "Chrome on macOS", from a User-Agent header — for the email and the
 * account's device list, never for a decision. iOS is tested before macOS
 * because an iPad reports "Mac OS X" too, and Edge before Chrome because it
 * reports both.
 */
export function deviceLabel(userAgent) {
  const ua = String(userAgent ?? "");
  if (!ua) return null;
  const browser = /Edg(e|A|iOS)?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /Firefox\/|FxiOS\//.test(ua)
        ? "Firefox"
        : /Chrome\/|CriOS\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : null;
  const os = /iPhone|iPad|iPod/.test(ua)
    ? "iOS"
    : /Android/.test(ua)
      ? "Android"
      : /Windows/.test(ua)
        ? "Windows"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Mac OS X|Macintosh/.test(ua)
            ? "macOS"
            : /Linux/.test(ua)
              ? "Linux"
              : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? "Unknown device";
}

/**
 * Per-account limits. The cooldown window is started by every code sent,
 * but only a *resend* is refused by it: somebody who signs in, goes back and
 * signs in again has not asked twice, they have started over, and the
 * previous code is void either way.
 */
async function throttleCodes(userId, { resend }) {
  const cooldown = await rateLimit(`login-code:cooldown:${userId}`, {
    limit: 1,
    windowMs: LOGIN_VERIFICATION.resendCooldownSeconds * 1000,
  });
  if (resend && !cooldown.allowed) {
    throw new AppError(
      `Please wait ${cooldown.retryAfterSeconds} seconds before requesting another code.`,
      {
        status: 429,
        code: "RESEND_COOLDOWN",
        details: { retryAfterSeconds: cooldown.retryAfterSeconds },
      },
    );
  }

  const hourly = await rateLimit(`login-code:hourly:${userId}`, {
    limit: LOGIN_VERIFICATION.maxCodesPerHour,
    windowMs: 60 * MINUTE,
  });
  if (!hourly.allowed) {
    const minutes = Math.ceil(hourly.retryAfterSeconds / 60);
    throw new RateLimitError(
      `Too many sign-in codes have been sent to this account. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
    );
  }
}

/** Best-effort: the code is already stored, and "Resend code" is one click away. */
async function sendCode(user, { code, userAgent }) {
  try {
    await sendEmail(
      {
        to: user.email,
        ...(await brandedEmailTemplates()).loginVerificationCode({
          firstName: user.firstName,
          code,
          expiresInMinutes: LOGIN_VERIFICATION.codeTtlMinutes,
          deviceLabel: deviceLabel(userAgent),
          whenLabel: new Date().toLocaleString("en-CA", {
            timeZone: user.timeZone || "America/Toronto",
          }),
        }),
      },
      // Security mail has no platform switch (§26, §36).
      { category: EMAIL_CATEGORIES.SECURITY },
    );
  } catch (error) {
    console.error("[login-verification] could not send a code:", error.message);
  }
}

const runNow = (task) => task();

/**
 * Store a fresh code for a challenge and sign the handle that carries it.
 *
 * The code is written before the response goes, so a person who types it
 * quickly can never race the database; only the email is handed to `defer`.
 */
async function issue(challenge, user, { ip, userAgent, defer }) {
  // One live code per account: a new one voids the last, so the guesses
  // against any account never exceed one code's worth at a time.
  await AuthToken.updateMany(
    { userId: user._id, purpose: AUTH_TOKEN_PURPOSE.LOGIN_VERIFICATION, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await AuthToken.create({
    userId: user._id,
    purpose: AUTH_TOKEN_PURPOSE.LOGIN_VERIFICATION,
    tokenHash: codeDigest(user._id, challenge.cid, code),
    subject: challenge.cid,
    expiresAt: new Date(challenge.cx),
    requestedIp: ip,
  });

  const signed = {
    ...challenge,
    // Sealed rather than merely signed: the handle is readable by whoever
    // holds the cookie, and a code in it — even a development one — should
    // be read only by the server that put it there.
    dc: codeShownOnScreen() ? encryptSecret(code, DEV_CODE_LABEL) : undefined,
  };
  const challengeToken = signState(signed, {
    label: CHALLENGE_LABEL,
    ttlSeconds: LOGIN_CHALLENGE_MAX_AGE_SECONDS,
  });

  await defer(() => sendCode(user, { code, userAgent }));

  return { challengeToken, ...describe(signed) };
}

// --- The flow ----------------------------------------------------------------

/**
 * Whether this browser is trusted by this account. Touches `lastUsedAt` when
 * it is, so the device list can say when each browser was last used.
 */
export async function isTrustedDevice(user, deviceToken) {
  if (!user || !DEVICE_TOKEN.test(deviceToken ?? "")) return false;
  const device = await TrustedDevice.findOneAndUpdate(
    {
      userId: user._id ?? user.id,
      deviceHash: hashToken(deviceToken),
      tokenVersion: user.tokenVersion ?? 0,
      expiresAt: { $gt: new Date() },
    },
    { $set: { lastUsedAt: new Date() } },
  )
    .select("_id")
    .lean();
  return Boolean(device);
}

/**
 * The password was right; the browser is not trusted. Start a challenge.
 *
 * `challengeToken` belongs in an httpOnly cookie; the rest is what the code
 * screen shows. The choices made on the sign-in form travel in the signed
 * handle, so the verify step never has to believe a body that restates them.
 *
 * @param {object} user  The account `authenticateWithPassword` returned.
 * @param {{ remember?: boolean, next?: string, ip?: string, userAgent?: string,
 *   defer?: (task: () => Promise<void>) => unknown }} [options]
 */
export async function startLoginChallenge(
  user,
  { remember = true, next, ip, userAgent, defer = runNow } = {},
) {
  const userId = String(user._id ?? user.id);
  await throttleCodes(userId, { resend: false });

  const now = Date.now();
  const challenge = {
    cid: randomBytes(16).toString("base64url"),
    uid: userId,
    tv: user.tokenVersion ?? 0,
    rm: Boolean(remember),
    nx: next ?? null,
    me: maskEmail(user.email),
    iat: now,
    cx: now + LOGIN_VERIFICATION.codeTtlMinutes * MINUTE,
  };

  return issue(challenge, { ...user, _id: userId }, { ip, userAgent, defer });
}

/** A new code for the challenge this browser already holds. */
export async function resendLoginCode(challengeToken, { ip, userAgent, defer = runNow } = {}) {
  const challenge = readChallenge(challengeToken);
  if (!challenge) throw challengeExpired();
  const user = await challengeUser(challenge);
  if (!user) throw challengeExpired();

  await throttleCodes(String(user._id), { resend: true });

  const now = Date.now();
  return issue(
    { ...challenge, iat: now, cx: now + LOGIN_VERIFICATION.codeTtlMinutes * MINUTE },
    user,
    { ip, userAgent, defer },
  );
}

/** What the code screen needs to resume after a refresh, or null. */
export function describeLoginChallenge(challengeToken) {
  const challenge = readChallenge(challengeToken);
  return challenge ? describe(challenge) : null;
}

/**
 * Exchange a correct code for a trusted browser and a signed-in account.
 *
 * The code is *claimed* with a conditional update before anything is
 * granted, so two tabs submitting the same right code open one session
 * between them. The caller sets the session and device cookies from what
 * this returns; the audit trail is written here.
 *
 * @returns {Promise<{ user: object, deviceToken: string, remember: boolean, next: string | null }>}
 */
export async function verifyLoginCode(
  { challengeToken, code, deviceToken },
  { ip, userAgent, request } = {},
) {
  const challenge = readChallenge(challengeToken);
  if (!challenge) throw challengeExpired();
  if (Date.now() > challenge.cx) throw codeExpired();

  const user = await challengeUser(challenge);
  if (!user) throw challengeExpired();

  // A code voided by a newer one (another tab, another sign-in) or burned by
  // too many guesses is simply gone; the way on is a new code either way.
  const live = await AuthToken.findOne({
    userId: user._id,
    purpose: AUTH_TOKEN_PURPOSE.LOGIN_VERIFICATION,
    subject: challenge.cid,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!live) throw codeExpired();

  if (!digestsMatch(live.tokenHash, codeDigest(user._id, challenge.cid, code))) {
    const counted = await AuthToken.findOneAndUpdate(
      { _id: live._id, consumedAt: null },
      { $inc: { attempts: 1 } },
      { returnDocument: "after" },
    );
    if (!counted || counted.attempts >= LOGIN_VERIFICATION.maxAttempts) {
      await AuthToken.updateOne({ _id: live._id }, { $set: { consumedAt: new Date() } });
      throw tooManyAttempts();
    }
    throw invalidCode();
  }

  const claimed = await AuthToken.findOneAndUpdate(
    { _id: live._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );
  if (!claimed) throw codeExpired();

  // Keep the browser's existing identifier when it has one, so one laptop is
  // one device across every account that verifies on it.
  const device = DEVICE_TOKEN.test(deviceToken ?? "")
    ? deviceToken
    : randomBytes(32).toString("base64url");
  const now = new Date();

  try {
    await TrustedDevice.findOneAndUpdate(
      { userId: user._id, deviceHash: hashToken(device) },
      {
        $set: {
          tokenVersion: user.tokenVersion ?? 0,
          label: deviceLabel(userAgent) ?? undefined,
          userAgent: userAgent ? String(userAgent).slice(0, 300) : undefined,
          ip: ip ? String(ip).slice(0, 64) : undefined,
          lastUsedAt: now,
          expiresAt: new Date(now.getTime() + TRUSTED_DEVICE_MAX_AGE_SECONDS * 1000),
        },
      },
      { upsert: true },
    );
  } catch (error) {
    // The person typed the right code; a failure to record that is ours, not
    // theirs. Release the claim so the same code still works on a retry.
    await AuthToken.updateOne({ _id: live._id }, { $set: { consumedAt: null } }).catch(() => {});
    throw error;
  }

  await recordAudit({
    actor: user,
    action: AUDIT_ACTIONS.USER_DEVICE_TRUSTED,
    entityType: "User",
    entityId: user._id,
    metadata: { device: deviceLabel(userAgent) },
    request,
  });
  await recordSignIn(user, { request, metadata: { newDevice: true } });

  return {
    user: toPlain({ ...user, passwordHash: undefined }),
    deviceToken: device,
    remember: challenge.rm !== false,
    next: challenge.nx ?? null,
  };
}
