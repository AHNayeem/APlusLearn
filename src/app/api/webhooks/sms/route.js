import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { applySmsKeyword } from "@/services/sms.service";
import { verifyTwilioSignature } from "@/services/external/sms-provider";
import { resolveIntegration, DEVELOPMENT } from "@/lib/config/env";
import { envBaseUrl } from "@/lib/config/base-url";

/**
 * Inbound text messages (§36, §41 Phase 2).
 *
 * Carriers forward STOP and START verbatim, and honouring them is a legal
 * duty rather than a preference — so this endpoint exists, it is public, and
 * it is therefore signed. An unsigned or mis-signed request is refused
 * outright: otherwise anyone who found the URL could silence another person's
 * lesson reminders, or opt a number back in against their wishes.
 *
 * It answers TwiML because that is what the carrier expects; the empty
 * response means "no reply text", which is correct for both keywords since
 * the carrier sends its own confirmation.
 *
 * Deliberately not wrapped in `routeHandler`: the body is form-encoded, the
 * response is XML, and the authentication is a signature rather than a
 * session — none of the pipeline's steps apply.
 */
export async function POST(request) {
  const resolved = resolveIntegration("sms");

  // With no carrier configured there is nothing that could legitimately be
  // calling this, so it is closed rather than left open in development.
  if (!resolved.configured || resolved.name === DEVELOPMENT) {
    return twiml("", 404);
  }

  const raw = await request.text();
  const params = Object.fromEntries(new URLSearchParams(raw).entries());

  // The signature covers the URL the carrier was configured with, which is
  // the deployment's own public origin — never a host header off the request,
  // which an attacker controls and could use to make any payload verify.
  const url = `${envBaseUrl()}/api/webhooks/sms`;

  const valid = verifyTwilioSignature({
    signature: request.headers.get("x-twilio-signature"),
    url,
    params,
    authToken: process.env.TWILIO_AUTH_TOKEN,
  });

  if (!valid) {
    console.warn("[sms] refused an inbound callback with an unverifiable signature");
    return twiml("", 403);
  }

  await connectToDatabase();
  const result = await applySmsKeyword({ from: params.From, body: params.Body });
  console.info(`[sms] inbound keyword handled: ${result.action} (${result.accounts} account(s))`);

  return twiml("");
}

function twiml(body, status = 200) {
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
