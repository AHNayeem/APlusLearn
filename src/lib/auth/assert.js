import { AuthenticationError, AuthorizationError, EmailNotVerifiedError } from "@/lib/api/errors";

/**
 * Record-level authorization assertions (§8, §42).
 *
 * These decide whether *this* actor may act on *this* already-loaded record.
 * They are deliberately pure — no session, no database, no `next/navigation`
 * — so a service can depend on them without dragging the request runtime in
 * behind it, and so they can be reasoned about and tested in isolation.
 *
 * Resolving who the actor *is* belongs one layer up, in `guards.js`, which
 * re-exports everything here so existing imports keep working.
 */

/**
 * Ownership check. `ownerId` comes from the *database record*, never from the
 * request body — the caller must load the resource first (§8, §42).
 */
export function requireOwnership(user, ownerId, message) {
  const mine = String(user.id ?? user._id);
  if (String(ownerId) !== mine) {
    throw new AuthorizationError(message ?? "You do not have access to this.");
  }
  return true;
}

/** Ownership that an administrator may override. */
export function requireOwnershipOrAdmin(user, ownerId, message) {
  if (user.role === "ADMIN") return true;
  return requireOwnership(user, ownerId, message);
}

/** Any of several allowed owners (e.g. both sides of a booking). */
export function requireParticipant(user, participantIds = [], message) {
  if (user.role === "ADMIN") return true;
  const mine = String(user.id ?? user._id);
  if (!participantIds.some((id) => String(id) === mine)) {
    throw new AuthorizationError(message ?? "You do not have access to this.");
  }
  return true;
}

/**
 * A confirmed email address is required before anything that spends money,
 * reaches another member, or becomes public (§9, §35).
 *
 * Signing in is deliberately *not* gated — somebody has to be able to reach
 * the page that resends the link. The gate sits on the actions instead, and
 * it sits in the services as well as the route pipeline so a second endpoint
 * onto the same operation cannot become a way around it.
 *
 * An administrator is exempt: an operator locked out of the console by an
 * unreceived email is a worse failure than the one this prevents.
 */
export function requireVerifiedEmail(user, message) {
  if (!user) throw new AuthenticationError();
  if (user.role === "ADMIN") return true;
  if (user.emailVerifiedAt) return true;
  throw new EmailNotVerifiedError(message);
}
