import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { getBooking } from "@/services/booking.service";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { BookingDetail } from "@/components/booking/BookingDetail";

export const metadata = { title: "Lesson details", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function BookingDetailPage({ params, searchParams }) {
  const { id } = await params;
  const query = await searchParams;
  const user = await enforceRole(LEARNER_ROLES, `/bookings/${id}`);
  await connectToDatabase();

  // getBooking enforces that the viewer is a party to this lesson (§8).
  const booking = await getBooking(id, user).catch(() => null);
  if (!booking) notFound();

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href="/bookings"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            All lessons
          </Link>
        }
        title="Lesson details"
      />
      <BookingDetail
        booking={booking}
        viewerRole={user.role}
        justConfirmed={query.confirmed === "1"}
      />
    </DashboardPage>
  );
}
