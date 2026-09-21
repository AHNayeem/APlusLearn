import { notFound, redirect } from "next/navigation";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES, PAYMENT_STATUS } from "@/constants";
import { getPayment, checkoutUrlFor } from "@/services/payment.service";
import { Booking } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { Alert, Button } from "@/components/ui";
import { CheckoutForm } from "@/components/booking/CheckoutForm";
import { formatDateTime } from "@/lib/utils/format";

/** How long the held slot has left, in the purchaser's own terms. */
function holdText(payment) {
  const until = payment.checkoutExpiresAt ? new Date(payment.checkoutExpiresAt) : null;
  if (!until || Number.isNaN(until.getTime()) || until <= new Date()) {
    return "The time is held for a short while longer.";
  }
  return `The time is held until ${formatDateTime(until)}.`;
}

export const metadata = { title: "Checkout", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params, searchParams }) {
  const { paymentId } = await params;
  const { cancelled } = (await searchParams) ?? {};
  const user = await enforceRole(LEARNER_ROLES, `/bookings/checkout/${paymentId}`);
  await connectToDatabase();

  // getPayment enforces that this payment belongs to the signed-in user (§8).
  const payment = await getPayment(paymentId, user).catch(() => null);
  if (!payment) notFound();

  const bookings = toPlain(
    await Booking.find({ paymentId }).sort({ startAt: 1 }).lean(),
  );
  if (!bookings.length) notFound();

  // Already paid: send them to the lesson rather than charging twice.
  if (payment.status === PAYMENT_STATUS.PAID) {
    redirect(`/bookings/${bookings[0].id}`);
  }

  // With a hosted provider the card is entered on their page, not ours. A
  // lapsed session is rebuilt rather than shown, so this link always works.
  const checkout = await checkoutUrlFor(paymentId, user);

  // Backing out of the hosted page returns the purchaser here. Redirecting
  // them again would send them straight back to the page they just left —
  // a loop with no way out but the browser's back button. So the cancel
  // return renders, and going back to pay is something they choose (§19).
  if (checkout.hosted && cancelled === "1") {
    return (
      <DashboardPage>
        <PageHeader
          title="Payment cancelled"
          description={
            bookings.length > 1
              ? `Your ${bookings.length} lesson times are still held, for now.`
              : "Your lesson time is still held, for now."
          }
        />
        <Alert tone="warning" title="You didn't complete the payment">
          <p className="mb-3">
            Nothing was charged.{" "}
            {holdText(payment)} After that the time goes back on the tutor&rsquo;s calendar and
            somebody else can book it.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button href={`/bookings/checkout/${paymentId}`} size="sm">
              Continue to payment
            </Button>
            <Button href={`/bookings/${bookings[0].id}`} size="sm" variant="secondary">
              View the booking
            </Button>
          </div>
        </Alert>
      </DashboardPage>
    );
  }

  if (checkout.hosted && checkout.url) {
    redirect(checkout.url);
  }

  return (
    <DashboardPage>
      <PageHeader
        title="Confirm and pay"
        description={
          bookings.length > 1
            ? `${bookings.length} lessons are held for you while you complete payment.`
            : "Your lesson is held for you while you complete payment."
        }
      />
      <CheckoutForm payment={payment} bookings={bookings} />
    </DashboardPage>
  );
}
