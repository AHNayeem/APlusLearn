import { z } from "zod";
import { routeHandler, ok } from "@/lib/api";
import { objectId } from "@/lib/validation/common";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { getPayment } from "@/services/payment.service";
import { settlePaymentFromProvider } from "@/services/booking.service";
import { Booking } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { PERMISSIONS } from "@/constants";

/**
 * Ask the payment provider what actually happened to this payment (§20, §38).
 *
 * This is what the purchaser's return page calls while it waits. It is **not**
 * the browser confirming a payment: the caller supplies an id and nothing
 * else, and the answer comes from the provider's own API, applied by the same
 * `settlePaymentFromProvider` the expiry sweep uses. A client that lies about
 * having paid gets the same answer as one that says nothing at all.
 *
 * It exists because the webhook is the normal path and not a guaranteed one.
 * Without it, a deployment whose endpoint is unreachable or whose signing
 * secret does not match leaves every purchaser watching a spinner until the
 * hold lapses — which is exactly the failure this endpoint was added for.
 *
 * Idempotent: on an already-settled payment it reads the record and returns.
 * Rate limited per payment, because it is a poll and it costs a provider
 * round-trip.
 */
export const POST = routeHandler(
  async ({ user, params }) => {
    // Ownership is checked against the loaded record, never the URL (§8).
    // A tutor or an administrator may also ask; none of them can change the
    // answer, which comes from the provider.
    await getPayment(params.id, user);

    // Twelve looks a minute is more than the page's backoff ever needs and
    // far less than a loop could do damage with.
    await enforceRateLimit(`payment-reconcile:${params.id}`, { limit: 12, windowMs: 60_000 });

    const result = await settlePaymentFromProvider(params.id, { source: "return-page" });

    // Re-read rather than trust the pre-reconcile copy: a webhook may have
    // settled it while the provider was being asked.
    const payment = await getPayment(params.id, user);
    const bookings = await Booking.find({ paymentId: params.id })
      .select("_id status")
      .sort({ startAt: 1 })
      .lean();

    return ok({
      payment,
      bookings: toPlain(bookings),
      /**
       * What the provider said, so the page can tell "still processing" from
       * "we could not ask" instead of showing one spinner for both.
       */
      reconciliation: {
        outcome: result.outcome,
        remoteStatus: result.remoteStatus,
        confirmed: result.confirmed,
      },
    });
  },
  { permission: PERMISSIONS.PAYMENT_VIEW, paramsSchema: z.object({ id: objectId }) },
);
