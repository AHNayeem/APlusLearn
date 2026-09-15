import { notFound, redirect } from "next/navigation";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES, PAYMENT_STATUS } from "@/constants";
import { getPayment } from "@/services/payment.service";
import { Booking } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { CheckoutPending } from "@/components/booking/CheckoutPending";

/**
 * Where a hosted checkout returns the purchaser (§20).
 *
 * Landing here does **not** confirm anything. The browser could have been
 * pointed at this URL by anyone, so the lesson is confirmed only once the
 * provider's signed webhook has been processed. This page reports the state
 * of the Payment record and waits for it — which is usually a second or two.
 */
export const metadata = { title: "Confirming your payment", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CheckoutCompletePage({ params }) {
  const { paymentId } = await params;
  const user = await enforceRole(LEARNER_ROLES, `/bookings/checkout/${paymentId}/complete`);
  await connectToDatabase();

  // Ownership is enforced against the loaded record, not the URL (§8).
  const payment = await getPayment(paymentId, user).catch(() => null);
  if (!payment) notFound();

  const bookings = toPlain(await Booking.find({ paymentId }).sort({ startAt: 1 }).lean());
  if (!bookings.length) notFound();

  if (payment.status === PAYMENT_STATUS.PAID) {
    redirect(`/bookings/${bookings[0].id}?confirmed=1`);
  }

  return (
    <DashboardPage>
      <PageHeader
        title="Confirming your payment"
        description="Your payment provider is letting us know. This usually takes a few seconds."
      />
      <CheckoutPending payment={payment} bookingId={bookings[0].id} />
    </DashboardPage>
  );
}
