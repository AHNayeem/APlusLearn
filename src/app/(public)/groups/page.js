import Link from "next/link";
import { Users, Clock, MapPin, Video } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { listOpenSessions } from "@/services/group.service";
import { LESSON_MODES, GROUP_SESSION_STATUS } from "@/constants";
import {
  Avatar, Badge, Button, Card, CardBody, EmptyState, Pagination, Progress,
} from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { formatMoney, formatDate, formatTime, formatDuration } from "@/lib/utils/format";

export const metadata = {
  title: "Group sessions",
  description:
    "Join a small-group lesson with a verified Canadian tutor. Lower cost per learner, same curriculum.",
};
export const dynamic = "force-dynamic";

/**
 * Group sessions open for sign-ups (§41 Phase 2).
 *
 * Public, like tutor search — browsing costs nothing and joining needs an
 * account (§9). No private address is ever rendered here; the service strips
 * it before the page sees it.
 */
export default async function GroupsPage({ searchParams }) {
  await connectToDatabase();
  const { page = "1" } = await searchParams;

  const { items, total, pageSize } = await listOpenSessions({ page: Number(page) });

  return (
    <div className="bg-canvas pb-16">
      <PageHero
        eyebrow="Small groups"
        title="Learn together, pay less"
        description="A handful of learners, one tutor, the same curriculum. Sessions run once enough people have joined — and if one doesn't fill up, everybody is refunded in full."
      />

      <div className="container-page">
        {items.length === 0 ? (
          <EmptyState
            icon={<Users className="size-7" />}
            title="No group sessions right now"
            description="Tutors schedule these around exam season and school breaks. In the meantime, one-to-one lessons are always available."
            action={<Button href="/find-a-tutor">Find a tutor</Button>}
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {items.map((session) => (
              <Card key={session.id} interactive>
                <CardBody>
                  <Link href={`/groups/${session.id}`} className="block">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-base font-bold text-ink-900">{session.title}</h2>
                          {session.status === GROUP_SESSION_STATUS.CONFIRMED && (
                            <Badge tone="success" size="sm">
                              Going ahead
                            </Badge>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-ink-500">
                          {session.courseCode ? `${session.courseCode} · ` : ""}
                          {formatDate(session.startAt, { weekday: "long" })} at{" "}
                          {formatTime(session.startAt, session.timeZone)}
                        </p>
                      </div>

                      <p className="text-xl font-extrabold text-ink-900">
                        {formatMoney(session.pricePerSeatCents)}
                      </p>
                    </div>

                    {session.description && (
                      <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-600">
                        {session.description}
                      </p>
                    )}

                    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-500">
                      <span className="flex items-center gap-1.5">
                        <Clock className="size-3" />
                        {formatDuration(session.durationMinutes)}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {session.mode === LESSON_MODES.ONLINE ? (
                          <>
                            <Video className="size-3" />
                            Online
                          </>
                        ) : (
                          <>
                            <MapPin className="size-3" />
                            {session.location?.label ?? "In person"}
                          </>
                        )}
                      </span>
                      {session.tutor && (
                        <span className="flex items-center gap-1.5">
                          <Avatar
                            src={session.tutor.avatarUrl}
                            name={session.tutor.displayName}
                            size="xs"
                          />
                          {session.tutor.displayName}
                        </span>
                      )}
                    </div>

                    <div className="mt-4 border-t border-ink-100 pt-3">
                      <Progress
                        value={session.seatsTaken}
                        max={session.maxParticipants}
                        tone={session.seatsRemaining <= 2 ? "accent" : "brand"}
                        label={
                          session.seatsRemaining > 0
                            ? `${session.seatsRemaining} of ${session.maxParticipants} seats left`
                            : "Full — join the waiting list"
                        }
                      />
                    </div>
                  </Link>
                </CardBody>
              </Card>
            ))}
          </div>
        )}

        <Pagination
          className="mt-8"
          page={Number(page)}
          totalPages={Math.max(1, Math.ceil(total / pageSize))}
          total={total}
          pageSize={pageSize}
          label="sessions"
          buildHref={(p) => `/groups?page=${p}`}
        />
      </div>
    </div>
  );
}
