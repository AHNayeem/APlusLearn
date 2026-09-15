import { NextResponse } from "next/server";
import { connectToDatabase } from "@/lib/db/connect";
import { confirmBookings } from "@/services/booking.service";
import { Payment } from "@/models";
import { PAYMENT_STATUS } from "@/constants";

/**
 * Payment provider webhook (§20, §38).
 *
 * Deliberately outside `routeHandler`: a webhook has no session, and its
 * authenticity comes from a signature rather than a cookie. The development
 * provider does not sign, so this only accepts calls when a signing secret is
 * configured *and* the signature matches.
 */
export async function POST(request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");

  if (!secret) {
    // Nothing is configured to call this yet; refuse rather than trust it.
    return NextResponse.json(
      { ok: false, error: { code: "NOT_CONFIGURED", message: "Webhooks are not configured." } },
      { status: 503 },
    );
  }
  if (!signature) {
    return NextResponse.json(
      { ok: false, error: { code: "UNSIGNED", message: "Missing signature." } },
      { status: 400 },
    );
  }

  const payload = await request.json().catch(() => null);
  if (!payload?.type) {
    return NextResponse.json(
      { ok: false, error: { code: "BAD_PAYLOAD", message: "Unrecognised event." } },
      { status: 400 },
    );
  }

  await connectToDatabase();

  switch (payload.type) {
    case "payment_intent.succeeded": {
      const payment = await Payment.findOne({
        providerPaymentIntentId: payload.data?.object?.id,
      });
      if (payment && payment.status !== PAYMENT_STATUS.PAID) {
        payment.status = PAYMENT_STATUS.PAID;
        payment.paidAt = new Date();
        await payment.save();
        await confirmBookings(payment._id);
      }
      break;
    }
    case "payment_intent.payment_failed": {
      await Payment.updateOne(
        { providerPaymentIntentId: payload.data?.object?.id },
        {
          $set: {
            status: PAYMENT_STATUS.FAILED,
            failureReason: payload.data?.object?.last_payment_error?.message,
          },
        },
      );
      break;
    }
    default:
      // Unknown events are acknowledged so the provider stops retrying.
      break;
  }

  return NextResponse.json({ ok: true, data: { received: true } });
}
