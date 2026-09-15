import "server-only";
import { User, AuthToken, AUTH_TOKEN_PURPOSE, StudentProfile, TutorApplication } from "@/models";
import { ROLES, USER_STATUS, AUTH_PROVIDERS, AUDIT_ACTIONS } from "@/constants";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createToken, hashToken } from "@/lib/auth/tokens";
import { AppError, ConflictError, NotFoundError, AuthenticationError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { getEmailProvider, emailTemplates } from "./external/email-provider";
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

  await getEmailProvider().send({
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

/** Google/Apple sign-in; creates the account on first use (§9). */
export async function oauthSignIn({ provider, credential, role }, { request } = {}) {
  const identity = await getOAuthProvider().verifyCredential({ provider, credential });

  let user = await User.findOne({
    $or: [
      { email: identity.email },
      {
        "oauthAccounts.provider": provider,
        "oauthAccounts.providerAccountId": identity.providerAccountId,
      },
    ],
  });

  if (user) {
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
    user.lastLoginAt = new Date();
    await user.save();
  } else {
    const newRole = role ?? ROLES.PARENT;
    user = await User.create({
      email: identity.email,
      firstName: identity.firstName,
      lastName: identity.lastName,
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

  await getEmailProvider().send({
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

  return { changed: true };
}

/** Invalidate every session for a user (logout everywhere, admin action). */
export async function revokeAllSessions(userId) {
  await User.updateOne({ _id: userId }, { $inc: { tokenVersion: 1 } });
  return { revoked: true };
}
