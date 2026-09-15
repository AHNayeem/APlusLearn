import "server-only";
import { redirect } from "next/navigation";
import { AuthenticationError, AuthorizationError } from "@/lib/api/errors";
import { roleHasPermission } from "@/lib/permissions";
import { homeForRole } from "@/constants/navigation";
import { getCurrentUser } from "./current-user";

/**
 * Server-side guards (§10).
 *
 * The `require*` family throws typed errors and is used by API routes and
 * services. The `enforce*` family redirects and is used by Server Component
 * pages. Both read the same session — neither trusts anything from the client.
 */

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) throw new AuthenticationError();
  return user;
}

export async function requireRole(...roles) {
  const user = await requireAuth();
  const allowed = roles.flat();
  if (!allowed.includes(user.role)) {
    throw new AuthorizationError("Your account type does not have access to this.");
  }
  return user;
}

export async function requirePermission(permission) {
  const user = await requireAuth();
  if (!roleHasPermission(user.role, permission)) {
    throw new AuthorizationError("You do not have permission to do that.");
  }
  return user;
}

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

// ---------------------------------------------------------------------------
// Page-level guards (redirect instead of throwing)
// ---------------------------------------------------------------------------

export async function enforceAuth(returnTo) {
  const user = await getCurrentUser();
  if (!user) {
    const next = returnTo ? `?next=${encodeURIComponent(returnTo)}` : "";
    redirect(`/login${next}`);
  }
  return user;
}

export async function enforceRole(roles, returnTo) {
  const user = await enforceAuth(returnTo);
  const allowed = [roles].flat();
  if (!allowed.includes(user.role)) {
    // Send people to their own dashboard rather than a dead end.
    redirect(homeForRole(user.role));
  }
  return user;
}

/** Signed-in users should never see login/register. */
export async function enforceGuest() {
  const user = await getCurrentUser();
  if (user) redirect(homeForRole(user.role));
}
