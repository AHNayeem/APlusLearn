import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ok, fail, failFromError } from "@/lib/api";
import { AuthorizationError } from "@/lib/api/errors";
import { connectToDatabase } from "@/lib/db/connect";
import { getCurrentUser } from "@/lib/auth/current-user";
import { ROLES } from "@/constants";
import { JOBS, listJobs, runScheduledJob, runAllScheduledJobs } from "@/services/scheduler.service";

/**
 * The scheduler's entry point (§16, §20, §28).
 *
 *   GET|POST /api/cron/<job>     run one job
 *   GET|POST /api/cron/all       run every job
 *   GET      /api/cron/list      the catalogue (administrators only)
 *
 * Two ways in, and nothing else:
 *
 *   1. `Authorization: Bearer $CRON_SECRET` — for the platform scheduler.
 *      Compared in constant time so the header cannot be probed a byte at a
 *      time. When `CRON_SECRET` is unset the bearer route is closed entirely
 *      rather than open: an unset secret must never mean "no secret needed".
 *   2. A signed-in administrator — so an operator can run a job by hand from
 *      the admin console without holding the deployment secret.
 *
 * This is written by hand rather than through `routeHandler` for one reason:
 * the pipeline authenticates a *person*, and a cron caller is not one.
 *
 * `force-dynamic` keeps it off any render cache — a cached job run would be
 * a job that silently stops happening.
 */
export const dynamic = "force-dynamic";

const paramsSchema = z.object({
  job: z.enum([...Object.values(JOBS), "all", "list"]),
});

async function handle(request, context) {
  try {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return fail("No scheduled job by that name.", { status: 404, code: "NOT_FOUND" });
    }
    const { job } = parsed.data;

    await connectToDatabase();
    const actor = await authorize(request);

    if (job === "list") return ok({ jobs: listJobs() });
    if (job === "all") return ok(await runAllScheduledJobs({ actor }));

    const outcome = await runScheduledJob(job, { actor });
    // A job that failed is reported as a failure, so a scheduler's own
    // alerting sees a non-2xx rather than a green tick over a broken run.
    return ok(outcome, { status: outcome.ok ? 200 : 500 });
  } catch (error) {
    return failFromError(error);
  }
}

/**
 * @returns {Promise<object>} the actor to attribute the run to.
 */
async function authorize(request) {
  const secret = process.env.CRON_SECRET?.trim();
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

  if (secret && presented && constantTimeEquals(presented, secret)) {
    return { id: null, role: "SYSTEM" };
  }

  const user = await getCurrentUser();
  if (user?.role === ROLES.ADMIN) return user;

  throw new AuthorizationError("This endpoint is for the platform scheduler.");
}

function constantTimeEquals(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual requires equal lengths; comparing the lengths first leaks
  // only the length, which the caller already chose.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export const GET = handle;
export const POST = handle;
