"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, TriangleAlert } from "lucide-react";
import { api } from "@/lib/api/client";
import { Alert, Button, Card, CardBody } from "@/components/ui";
import { PAYMENT_STATUS } from "@/constants";

/**
 * Waits for a hosted payment to be confirmed (§20).
 *
 * Nothing here confirms a booking, which is the point: a browser saying "it
 * worked" is not evidence that it did. What this does is ask the server to
 * ask the **provider** — `POST /api/payments/:id/reconcile`, which reads
 * Stripe's own answer and applies it through the same code path the webhook
 * uses. The request carries an id and nothing else; a tampered response body
 * could not confirm a lesson if it tried.
 *
 * Why it asks rather than only polls the record: the webhook is the normal
 * path and not a guaranteed one. An endpoint that is unreachable, or a
 * signing secret that belongs to a different Stripe account, used to leave a
 * purchaser watching this spinner until it gave up — and their paid lesson
 * sitting in "Payment not completed" until the nightly sweep found it.
 *
 * The schedule backs off rather than hammering: the first look is immediate,
 * and the gaps widen to half a minute. Roughly two minutes in total, which is
 * far longer than a healthy webhook needs and short enough not to strand
 * anybody in front of it.
 */
const POLL_SCHEDULE_MS = [0, 1500, 2500, 4000, 6000, 8000, 12000, 15000, 20000, 25000, 30000];

export function CheckoutPending({ payment, bookingId }) {
  const router = useRouter();
  const [status, setStatus] = useState(payment.status);
  const [outcome, setOutcome] = useState(null);
  const [timedOut, setTimedOut] = useState(false);
  /** Bumped by "Check again", which restarts the schedule. */
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (status === PAYMENT_STATUS.PAID) {
      router.replace(`/bookings/${bookingId}?confirmed=1`);
      return undefined;
    }
    if (status === PAYMENT_STATUS.FAILED) return undefined;

    let cancelled = false;
    let timer;
    let attempt = 0;

    const tick = async () => {
      if (cancelled) return;

      try {
        const result = await api.post(`/api/payments/${payment.id}/reconcile`);
        if (cancelled) return;

        setOutcome(result.reconciliation?.outcome ?? null);

        const next = result.payment?.status;
        if (next && next !== status) {
          // Re-runs this effect, which redirects or stops as the new state
          // requires. A move to PROCESSING deliberately restarts the
          // schedule: the money is genuinely in flight and deserves the
          // full window rather than whatever was left of the old one.
          setStatus(next);
          return;
        }
      } catch {
        // A blip while polling is not worth showing. The schedule running
        // out is what tells the purchaser we could not get an answer.
      }

      // A request that rejects *after* the component went away lands here
      // rather than at the guard above, so re-check before scheduling.
      if (cancelled) return;

      attempt += 1;
      if (attempt >= POLL_SCHEDULE_MS.length) {
        if (!cancelled) setTimedOut(true);
        return;
      }
      timer = setTimeout(tick, POLL_SCHEDULE_MS[attempt]);
    };

    timer = setTimeout(tick, POLL_SCHEDULE_MS[0]);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status, payment.id, bookingId, router, round]);

  if (status === PAYMENT_STATUS.FAILED) {
    return (
      <Alert tone="danger" title="That payment didn't go through">
        <p className="mb-3">
          Your card was not charged. You can try again with a different payment method — the lesson
          time is still held for you.
        </p>
        <Button href={`/bookings/checkout/${payment.id}`} size="sm">
          Try again
        </Button>
      </Alert>
    );
  }

  if (timedOut) {
    return (
      <Alert tone="warning" title="This is taking longer than usual" icon={<TriangleAlert className="size-4" />}>
        <p className="mb-3">
          Your payment may still be going through. Nothing is lost — your lesson time stays held
          while we wait, and it will appear in My Bookings as soon as your bank confirms it.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              setTimedOut(false);
              setRound((n) => n + 1);
            }}
          >
            Check again
          </Button>
          <Button href="/bookings" size="sm" variant="secondary">
            Go to my bookings
          </Button>
        </div>
      </Alert>
    );
  }

  // The provider has told us the money is in flight. That is a different
  // thing from "we have not heard yet", and saying so is the difference
  // between a purchaser who waits and one who pays twice.
  const processing = status === PAYMENT_STATUS.PROCESSING || outcome === "PROCESSING";

  return (
    <Card>
      <CardBody className="flex items-center gap-3 py-10 text-sm text-ink-600">
        <Loader2 className="size-5 animate-spin text-brand-600" aria-hidden="true" />
        <span role="status">
          {processing
            ? "Your payment is being processed. Your lesson is held while it clears."
            : "Waiting for confirmation from your payment provider…"}
        </span>
      </CardBody>
    </Card>
  );
}
