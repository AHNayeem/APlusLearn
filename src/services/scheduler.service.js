import "server-only";
import { AUDIT_ACTIONS } from "@/constants";
import { NotFoundError } from "@/lib/api/errors";
import { sendBookingReminders, expireStaleBookings } from "./booking.service";
import { expireStaleVerifications } from "./verification.service";
import { runScheduledPayouts } from "./payout.service";
import { expireStaleRequests } from "./request.service";
import { recordAudit } from "./audit.service";

/**
 * Scheduled work (§16, §20, §28).
 *
 * The platform is a single Next.js application with no queue and no worker
 * process, so the scheduler is deliberately the smallest thing that can be
 * correct: a named registry of jobs, invoked over an authenticated internal
 * endpoint. Whatever drives that endpoint — Vercel Cron, a Kubernetes
 * CronJob, systemd, GitHub Actions, `curl` from a crontab — is a deployment
 * fact, not an application one, and swapping it changes nothing in here.
 *
 * The contract every job keeps:
 *
 *   **Idempotent.** Running twice must be indistinguishable from running
 *   once. No job relies on being called on time, exactly once, or at all —
 *   each one recomputes what is due from stored state and claims the work
 *   atomically before acting on it. A missed window is caught up on the next
 *   run; a duplicated window is a no-op.
 *
 *   **Independent.** One job throwing must not stop the others, so a run of
 *   the whole set collects outcomes rather than propagating the first error.
 */

export const JOBS = {
  BOOKING_REMINDERS: "booking-reminders",
  BOOKING_EXPIRY: "booking-expiry",
  VERIFICATION_EXPIRY: "verification-expiry",
  PAYOUTS: "payouts",
  REQUEST_EXPIRY: "request-expiry",
};

/**
 * @type {Record<string, { name: string, description: string, suggestedCron: string, run: (options: object) => Promise<object> }>}
 */
const REGISTRY = {
  [JOBS.BOOKING_REMINDERS]: {
    name: "Lesson reminders",
    description:
      "Sends the 24-hour and 1-hour reminders for confirmed lessons. Each reminder is claimed on the booking before it is sent, so repeat runs never duplicate one.",
    suggestedCron: "*/15 * * * *",
    run: (options) => sendBookingReminders(options),
  },
  [JOBS.BOOKING_EXPIRY]: {
    name: "Abandoned checkout expiry",
    description:
      "Releases the slots held by bookings whose checkout was never completed, so an abandoned payment cannot take a tutor's availability off the calendar permanently. Each booking is claimed on its PENDING_PAYMENT status before it is released, and a settled payment is never touched.",
    // Runs often: the hold is measured in minutes, so a daily sweep would
    // leave a slot dead for most of the day after it should have come back.
    suggestedCron: "*/10 * * * *",
    run: (options) => expireStaleBookings(options),
  },
  [JOBS.VERIFICATION_EXPIRY]: {
    name: "Verification expiry",
    description:
      "Expires approved verification badges whose documents have lapsed, and takes the badge off the public profile.",
    suggestedCron: "0 3 * * *",
    run: () => expireStaleVerifications(),
  },
  [JOBS.PAYOUTS]: {
    name: "Tutor payouts",
    description:
      "Creates payouts for every tutor whose completed lessons have cleared the hold period. Bookings are claimed as they are paid, so a second run finds nothing.",
    suggestedCron: "0 4 * * *",
    run: (options) => runScheduledPayouts(options),
  },
  [JOBS.REQUEST_EXPIRY]: {
    name: "Tutor request expiry",
    description: "Closes open tutor requests that have passed their expiry date.",
    suggestedCron: "0 5 * * *",
    run: () => expireStaleRequests(),
  },
};

/** The catalogue, for the admin console and for documentation. */
export function listJobs() {
  return Object.entries(REGISTRY).map(([key, job]) => ({
    key,
    name: job.name,
    description: job.description,
    suggestedCron: job.suggestedCron,
  }));
}

/**
 * Run one job by name.
 *
 * @param {string} key      One of `JOBS`.
 * @param {object} [options]
 * @param {object} [options.actor]  Who or what triggered it, for the audit log.
 * @param {Date}   [options.now]    Injected by tests so "due" is deterministic.
 */
export async function runScheduledJob(key, { actor, ...options } = {}) {
  const job = REGISTRY[key];
  if (!job) throw new NotFoundError(`No scheduled job named "${key}".`);

  const startedAt = Date.now();
  try {
    const result = await job.run({ actor, ...options });
    const outcome = {
      job: key,
      ok: true,
      durationMs: Date.now() - startedAt,
      result: result ?? {},
    };
    await recordJobRun(actor, outcome);
    return outcome;
  } catch (error) {
    // Logged and returned rather than thrown: a scheduler calling this wants
    // to know what happened to every job, not to be interrupted by the first
    // one that failed.
    console.error(`[scheduler] ${key} failed:`, error);
    const outcome = {
      job: key,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error.message,
    };
    await recordJobRun(actor, outcome);
    return outcome;
  }
}

/** Run every registered job. Used by a single "all jobs" cron entry. */
export async function runAllScheduledJobs(options = {}) {
  const jobs = [];
  for (const key of Object.keys(REGISTRY)) {
    jobs.push(await runScheduledJob(key, options));
  }
  return { jobs, ok: jobs.every((j) => j.ok) };
}

/**
 * A job run is only worth auditing when it did something or went wrong —
 * otherwise a fifteen-minute reminder sweep would bury the trail that
 * matters (§35).
 */
/** Counts that describe what a job *looked at*, not what it changed. */
const NON_MUTATING_COUNTS = ["examined", "held"];

async function recordJobRun(actor, outcome) {
  const changedSomething =
    !outcome.ok ||
    Object.entries(outcome.result ?? {}).some(
      ([key, value]) =>
        typeof value === "number" && value > 0 && !NON_MUTATING_COUNTS.includes(key),
    );
  if (!changedSomething) return;

  await recordAudit({
    actor: actor ?? { role: "SYSTEM" },
    action: AUDIT_ACTIONS.SCHEDULED_JOB_RUN,
    entityType: "ScheduledJob",
    metadata: outcome,
  });
}
