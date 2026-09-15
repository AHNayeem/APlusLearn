import "server-only";
import { User, AuthToken, AUTH_TOKEN_PURPOSE, StudentProfile, TutorApplication } from "@/models";
import { ROLES, USER_STATUS, AUTH_PROVIDERS, AUDIT_ACTIONS } from "@/constants";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createToken, hashToken } from "@/lib/auth/tokens";
import { AppError, ConflictError, NotFoundError, AuthenticationError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { sendEmail, emailTemplates } from "./external/email-provider";
import { getOAuthProvider } from "./external/oauth-provider";
import { recordAudit } from "./audit.service";

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

/**
 * Registration (§4, §9).
 *
 * A self-serve STUDENT gets a learner profile pointing at themselves, and a
 * TUTOR gets a draft application, so every account is immediately usable.
 */
export async function register(input, { request } = {}) {
  const existing = await User.findOne({ email: input.email }).select("_id").lean();
  if (existing) {
    throw new ConflictError("An account with that email already exists. Try signing in instead.");
  }

  const user = await User.create({
    email: input.email,
    passwordHash: await hashPassword(input.password),
    firstName: input.firstName,
    lastName: input.lastName,
    phone: input.phone,
    role: input.role,
    status: USER_STATUS.PENDING_VERIFICATION,
    province: input.provinceCode,
    city: input.city,
    marketingOptIn: input.marketingOptIn,
    acceptedTermsAt: new Date(),
  });

  if (input.role === ROLES.STUDENT) {
    await StudentProfile.create({
      ownerId: user._id,
      isSelf: true,
      firstName: user.firstName,
      lastName: user.lastName,
      provinceCode: input.provinceCode,
      isMinor: false,
    });
  }

  if (input.role === ROLES.TUTOR) {
    await TutorApplication.create({
      userId: user._id,
      data: {
        PERSONAL: {
          firstName: user.firstName,
          lastName: user.lastName,
          phone: user.phone,
          province: input.provinceCode,
          city: input.city,
        },
      },
    });
  }

  await sendVerificationEmail(user);
  await recordAudit({
    actor: user,
    action: AUDIT_ACTIONS.USER_REGISTERED,
    entityType: "User",
    entityId: user._id,
    metadata: { role: user.role },
    request,
  });

  return toPlain({ ...user.toObject(), passwordHash: undefined });
}

export async function sendVerificationEmail(user) {
  await AuthToken.updateMany(
    { userId: user._id, purpose: AUTH_TOKEN_PURPOSE.EMAIL_VERIFICATION, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );

  const { raw, hash } = createToken();
  await AuthToken.create({
    userId: user._id,
    purpose: AUTH_TOKEN_PURPOSE.EMAIL_VERIFICATION,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + VERIFY_TTL_MS),
  });

  // Best-effort: a transient provider outage must not fail registration, and
  // "resend verification" is always available. The token is already stored.
  await sendEmail({
    to: user.email,
    ...emailTemplates.verifyEmail({ firstName: user.firstName, token: raw }),
  });

  return { sent: true };
}

export async function verifyEmail(rawToken) {
  const record = await AuthToken.findOne({
    tokenHash: hashToken(rawToken),
    purpose: AUTH_TOKEN_PURPOSE.EMAIL_VERIFICATION,
  });

  if (!record || record.consumedAt || record.expiresAt < new Date()) {
    throw new AppError("That verification link has expired. Request a new one.", {
      status: 410,
      code: "TOKEN_EXPIRED",
    });
  }

  record.consumedAt = new Date();
  await record.save();

  const user = await User.findByIdAndUpdate(
    record.userId,
    {
      $set: {
        emailVerifiedAt: new Date(),
        // Verifying is what activates a pending account.
        status: USER_STATUS.ACTIVE,
      },
    },
    { returnDocument: "after" },
  ).lean();

  if (!user) throw new NotFoundError("We couldn't find that account.");
  return toPlain({ ...user, passwordHash: undefined });
}

export async function resendVerification(email) {
  const user = await User.findOne({ email }).lean();
  // Always report success so the endpoint cannot enumerate accounts.
  if (!user || user.emailVerifiedAt) return { sent: true };
  await sendVerificationEmail(user);
  return { sent: true };
}

/**
 * Credentials login. The same generic message is returned for an unknown
 * email and a wrong password so neither can be probed.
 */
export async function login({ email, password }, { request } = {}) {
  const user = await User.findOne({ email }).select("+passwordHash");

  if (!user || user.deletedAt) {
    throw new AuthenticationError("That email or password is incorrect.");
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    throw new AuthenticationError("That email or password is incorrect.");
  }

  if (user.status === USER_STATUS.SUSPENDED) {
    throw new AppError(
      "This account has been suspended. Contact support if you think this is a mistake.",
      { status: 403, code: "ACCOUNT_SUSPENDED" },
    );
  }

  user.lastLoginAt = new Date();
  await user.save();

  await recordAudit({
    actor: user,
    action: AUDIT_ACTIONS.USER_LOGIN,
    entityType: "User",
    entityId: user._id,
    request,
  });

  return toPlain({ ...user.toObject(), passwordHash: undefined });
}

/**
 * Google/Apple sign-in; creates the account on first use (§9).
 *
 * The identity has already been cryptographically verified by the provider
 * adapter. What this function decides is what that identity is allowed to do
 * to an account, and the rules are conservative:
 *
 * - **Linking by email needs a provider-verified address.** Otherwise anyone
 *   who can assert an unverified `email` claim could attach themselves to an
 *   existing account.
 * - **One identity, one account.** If the provider identity already belongs
 *   to somebody else, the sign-in is refused rather than re-pointed.
 * - **Role is never granted by OAuth.** `role` is honoured only when creating
 *   a brand-new account; an existing user's role, status and profile are left
 *   exactly as they are. RBAC stays where it lives (§10).
 * - **Protected fields are not overwritten.** The provider may supply a name
 *   or picture, and they are used only to fill a blank.
 */
export async function oauthSignIn({ provider, credential, role, nonce, profile }, { request } = {}) {
  const identity = await getOAuthProvider().verifyCredential({
    provider,
    credential,
    expectedNonce: nonce,
    profile,
  });

  // Look the provider identity up first: it is the strong key.
  let user = await User.findOne({
    "oauthAccounts.provider": provider,
    "oauthAccounts.providerAccountId": identity.providerAccountId,
  });

  if (!user) {
    const byEmail = await User.findOne({ email: identity.email });

    if (byEmail) {
      if (!identity.emailVerified) {
        throw new AppError(
          "An account already uses that email address. Sign in with your password to link this provider.",
          { status: 409, code: "EMAIL_NOT_VERIFIED_BY_PROVIDER" },
        );
      }
      user = byEmail;
    }
  } else if (user.email !== identity.email) {
    // The provider changed the address on an identity we already know. Trust
    // the link, not the new address — changing an account email is a
    // deliberate, separately-verified action.
    const clash = await User.findOne({ email: identity.email }).select("_id").lean();
    if (clash && String(clash._id) !== String(user._id)) {
      throw new ConflictError(
        "That email address is already used by another account. Sign in with your password instead.",
      );
    }
  }

  if (user) {
    if (user.deletedAt) {
      throw new AuthenticationError("That email or password is incorrect.");
    }

    const alreadyLinked = user.oauthAccounts.some(
      (a) => a.provider === provider && a.providerAccountId === identity.providerAccountId,
    );
    if (!alreadyLinked) {
      user.oauthAccounts.push({
        provider,
        providerAccountId: identity.providerAccountId,
      });
    }
    // A provider-verified address counts as a verified email.
    if (identity.emailVerified && !user.emailVerifiedAt) {
      user.emailVerifiedAt = new Date();
      if (user.status === USER_STATUS.PENDING_VERIFICATION) user.status = USER_STATUS.ACTIVE;
    }
    // Fill blanks only — never overwrite what the user has set themselves.
    if (!user.avatarUrl && identity.avatarUrl) user.avatarUrl = identity.avatarUrl;
    user.lastLoginAt = new Date();
    await user.save();

    await recordAudit({
      actor: user,
      action: AUDIT_ACTIONS.USER_LOGIN,
      entityType: "User",
      entityId: user._id,
      metadata: { provider, linked: !alreadyLinked },
      request,
    });
  } else {
    const newRole = role ?? ROLES.PARENT;
    user = await User.create({
      email: identity.email,
      firstName: identity.firstName || "New",
      lastName: identity.lastName || "Member",
      avatarUrl: identity.avatarUrl,
      role: newRole,
      status: identity.emailVerified ? USER_STATUS.ACTIVE : USER_STATUS.PENDING_VERIFICATION,
      emailVerifiedAt: identity.emailVerified ? new Date() : null,
      acceptedTermsAt: new Date(),
      oauthAccounts: [
        { provider, providerAccountId: identity.providerAccountId },
      ],
      lastLoginAt: new Date(),
    });

    if (newRole === ROLES.STUDENT) {
      await StudentProfile.create({
        ownerId: user._id,
        isSelf: true,
        firstName: user.firstName,
        lastName: user.lastName,
        isMinor: false,
      });
    }
    if (newRole === ROLES.TUTOR) {
      await TutorApplication.create({ userId: user._id });
    }

    await recordAudit({
      actor: user,
      action: AUDIT_ACTIONS.USER_REGISTERED,
      entityType: "User",
      entityId: user._id,
      metadata: { role: newRole, provider },
      request,
    });
  }

  if (user.status === USER_STATUS.SUSPENDED) {
    throw new AppError("This account has been suspended.", {
      status: 403,
      code: "ACCOUNT_SUSPENDED",
    });
  }

  return toPlain({ ...user.toObject(), passwordHash: undefined });
}

export async function requestPasswordReset(email) {
  const user = await User.findOne({ email }).lean();
  // Always return success: the response must not reveal whether an account exists.
  if (!user || user.deletedAt) return { sent: true };

  await AuthToken.updateMany(
    { userId: user._id, purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET, consumedAt: null },
    { $set: { consumedAt: new Date() } },
  );

  const { raw, hash } = createToken();
  await AuthToken.create({
    userId: user._id,
    purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET,
    tokenHash: hash,
    expiresAt: new Date(Date.now() + RESET_TTL_MS),
  });

  // Deliberately not surfaced: a delivery error here would only ever happen
  // for an address that exists, which would turn this endpoint into an
  // account-enumeration oracle. It is logged instead.
  await sendEmail({
    to: user.email,
    ...emailTemplates.resetPassword({ firstName: user.firstName, token: raw }),
  });

  return { sent: true };
}

export async function resetPassword({ token, password }) {
  const record = await AuthToken.findOne({
    tokenHash: hashToken(token),
    purpose: AUTH_TOKEN_PURPOSE.PASSWORD_RESET,
  });

  if (!record || record.consumedAt || record.expiresAt < new Date()) {
    throw new AppError("That reset link has expired. Request a new one.", {
      status: 410,
      code: "TOKEN_EXPIRED",
    });
  }

  record.consumedAt = new Date();
  await record.save();

  const user = await User.findById(record.userId);
  if (!user) throw new NotFoundError("We couldn't find that account.");

  user.passwordHash = await hashPassword(password);
  // Invalidate every session issued before the reset.
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  if (user.status === USER_STATUS.PENDING_VERIFICATION && user.emailVerifiedAt) {
    user.status = USER_STATUS.ACTIVE;
  }
  await user.save();

  await notifyPasswordChanged(user);

  return toPlain({ ...user.toObject(), passwordHash: undefined });
}

export async function changePassword(userId, { currentPassword, password }) {
  const user = await User.findById(userId).select("+passwordHash");
  if (!user) throw new NotFoundError("We couldn't find that account.");

  if (user.passwordHash) {
    const valid = await verifyPassword(currentPassword, user.passwordHash);
    if (!valid) throw new AuthenticationError("Your current password is incorrect.");
  }

  user.passwordHash = await hashPassword(password);
  user.tokenVersion = (user.tokenVersion ?? 0) + 1;
  await user.save();

  await notifyPasswordChanged(user);

  return { changed: true };
}

/**
 * Tell someone their password changed (§36).
 *
 * Sent after the fact and carrying no token, so it is safe to deliver to an
 * address that may no longer be under the account owner's control — its whole
 * job is to let a victim notice a takeover.
 */
async function notifyPasswordChanged(user) {
  await sendEmail({
    to: user.email,
    ...emailTemplates.passwordChanged({
      firstName: user.firstName,
      whenLabel: new Date().toLocaleString("en-CA", { timeZone: user.timeZone || "America/Toronto" }),
    }),
  });
}

/** Invalidate every session for a user (logout everywhere, admin action). */
export async function revokeAllSessions(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  return { revoked: true };
}
