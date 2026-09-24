/**
 * Why a social sign-in did not finish, as the sign-in page explains it (§9).
 *
 * The callback runs in the person's browser and answers with a redirect, so
 * its outcome travels back to the sign-in page in the query string. Only a
 * code from this table ever goes there — never a message — and the page maps
 * it to fixed copy. Anything else in the URL renders the generic line, so the
 * parameter cannot be used to put somebody else's words on this page.
 *
 * Pure and import-free: the callback route and the sign-in form both read it.
 */
export const OAUTH_ERROR_MESSAGES = {
  CANCELLED: {
    tone: "info",
    title: "Sign-in cancelled",
    message: "Nothing was changed. Choose a way to sign in when you're ready.",
  },
  PROVIDER_DISABLED: {
    tone: "warning",
    title: "That sign-in method isn't available",
    message: "Use your email and password instead.",
  },
  PROVIDER_UNAVAILABLE: {
    tone: "warning",
    title: "That sign-in method isn't working right now",
    message: "Use your email and password, or try again later.",
  },
  STATE_INVALID: {
    tone: "warning",
    title: "That sign-in attempt expired",
    message: "It took too long, or it was started in another browser or tab. Please try again.",
  },
  EMAIL_NOT_SHARED: {
    tone: "warning",
    title: "No email address was shared",
    message:
      "We need an email address to create your account. Try again and share your email, or sign up with an email and password.",
  },
  EMAIL_NOT_VERIFIED_BY_PROVIDER: {
    tone: "warning",
    title: "An account already uses that email",
    message: "Sign in with your password first. You can use this sign-in method afterwards.",
  },
  EMAIL_IN_USE: {
    tone: "warning",
    title: "That email address belongs to another account",
    message: "Sign in with your email and password instead.",
  },
  ACCOUNT_SUSPENDED: {
    tone: "danger",
    title: "This account has been suspended",
    message: "Contact support if you think this is a mistake.",
  },
  RATE_LIMITED: {
    tone: "warning",
    title: "Too many sign-in attempts",
    message: "Wait a few minutes, then try again.",
  },
  FAILED: {
    tone: "danger",
    title: "We couldn't complete that sign-in",
    message: "Please try again, or use your email and password.",
  },
};

/** An internal error code, reduced to one the sign-in page knows. */
export function oauthErrorCode(code) {
  switch (code) {
    case "PROVIDER_DISABLED":
    case "PROVIDER_UNKNOWN":
    case "MODULE_DISABLED":
    case "DEVELOPMENT_MODE":
      return "PROVIDER_DISABLED";
    case "PROVIDER_UNAVAILABLE":
    case "PROVIDER_MISCONFIGURED":
    case "PROVIDER_UNREACHABLE":
      return "PROVIDER_UNAVAILABLE";
    case "STATE_INVALID":
    case "NONCE_MISMATCH":
    case "CODE_REJECTED":
    case "CODE_MISSING":
      return "STATE_INVALID";
    case "CONFLICT":
      return "EMAIL_IN_USE";
    case "CANCELLED":
    case "EMAIL_NOT_SHARED":
    case "EMAIL_NOT_VERIFIED_BY_PROVIDER":
    case "ACCOUNT_SUSPENDED":
    case "RATE_LIMITED":
      return code;
    default:
      return "FAILED";
  }
}

/** The copy for a code read from a URL — the generic line for anything unknown. */
export function oauthErrorPresentation(code) {
  if (!code) return null;
  return OAUTH_ERROR_MESSAGES[code] ?? OAUTH_ERROR_MESSAGES.FAILED;
}
