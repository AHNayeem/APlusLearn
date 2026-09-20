import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { applySmsKeyword } from "@/services/sms.service";
import { verifyTwilioSignature } from "@/services/external/sms-provider";
import { DEVELOPMENT } from "@/lib/config/env";
import { resolveIntegrationConfig } from "@/lib/config/integrations";
import { INTEGRATION_MODULES } from "@/constants";
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
  // Resolving needs the database now that the auth token may be stored there,
  // and the signature is checked against that same token — so the connection
  // is opened before anything is trusted rather than after.
  await connectToDatabase();
  const resolved = await resolveIntegrationConfig(INTEGRATION_MODULES.SMS);

  // With no carrier configured — or with the module switched off — there is
  // nothing that could legitimately be calling this, so it is closed rather
  // than left open. A disabled module must not still be processing opt-outs
  // on a signature it can no longer be sure of (§39).
  if (!resolved.enabled || !resolved.configured || resolved.provider === DEVELOPMENT) {
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
    // The same token the sending side uses, from the same resolved
    // configuration — so rotating it in the admin panel keeps inbound
    // callbacks verifiable without a second place to remember.
    authToken: resolved.secrets.authToken,
  });

  if (!valid) {
    console.warn("[sms] refused an inbound callback with an unverifiable signature");
    return twiml("", 403);
  }

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
