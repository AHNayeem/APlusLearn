import "server-only";
import { TutorRequest, TutorMatch, TutorProfile, Availability, StudentProfile, Course } from "@/models";
import {
  REQUEST_STATUS,
  MATCH_STATUS,
  NOTIFICATION_TYPES,
  PAGE_SIZES,
  ROLES,
  LESSON_MODES,
} from "@/constants";
import { NotFoundError, AuthorizationError, BusinessRuleError, ConflictError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicReference } from "@/lib/auth/tokens";
import { addDays } from "@/lib/utils/time";
import { geocode } from "@/lib/geo";
import { scoreTutorForRequest, explainMatch } from "@/lib/matching/score";
import { toPublicTutor } from "./tutor.service";
import { notify, notifyMany } from "./notification.service";

/**
 * Tutor requests and matching (§22).
 *
 * Posting a request runs the matching service immediately so the parent sees
 * suggestions right away, and notifies the top candidates so tutors can
 * express interest.
 */

const REQUEST_TTL_DAYS = 30;
const MAX_SUGGESTIONS = 20;
const NOTIFY_TOP_N = 8;

export async function createTutorRequest(input, actor) {
  const [student, course] = await Promise.all([
    StudentProfile.findById(input.studentProfileId).lean(),
    Course.findById(input.courseId).lean(),
  ]);

  if (!student) throw new NotFoundError("Choose who the lessons are for.");
  if (String(student.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("You can only post requests for your own students.");
  }
  if (!course) throw new NotFoundError("That course is no longer available.");

  const geo = input.postalCode || input.city
    ? await geocode({
        postalCode: input.postalCode,
        city: input.city,
        province: input.provinceCode ?? course.provinceCode,
      })
    : null;

  const request = await TutorRequest.create({
    reference: publicReference("REQ"),
    ownerId: actor.id,
    studentProfileId: student._id,
    courseId: course._id,
    courseName: course.name,
    courseCode: course.code,
    subjectId: course.subjectId,
    gradeLevel: course.gradeLevel,
    provinceCode: input.provinceCode ?? course.provinceCode,
    modes: input.modes,
    city: input.city ?? geo?.city,
    postalCode: input.postalCode,
    location: geo ? { type: "Point", coordinates: geo.coordinates } : undefined,
    maxDistanceKm: input.maxDistanceKm,
    preferredWindows: input.preferredWindows,
    sessionsPerWeek: input.sessionsPerWeek,
    preferredDurationMinutes: input.preferredDurationMinutes,
    budgetMinCents: input.budgetMinCents,
    budgetMaxCents: input.budgetMaxCents,
    goal: input.goal,
    startDate: input.startDate ? new Date(input.startDate) : undefined,
    notes: input.notes,
    expiresAt: addDays(new Date(), REQUEST_TTL_DAYS),
  });

  const matches = await generateMatches(request);

  return { request: toPlain(request), matchCount: matches.length };
}

/**
 * Run the matching service for a request and persist the suggestions.
 * Candidate selection is deliberately broad (subject-level) so the scorer,
 * not the query, decides relevance.
 */
export async function generateMatches(request) {
  const candidateQuery = {
    isSearchable: true,
    acceptingNewStudents: true,
    $or: [{ courseIds: request.courseId }, { subjectIds: request.subjectId }],
  };

  // In-person requests only consider tutors who can actually travel there.
  if (request.modes?.includes(LESSON_MODES.IN_PERSON) && request.location?.coordinates) {
    candidateQuery.lessonModes = { $in: request.modes };
    candidateQuery.location = {
      $geoWithin: {
        $centerSphere: [request.location.coordinates, (request.maxDistanceKm ?? 25) / 6378.1],
      },
    };
  } else if (request.modes?.length) {
    candidateQuery.lessonModes = { $in: request.modes };
  }

  const candidates = await TutorProfile.find(candidateQuery)
    .limit(200)
    .populate("userId", "firstName lastName avatarUrl")
    .lean();

  if (!candidates.length) return [];

  const availabilities = await Availability.find({
    tutorProfileId: { $in: candidates.map((c) => c._id) },
  }).lean();
  const availabilityMap = new Map(
    availabilities.map((a) => [String(a.tutorProfileId), a]),
  );

  const scored = candidates
    .map((tutor) => ({
      tutor,
      ...scoreTutorForRequest(tutor, request, availabilityMap.get(String(tutor._id))),
    }))
    // A tutor who cannot teach the subject at all is not a match.
    .filter((m) => m.breakdown.course > 0 && m.score > 25)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SUGGESTIONS);

  if (!scored.length) return [];

  await TutorMatch.bulkWrite(
    scored.map((m) => ({
      updateOne: {
        filter: { requestId: request._id, tutorProfileId: m.tutor._id },
        update: {
          $set: {
            score: m.score,
            scoreBreakdown: m.breakdown,
            distanceKm: m.distanceKm,
          },
          $setOnInsert: {
            requestId: request._id,
            tutorProfileId: m.tutor._id,
            tutorUserId: m.tutor.userId._id ?? m.tutor.userId,
            status: MATCH_STATUS.SUGGESTED,
          },
        },
        upsert: true,
      },
    })),
  );

  // Let the strongest candidates know there is work available.
  await notifyMany(
    scored.slice(0, NOTIFY_TOP_N).map((m) => m.tutor.userId._id ?? m.tutor.userId),
    {
      type: NOTIFICATION_TYPES.REQUEST_MATCHED,
      title: `New ${request.courseCode ?? request.courseName} request near you`,
      body: `${request.goal?.slice(0, 120) ?? "A family is looking for a tutor."}`,
      href: `/tutor/requests/${request._id}`,
      entityType: "TutorRequest",
      entityId: request._id,
    },
  );

  return scored;
}

export async function listRequests(actor, { status, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.bookings;
  const query = { ownerId: actor.id };
  if (status) query.status = status;

  const [items, total] = await Promise.all([
    TutorRequest.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("studentProfileId", "firstName lastName gradeName")
      .lean(),
    TutorRequest.countDocuments(query),
  ]);

  return { items: toPlain(items), total, page, pageSize: size };
}

export async function getRequest(id, actor) {
  const request = await TutorRequest.findById(id)
    .populate("studentProfileId", "firstName lastName gradeName isMinor shareFullNameWithTutor")
    .lean();
  if (!request) throw new NotFoundError("That request no longer exists.");

  const isOwner = String(request.ownerId) === String(actor.id);
  if (!isOwner && actor.role !== ROLES.ADMIN && actor.role !== ROLES.TUTOR) {
    throw new AuthorizationError("You do not have access to this request.");
  }

  return toPlain(request);
}

/** The parent's comparison view: interested tutors first, then suggestions. */
export async function listMatches(requestId, actor) {
  const request = await TutorRequest.findById(requestId).lean();
  if (!request) throw new NotFoundError("That request no longer exists.");
  if (String(request.ownerId) !== String(actor.id) && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("You do not have access to this request.");
  }

  const matches = await TutorMatch.find({ requestId })
    .sort({ status: 1, score: -1 })
    .populate({
      path: "tutorProfileId",
      populate: { path: "userId", select: "firstName lastName avatarUrl" },
    })
    .lean();

  await TutorMatch.updateMany(
    { requestId, viewedByOwnerAt: null },
    { $set: { viewedByOwnerAt: new Date() } },
  );

  return matches
    .filter((m) => m.tutorProfileId)
    .map((match) => ({
      id: String(match._id),
      status: match.status,
      score: match.score,
      scoreBreakdown: match.scoreBreakdown,
      distanceKm: match.distanceKm,
      message: match.message,
      proposedRateCents: match.proposedRateCents,
      respondedAt: match.respondedAt?.toISOString?.() ?? null,
      reasons: explainMatch(match.scoreBreakdown ?? {}, match.distanceKm),
      tutor: toPublicTutor(match.tutorProfileId, match.tutorProfileId.userId, {
        distanceKm: match.distanceKm,
      }),
    }));
}

/** Requests a tutor can respond to (§22). */
export async function listOpenRequestsForTutor(actor, { page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.bookings;
  const profile = await TutorProfile.findOne({ userId: actor.id })
    .select("_id courseIds subjectIds isSearchable")
    .lean();

  if (!profile?.isSearchable) {
    return { items: [], total: 0, page, pageSize: size, requiresApproval: true };
  }

  // Everything this tutor was matched to, plus open requests for their courses.
  const matches = await TutorMatch.find({ tutorProfileId: profile._id })
    .select("requestId status score message")
    .lean();
  const matchMap = new Map(matches.map((m) => [String(m.requestId), m]));

  const query = {
    status: REQUEST_STATUS.OPEN,
    $or: [
      { _id: { $in: matches.map((m) => m.requestId) } },
      { courseId: { $in: profile.courseIds ?? [] } },
    ],
  };

  const [items, total] = await Promise.all([
    TutorRequest.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("studentProfileId", "firstName gradeName")
      .lean(),
    TutorRequest.countDocuments(query),
  ]);

  return {
    items: toPlain(items).map((request) => {
      const match = matchMap.get(request.id);
      return {
        ...request,
        matchStatus: match?.status ?? null,
        matchScore: match?.score ?? null,
        hasResponded: Boolean(match?.message),
      };
    }),
    total,
    page,
    pageSize: size,
  };
}

export async function expressInterest(requestId, { message, proposedRateCents }, actor) {
  const [request, profile] = await Promise.all([
    TutorRequest.findById(requestId),
    TutorProfile.findOne({ userId: actor.id }).select("_id isSearchable courseIds").lean(),
  ]);

  if (!request) throw new NotFoundError("That request no longer exists.");
  if (request.status !== REQUEST_STATUS.OPEN) {
    throw new BusinessRuleError("This request is no longer open.");
  }
  if (!profile?.isSearchable) {
    throw new BusinessRuleError("Your profile must be approved before you can respond to requests.");
  }

  const existing = await TutorMatch.findOne({ requestId, tutorProfileId: profile._id });
  if (existing?.message) {
    throw new ConflictError("You have already responded to this request.");
  }

  const match = await TutorMatch.findOneAndUpdate(
    { requestId, tutorProfileId: profile._id },
    {
      $set: {
        status: MATCH_STATUS.TUTOR_INTERESTED,
        message,
        proposedRateCents,
        respondedAt: new Date(),
      },
      $setOnInsert: {
        requestId,
        tutorProfileId: profile._id,
        tutorUserId: actor.id,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  await TutorRequest.updateOne({ _id: requestId }, { $inc: { interestedCount: 1 } });

  await notify({
    userId: request.ownerId,
    type: NOTIFICATION_TYPES.REQUEST_INTEREST,
    title: "A tutor is interested in your request",
    body: message.slice(0, 140),
    href: `/requests/${requestId}`,
    entityType: "TutorRequest",
    entityId: request._id,
  });

  return toPlain(match);
}

export async function respondToMatch(matchId, { action }, actor) {
  const match = await TutorMatch.findById(matchId);
  if (!match) throw new NotFoundError("That match no longer exists.");

  const request = await TutorRequest.findById(match.requestId).lean();
  if (String(request.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("You do not have access to this request.");
  }

  match.status = action === "SHORTLIST" ? MATCH_STATUS.SHORTLISTED : MATCH_STATUS.DECLINED;
  await match.save();

  if (action === "SHORTLIST") {
    await notify({
      userId: match.tutorUserId,
      type: NOTIFICATION_TYPES.REQUEST_INTEREST,
      title: "You've been shortlisted",
      body: `A family shortlisted you for their ${request.courseCode ?? request.courseName} request.`,
      href: `/tutor/requests/${request._id}`,
      entityType: "TutorRequest",
      entityId: request._id,
    });
  }

  return toPlain(match);
}

export async function closeRequest(requestId, { reason, bookedTutorProfileId }, actor) {
  const request = await TutorRequest.findById(requestId);
  if (!request) throw new NotFoundError("That request no longer exists.");
  if (String(request.ownerId) !== String(actor.id) && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("You do not have access to this request.");
  }

  request.status = reason === "BOOKED" ? REQUEST_STATUS.MATCHED : REQUEST_STATUS.CLOSED;
  request.closedAt = new Date();
  if (bookedTutorProfileId) {
    request.bookedTutorProfileId = bookedTutorProfileId;
    await TutorMatch.updateOne(
      { requestId, tutorProfileId: bookedTutorProfileId },
      { $set: { status: MATCH_STATUS.BOOKED } },
    );
  }
  await request.save();

  return toPlain(request);
}

/** Close requests that have aged out. Safe to run repeatedly. */
export async function expireStaleRequests() {
  const result = await TutorRequest.updateMany(
    { status: REQUEST_STATUS.OPEN, expiresAt: { $lt: new Date() } },
    { $set: { status: REQUEST_STATUS.EXPIRED, closedAt: new Date() } },
  );
  return { expired: result.modifiedCount };
}
