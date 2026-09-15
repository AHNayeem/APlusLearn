import { Types } from "mongoose";
import { routeHandler, ok } from "@/lib/api";
import { Booking, StudentProfile } from "@/models";
import { BOOKING_STATUS, ROLES } from "@/constants";
import { toPlain } from "@/lib/utils/serialize";

/**
 * The tutor's student roster (§24). Names respect each learner's minor
 * privacy setting — a tutor sees "Emily C." unless the parent opted in (§35).
 */
export const GET = routeHandler(
  async ({ user }) => {
    const rows = await Booking.aggregate([
      { $match: { tutorUserId: Types.ObjectId.createFromHexString(user.id) } },
      {
        $group: {
          _id: "$studentProfileId",
          completed: { $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, 1, 0] } },
          upcoming: {
            $sum: {
              $cond: [
                { $and: [{ $eq: ["$status", BOOKING_STATUS.CONFIRMED] }, { $gt: ["$startAt", new Date()] }] },
                1, 0,
              ],
            },
          },
          lastLessonAt: { $max: "$startAt" },
          courses: { $addToSet: { code: "$courseCode", name: "$courseName" } },
          revenueCents: { $sum: "$price.tutorEarningsCents" },
        },
      },
      { $sort: { lastLessonAt: -1 } },
    ]);

    const students = await StudentProfile.find({ _id: { $in: rows.map((r) => r._id) } })
      .populate("ownerId", "firstName lastName email")
      .lean();
    const map = new Map(students.map((s) => [String(s._id), s]));

    return ok({
      students: rows
        .map((row) => {
          const student = map.get(String(row._id));
          if (!student) return null;
          const displayName =
            student.isMinor && !student.shareFullNameWithTutor
              ? `${student.firstName} ${student.lastName?.charAt(0) ?? ""}.`.trim()
              : `${student.firstName} ${student.lastName ?? ""}`.trim();

          return {
            id: String(student._id),
            displayName,
            gradeName: student.gradeName,
            school: student.school,
            avatarUrl: student.avatarUrl ?? null,
            guardian: student.isSelf
              ? null
              : { name: `${student.ownerId?.firstName ?? ""} ${student.ownerId?.lastName ?? ""}`.trim() },
            completed: row.completed,
            upcoming: row.upcoming,
            lastLessonAt: row.lastLessonAt,
            courses: row.courses.filter((c) => c.name),
            earningsCents: row.revenueCents,
          };
        })
        .filter(Boolean)
        .map(toPlain),
    });
  },
  { roles: ROLES.TUTOR },
);
