import "server-only";
import { AuditLog } from "@/models";
import { toPlain } from "@/lib/utils/serialize";

/**
 * Append-only audit trail (§35). Writes are fire-and-forget: an audit failure
 * must never break the action the user was performing, but it is logged.
 */
export async function recordAudit({
  actor,
  action,
  entityType,
  entityId,
  metadata,
  request,
} = {}) {
  try {
    await AuditLog.create({
      actorId: actor?.id ?? actor?._id ?? null,
      actorRole: actor?.role ?? null,
      action,
      entityType,
      entityId,
      metadata,
      ip: request?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim(),
      userAgent: request?.headers?.get?.("user-agent")?.slice(0, 300),
    });
  } catch (error) {
    console.error("[audit] failed to record", action, error.message);
  }
}

export async function listAuditLogs({ entityType, entityId, action, limit = 50 } = {}) {
  const query = {};
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  if (action) query.action = action;

  const logs = await AuditLog.find(query)
    .sort({ createdAt: -1 })
    .limit(Math.min(limit, 200))
    .populate("actorId", "firstName lastName email role")
    .lean();

  return toPlain(logs);
}
