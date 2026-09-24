import "server-only";
import { AuditLog } from "@/models";
import { PAGE_SIZES } from "@/constants";
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

/* --- Reading ---------------------------------------------------------------- */

/**
 * Keys whose *value* never leaves this service.
 *
 * The write side is already careful — `describeChanges` in the integration
 * service records that a secret rotated, never what it rotated to — but an
 * audit log is written from thirty-odd call sites and read by a screen that
 * shows whatever it finds. Deciding here, on the way out, means a future call
 * site that is careless with a payload cannot turn the audit viewer into a
 * credential reader (§35, §36).
 */
const SECRET_KEY_PATTERN =
  /(secret|password|passcode|credential|api[-_]?key|access[-_]?key|private[-_]?key|auth[-_]?token|bearer|authorization|signature|storagekey)/i;

/**
 * Keys that *match* the pattern above but carry field names rather than
 * values — "which credentials were rotated" is the most useful line in an
 * audit record about a key rotation, and redacting it would remove the only
 * thing worth reading.
 */
const FIELD_NAME_KEYS = new Set(["secretsRotated", "secretsCleared", "rotated", "cleared"]);

/** Shapes that are a credential whatever key they arrived under. */
function looksLikeSecretValue(value) {
  if (typeof value !== "string") return false;
  return (
    /^v\d+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(value) || // our own AES-GCM envelope
    /^(sk|rk)_(live|test)_/.test(value) || // Stripe secret / restricted key
    /^whsec_/.test(value) || // Stripe webhook signing secret
    /^GOCSPX-/.test(value) || // Google OAuth client secret
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(value) || // a PEM private key (Apple .p8)
    /^ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./.test(value) // a JWT
  );
}

const REDACTED = "[redacted]";

/**
 * A metadata object safe to render.
 *
 * Bounded as well as filtered: depth, array length and string length are all
 * capped, because an audit row is a summary and a screen that renders an
 * unbounded stored object is its own problem.
 */
export function redactAuditMetadata(value, depth = 0) {
  if (value == null) return value;
  if (depth > 4) return REDACTED;

  if (typeof value === "string") {
    if (looksLikeSecretValue(value)) return REDACTED;
    return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  }
  if (typeof value !== "object") return value;

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((entry) => redactAuditMetadata(entry, depth + 1));
  }

  const out = {};
  for (const [key, inner] of Object.entries(value).slice(0, 50)) {
    if (SECRET_KEY_PATTERN.test(key) && !FIELD_NAME_KEYS.has(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redactAuditMetadata(inner, depth + 1);
  }
  return out;
}

function presentable(log) {
  return { ...log, metadata: redactAuditMetadata(log.metadata) };
}

/**
 * The per-entity reader, used by the user detail screen.
 *
 * Kept as it was — including the `limit` rather than a page — because it
 * answers a different question from the browser below: "what has happened to
 * this record", not "what has happened on this platform".
 */
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

  return toPlain(logs).map(presentable);
}

/** The exclusive upper bound for a `to` filter. See `listAuditEvents`. */
function endOfDayExclusive(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return date;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return new Date(date.getTime() + 24 * 60 * 60 * 1000);
  }
  return date;
}

/**
 * The global audit browser (§35).
 *
 * Every filter is optional and they compose, so an operator can ask "every
 * refund last month", "everything this administrator did", or "everything
 * that ever touched this booking" without needing a different screen for
 * each. The period is half-open internally — `from` inclusive, the upper
 * bound exclusive — matching how analytics ranges are expressed everywhere
 * else in the product, so a day is never counted twice at a boundary. A bare
 * date picked in the admin form means the whole of that day, which is what
 * the operator meant by it.
 *
 * Read-only by construction: there is no write path into this collection
 * other than `recordAudit`, and no endpoint that edits or deletes a row.
 */
export async function listAuditEvents({
  action,
  entityType,
  entityId,
  actorId,
  from,
  to,
  page = 1,
  pageSize,
} = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = {};

  if (action) query.action = action;
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  if (actorId) query.actorId = actorId;

  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    // A bare `YYYY-MM-DD` is the whole of that day, so the exclusive bound is
    // the next midnight. Without this, "from the 3rd to the 3rd" would be an
    // empty range — which is arithmetically defensible and useless to the
    // operator who typed it.
    if (to) query.createdAt.$lt = endOfDayExclusive(to);
  }

  const [items, total] = await Promise.all([
    AuditLog.find(query)
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("actorId", "firstName lastName email role")
      .lean(),
    AuditLog.countDocuments(query),
  ]);

  return { items: toPlain(items).map(presentable), total, page, pageSize: size };
}

/**
 * The entity types that actually appear in the log.
 *
 * Derived rather than declared: `entityType` is a free string on the model,
 * so a hard-coded list would drift the moment a new one is recorded, and the
 * filter would quietly stop offering it.
 */
export async function auditEntityTypes() {
  const types = await AuditLog.distinct("entityType");
  return types.filter(Boolean).sort();
}
