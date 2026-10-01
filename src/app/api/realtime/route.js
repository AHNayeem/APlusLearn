import { routeHandler } from "@/lib/api";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { openRealtimeStream } from "@/services/realtime.service";
import { PERMISSIONS } from "@/constants";

/**
 * The signed-in user's realtime event stream (docs/REALTIME.md).
 *
 * Server-Sent Events: one long response per browser tab in view, carrying
 * hints — ids, timestamps and unread counts — that the page answers by
 * reading through the endpoints it already uses. Nothing in the request
 * chooses what it receives; that is the session, and only the session.
 *
 * The stream ends itself before `maxDuration` and the browser reconnects at
 * once, so a serverless platform's execution limit is a reconnect, not an
 * outage. Every reconnect begins with a fresh `ready` snapshot.
 */
export const maxDuration = 300;

export const GET = routeHandler(
  async ({ request, user }) => {
    // Generous for a person with several tabs who switches between them all
    // day (each tab in view reconnects about every four and a half minutes);
    // far short of a loop hammering the server.
    await enforceRateLimit(`realtime:${user.id}`, { limit: 60, windowMs: 5 * 60_000 });
    return openRealtimeStream(user, request.signal);
  },
  { permission: PERMISSIONS.NOTIFICATION_VIEW },
);
