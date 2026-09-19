import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { completeConnection } from "@/services/calendar.service";
import { envBaseUrl } from "@/lib/config/base-url";

/**
 * Where the calendar provider sends the tutor back (§18, §36, §41 Phase 2).
 *
 * The person arrives here in their browser after consenting, so the response
 * is a redirect rather than JSON — and the outcome is carried in the query
 * string of the page they land on, which reads it once and clears it.
 *
 * Authentication is the signed `state`, not the session: a provider redirect
 * does not always carry cookies, and the state already proves which account
 * asked for this connection. An unsigned, expired or altered state is refused
 * before the code is ever redeemed.
 *
 * Not wrapped in `routeHandler` because nothing about it fits that pipeline:
 * no JSON body, no session requirement, and a redirect for a response.
 */
export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const providerError = url.searchParams.get("error");

  const back = (params) => {
    const target = new URL("/tutor/calendar", envBaseUrl());
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value);
    return NextResponse.redirect(target.toString());
  };

  // The person declined on the provider's screen. Not an error worth a stack
  // trace — they simply changed their mind.
  if (providerError) {
    return back({ calendar: "cancelled" });
  }
  if (!code || !state) {
    return back({ calendar: "error", reason: "missing" });
  }

  try {
    await connectToDatabase();
    const connection = await completeConnection({ code, state });
    return back({ calendar: "connected", provider: connection.provider });
  } catch (error) {
    // The provider's own words are useful to the tutor ("grant calendar
    // access"), but only when we chose to expose them.
    console.error("[calendar] connection failed:", error.message);
    return back({
      calendar: "error",
      reason: error.expose ? String(error.message).slice(0, 160) : "failed",
    });
  }
}
