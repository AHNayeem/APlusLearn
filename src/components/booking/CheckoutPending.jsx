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
 * The confirmation itself happens server-side when the provider's signed
 * webhook arrives — this only polls the Payment record until it changes.
 * Nothing here can confirm a booking, which is the point: a browser saying
 * "it worked" is not evidence that it did.
 */
const POLL_MS = 2000;
const GIVE_UP_AFTER_MS = 60_000;

export function CheckoutPending({ payment, bookingId }) {
  const router = useRouter();
  const [status, setStatus] = useState(payment.status);
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (status === PAYMENT_STATUS.PAID) {
      router.replace(`/bookings/${bookingId}?confirmed=1`);
      return undefined;
    }

    const startedAt = Date.now();
    let cancelled = false;

    const timer = setInterval(async () => {
      if (Date.now() - startedAt > GIVE_UP_AFTER_MS) {
        if (!cancelled) setTimedOut(true);
        clearInterval(timer);
        return;
      }
      try {
        const result = await api.get(`/api/payments/${payment.id}`);
        if (cancelled) return;
        if (result.payment?.status && result.payment.status !== status) {
          setStatus(result.payment.status);
        }
      } catch {
        // A blip while polling is not worth showing; the timeout covers it.
      }
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [status, payment.id, bookingId, router]);

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
          Your payment may still be going through. Nothing is lost — check your bookings in a
          moment, and contact us if the lesson hasn&rsquo;t appeared.
        </p>
        <Button href="/bookings" size="sm" variant="secondary">
          Go to my bookings
        </Button>
      </Alert>
    );
  }

  return (
    <Card>
      <CardBody className="flex items-center gap-3 py-10 text-sm text-ink-600">
        <Loader2 className="size-5 animate-spin text-brand-600" aria-hidden="true" />
        <span role="status">Waiting for confirmation from your payment provider…</span>
      </CardBody>
    </Card>
  );
}
