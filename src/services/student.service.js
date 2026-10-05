import "server-only";
import { Types } from "mongoose";
import { StudentProfile, Booking, Grade, Favourite, TutorProfile, Course, Subject, Province } from "@/models";
import { ROLES, BOOKING_STATUS } from "@/constants";
import { NotFoundError, AuthorizationError, BusinessRuleError } from "@/lib/api/errors";
import { toPlain, compact } from "@/lib/utils/serialize";
import { isMinorByBirthYear } from "@/lib/utils/age";
import { learnerForTutor } from "@/lib/privacy/learner";
import { netTutorEarningsExpression } from "@/lib/booking/pricing";

/**
 * Child and student profiles (§5).
 *
 * Every read and write is scoped by `ownerId` loaded from the database, so a
 * parent can never reach another family's child (§8). Each learner's
 * curriculum — province, grade, subjects and courses — is checked against
 * the curriculum itself on every write, so one child's record can never
 * name another province's grade or a course that does not exist.
 */

/** What a learner's own record shows, with the curriculum names resolved. */
const PROFILE_POPULATE = [
  { path: "gradeId", select: "name level slug provinceId" },
  { path: "currentCourses", select: "name code slug gradeLevel gradeSlug subjectSlug provinceCode" },
  { path: "subjectsOfInterest", select: "name slug shortName" },
];

export async function listStudents(actor, { includeArchived = false } = {}) {
  const query = { ownerId: actor.id };
  if (!includeArchived) query.archivedAt = null;

  const students = await StudentProfile.find(query)
    .sort({ createdAt: 1 })
    .populate(PROFILE_POPULATE)
    .lean();
  return toPlain(students);
}

export async function getStudent(id, actor) {
  const student = await StudentProfile.findById(id).populate(PROFILE_POPULATE).lean();
  if (!student) throw new NotFoundError("That student profile no longer exists.");

  if (String(student.ownerId) !== String(actor.id) && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("You do not have access to this student profile.");
  }

  return toPlain(student);
}

export async function createStudent(input, actor) {
  if (actor.role !== ROLES.PARENT && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("Only parent accounts can add children.");
  }

  const curriculum = await resolveLearnerCurriculum(compact(input));

  const student = await StudentProfile.create({
    ...compact(input),
    ...curriculum,
    learningGoals: goalsFrom(input.learningGoals ?? []),
    ownerId: actor.id,
    isSelf: false,
    isMinor: isMinor(input.birthYear),
  });

  return toPlain(student);
}

export async function updateStudent(id, patch, actor) {
  const student = await StudentProfile.findById(id);
  if (!student) throw new NotFoundError("That student profile no longer exists.");

  if (String(student.ownerId) !== String(actor.id) && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("You do not have access to this student profile.");
  }

  const update = compact(patch);

  // The curriculum is re-checked as a whole whenever any part of it moves:
  // a new province can strand the grade and courses chosen under the old one.
  const touchesCurriculum = ["provinceCode", "gradeId", "currentCourses", "subjectsOfInterest"].some(
    (key) => key in update,
  );
  if (touchesCurriculum) {
    Object.assign(
      update,
      await resolveLearnerCurriculum({
        provinceCode: "provinceCode" in update ? update.provinceCode : student.provinceCode,
        gradeId: "gradeId" in update ? update.gradeId : student.gradeId,
        currentCourses: update.currentCourses ?? student.currentCourses,
        subjectsOfInterest: update.subjectsOfInterest ?? student.subjectsOfInterest,
      }),
    );
  }

  if ("learningGoals" in update) update.learningGoals = goalsFrom(update.learningGoals, student.learningGoals);
  if ("birthYear" in update) update.isMinor = isMinor(update.birthYear ?? undefined);

  // `null` clears a field; setting it undefined is what makes Mongoose unset it.
  for (const [key, value] of Object.entries(update)) {
    student.set(key, value === null ? undefined : value);
  }
  await student.save();

  return toPlain(await StudentProfile.findById(id).populate(PROFILE_POPULATE).lean());
}

/**
 * Check a learner's curriculum against the database and derive the copies
 * the record keeps (`gradeLevel`, `gradeName`). Throws a field-level error
 * for anything that does not belong to the learner's province.
 */
async function resolveLearnerCurriculum({ provinceCode, gradeId, currentCourses = [], subjectsOfInterest = [] }) {
  const out = {};
  const province = provinceCode ? await Province.findOne({ code: provinceCode }).lean() : null;
  if (provinceCode && !province) {
    throw new BusinessRuleError("Choose a province from the list.", "INVALID_PROVINCE", {
      fieldErrors: { provinceCode: "Choose a province from the list." },
    });
  }

  if (gradeId) {
    const grade = await Grade.findById(gradeId).lean();
    if (!grade || (province && String(grade.provinceId) !== String(province._id))) {
      throw new BusinessRuleError("That grade is not part of the province you chose.", "GRADE_PROVINCE_MISMATCH", {
        fieldErrors: { gradeId: "Choose a grade from this province." },
      });
    }
    out.gradeId = grade._id;
    out.gradeLevel = grade.level;
    out.gradeName = grade.name;
  } else if (gradeId === null || gradeId === undefined) {
    out.gradeLevel = undefined;
    out.gradeName = undefined;
  }

  const courseIds = [...new Set((currentCourses ?? []).map(String))];
  if (courseIds.length) {
    if (!province) {
      throw new BusinessRuleError("Choose the learner's province before their courses.", "PROVINCE_REQUIRED", {
        fieldErrors: { provinceCode: "Choose a province first." },
      });
    }
    const valid = await Course.countDocuments({
      _id: { $in: courseIds },
      provinceId: province._id,
      isActive: true,
    });
    if (valid !== courseIds.length) {
      throw new BusinessRuleError("Some of those courses aren't offered in this province.", "COURSE_PROVINCE_MISMATCH", {
        fieldErrors: { currentCourses: "Choose courses from this province's curriculum." },
      });
    }
  }
  out.currentCourses = courseIds;

  const subjectIds = [...new Set((subjectsOfInterest ?? []).map(String))];
  if (subjectIds.length) {
    const valid = await Subject.countDocuments({ _id: { $in: subjectIds }, isActive: true });
    if (valid !== subjectIds.length) {
      throw new BusinessRuleError("Choose subjects from the list.", "INVALID_SUBJECT", {
        fieldErrors: { subjectsOfInterest: "Choose subjects from the list." },
      });
    }
  }
  out.subjectsOfInterest = subjectIds;

  return out;
}

/**
 * Learning goals from the form. A goal keeps the moment it was first marked
 * achieved; unticking it clears that.
 */
function goalsFrom(input = [], existing = []) {
  const previous = new Map((existing ?? []).map((goal) => [goal.label, goal]));
  return (input ?? []).map((goal) => ({
    label: goal.label,
    targetDate: goal.targetDate ? new Date(`${goal.targetDate}T12:00:00Z`) : undefined,
    achievedAt: goal.achieved ? (previous.get(goal.label)?.achievedAt ?? new Date()) : undefined,
  }));
}

/**
 * The lesson statuses that make a learner somebody a tutor has actually
 * taught or is about to: a paid, confirmed lesson or anything after one. An
 * abandoned checkout, an expired hold or a cancelled request is not a
 * student relationship and reveals nothing (R5.12, R23.5).
 */
export const STUDENT_RELATIONSHIP_STATUSES = [
  BOOKING_STATUS.CONFIRMED,
  BOOKING_STATUS.COMPLETED,
  BOOKING_STATUS.NO_SHOW_STUDENT,
  BOOKING_STATUS.NO_SHOW_TUTOR,
  BOOKING_STATUS.DISPUTED,
];

/**
 * A tutor's roster (§23): the learners they have a real lesson relationship
 * with, what they covered, what they earned from them, and the learning
 * details the family shared for tutors they book.
 *
 * "Earned" is completed lessons only, net of anything refunded on them — the
 * tutor's share of money actually kept, not the list price of every booking
 * ever started (R23.5).
 */
export async function listTutorRoster(actor) {
  if (actor.role !== ROLES.TUTOR) throw new AuthorizationError("Only tutors have a student roster.");

  const now = new Date();
  const rows = await Booking.aggregate([
    {
      $match: {
        tutorUserId: Types.ObjectId.createFromHexString(String(actor.id)),
        status: { $in: STUDENT_RELATIONSHIP_STATUSES },
      },
    },
    {
      $group: {
        _id: "$studentProfileId",
        completed: { $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, 1, 0] } },
        upcoming: {
          $sum: {
            $cond: [{ $and: [{ $eq: ["$status", BOOKING_STATUS.CONFIRMED] }, { $gt: ["$startAt", now] }] }, 1, 0],
          },
        },
        lastLessonAt: { $max: { $cond: [{ $lt: ["$startAt", now] }, "$startAt", null] } },
        nextLessonAt: {
          $min: {
            $cond: [{ $and: [{ $eq: ["$status", BOOKING_STATUS.CONFIRMED] }, { $gt: ["$startAt", now] }] }, "$startAt", null],
          },
        },
        courses: { $addToSet: { code: "$courseCode", name: "$courseName" } },
        earningsCents: {
          $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, netTutorEarningsExpression(), 0] },
        },
      },
    },
    { $sort: { nextLessonAt: 1, lastLessonAt: -1 } },
  ]);

  const students = await StudentProfile.find({ _id: { $in: rows.map((r) => r._id) } })
    .populate("ownerId", "firstName lastName")
    .populate({ path: "currentCourses", select: "name code" })
    .lean();
  const map = new Map(students.map((student) => [String(student._id), toPlain(student)]));

  return rows
    .map((row) => {
      const raw = map.get(String(row._id));
      if (!raw) return null;
      const student = learnerForTutor(raw);
      const guardian = raw.isSelf ? null : raw.ownerId;
      return {
        id: String(row._id),
        firstName: student.firstName,
        lastName: student.lastName,
        displayName: `${student.firstName} ${student.lastName ?? ""}`.trim(),
        gradeName: student.gradeName ?? null,
        school: student.school ?? null,
        avatarUrl: student.avatarUrl ?? null,
        guardianName: guardian
          ? `${guardian.firstName ?? ""} ${(guardian.lastName ?? "").charAt(0)}${guardian.lastName ? "." : ""}`.trim()
          : null,
        learning: {
          courses: (student.currentCourses ?? []).map((c) => c.code ?? c.name),
          lessonModePreference: student.lessonModePreference ?? null,
          currentMark: student.currentMark ?? null,
          targetMark: student.targetMark ?? null,
          goals: (student.learningGoals ?? []).map((g) => ({ label: g.label, achieved: Boolean(g.achievedAt) })),
          areasForImprovement: student.areasForImprovement ?? null,
          learningPreferences: student.learningPreferences ?? null,
          notes: student.notes ?? null,
          accessibilityNeeds: student.accessibilityNeeds ?? null,
        },
        completed: row.completed,
        upcoming: row.upcoming,
        lastLessonAt: row.lastLessonAt ?? null,
        nextLessonAt: row.nextLessonAt ?? null,
        courses: (row.courses ?? []).filter((c) => c.name),
        earningsCents: Math.round(row.earningsCents ?? 0),
      };
    })
    .filter(Boolean)
    .map(toPlain);
}

/**
 * Children are archived, never hard-deleted, while lesson history exists —
 * bookings and receipts must stay intact (§35).
 */
export async function archiveStudent(id, actor) {
  const student = await StudentProfile.findById(id);
  if (!student) throw new NotFoundError("That student profile no longer exists.");

  if (String(student.ownerId) !== String(actor.id) && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("You do not have access to this student profile.");
  }
  if (student.isSelf) {
    throw new BusinessRuleError("You cannot remove your own learner profile.");
  }

  const upcoming = await Booking.countDocuments({
    studentProfileId: id,
    status: BOOKING_STATUS.CONFIRMED,
    startAt: { $gte: new Date() },
  });
  if (upcoming > 0) {
    throw new BusinessRuleError(
      `This student has ${upcoming} upcoming lesson${upcoming === 1 ? "" : "s"}. Cancel them first.`,
      "HAS_UPCOMING_BOOKINGS",
    );
  }

  student.archivedAt = new Date();
  await student.save();

  return { archived: true };
}

export async function restoreStudent(id, actor) {
  const student = await StudentProfile.findById(id);
  if (!student) throw new NotFoundError("That student profile no longer exists.");
  if (String(student.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("You do not have access to this student profile.");
  }

  student.archivedAt = null;
  await student.save();
  return toPlain(student);
}

function isMinor(birthYear) {
  // Unknown is treated as a minor until told otherwise; see lib/utils/age.
  return isMinorByBirthYear(birthYear);
}

/** Per-child lesson activity for the parent dashboard (§24). */
export async function studentSummary(id, actor) {
  await getStudent(id, actor); // authorises

  const [upcoming, completed, tutors] = await Promise.all([
    Booking.countDocuments({
      studentProfileId: id,
      status: BOOKING_STATUS.CONFIRMED,
      startAt: { $gte: new Date() },
    }),
    Booking.countDocuments({ studentProfileId: id, status: BOOKING_STATUS.COMPLETED }),
    Booking.distinct("tutorProfileId", { studentProfileId: id }),
  ]);

  return { upcoming, completed, tutorCount: tutors.length };
}

/**
 * Saved tutors (§20 favourites).
 *
 * Only tutors who can currently be booked: a profile that was suspended or
 * taken out of search would otherwise sit in the list linking to a 404
 * (R20.2). The favourite itself is kept, so a tutor who returns reappears.
 */
export async function listFavourites(actor) {
  const favourites = await Favourite.find({ userId: actor.id })
    .sort({ createdAt: -1 })
    .populate({
      path: "tutorProfileId",
      match: { isSearchable: true },
      populate: { path: "userId", select: "firstName lastName avatarUrl" },
    })
    .lean();

  return favourites.filter((f) => f.tutorProfileId);
}

export async function addFavourite({ tutorProfileId, note }, actor) {
  // The id is the client's to name, so it is checked against the database
  // rather than trusted. Without this a favourite can be stored pointing at
  // nothing: the write answers 201, `listFavourites` drops the dangling row
  // on the way out, and the saved tutor never appears — which reads as the
  // feature being broken rather than as the request having been wrong.
  const exists = await TutorProfile.exists({ _id: tutorProfileId, isSearchable: true });
  if (!exists) throw new NotFoundError("That tutor is no longer available.");

  const favourite = await Favourite.findOneAndUpdate(
    { userId: actor.id, tutorProfileId },
    { $setOnInsert: { userId: actor.id, tutorProfileId }, $set: compact({ note }) },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  ).lean();

  return toPlain(favourite);
}

export async function removeFavourite(tutorProfileId, actor) {
  await Favourite.deleteOne({ userId: actor.id, tutorProfileId });
  return { removed: true };
}

export async function isFavourite(tutorProfileId, userId) {
  if (!userId) return false;
  return Boolean(await Favourite.exists({ userId, tutorProfileId }));
}
