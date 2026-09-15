"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, CreditCard, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Card, CardBody, CardHeader, Field, Input, FormErrorSummary, useToast,
} from "@/components/ui";
import { formatMoney, formatDateTime, formatDuration } from "@/lib/utils/format";
import { LESSON_MODES } from "@/constants";

/**
 * Checkout (§19, §20).
 *
 * The amount is whatever the server put on the Payment record — this form
 * never computes or submits a price, only the card details, which go straight
 * to the provider and are never stored (§35, §42).
 */
export function CheckoutForm({ payment, bookings, meetingProvider }) {
  const router = useRouter();
  const toast = useToast();

  const [card, setCard] = useState({
    number: "",
    name: "",
    expiry: "",
    cvc: "",
    postalCode: "",
  });

  const set = (key) => (event) => setCard((c) => ({ ...c, [key]: event.target.value }));

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post(`/api/payments/${payment.id}/capture`, {
      card: { ...card, number: card.number.replace(/\s/g, "") },
      meetingProvider,
    });
    toast.success(
      result.confirmed > 1 ? `${result.confirmed} lessons confirmed` : "Lesson confirmed",
      "We've emailed you the details.",
    );
    router.push(`/bookings/${bookings[0].id}?confirmed=1`);
    router.refresh();
    return result;
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <Card>
        <CardHeader
          title="Payment details"
          description="Your card is charged now and the lesson is confirmed immediately."
        />
        <CardBody>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-5"
          >
            <FormErrorSummary error={error} fieldErrors={fieldErrors} />

            <Alert tone="info" title="Development payment provider">
              No real payment is taken. Use <strong>4242 4242 4242 4242</strong> to succeed, or a
              number ending <strong>0002</strong> to see the declined-card flow.
            </Alert>

            <Field
              label="Card number"
              htmlFor="card-number"
              error={fieldErrors["card.number"]}
              required
            >
              <Input
                id="card-number"
                inputMode="numeric"
                autoComplete="cc-number"
                required
                value={card.number}
                onChange={(e) =>
                  setCard((c) => ({ ...c, number: formatCardNumber(e.target.value) }))
                }
                maxLength={19}
                placeholder="4242 4242 4242 4242"
                error={fieldErrors["card.number"]}
                iconLeft={<CreditCard className="size-4" />}
              />
            </Field>

            <Field
              label="Name on card"
              htmlFor="card-name"
              error={fieldErrors["card.name"]}
              required
            >
              <Input
                id="card-name"
                autoComplete="cc-name"
                required
                value={card.name}
                onChange={set("name")}
                placeholder="J. Chen"
                error={fieldErrors["card.name"]}
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Expiry" htmlFor="card-expiry" error={fieldErrors["card.expiry"]} required>
                <Input
                  id="card-expiry"
                  inputMode="numeric"
                  autoComplete="cc-exp"
                  required
                  value={card.expiry}
                  onChange={(e) => setCard((c) => ({ ...c, expiry: formatExpiry(e.target.value) }))}
                  maxLength={5}
                  placeholder="MM/YY"
                  error={fieldErrors["card.expiry"]}
                />
              </Field>
              <Field label="CVC" htmlFor="card-cvc" error={fieldErrors["card.cvc"]} required>
                <Input
                  id="card-cvc"
                  inputMode="numeric"
                  autoComplete="cc-csc"
                  required
                  value={card.cvc}
                  onChange={(e) =>
                    setCard((c) => ({ ...c, cvc: e.target.value.replace(/\D/g, "").slice(0, 4) }))
                  }
                  placeholder="123"
                  error={fieldErrors["card.cvc"]}
                />
              </Field>
              <Field label="Postal code" htmlFor="card-postal">
                <Input
                  id="card-postal"
                  autoComplete="postal-code"
                  value={card.postalCode}
                  onChange={set("postalCode")}
                  placeholder="M5V 2K3"
                />
              </Field>
            </div>

            <Button type="submit" size="lg" fullWidth loading={pending}>
              {pending ? "Processing…" : `Pay ${formatMoney(payment.totalCents)}`}
            </Button>

            <div className="flex items-center justify-center gap-4 text-xs text-ink-500">
              <span className="flex items-center gap-1.5">
                <Lock className="size-3" />
                Encrypted
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="size-3" />
                Held until the lesson is done
              </span>
            </div>
          </form>
        </CardBody>
      </Card>

      <OrderSummary payment={payment} bookings={bookings} />
    </div>
  );
}

function OrderSummary({ payment, bookings }) {
  const first = bookings[0];

  return (
    <Card className="h-fit lg:sticky lg:top-24">
      <CardHeader title="Order summary" />
      <CardBody className="space-y-4">
        <div>
          <p className="text-sm font-bold text-ink-900">
            {first.courseCode ? `${first.courseCode} — ` : ""}
            {first.courseName}
          </p>
          <p className="mt-0.5 text-xs text-ink-500">
            {first.mode === LESSON_MODES.ONLINE ? "Online lesson" : "In-person lesson"} ·{" "}
            {formatDuration(first.durationMinutes)}
          </p>
        </div>

        <ul className="space-y-2 border-t border-ink-100 pt-4">
          {bookings.map((booking, index) => (
            <li key={booking.id} className="flex justify-between gap-3 text-sm">
              <span className="min-w-0 text-ink-600">
                {bookings.length > 1 && (
                  <span className="mr-1.5 text-xs text-ink-400">#{index + 1}</span>
                )}
                {formatDateTime(booking.startAt, booking.timeZone)}
              </span>
              <span className="shrink-0 font-semibold text-ink-900">
                {formatMoney(booking.price.totalCents)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="space-y-2 border-t border-ink-100 pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">Subtotal</dt>
            <dd className="font-semibold text-ink-900">{formatMoney(payment.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-ink-100 pt-2">
            <dt className="text-base font-bold text-ink-900">Total</dt>
            <dd className="text-base font-extrabold text-ink-900">
              {formatMoney(payment.totalCents)}
            </dd>
          </div>
        </dl>

        <p className="rounded-lg bg-ink-50 p-3 text-xs leading-relaxed text-ink-500">
          Cancel free of charge up to 24 hours before a lesson starts. If your tutor cancels or
          doesn&rsquo;t attend, you&rsquo;re refunded in full.
        </p>
      </CardBody>
    </Card>
  );
}

function formatCardNumber(value) {
  return value
    .replace(/\D/g, "")
    .slice(0, 16)
    .replace(/(\d{4})(?=\d)/g, "$1 ");
}

function formatExpiry(value) {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length > 2 ? `${digits.slice(0, 2)}/${digits.slice(2)}` : digits;
}
