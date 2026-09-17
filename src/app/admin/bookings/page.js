import Link from "next/link";
import { CalendarDays, Search } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, BOOKING_STATUS, BOOKING_STATUS_LABELS, LESSON_MODE_LABELS, PAGE_SIZES,
} from "@/constants";
import { Booking } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { escapeRegex } from "@/lib/security/sanitize";
import {
  Badge, Button, EmptyState, LinkTabs, Pagination, StatCard,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { statusTone } from "@/components/booking/BookingRow";
import { formatMoney, formatDateTime, formatDuration } from "@/lib/utils/format";

export const metadata = { title: "Bookings" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: BOOKING_STATUS.CONFIRMED, label: "Confirmed" },
  { value: BOOKING_STATUS.COMPLETED, label: "Completed" },
  { value: BOOKING_STATUS.PENDING_PAYMENT, label: "Unpaid" },
  { value: BOOKING_STATUS.DISPUTED, label: "Disputed" },
  { value: BOOKING_STATUS.EXPIRED, label: "Expired" },
];

export default async function AdminBookingsPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/bookings");
  await connectToDatabase();

  const { status = "", q, page = "1" } = await searchParams;
  const pageSize = PAGE_SIZES.adminTable;
  const currentPage = Number(page);

  const filter = {};
  if (status) filter.status = status;
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ reference: pattern }, { courseCode: pattern }, { courseName: pattern }];
  }

  const [items, total, aggregate] = await Promise.all([
    Booking.find(filter)
      .sort({ startAt: -1 })
      .skip((currentPage - 1) * pageSize)
      .limit(pageSize)
      .populate({
        path: "tutorProfileId",
        select: "slug userId",
        populate: { path: "userId", select: "firstName lastName" },
      })
      .populate("studentProfileId", "firstName lastName")
      .populate("purchaserId", "firstName lastName email")
      .lean(),
    Booking.countDocuments(filter),
    Booking.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          gross: { $sum: "$price.totalCents" },
          commission: { $sum: "$price.commissionCents" },
        },
      },
    ]),
  ]);

  const bookings = toPlain(items);
  const totals = aggregate[0] ?? { gross: 0, commission: 0 };

  return (
    <DashboardPage>
      <PageHeader
        title="Bookings"
        description="Every lesson on the platform, with the money behind it."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Bookings" value={total} icon={<CalendarDays className="size-5" />} />
        <StatCard label="Gross value" value={formatMoney(totals.gross, { compact: true })} />
        <StatCard
          label="Platform commission"
          value={formatMoney(totals.commission, { compact: true })}
        />
      </div>

      <div className="mt-6">
        <LinkTabs
          activeValue={status}
          tabs={TABS.map((tab) => ({
            ...tab,
            href: tab.value ? `/admin/bookings?status=${tab.value}` : "/admin/bookings",
          }))}
        />
      </div>

      <form action="/admin/bookings" className="mt-5 flex max-w-md gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by reference or course"
          aria-label="Search bookings"
          className="h-10 flex-1 rounded-xl border-0 bg-white px-3.5 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
        />
        <Button type="submit" variant="secondary" size="sm" iconLeft={<Search className="size-4" />}>
          Search
        </Button>
      </form>

      <div className="mt-6">
        {bookings.length === 0 ? (
          <EmptyState
            icon={<CalendarDays className="size-7" />}
            title="No bookings match"
            description="Try a different filter or search term."
          />
        ) : (
          <Table className="min-w-[900px]">
            <THead>
              <TH>Reference</TH>
              <TH>Course</TH>
              <TH>Tutor</TH>
              <TH>Family</TH>
              <TH>When</TH>
              <TH>Status</TH>
              <TH align="right">Value</TH>
            </THead>
            <TBody>
              {bookings.map((booking) => (
                <TR key={booking.id}>
                  <TD>
                    <Link
                      href={`/admin/bookings?q=${booking.reference}`}
                      className="font-semibold text-ink-900"
                    >
                      {booking.reference}
                    </Link>
                    <span className="block text-xs text-ink-400">
                      {LESSON_MODE_LABELS[booking.mode]}
                    </span>
                  </TD>
                  <TD>
                    <span className="block font-medium text-ink-800">
                      {booking.courseCode ?? booking.courseName}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {formatDuration(booking.durationMinutes)}
                    </span>
                  </TD>
                  <TD className="text-sm">
                    {booking.tutorProfileId?.userId ? (
                      <Link
                        href={`/tutors/${booking.tutorProfileId.slug}`}
                        className="text-brand-600 hover:underline"
                      >
                        {booking.tutorProfileId.userId.firstName}{" "}
                        {booking.tutorProfileId.userId.lastName}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </TD>
                  <TD className="text-sm">
                    {booking.purchaserId ? (
                      <Link
                        href={`/admin/users/${booking.purchaserId.id}`}
                        className="text-brand-600 hover:underline"
                      >
                        {booking.purchaserId.firstName} {booking.purchaserId.lastName}
                      </Link>
                    ) : (
                      "—"
                    )}
                    {booking.studentProfileId && (
                      <span className="block text-xs text-ink-500">
                        for {booking.studentProfileId.firstName}
                      </span>
                    )}
                  </TD>
                  <TD className="text-xs">
                    {formatDateTime(booking.startAt, booking.timeZone)}
                  </TD>
                  <TD>
                    <Badge tone={statusTone(booking.status)} size="sm">
                      {BOOKING_STATUS_LABELS[booking.status]}
                    </Badge>
                  </TD>
                  <TD align="right">
                    <span className="block font-semibold text-ink-900">
                      {formatMoney(booking.price.totalCents)}
                    </span>
                    <span className="block text-xs text-ink-500">
                      {formatMoney(booking.price.commissionCents)} fee
                    </span>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}

        <Pagination
          className="mt-6"
          page={currentPage}
          totalPages={Math.max(1, Math.ceil(total / pageSize))}
          total={total}
          pageSize={pageSize}
          label="bookings"
          buildHref={(p) =>
            `/admin/bookings?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}), page: String(p) })}`
          }
        />
      </div>
    </DashboardPage>
  );
}
