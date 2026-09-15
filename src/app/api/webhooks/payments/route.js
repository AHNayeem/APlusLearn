import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { handlePaymentWebhook } from "@/services/webhook.service";
import { AppError } from "@/lib/api/errors";

/**
 * Payment provider webhook (§20, §36, §38).
 *
 * Deliberately outside `routeHandler`: a webhook carries no session, and its
 * authenticity comes from a signature over the **raw** body rather than from
 * a cookie. Reading the body as text — not `request.json()` — is load-bearing:
 * re-serialising the payload would change a byte somewhere and every
 * signature would fail.
 *
 * The route stays thin; verification, idempotency and state changes all live
 * in `webhook.service`.
 *
 *   Production endpoint:  POST /api/webhooks/payments
 *   Connect endpoint:     POST /api/webhooks/payments?connect=1
 */
export const dynamic = "force-dynamic";

export async function POST(request) {
  const signature =
    request.headers.get("stripe-signature") ?? request.headers.get("x-provider-signature");

  if (!signature) {
    return NextResponse.json(
      { ok: false, error: { code: "UNSIGNED", message: "Missing signature." } },
      { status: 400 },
    );
  }

  const payload = await request.text();
  const connect = new URL(request.url).searchParams.get("connect") === "1";

  try {
    await connectToDatabase();
    const result = await handlePaymentWebhook({ payload, signature, connect });
    return NextResponse.json({ ok: true, data: result });
  } catch (error) {
    // A signature failure or an unconfigured endpoint is the caller's problem
    // and must not be retried; anything else is ours, and a 500 asks the
    // provider to redeliver.
    if (error instanceof AppError) {
      console.warn(`[webhook] rejected: ${error.code}`);
      return NextResponse.json(
        { ok: false, error: { code: error.code, message: error.message } },
        { status: error.status },
      );
    }

    console.error("[webhook] processing failed:", error.message);
    return NextResponse.json(
      {
        ok: false,
        error: { code: "WEBHOOK_FAILED", message: "The event could not be processed." },
      },
      { status: 500 },
    );
  }
}
