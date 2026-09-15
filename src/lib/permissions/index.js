import { ROLES, permissionsForRole, roleHasPermission } from "@/constants/roles";

export { permissionsForRole, roleHasPermission };

export function isAdmin(user) {
  return user?.role === ROLES.ADMIN;
}

export function isTutor(user) {
  return user?.role === ROLES.TUTOR;
}

export function isLearner(user) {
  return user?.role === ROLES.PARENT || user?.role === ROLES.STUDENT;
}

/** True when `user` may act on a resource they own, or is an admin. */
export function ownsOrAdmin(user, ownerId) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  return String(ownerId) === String(user.id ?? user._id);
}

/** Both parties of a booking/conversation, plus admins. */
export function isParticipantOrAdmin(user, participantIds = []) {
  if (!user) return false;
  if (isAdmin(user)) return true;
  const me = String(user.id ?? user._id);
  return participantIds.some((id) => String(id) === me);
}
