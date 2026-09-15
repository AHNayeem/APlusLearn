import "server-only";
import { RateLimitError } from "@/lib/api/errors";

/**
 * In-memory fixed-window rate limiter.
 *
 * Deliberately simple: it protects login, registration and password-reset
 * from casual abuse on a single instance. A multi-instance deployment should
 * swap the store for Redis — the call signature is designed not to change.
 */

const globalForLimiter = globalThis;
const buckets = globalForLimiter.__aplusRateBuckets ?? new Map();
globalForLimiter.__aplusRateBuckets = buckets;

function sweep(now) {
  if (buckets.size < 5000) return;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(key, { limit = 10, windowMs = 60_000 } = {}) {
  const now = Date.now();
  sweep(now);

  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs };
  }

  entry.count += 1;
  const allowed = entry.count <= limit;
  return {
    allowed,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
    retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000),
  };
}

export function enforceRateLimit(key, options) {
  const result = rateLimit(key, options);
  if (!result.allowed) {
    throw new RateLimitError(
      `Too many attempts. Please try again in ${result.retryAfterSeconds} seconds.`,
    );
  }
  return result;
}

/** Best-effort client identity for limiting — proxy headers then fallback. */
export function clientKey(request, suffix = "") {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "local";
  return suffix ? `${ip}:${suffix}` : ip;
}
