import Link from "next/link";
import { GraduationCap, Search } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, TUTOR_STATUS, TUTOR_STATUS_LABELS, PAGE_SIZES } from "@/constants";
import { TutorProfile } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { escapeRegex } from "@/lib/security/sanitize";
import {
  Avatar, Badge, Button, EmptyState, LinkTabs, Pagination, Rating,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { TutorRowActions } from "@/components/admin/TutorRowActions";
import { formatRate, formatMoney } from "@/lib/utils/format";

export const metadata = { title: "Tutors" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: TUTOR_STATUS.APPROVED, label: "Approved" },
  { value: TUTOR_STATUS.PENDING_REVIEW, label: "Pending" },
  { value: TUTOR_STATUS.SUSPENDED, label: "Suspended" },
  { value: TUTOR_STATUS.REJECTED, label: "Rejected" },
];

export default async function AdminTutorsPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/tutors");
  await connectToDatabase();

  const { status = "", q, page = "1" } = await searchParams;
  const pageSize = PAGE_SIZES.adminTable;
  const currentPage = Number(page);

  const filter = {};
  if (status) filter.status = status;
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    filter.$or = [{ headline: pattern }, { city: pattern }, { courseCodes: pattern }];
  }

  const [items, total] = await Promise.all([
    TutorProfile.find(filter)
      .sort({ updatedAt: -1 })
      .skip((currentPage - 1) * pageSize)
      .limit(pageSize)
      .populate("userId", "firstName lastName email status avatarUrl")
      .lean(),
    TutorProfile.countDocuments(filter),
  ]);

  const tutors = toPlain(items);

  return (
    <DashboardPage>
      <PageHeader
        title="Tutors"
        description="Every tutor profile, including those not visible in search."
      />

      <LinkTabs
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/tutors?status=${tab.value}` : "/admin/tutors",
        }))}
      />

      <form action="/admin/tutors" className="mt-5 flex max-w-md gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by headline, city or course code"
          aria-label="Search tutors"
          className="h-10 flex-1 rounded-xl border-0 bg-white px-3.5 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
        />
        <Button type="submit" variant="secondary" size="sm" iconLeft={<Search className="size-4" />}>
          Search
        </Button>
      </form>

      <div className="mt-6">
        {tutors.length === 0 ? (
          <EmptyState
            icon={<GraduationCap className="size-7" />}
            title="No tutors match"
            description="Try a different search or status filter."
          />
        ) : (
          <Table className="min-w-[860px]">
            <THead>
              <TH>Tutor</TH>
              <TH>Courses</TH>
              <TH>Rate</TH>
              <TH>Rating</TH>
              <TH>Lessons</TH>
              <TH>Status</TH>
              <TH align="right">Actions</TH>
            </THead>
            <TBody>
              {tutors.map((tutor) => (
                <TR key={tutor.id}>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Avatar
                        src={tutor.userId?.avatarUrl}
                        firstName={tutor.userId?.firstName}
                        lastName={tutor.userId?.lastName}
                        size="sm"
                      />
                      <div className="min-w-0">
                        <span className="block truncate font-semibold text-ink-900">
                          {tutor.userId?.firstName} {tutor.userId?.lastName}
                        </span>
                        <span className="block truncate text-xs text-ink-500">
                          {tutor.city}, {tutor.province}
                        </span>
                      </div>
                    </div>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {tutor.courseCodes?.slice(0, 2).map((code) => (
                        <Badge key={code} tone="neutral" size="sm">
                          {code}
                        </Badge>
                      ))}
                      {tutor.courseCodes?.length > 2 && (
                        <Badge tone="neutral" size="sm">
                          +{tutor.courseCodes.length - 2}
                        </Badge>
                      )}
                    </div>
                  </TD>
                  <TD>{formatRate(tutor.hourlyRateCents)}</TD>
                  <TD>
                    {tutor.stats?.ratingCount ? (
                      <Rating
                        value={tutor.stats.ratingAverage}
                        count={tutor.stats.ratingCount}
                        size="sm"
                      />
                    ) : (
                      <span className="text-xs text-ink-400">No reviews</span>
                    )}
                  </TD>
                  <TD className="tabular-nums">{tutor.stats?.completedLessons ?? 0}</TD>
                  <TD>
                    <Badge
                      tone={
                        tutor.status === TUTOR_STATUS.APPROVED
                          ? "success"
                          : tutor.status === TUTOR_STATUS.SUSPENDED ||
                              tutor.status === TUTOR_STATUS.REJECTED
                            ? "danger"
                            : "warning"
                      }
                      size="sm"
                    >
                      {TUTOR_STATUS_LABELS[tutor.status]}
                    </Badge>
                    {tutor.status === TUTOR_STATUS.APPROVED && !tutor.isSearchable && (
                      <span className="mt-1 block text-[11px] text-warning-700">
                        Hidden from search
                      </span>
                    )}
                  </TD>
                  <TD align="right">
                    <TutorRowActions tutor={tutor} />
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
          label="tutors"
          buildHref={(p) =>
            `/admin/tutors?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}), page: String(p) })}`
          }
        />
      </div>
    </DashboardPage>
  );
}
