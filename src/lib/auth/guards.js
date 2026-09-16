import "server-only";
import { redirect } from "next/navigation";
import { AuthenticationError, AuthorizationError } from "@/lib/api/errors";
import { roleHasPermission } from "@/lib/permissions";
import { homeForRole } from "@/constants/navigation";
import { getCurrentUser } from "./current-user";

/**
 * The record-level assertions live in `assert.js`, which has no dependency on
 * the request runtime, and are re-exported here so this module stays the one
 * place a caller has to know about.
 */
export {
  requireOwnership,
  requireOwnershipOrAdmin,
  requireParticipant,
  requireVerifiedEmail,
} from "./assert";

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
