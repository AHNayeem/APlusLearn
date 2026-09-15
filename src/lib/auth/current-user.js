import "server-only";
import { cache } from "react";
import { connectToDatabase } from "@/lib/db/connect";
import { User } from "@/models";
import { USER_STATUS } from "@/constants";
import { toPlain } from "@/lib/utils/serialize";
import { readSessionToken, verifySessionToken } from "./session";

/**
 * Resolve the signed-in user for the current request.
 *
 * Wrapped in React's `cache` so a page, its layout and any nested Server
 * Component share a single database read per request.
 *
 * Returns null — never throws — so public pages can call it freely.
 */
export const getCurrentUser = cache(async () => {
  const token = await readSessionToken();
  const payload = await verifySessionToken(token);
  if (!payload) return null;

  await connectToDatabase();
  const user = await User.findById(payload.userId).lean();

  if (!user) return null;
  if (user.deletedAt) return null;
  if (user.status === USER_STATUS.SUSPENDED) return null;

  // Token predates a password reset or forced logout.
  if ((user.tokenVersion ?? 0) !== payload.tokenVersion) return null;

  return toPlain({ ...user, passwordHash: undefined });
});

/** Minimal session descriptor — cheaper than the full user where enough. */
export async function getSession() {
  const user = await getCurrentUser();
  if (!user) return null;
  return { userId: user.id, role: user.role, status: user.status };
}
