import "server-only";
import { StudentProfile, Booking, Grade, Favourite, TutorProfile } from "@/models";
import { ROLES, BOOKING_STATUS } from "@/constants";
import { NotFoundError, AuthorizationError, BusinessRuleError } from "@/lib/api/errors";
import { toPlain, compact } from "@/lib/utils/serialize";

/**
 * Child and student profiles (§5).
 *
 * Every read and write is scoped by `ownerId` loaded from the database, so a
 * parent can never reach another family's child (§8).
 */

export async function listStudents(actor, { includeArchived = false } = {}) {
  const query = { ownerId: actor.id };
  if (!includeArchived) query.archivedAt = null;

  const students = await StudentProfile.find(query).sort({ createdAt: 1 }).lean();
  return toPlain(students);
}

export async function getStudent(id, actor) {
  const student = await StudentProfile.findById(id).populate("gradeId", "name level slug").lean();
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

  const grade = input.gradeId ? await Grade.findById(input.gradeId).lean() : null;

  const student = await StudentProfile.create({
    ...compact(input),
    ownerId: actor.id,
    isSelf: false,
    isMinor: isMinor(input.birthYear),
    gradeLevel: grade?.level,
    gradeName: grade?.name,
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

  if (update.gradeId) {
    const grade = await Grade.findById(update.gradeId).lean();
    if (grade) {
      update.gradeLevel = grade.level;
      update.gradeName = grade.name;
    }
  }
  if (update.birthYear !== undefined) update.isMinor = isMinor(update.birthYear);

  Object.assign(student, update);
  await student.save();

  return toPlain(student);
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
  if (!birthYear) return true; // assume a minor until told otherwise
  return new Date().getFullYear() - birthYear < 18;
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

/** Saved tutors (§20 favourites). */
export async function listFavourites(actor) {
  const favourites = await Favourite.find({ userId: actor.id })
    .sort({ createdAt: -1 })
    .populate({
      path: "tutorProfileId",
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
  const exists = await TutorProfile.exists({ _id: tutorProfileId });
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
