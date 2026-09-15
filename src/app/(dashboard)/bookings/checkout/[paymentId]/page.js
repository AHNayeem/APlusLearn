import { notFound, redirect } from "next/navigation";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES, PAYMENT_STATUS } from "@/constants";
import { getPayment } from "@/services/payment.service";
import { Booking } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { CheckoutForm } from "@/components/booking/CheckoutForm";

export const metadata = { title: "Checkout", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }) {
  const { paymentId } = await params;
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
