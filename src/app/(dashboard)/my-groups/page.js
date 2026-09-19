import Link from "next/link";
import { Users, Clock } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  LEARNER_ROLES, GROUP_ENROLMENT_STATUS, GROUP_ENROLMENT_STATUS_LABELS,
  GROUP_SESSION_STATUS_LABELS, ATTENDANCE_LABELS,
} from "@/constants";
import { listEnrolmentsForOwner } from "@/services/group.service";
import {
  Avatar, Badge, Button, Card, CardBody, EmptyState, Pagination,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatDate, formatTime } from "@/lib/utils/format";

export const metadata = { title: "Group sessions" };
export const dynamic = "force-dynamic";

/** The group sessions a family has joined (§41 Phase 2). */
export default async function MyGroupsPage({ searchParams }) {
  const user = await enforceRole(LEARNER_ROLES, "/my-groups");
  await connectToDatabase();

  const { page = "1" } = await searchParams;
  const { items, total, pageSize } = await listEnrolmentsForOwner(user, { page: Number(page) });

  return (
    <DashboardPage>
      <PageHeader
        title="Group sessions"
        description="Small-group lessons you've joined."
        action={
          <Button href="/groups" variant="secondary">
            Browse sessions
          </Button>
        }
      />

      <div className="space-y-4">
        {items.length === 0 ? (
          <EmptyState
            icon={<Users className="size-7" />}
            title="You haven&rsquo;t joined any yet"
            description="Group sessions cost less per learner than a one-to-one lesson, and often fill up around exam season."
            action={<Button href="/groups">See what&rsquo;s on</Button>}
          />
        ) : (
          items.map((enrolment) => {
            const session = enrolment.sessionId;
            const tutor = session.tutorProfileId?.userId;
            const waitlisted = enrolment.status === GROUP_ENROLMENT_STATUS.WAITLISTED;

            return (
              <Card key={enrolment.id} interactive>
                <CardBody>
                  <Link href={`/groups/${session.id}`} className="block">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar src={tutor?.avatarUrl} name={tutor?.firstName ?? "Tutor"} />
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-sm font-bold text-ink-900">{session.title}</h2>
                            <Badge
                              tone={
                                enrolment.status === GROUP_ENROLMENT_STATUS.CONFIRMED
                                  ? "success"
                                  : waitlisted
                                    ? "warning"
                                    : "neutral"
                              }
                              size="sm"
                              icon={waitlisted ? <Clock className="size-3" /> : undefined}
                            >
                              {waitlisted && enrolment.waitlistPosition
                                ? `Waiting · ${enrolment.waitlistPosition}`
                                : GROUP_ENROLMENT_STATUS_LABELS[enrolment.status]}
                            </Badge>
                            {enrolment.attendance && (
                              <Badge
                                tone={enrolment.attendance === "PRESENT" ? "success" : "neutral"}
                                size="sm"
                              >
                                {ATTENDANCE_LABELS[enrolment.attendance]}
                              </Badge>
                            )}
                          </div>
                          <p className="mt-0.5 text-xs text-ink-500">
                            {formatDate(session.startAt, { weekday: "long" })} at{" "}
                            {formatTime(session.startAt, session.timeZone)} · for{" "}
                            {enrolment.studentProfileId?.firstName}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <p className="text-sm font-bold text-ink-900">
                          {formatMoney(session.pricePerSeatCents)}
                        </p>
                        <p className="text-xs text-ink-500">
                          {GROUP_SESSION_STATUS_LABELS[session.status]}
                        </p>
                      </div>
                    </div>

                    {enrolment.refundedCents > 0 && (
                      <p className="mt-3 text-xs text-ink-500">
                        {formatMoney(enrolment.refundedCents)} refunded
                      </p>
                    )}
                  </Link>
                </CardBody>
              </Card>
            );
          })
        )}
      </div>

      <Pagination
        className="mt-6"
        page={Number(page)}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        label="sessions"
        buildHref={(p) => `/my-groups?page=${p}`}
      />
    </DashboardPage>
  );
}
