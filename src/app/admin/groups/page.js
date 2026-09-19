import { Users } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, GROUP_SESSION_STATUS, GROUP_SESSION_STATUS_LABELS } from "@/constants";
import { listAllSessions } from "@/services/group.service";
import {
  Badge, Card, CardBody, EmptyState, LinkTabs, Pagination,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatDate, formatTime } from "@/lib/utils/format";

export const metadata = { title: "Group sessions" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "", label: "All" },
  { value: GROUP_SESSION_STATUS.PUBLISHED, label: "Filling" },
  { value: GROUP_SESSION_STATUS.CONFIRMED, label: "Going ahead" },
  { value: GROUP_SESSION_STATUS.COMPLETED, label: "Finished" },
  { value: GROUP_SESSION_STATUS.CANCELLED, label: "Cancelled" },
];

function tone(status) {
  if (status === GROUP_SESSION_STATUS.CONFIRMED) return "success";
  if (status === GROUP_SESSION_STATUS.CANCELLED) return "danger";
  if (status === GROUP_SESSION_STATUS.PUBLISHED) return "brand";
  return "neutral";
}

/** Group sessions across the platform, for moderation and support. */
export default async function AdminGroupsPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/groups");
  await connectToDatabase();

  const { status = "", page = "1" } = await searchParams;
  const { items, total, pageSize } = await listAllSessions({
    status: status || undefined,
    page: Number(page),
  });

  return (
    <DashboardPage>
      <PageHeader
        title="Group sessions"
        description="Small-group lessons tutors are running, and how full each one is."
      />

      <LinkTabs
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/groups?status=${tab.value}` : "/admin/groups",
        }))}
      />

      <Card className="mt-6">
        <CardBody className="p-0">
          {items.length === 0 ? (
            <EmptyState
              icon={<Users className="size-7" />}
              title="Nothing here"
              description="No group sessions match this filter."
            />
          ) : (
            <Table>
              <THead>
                <TH>When</TH>
                <TH>Session</TH>
                <TH>Tutor</TH>
                <TH>Seats</TH>
                <TH>Seat price</TH>
                <TH>Status</TH>
              </THead>
              <TBody>
                {items.map((session) => (
                  <TR key={session.id}>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      {formatDate(session.startAt, { weekday: "short" })}
                      <span className="block text-ink-400">
                        {formatTime(session.startAt, session.timeZone)}
                      </span>
                    </TD>
                    <TD className="text-xs">
                      {session.title}
                      <span className="block text-ink-400">
                        {session.courseCode ?? session.courseName} · {session.reference}
                      </span>
                    </TD>
                    <TD className="text-xs">
                      {session.tutorUserId?.firstName} {session.tutorUserId?.lastName}
                    </TD>
                    <TD className="whitespace-nowrap text-xs font-semibold">
                      {session.seatsTaken} / {session.maxParticipants}
                      <span className="block font-normal text-ink-400">
                        needs {session.minParticipants}
                      </span>
                    </TD>
                    <TD className="whitespace-nowrap text-xs">
                      {formatMoney(session.pricePerSeatCents)}
                    </TD>
                    <TD>
                      <Badge tone={tone(session.status)} size="sm">
                        {GROUP_SESSION_STATUS_LABELS[session.status]}
                      </Badge>
                      {session.cancellationReason && (
                        <span className="mt-1 block text-[11px] text-ink-500">
                          {session.cancellationReason}
                        </span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Pagination
        className="mt-6"
        page={Number(page)}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        label="sessions"
        buildHref={(p) => `/admin/groups?status=${status}&page=${p}`}
      />
    </DashboardPage>
  );
}
