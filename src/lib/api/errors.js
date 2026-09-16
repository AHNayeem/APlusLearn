/**
 * Typed application errors.
 *
 * Services throw these; the route wrapper turns them into a consistent JSON
 * envelope with the right status code. Nothing else ever reaches the client —
 * unexpected errors are logged server-side and reported generically so we
 * never leak database internals (§36).
 */

export class AppError extends Error {
  constructor(message, { status = 400, code = "BAD_REQUEST", details } = {}) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export class ValidationError extends AppError {
  constructor(details, message = "Some details need your attention.") {
    super(message, { status: 422, code: "VALIDATION_ERROR", details });
    this.name = "ValidationError";
  }
}

export class AuthenticationError extends AppError {
  constructor(message = "You need to sign in to continue.") {
    super(message, { status: 401, code: "UNAUTHENTICATED" });
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends AppError {
  constructor(message = "You do not have access to this.") {
    super(message, { status: 403, code: "FORBIDDEN" });
    this.name = "AuthorizationError";
  }
}

/**
 * Signed in, but the email address behind the account has never been proved.
 *
 * Distinct from AuthorizationError so the UI can offer "resend the link"
 * rather than a dead end — the person is not forbidden, only unconfirmed.
 */
export class EmailNotVerifiedError extends AppError {
  constructor(message = "Confirm your email address to continue.") {
    super(message, { status: 403, code: "EMAIL_NOT_VERIFIED" });
    this.name = "EmailNotVerifiedError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "We couldn't find what you were looking for.") {
    super(message, { status: 404, code: "NOT_FOUND" });
    this.name = "NotFoundError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "That conflicts with something that already exists.") {
    super(message, { status: 409, code: "CONFLICT" });
    this.name = "ConflictError";
  }
}

/** A business rule said no — distinct from a malformed request. */
export class BusinessRuleError extends AppError {
  constructor(message, code = "RULE_VIOLATION") {
    super(message, { status: 422, code });
    this.name = "BusinessRuleError";
  }
}

export class RateLimitError extends AppError {
  constructor(message = "Too many attempts. Please wait a moment and try again.") {
    super(message, { status: 429, code: "RATE_LIMITED" });
    this.name = "RateLimitError";
  }
}

/** Convert a Zod v4 error into the `details` shape the UI renders per-field. */
export function zodToDetails(error) {
  const fieldErrors = {};
  for (const issue of error.issues ?? []) {
    const path = issue.path.join(".") || "_";
    if (!fieldErrors[path]) fieldErrors[path] = [];
    fieldErrors[path].push(issue.message);
  }
  return { fieldErrors };
}
