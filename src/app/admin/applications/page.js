import Link from "next/link";
import { ClipboardCheck, Search } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, TUTOR_STATUS, TUTOR_STATUS_LABELS, PAGE_SIZES } from "@/constants";
import { TutorApplication, User } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { escapeRegex } from "@/lib/security/sanitize";
import {
  Badge, Button, EmptyState, LinkTabs, Pagination, Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatDate, formatRelative, formatRate } from "@/lib/utils/format";

export const metadata = { title: "Tutor applications" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: TUTOR_STATUS.PENDING_REVIEW, label: "Pending" },
  { value: TUTOR_STATUS.INFO_REQUESTED, label: "Info requested" },
  { value: TUTOR_STATUS.APPROVED, label: "Approved" },
  { value: TUTOR_STATUS.REJECTED, label: "Rejected" },
];

function statusTone(status) {
  if (status === TUTOR_STATUS.APPROVED) return "success";
  if (status === TUTOR_STATUS.REJECTED) return "danger";
  if (status === TUTOR_STATUS.INFO_REQUESTED) return "warning";
  return "brand";
}

export default async function AdminApplicationsPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/applications");
  await connectToDatabase();

  const { status = TUTOR_STATUS.PENDING_REVIEW, q, page = "1" } = await searchParams;
  const pageSize = PAGE_SIZES.adminTable;
  const currentPage = Number(page);

  const filter = { status };
  if (q) {
    const pattern = new RegExp(escapeRegex(q), "i");
    const ids = await User.find({
      $or: [{ firstName: pattern }, { lastName: pattern }, { email: pattern }],
    }).distinct("_id");
    filter.userId = { $in: ids };
  }

  const [items, total] = await Promise.all([
    TutorApplication.find(filter)
      .sort({ submittedAt: 1, createdAt: -1 })
      .skip((currentPage - 1) * pageSize)
      .limit(pageSize)
      .populate("userId", "firstName lastName email city province createdAt")
      .populate("tutorProfileId", "slug headline hourlyRateCents courseCodes yearsExperience qualifications")
      .lean(),
    TutorApplication.countDocuments(filter),
  ]);

  const applications = toPlain(items);

  return (
    <DashboardPage>
      <PageHeader
        title="Tutor applications"
        description="Review credentials and documents before a profile goes live."
      />

      <LinkTabs
        activeValue={status}
        tabs={TABS.map((tab) => ({ ...tab, href: `/admin/applications?status=${tab.value}` }))}
      />

      <form action="/admin/applications" className="mt-5 flex max-w-md gap-2">
        <input type="hidden" name="status" value={status} />
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search by name or email"
          aria-label="Search applications"
          className="h-10 flex-1 rounded-xl border-0 bg-white px-3.5 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
        />
        <Button type="submit" variant="secondary" size="sm" iconLeft={<Search className="size-4" />}>
          Search
        </Button>
      </form>

      <div className="mt-6">
        {applications.length === 0 ? (
          <EmptyState
            icon={<ClipboardCheck className="size-7" />}
            title="Nothing in this queue"
            description={
              status === TUTOR_STATUS.PENDING_REVIEW
                ? "Every application has been reviewed."
                : "No applications with this status."
            }
          />
        ) : (
          <Table>
            <THead>
              <TH>Applicant</TH>
              <TH>Teaching</TH>
              <TH>Rate</TH>
              <TH>Submitted</TH>
              <TH>Status</TH>
              <TH align="right">Action</TH>
            </THead>
            <TBody>
              {applications.map((application) => (
                <TR key={application.id}>
                  <TD>
                    <span className="block font-semibold text-ink-900">
                      {application.userId?.firstName} {application.userId?.lastName}
                    </span>
                    <span className="block text-xs text-ink-500">{application.userId?.email}</span>
                    <span className="block text-xs text-ink-400">
                      {application.userId?.city}, {application.userId?.province}
                    </span>
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {application.tutorProfileId?.courseCodes?.slice(0, 3).map((code) => (
                        <Badge key={code} tone="neutral" size="sm">
                          {code}
                        </Badge>
                      ))}
                      {application.tutorProfileId?.courseCodes?.length > 3 && (
                        <Badge tone="neutral" size="sm">
                          +{application.tutorProfileId.courseCodes.length - 3}
                        </Badge>
                      )}
                    </div>
                    {application.tutorProfileId?.yearsExperience != null && (
                      <span className="mt-1 block text-xs text-ink-500">
                        {application.tutorProfileId.yearsExperience} years experience
                      </span>
                    )}
                  </TD>
                  <TD>
                    {application.tutorProfileId?.hourlyRateCents
                      ? formatRate(application.tutorProfileId.hourlyRateCents)
                      : "—"}
                  </TD>
                  <TD>
                    {application.submittedAt ? (
                      <>
                        <span className="block text-sm">{formatDate(application.submittedAt)}</span>
                        <span className="block text-xs text-ink-400">
                          {formatRelative(application.submittedAt)}
                        </span>
                      </>
                    ) : (
                      <span className="text-ink-400">Draft</span>
                    )}
                  </TD>
                  <TD>
                    <Badge tone={statusTone(application.status)} size="sm">
                      {TUTOR_STATUS_LABELS[application.status]}
                    </Badge>
                  </TD>
                  <TD align="right">
                    <Link
                      href={`/admin/applications/${application.id}`}
                      className="text-sm font-semibold text-brand-600 hover:underline"
                    >
                      Review
                    </Link>
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
          label="applications"
          buildHref={(p) => `/admin/applications?status=${status}&page=${p}`}
        />
      </div>
    </DashboardPage>
  );
}
