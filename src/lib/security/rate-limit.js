import "server-only";
import { RateLimitError } from "@/lib/api/errors";

/**
 * Fixed-window rate limiting for login, registration, password reset and the
 * other endpoints an unauthenticated caller can hammer (§36).
 *
 * **The window is shared across instances.** A limit that lives in one
 * process is a limit multiplied by however many processes the deployment
 * happens to be running, which is the same as having no limit at all once the
 * application is scaled horizontally. The counter therefore lives in MongoDB
 * — the shared store this architecture already requires — so nothing new has
 * to be provisioned, no Redis becomes a deployment dependency, and local
 * development is unchanged.
 *
 * `RATE_LIMIT_STORE` decides, and it is explicit rather than inferred:
 *
 *   database  (default) — one window per key, shared by every instance.
 *   memory              — per-process. Correct only on a single instance;
 *                         useful for a test that must not touch Mongo.
 *
 * **Failure is safe, not open.** If the database cannot be reached the call
 * falls back to the in-process counter rather than allowing the request: a
 * degraded limit on one instance is still a limit, where returning "allowed"
 * would turn a database blip into an open door on exactly the endpoints this
 * protects. The fallback is logged once per process so it cannot go unnoticed.
 *
 * The call signature is deliberately unchanged in shape — `rateLimit(key,
 * { limit, windowMs })` returning `{ allowed, remaining, resetAt }` — except
 * that both functions are now `async`, which they have to be to reach a
 * shared store at all.
 */

const globalForLimiter = globalThis;
const buckets = globalForLimiter.__aplusRateBuckets ?? new Map();
globalForLimiter.__aplusRateBuckets = buckets;

/** Set once we have already said the shared store is unreachable. */
let warnedAboutFallback = globalForLimiter.__aplusRateWarned ?? false;

export const RATE_LIMIT_STORES = { DATABASE: "database", MEMORY: "memory" };

/** Which store this process is using, for diagnostics and the test suites. */
export function rateLimitStore() {
  const configured = (process.env.RATE_LIMIT_STORE ?? "").trim().toLowerCase();
  if (configured === RATE_LIMIT_STORES.MEMORY) return RATE_LIMIT_STORES.MEMORY;
  if (configured === RATE_LIMIT_STORES.DATABASE) return RATE_LIMIT_STORES.DATABASE;
  return RATE_LIMIT_STORES.DATABASE;
}

/**
 * True when this deployment's limits hold across more than one instance.
 *
 * Exported so the answer is a fact the application can state rather than an
 * assumption an operator has to make.
 */
export function rateLimitIsShared() {
  return rateLimitStore() === RATE_LIMIT_STORES.DATABASE;
}

function sweepMemory(now) {
  if (buckets.size < 5000) return;
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now) buckets.delete(key);
  }
}

function inMemory(key, limit, windowMs, now) {
  sweepMemory(now);

  const entry = buckets.get(key);
  if (!entry || entry.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, resetAt: now + windowMs, count: 1 };
  }

  entry.count += 1;
  return {
    allowed: entry.count <= limit,
    remaining: Math.max(0, limit - entry.count),
    resetAt: entry.resetAt,
    count: entry.count,
  };
}

/**
 * Expired rows, cleared without needing the TTL index to exist.
 *
 * One in roughly two hundred calls, so the cost is amortised to nothing and
 * a busy deployment still keeps the collection small.
 */
async function sweepDatabase(RateLimitWindow, now) {
  if (Math.random() > 0.005) return;
  await RateLimitWindow.deleteMany({ resetAt: { $lte: new Date(now - 60_000) } }).catch(() => {});
}

async function inDatabase(key, limit, windowMs, now) {
  const { connectToDatabase } = await import("@/lib/db/connect");
  const { RateLimitWindow } = await import("@/models");

  await connectToDatabase();
  await sweepDatabase(RateLimitWindow, now);

  const bump = async () =>
    RateLimitWindow.findOneAndUpdate(
      { _id: key },
      { $inc: { count: 1 }, $setOnInsert: { resetAt: new Date(now + windowMs) } },
      { upsert: true, returnDocument: "after" },
    ).lean();

  let doc;
  try {
    doc = await bump();
  } catch (error) {
    // Two callers upserting the same brand-new key: one inserts, the other
    // collides. The second attempt finds the row and increments it.
    if (error?.code !== 11000) throw error;
    doc = await bump();
  }

  // The window this row describes has lapsed, so roll it forward — but only
  // if nobody else has already, or two callers arriving together would each
  // start their own window and the limit would be double what it says.
  //
  // The caller that loses that race does *not* adopt the winner's count: it
  // increments the window the winner just opened, so a burst arriving on a
  // lapsed key is counted once per attempt rather than once per roll.
  if (doc.resetAt.getTime() <= now) {
    const rolled = await RateLimitWindow.findOneAndUpdate(
      { _id: key, resetAt: doc.resetAt },
      { $set: { count: 1, resetAt: new Date(now + windowMs) } },
      { returnDocument: "after" },
    ).lean();
    doc = rolled ?? (await bump());
  }

  return {
    allowed: doc.count <= limit,
    remaining: Math.max(0, limit - doc.count),
    resetAt: doc.resetAt.getTime(),
    count: doc.count,
  };
}

export async function rateLimit(key, { limit = 10, windowMs = 60_000 } = {}) {
  const now = Date.now();

  let result;
  if (rateLimitStore() === RATE_LIMIT_STORES.MEMORY) {
    result = inMemory(key, limit, windowMs, now);
  } else {
    try {
      result = await inDatabase(key, limit, windowMs, now);
    } catch (error) {
      if (!warnedAboutFallback) {
        warnedAboutFallback = true;
        globalForLimiter.__aplusRateWarned = true;
        console.error(
          "[rate-limit] the shared window store is unreachable; falling back to a per-process " +
            "counter, which does NOT hold across instances:",
          error.message,
        );
      }
      result = inMemory(key, limit, windowMs, now);
    }
  }

  return {
    allowed: result.allowed,
    remaining: result.remaining,
    resetAt: result.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((result.resetAt - now) / 1000)),
  };
}

export async function enforceRateLimit(key, options) {
  const result = await rateLimit(key, options);
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
