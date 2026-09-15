import Link from "next/link";
import { Users, MessageSquare } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, BOOKING_STATUS } from "@/constants";
import { Booking, StudentProfile } from "@/models";
import { Types } from "mongoose";
import { toPlain } from "@/lib/utils/serialize";
import { Avatar, Badge, Button, Card, CardBody, EmptyState } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatMoney, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Students" };
export const dynamic = "force-dynamic";

/**
 * The tutor's student roster (§24).
 *
 * Names respect each learner's minor-privacy setting — a tutor sees
 * "Emily C." unless the parent explicitly shared the full name (§35).
 */
export default async function TutorStudentsPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/students");
  await connectToDatabase();

  const rows = await Booking.aggregate([
    { $match: { tutorUserId: Types.ObjectId.createFromHexString(user.id) } },
    {
      $group: {
        _id: "$studentProfileId",
        completed: { $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, 1, 0] } },
        upcoming: {
          $sum: {
            $cond: [
              {
                $and: [
                  { $eq: ["$status", BOOKING_STATUS.CONFIRMED] },
                  { $gt: ["$startAt", new Date()] },
                ],
              },
              1,
              0,
            ],
          },
        },
        lastLessonAt: { $max: "$startAt" },
        courses: { $addToSet: { code: "$courseCode", name: "$courseName" } },
        earningsCents: { $sum: "$price.tutorEarningsCents" },
      },
    },
    { $sort: { lastLessonAt: -1 } },
  ]);

  const students = toPlain(
    await StudentProfile.find({ _id: { $in: rows.map((r) => r._id) } })
      .populate("ownerId", "firstName lastName")
      .lean(),
  );
  const map = new Map(students.map((s) => [s.id, s]));

  const roster = rows
    .map((row) => {
      const student = map.get(String(row._id));
      if (!student) return null;
      return {
        ...row,
        id: String(row._id),
        student,
        displayName:
          student.isMinor && !student.shareFullNameWithTutor
            ? `${student.firstName} ${student.lastName?.charAt(0) ?? ""}.`.trim()
            : `${student.firstName} ${student.lastName ?? ""}`.trim(),
      };
    })
    .filter(Boolean);

  return (
    <DashboardPage>
      <PageHeader
        title="Students"
        description="Everyone you've taught, with what you covered and what's booked next."
      />

      {roster.length === 0 ? (
        <EmptyState
          icon={<Users className="size-7" />}
          title="No students yet"
          description="Students appear here once they book their first lesson with you."
          action={<Button href="/tutor/calendar">Check my availability</Button>}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {roster.map((entry) => (
            <Card key={entry.id}>
              <CardBody>
                <div className="flex items-start gap-3">
                  <Avatar
                    src={entry.student.avatarUrl}
                    firstName={entry.student.firstName}
                    lastName={entry.student.lastName}
                    size="lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-bold text-ink-900">
                      {entry.displayName}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {entry.student.gradeName ?? "Grade not set"}
                      {entry.student.school ? ` · ${entry.student.school}` : ""}
                    </p>
                    {!entry.student.isSelf && entry.student.ownerId && (
                      <p className="mt-0.5 text-xs text-ink-400">
                        Parent: {entry.student.ownerId.firstName}{" "}
                        {entry.student.ownerId.lastName?.charAt(0)}.
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {entry.courses
                    .filter((c) => c.name)
                    .slice(0, 3)
                    .map((course) => (
                      <Badge key={course.code ?? course.name} tone="neutral" size="sm">
                        {course.code ?? course.name}
                      </Badge>
                    ))}
                </div>

                {entry.student.notes && (
                  <p className="mt-3 line-clamp-2 text-sm leading-relaxed text-ink-500">
                    {entry.student.notes}
                  </p>
                )}

                {entry.student.accessibilityNeeds && (
                  <div className="mt-3 rounded-lg border border-info-100 bg-info-50 p-2.5">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-info-600">
                      Learning needs
                    </p>
                    <p className="mt-0.5 text-xs leading-relaxed text-ink-600">
                      {entry.student.accessibilityNeeds}
                    </p>
                  </div>
                )}

                <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-ink-100 pt-3 text-center">
                  <div>
                    <dt className="text-[11px] text-ink-400">Completed</dt>
                    <dd className="text-sm font-bold text-ink-900">{entry.completed}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-ink-400">Upcoming</dt>
                    <dd className="text-sm font-bold text-ink-900">{entry.upcoming}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-ink-400">Earned</dt>
                    <dd className="text-sm font-bold text-ink-900">
                      {formatMoney(entry.earningsCents, { compact: true })}
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 text-xs text-ink-400">
                  Last lesson {formatRelative(entry.lastLessonAt)}
                </p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </DashboardPage>
  );
}
