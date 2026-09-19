import "server-only";
import {
  TutorRequest,
  TutorMatch,
  TutorProfile,
  Availability,
  StudentProfile,
  Course,
} from "@/models";
import {
  REQUEST_STATUS,
  REQUEST_VISIBILITY,
  CLOSED_REQUEST_STATUSES,
  MATCH_STATUS,
  TUTOR_CLOSED_MATCH_STATUSES,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  PAGE_SIZES,
  ROLES,
} from "@/constants";
import {
  NotFoundError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
} from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { publicReference } from "@/lib/auth/tokens";
import { addDays } from "@/lib/utils/time";
import { geocode } from "./external/geocoding-provider";
import { scoreTutorForRequest, explainMatch, compareMatches } from "@/lib/matching/score";
import {
  matchCandidateQuery,
  isEligibleForMatch,
  requestAcceptsMatches,
} from "@/lib/matching/eligibility";
import { toPublicTutor } from "./tutor.service";
import { notify, notifyMany } from "./notification.service";
import { recordAudit } from "./audit.service";
import { getSettings } from "./settings.service";

/**
 * Tutor requests and matching (§22, §41 Phase 2).
 *
 * The full request lifecycle lives here and only here: creation, editing,
 * invitation, tutor response, shortlisting, cancellation, expiry and
 * moderation. Nothing outside this module changes a request's status or a
 * match's status, which is what keeps the state machine honest.
 *
 *   OPEN ──edit──▸ OPEN            (re-runs the matcher)
 *        ──close(BOOKED)──▸ MATCHED
 *        ──close──────────▸ CLOSED
 *        ──cancel─────────▸ CANCELLED
 *        ──expiry job─────▸ EXPIRED
 *        ──moderator──────▸ REMOVED
 *
 * Every ending is terminal. A closed request gains no new matches, accepts no
 * tutor response and cannot be edited back open — `assertOpen` is the single
 * gate all of that runs through.
 */

const CANDIDATE_READ_LIMIT = 300;

// --- Reads -----------------------------------------------------------------

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

/**
 * One request, scoped to who is asking.
 *
 * A tutor sees a request only when it is open to them: public, or one they
 * were invited to. That check is here rather than in the listing, so guessing
 * an id gains nothing (§10, §36).
 */
export async function getRequest(id, actor) {
  const request = await TutorRequest.findById(id)
    .populate("studentProfileId", "firstName lastName gradeName isMinor shareFullNameWithTutor")
    .lean();
  if (!request) throw new NotFoundError("That request no longer exists.");

  if (String(request.ownerId) === String(actor.id)) return toPlain(request);
  if (actor.role === ROLES.ADMIN) return toPlain(request);

  if (actor.role === ROLES.TUTOR) {
    const match = await tutorMatchFor(request._id, actor.id);
    assertTutorMaySee(request, match);
    return toPlain(request);
  }

  throw new AuthorizationError("You do not have access to this request.");
}

/**
 * The tutor's own view of a request, with their match state attached, and the
 * view recorded once so the family can see that tutors are looking.
 */
export async function getRequestForTutor(id, actor) {
  const [request, profile] = await Promise.all([
    TutorRequest.findById(id).populate("studentProfileId", "firstName gradeName").lean(),
    tutorProfileFor(actor.id),
  ]);
  if (!request) throw new NotFoundError("That request no longer exists.");

  const match = profile
    ? await TutorMatch.findOne({ requestId: request._id, tutorProfileId: profile._id }).lean()
    : null;

  assertTutorMaySee(request, match);

  if (match && !match.viewedByTutorAt) {
    await Promise.all([
      TutorMatch.updateOne(
        { _id: match._id, viewedByTutorAt: null },
        { $set: { viewedByTutorAt: new Date() } },
      ),
      TutorRequest.updateOne({ _id: request._id }, { $inc: { viewCount: 1 } }),
    ]);
  }

  return {
    request: toPlain(request),
    match: match
      ? {
          id: String(match._id),
          status: match.status,
          score: match.score,
          message: match.message ?? null,
          proposedRateCents: match.proposedRateCents ?? null,
          respondedAt: match.respondedAt?.toISOString?.() ?? null,
          invitedAt: match.invitedAt?.toISOString?.() ?? null,
        }
      : null,
    canRespond: canTutorRespond(request, match),
  };
}

/** The family's comparison view: responses first, then suggestions. */
export async function listMatches(requestId, actor) {
  const request = await TutorRequest.findById(requestId).lean();
  if (!request) throw new NotFoundError("That request no longer exists.");
  if (String(request.ownerId) !== String(actor.id) && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("You do not have access to this request.");
  }

  const matches = await TutorMatch.find({ requestId })
    .populate({
      path: "tutorProfileId",
      populate: { path: "userId", select: "firstName lastName avatarUrl" },
    })
    .lean();

  if (String(request.ownerId) === String(actor.id)) {
    await TutorMatch.updateMany(
      { requestId, viewedByOwnerAt: null },
      { $set: { viewedByOwnerAt: new Date() } },
    );
  }

  return matches
    .filter((m) => m.tutorProfileId)
    .sort(byOwnerRelevance)
    .map((match) => ({
      id: String(match._id),
      status: match.status,
      score: match.score,
      scoreBreakdown: match.scoreBreakdown,
      distanceKm: match.distanceKm,
      message: match.message,
      proposedRateCents: match.proposedRateCents,
      respondedAt: match.respondedAt?.toISOString?.() ?? null,
      invitedAt: match.invitedAt?.toISOString?.() ?? null,
      declinedAt: match.declinedAt?.toISOString?.() ?? null,
      declineReason: match.declineReason ?? null,
      reasons: explainMatch(match.scoreBreakdown ?? {}, match.distanceKm, match.scoreWeights),
      tutor: toPublicTutor(match.tutorProfileId, match.tutorProfileId.userId, {
        distanceKm: match.distanceKm,
      }),
    }));
}

/** Tutors who answered come first; within a group, the better score wins. */
const OWNER_SORT_RANK = {
  [MATCH_STATUS.SHORTLISTED]: 0,
  [MATCH_STATUS.BOOKED]: 1,
  [MATCH_STATUS.TUTOR_INTERESTED]: 2,
  [MATCH_STATUS.INVITED]: 3,
  [MATCH_STATUS.SUGGESTED]: 4,
  [MATCH_STATUS.TUTOR_DECLINED]: 5,
  [MATCH_STATUS.WITHDRAWN]: 6,
  [MATCH_STATUS.DECLINED]: 7,
};

function byOwnerRelevance(a, b) {
  const rankA = OWNER_SORT_RANK[a.status] ?? 9;
  const rankB = OWNER_SORT_RANK[b.status] ?? 9;
  if (rankA !== rankB) return rankA - rankB;
  if ((b.score ?? 0) !== (a.score ?? 0)) return (b.score ?? 0) - (a.score ?? 0);
  return String(a._id).localeCompare(String(b._id));
}

/**
 * Requests a tutor can respond to (§22).
 *
 * Three sources, unioned: requests they were invited to, requests the matcher
 * suggested them for, and open public requests for a course they teach. An
 * INVITE_ONLY request never reaches the last two.
 */
export async function listOpenRequestsForTutor(actor, { page = 1, pageSize, status } = {}) {
  const size = pageSize ?? PAGE_SIZES.bookings;
  const profile = await tutorProfileFor(actor.id);

  if (!profile?.isSearchable) {
    return { items: [], total: 0, page, pageSize: size, requiresApproval: true };
  }

  const matches = await TutorMatch.find({ tutorProfileId: profile._id })
    .select("requestId status score message invitedAt")
    .lean();
  const matchMap = new Map(matches.map((m) => [String(m.requestId), m]));

  const query = {
    status: status ?? REQUEST_STATUS.OPEN,
    $or: [
      { _id: { $in: matches.map((m) => m.requestId) } },
      {
        visibility: REQUEST_VISIBILITY.PUBLIC,
        courseId: { $in: profile.courseIds ?? [] },
      },
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
        invitedAt: match?.invitedAt ?? null,
        hasResponded: Boolean(match?.message),
        canRespond: canTutorRespond(request, match),
      };
    }),
    total,
    page,
    pageSize: size,
  };
}

// --- Create / edit ---------------------------------------------------------

export async function createTutorRequest(input, actor) {
  const settings = await getSettings();

  const [student, course, openCount] = await Promise.all([
    StudentProfile.findById(input.studentProfileId).lean(),
    Course.findById(input.courseId).lean(),
    TutorRequest.countDocuments({ ownerId: actor.id, status: REQUEST_STATUS.OPEN }),
  ]);

  if (!student) throw new NotFoundError("Choose who the lessons are for.");
  if (String(student.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("You can only post requests for your own students.");
  }
  if (!course) throw new NotFoundError("That course is no longer available.");

  // A cap rather than a rate limit: the cost of an open request is that it
  // notifies tutors, so the bound that matters is how many can be live at once.
  const cap = settings.matching?.maxOpenRequestsPerOwner ?? 10;
  if (openCount >= cap) {
    throw new BusinessRuleError(
      `You already have ${cap} open requests. Close one before posting another.`,
      "REQUEST_LIMIT_REACHED",
    );
  }

  const geo = await resolveLocation(input, course);

  const request = await TutorRequest.create({
    reference: publicReference("REQ"),
    ownerId: actor.id,
    studentProfileId: student._id,
    title: input.title,
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
    languages: input.languages ?? [],
    minYearsExperience: input.minYearsExperience,
    preferredQualifications: input.preferredQualifications ?? [],
    urgency: input.urgency,
    visibility: input.visibility,
    goal: input.goal,
    startDate: input.startDate ? new Date(input.startDate) : undefined,
    notes: input.notes,
    expiresAt: addDays(new Date(), settings.matching?.requestTtlDays ?? 30),
  });

  const matches = await generateMatches(request, { settings });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.REQUEST_CREATED,
    entityType: "TutorRequest",
    entityId: request._id,
    metadata: { reference: request.reference, course: course.code, matches: matches.length },
  });

  return { request: toPlain(request), matchCount: matches.length };
}

/**
 * Edit an open request.
 *
 * Only the family's own description of what they need can change — never who
 * it is for, which course it is, or any of the counters and lifecycle stamps.
 * The whitelist below *is* that rule; anything not named here is not editable
 * however it arrives (§42).
 *
 * Re-running the matcher afterwards is the point: an edited budget or a new
 * set of windows that did not reach the right tutors would leave the family
 * looking at answers to a question they no longer asked.
 */
const EDITABLE_FIELDS = [
  "title",
  "modes",
  "city",
  "postalCode",
  "maxDistanceKm",
  "preferredWindows",
  "sessionsPerWeek",
  "preferredDurationMinutes",
  "budgetMinCents",
  "budgetMaxCents",
  "languages",
  "minYearsExperience",
  "preferredQualifications",
  "urgency",
  "visibility",
  "goal",
  "startDate",
  "notes",
];

export async function updateTutorRequest(id, input, actor) {
  const request = await TutorRequest.findById(id);
  if (!request) throw new NotFoundError("That request no longer exists.");
  if (String(request.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("You can only edit your own requests.");
  }
  assertOpen(request, "Only an open request can be edited.");

  const changed = [];
  for (const field of EDITABLE_FIELDS) {
    if (input[field] === undefined) continue;
    const next = field === "startDate" ? new Date(input[field]) : input[field];
    if (JSON.stringify(request[field]) === JSON.stringify(next)) continue;
    request[field] = next;
    changed.push(field);
  }

  if (!changed.length) return { request: toPlain(request), matchCount: 0, changed };

  // A new postal code or city means a new centre for every distance decision.
  if (changed.includes("postalCode") || changed.includes("city")) {
    const geo = await resolveLocation(request, { provinceCode: request.provinceCode });
    request.location = geo ? { type: "Point", coordinates: geo.coordinates } : undefined;
    if (!request.city && geo?.city) request.city = geo.city;
  }

  request.editCount += 1;
  request.lastEditedAt = new Date();
  await request.save();

  const matches = await generateMatches(request);

  // Tutors who already pitched put work into it; they are told the brief moved.
  await notifyRespondents(request, {
    type: NOTIFICATION_TYPES.REQUEST_UPDATED,
    title: "A request you answered has changed",
    body: `The family updated their ${request.courseCode ?? request.courseName} request.`,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.REQUEST_UPDATED,
    entityType: "TutorRequest",
    entityId: request._id,
    metadata: { reference: request.reference, changed },
  });

  return { request: toPlain(request), matchCount: matches.length, changed };
}

// --- Matching --------------------------------------------------------------

/**
 * Run the matcher for a request and persist the suggestions.
 *
 * Candidate selection is deliberately broad — the query narrows to tutors who
 * *could* be eligible, `isEligibleForMatch` decides whether they are, and the
 * scorer decides the order. Keeping those three apart is what stops an
 * operator's weight change from ever surfacing an ineligible tutor.
 *
 * Idempotent: re-running upserts the same rows and never resurrects a match a
 * tutor has already closed off.
 */
export async function generateMatches(request, { settings: injected } = {}) {
  if (!requestAcceptsMatches(request)) return [];

  const settings = injected ?? (await getSettings());
  const weights = settings.matchWeights;
  const minimumScore = settings.matching?.minimumScore ?? 25;
  const maxSuggestions = settings.matching?.maxSuggestions ?? 20;

  const candidates = await TutorProfile.find(matchCandidateQuery(request))
    .limit(CANDIDATE_READ_LIMIT)
    .populate("userId", "firstName lastName avatarUrl status deletedAt")
    .lean();

  if (!candidates.length) return [];

  const eligible = candidates.filter((tutor) => isEligibleForMatch(tutor, request).eligible);
  if (!eligible.length) return [];

  const availabilities = await Availability.find({
    tutorProfileId: { $in: eligible.map((c) => c._id) },
  }).lean();
  const availabilityMap = new Map(availabilities.map((a) => [String(a.tutorProfileId), a]));

  const scored = eligible
    .map((tutor) => ({
      tutor,
      ...scoreTutorForRequest(tutor, request, availabilityMap.get(String(tutor._id)), weights),
    }))
    .filter((m) => m.score >= minimumScore)
    .sort(compareMatches)
    .slice(0, maxSuggestions);

  if (!scored.length) return [];

  // A tutor who has said no is not asked again, and their row is not revived.
  const closed = await TutorMatch.find({
    requestId: request._id,
    status: { $in: TUTOR_CLOSED_MATCH_STATUSES },
  })
    .select("tutorProfileId")
    .lean();
  const closedIds = new Set(closed.map((m) => String(m.tutorProfileId)));

  const scoredAt = new Date();
  await TutorMatch.bulkWrite(
    scored.map((m) => ({
      updateOne: {
        filter: { requestId: request._id, tutorProfileId: m.tutor._id },
        update: {
          $set: {
            score: m.score,
            scoreBreakdown: m.breakdown,
            scoreWeights: m.weights,
            scoredAt,
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

  await TutorRequest.updateOne(
    { _id: request._id },
    { $set: { suggestedCount: scored.length, lastMatchedAt: scoredAt } },
  );

  // An invite-only request is not advertised: the family chooses who hears
  // about it, so the matcher's job stops at producing the shortlist to pick
  // from (§41 Phase 2, request visibility).
  if (request.visibility !== REQUEST_VISIBILITY.INVITE_ONLY) {
    const notifyTop = settings.matching?.notifyTopTutors ?? 8;
    const audience = scored
      .filter((m) => !closedIds.has(String(m.tutor._id)))
      .slice(0, notifyTop)
      .map((m) => m.tutor.userId._id ?? m.tutor.userId);

    await notifyMany(audience, {
      type: NOTIFICATION_TYPES.REQUEST_MATCHED,
      title: `New ${request.courseCode ?? request.courseName} request near you`,
      body: request.goal?.slice(0, 120) ?? "A family is looking for a tutor.",
      href: `/tutor/requests/${request._id}`,
      entityType: "TutorRequest",
      entityId: request._id,
    });
  }

  return scored;
}

/**
 * Invite named tutors to a request.
 *
 * The only way a tutor reaches an INVITE_ONLY request. Each invitation is an
 * upsert on the same unique (request, tutor) row the matcher uses, so a tutor
 * who was already suggested is promoted rather than duplicated.
 */
export async function inviteTutors(requestId, { tutorProfileIds }, actor) {
  const settings = await getSettings();
  const request = await TutorRequest.findById(requestId);
  if (!request) throw new NotFoundError("That request no longer exists.");
  if (String(request.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("You can only invite tutors to your own requests.");
  }
  assertOpen(request, "This request is no longer open.");

  const cap = settings.matching?.maxInvitesPerRequest ?? 10;
  if (request.invitedCount + tutorProfileIds.length > cap) {
    throw new BusinessRuleError(
      `You can invite up to ${cap} tutors to one request.`,
      "INVITE_LIMIT_REACHED",
    );
  }

  const tutors = await TutorProfile.find({ _id: { $in: tutorProfileIds } })
    .populate("userId", "firstName lastName status deletedAt")
    .lean();

  // An invitation cannot bypass eligibility: invite-only changes *who hears
  // about* a request, never *who is allowed to serve it* (§42).
  const invitable = tutors.filter((tutor) => isEligibleForMatch(tutor, request).eligible);
  if (!invitable.length) {
    throw new BusinessRuleError(
      "None of those tutors are available for this request right now.",
      "NO_ELIGIBLE_TUTORS",
    );
  }

  const now = new Date();
  const existing = await TutorMatch.find({
    requestId: request._id,
    tutorProfileId: { $in: invitable.map((t) => t._id) },
  })
    .select("tutorProfileId status")
    .lean();
  const existingMap = new Map(existing.map((m) => [String(m.tutorProfileId), m.status]));

  // Somebody who already answered, or already said no, is not re-invited.
  const fresh = invitable.filter((tutor) => {
    const status = existingMap.get(String(tutor._id));
    return !status || status === MATCH_STATUS.SUGGESTED;
  });
  if (!fresh.length) {
    throw new ConflictError("Those tutors have already been invited or have responded.");
  }

  await TutorMatch.bulkWrite(
    fresh.map((tutor) => ({
      updateOne: {
        filter: { requestId: request._id, tutorProfileId: tutor._id },
        update: {
          $set: { status: MATCH_STATUS.INVITED, invitedAt: now, invitedBy: actor.id },
          $setOnInsert: {
            requestId: request._id,
            tutorProfileId: tutor._id,
            tutorUserId: tutor.userId._id ?? tutor.userId,
          },
        },
        upsert: true,
      },
    })),
  );

  await TutorRequest.updateOne(
    { _id: request._id },
    { $inc: { invitedCount: fresh.length } },
  );

  await notifyMany(
    fresh.map((t) => t.userId._id ?? t.userId),
    {
      type: NOTIFICATION_TYPES.REQUEST_INVITED,
      title: "A family invited you to their request",
      body: `You have been invited to respond to a ${request.courseCode ?? request.courseName} request.`,
      href: `/tutor/requests/${request._id}`,
      entityType: "TutorRequest",
      entityId: request._id,
    },
  );

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.REQUEST_TUTOR_INVITED,
    entityType: "TutorRequest",
    entityId: request._id,
    metadata: { reference: request.reference, invited: fresh.length },
  });

  return { invited: fresh.length, skipped: tutorProfileIds.length - fresh.length };
}

// --- Tutor responses -------------------------------------------------------

export async function expressInterest(requestId, { message, proposedRateCents }, actor) {
  const [request, profile] = await Promise.all([
    TutorRequest.findById(requestId).lean(),
    tutorProfileFor(actor.id),
  ]);

  if (!request) throw new NotFoundError("That request no longer exists.");
  if (!profile?.isSearchable) {
    throw new BusinessRuleError(
      "Your profile must be approved before you can respond to requests.",
      "PROFILE_NOT_APPROVED",
    );
  }

  const existing = await TutorMatch.findOne({
    requestId: request._id,
    tutorProfileId: profile._id,
  }).lean();

  assertTutorMaySee(request, existing);
  assertOpen(request, "This request is no longer open.");

  if (existing?.message && existing.status === MATCH_STATUS.TUTOR_INTERESTED) {
    throw new ConflictError("You have already responded to this request.");
  }
  if (existing && TUTOR_CLOSED_MATCH_STATUSES.includes(existing.status)) {
    throw new BusinessRuleError(
      "You have already declined this request.",
      "MATCH_CLOSED",
    );
  }
  if (existing?.status === MATCH_STATUS.DECLINED) {
    throw new BusinessRuleError(
      "This family has already decided this is not a fit.",
      "MATCH_CLOSED",
    );
  }

  const match = await TutorMatch.findOneAndUpdate(
    { requestId: request._id, tutorProfileId: profile._id },
    {
      $set: {
        status: MATCH_STATUS.TUTOR_INTERESTED,
        message,
        proposedRateCents,
        respondedAt: new Date(),
      },
      $unset: { declinedAt: "", declineReason: "", withdrawnAt: "" },
      $setOnInsert: {
        requestId: request._id,
        tutorProfileId: profile._id,
        tutorUserId: actor.id,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  // Counted once per tutor, not once per edit of their pitch.
  if (!existing?.message) {
    await TutorRequest.updateOne({ _id: request._id }, { $inc: { interestedCount: 1 } });
  }

  await notify({
    userId: request.ownerId,
    type: NOTIFICATION_TYPES.REQUEST_INTEREST,
    title: "A tutor is interested in your request",
    body: message.slice(0, 140),
    href: `/requests/${request._id}`,
    entityType: "TutorRequest",
    entityId: request._id,
  });

  return toPlain(match);
}

/** A tutor takes back a pitch, or declines an invitation they were sent. */
export async function withdrawFromRequest(requestId, { action, reason }, actor) {
  const [request, profile] = await Promise.all([
    TutorRequest.findById(requestId).lean(),
    tutorProfileFor(actor.id),
  ]);
  if (!request) throw new NotFoundError("That request no longer exists.");
  if (!profile) throw new NotFoundError("You do not have a tutor profile.");

  const match = await TutorMatch.findOne({
    requestId: request._id,
    tutorProfileId: profile._id,
  });
  if (!match) throw new NotFoundError("You have no response to withdraw.");

  assertTutorMaySee(request, match);

  if (match.status === MATCH_STATUS.BOOKED) {
    throw new BusinessRuleError(
      "This request has already turned into a booking. Cancel the lesson instead.",
      "MATCH_BOOKED",
    );
  }
  if (TUTOR_CLOSED_MATCH_STATUSES.includes(match.status)) {
    throw new ConflictError("You have already stepped back from this request.");
  }

  const withdrawing = action === "WITHDRAW";
  const hadPitched = Boolean(match.message);

  match.status = withdrawing ? MATCH_STATUS.WITHDRAWN : MATCH_STATUS.TUTOR_DECLINED;
  match[withdrawing ? "withdrawnAt" : "declinedAt"] = new Date();
  match.declineReason = reason;
  await match.save();

  if (hadPitched) {
    await TutorRequest.updateOne(
      { _id: request._id, interestedCount: { $gt: 0 } },
      { $inc: { interestedCount: -1 } },
    );
    // Only worth telling the family about a pitch that is being taken back;
    // an unanswered suggestion going quiet is not news.
    await notify({
      userId: request.ownerId,
      type: NOTIFICATION_TYPES.REQUEST_INTEREST,
      title: "A tutor has withdrawn",
      body: `A tutor is no longer available for your ${request.courseCode ?? request.courseName} request.`,
      href: `/requests/${request._id}`,
      entityType: "TutorRequest",
      entityId: request._id,
    });
  }

  return toPlain(match);
}

// --- Owner responses -------------------------------------------------------

export async function respondToMatch(matchId, { action }, actor) {
  const match = await TutorMatch.findById(matchId);
  if (!match) throw new NotFoundError("That match no longer exists.");

  const request = await TutorRequest.findById(match.requestId).lean();
  if (!request) throw new NotFoundError("That request no longer exists.");
  if (String(request.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("You do not have access to this request.");
  }
  assertOpen(request, "This request is no longer open.");

  if (match.status === MATCH_STATUS.BOOKED) {
    throw new BusinessRuleError("This tutor is already booked.", "MATCH_BOOKED");
  }

  if (action === "SHORTLIST") {
    match.status = MATCH_STATUS.SHORTLISTED;
    match.shortlistedAt = new Date();
  } else {
    match.status = MATCH_STATUS.DECLINED;
    match.declinedAt = new Date();
  }
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

// --- Endings ---------------------------------------------------------------

export async function closeRequest(requestId, { reason, bookedTutorProfileId }, actor) {
  const request = await TutorRequest.findById(requestId);
  if (!request) throw new NotFoundError("That request no longer exists.");
  if (String(request.ownerId) !== String(actor.id) && actor.role !== ROLES.ADMIN) {
    throw new AuthorizationError("You do not have access to this request.");
  }
  assertOpen(request, "This request is already closed.");

  const booked = reason === "BOOKED";
  request.status = booked ? REQUEST_STATUS.MATCHED : REQUEST_STATUS.CLOSED;
  request.closedAt = new Date();
  request.closeReason = booked ? "BOOKED" : reason;
  if (booked) request.matchedAt = new Date();

  if (bookedTutorProfileId) {
    request.bookedTutorProfileId = bookedTutorProfileId;
    await TutorMatch.updateOne(
      { requestId: request._id, tutorProfileId: bookedTutorProfileId },
      { $set: { status: MATCH_STATUS.BOOKED, bookedAt: new Date() } },
    );
  }
  await request.save();

  await notifyRespondents(request, {
    type: NOTIFICATION_TYPES.REQUEST_CLOSED,
    title: "A request you answered has closed",
    body: `The family's ${request.courseCode ?? request.courseName} request is no longer taking responses.`,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.REQUEST_CLOSED,
    entityType: "TutorRequest",
    entityId: request._id,
    metadata: { reference: request.reference, reason: request.closeReason },
  });

  return toPlain(request);
}

export async function cancelRequest(requestId, { reason }, actor) {
  const request = await TutorRequest.findById(requestId);
  if (!request) throw new NotFoundError("That request no longer exists.");
  if (String(request.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("You can only cancel your own requests.");
  }
  assertOpen(request, "This request is already closed.");

  request.status = REQUEST_STATUS.CANCELLED;
  request.cancelledAt = new Date();
  request.closedAt = new Date();
  request.closeReason = reason;
  await request.save();

  await notifyRespondents(request, {
    type: NOTIFICATION_TYPES.REQUEST_CLOSED,
    title: "A request you answered was cancelled",
    body: `The family withdrew their ${request.courseCode ?? request.courseName} request.`,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.REQUEST_CANCELLED,
    entityType: "TutorRequest",
    entityId: request._id,
    metadata: { reference: request.reference, reason },
  });

  return toPlain(request);
}

// --- Admin moderation ------------------------------------------------------

/** Every request on the platform, for the moderation queue (§23, §28). */
export async function listAllRequests({ status, search, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  const query = {};
  if (status) query.status = status;
  if (search) {
    const term = String(search).trim();
    query.$or = [
      { reference: new RegExp(`^${term.replace(/[^\w-]/g, "")}`, "i") },
      { courseCode: term.toUpperCase() },
    ];
  }

  const [items, total] = await Promise.all([
    TutorRequest.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("ownerId", "firstName lastName email")
      .populate("studentProfileId", "firstName gradeName")
      .lean(),
    TutorRequest.countDocuments(query),
  ]);

  return { items: toPlain(items), total, page, pageSize: size };
}

/**
 * A moderator removes a request, or restores one they removed.
 *
 * Removal is a status, not a delete: the record, its matches and the reason
 * all survive so the decision can be reviewed and reversed (§23, §35).
 */
export async function moderateRequest(requestId, { action, note }, actor) {
  const request = await TutorRequest.findById(requestId);
  if (!request) throw new NotFoundError("That request no longer exists.");

  const removing = action === "REMOVE";
  if (removing && request.status === REQUEST_STATUS.REMOVED) {
    throw new ConflictError("That request has already been removed.");
  }
  if (!removing && request.status !== REQUEST_STATUS.REMOVED) {
    throw new ConflictError("That request has not been removed.");
  }

  if (removing) {
    request.status = REQUEST_STATUS.REMOVED;
    request.removedAt = new Date();
    request.removedBy = actor.id;
    request.closedAt = new Date();
  } else {
    // Restoring returns it to the board only when there is still time on it.
    const stillFresh = request.expiresAt && new Date(request.expiresAt) > new Date();
    request.status = stillFresh ? REQUEST_STATUS.OPEN : REQUEST_STATUS.EXPIRED;
    request.removedAt = undefined;
    request.removedBy = undefined;
    request.closedAt = stillFresh ? undefined : request.closedAt;
  }

  request.moderationNote = note;
  request.moderationHistory.push({
    at: new Date(),
    byId: actor.id,
    byRole: actor.role,
    action,
    note,
  });
  await request.save();

  await notify({
    userId: request.ownerId,
    type: NOTIFICATION_TYPES.REQUEST_CLOSED,
    title: removing ? "Your tutor request was removed" : "Your tutor request was restored",
    body: note?.slice(0, 200) ?? undefined,
    href: `/requests/${request._id}`,
    entityType: "TutorRequest",
    entityId: request._id,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.REQUEST_MODERATED,
    entityType: "TutorRequest",
    entityId: request._id,
    metadata: { reference: request.reference, action, note },
  });

  return toPlain(request);
}

// --- Scheduled work --------------------------------------------------------

/**
 * Close requests that have aged out, and warn the ones about to (§28).
 *
 * Both halves are claim-then-act, so the job is safe to run twice at once and
 * a family is never warned about the same request more than once.
 */
export async function expireStaleRequests({ now = new Date() } = {}) {
  const settings = await getSettings();

  const due = await TutorRequest.find({
    status: REQUEST_STATUS.OPEN,
    expiresAt: { $lt: now },
  })
    .select("_id ownerId reference courseCode courseName")
    .limit(500)
    .lean();

  let expired = 0;
  for (const request of due) {
    const claimed = await TutorRequest.updateOne(
      { _id: request._id, status: REQUEST_STATUS.OPEN },
      { $set: { status: REQUEST_STATUS.EXPIRED, closedAt: now } },
    );
    if (!claimed.modifiedCount) continue;
    expired += 1;

    await notify({
      userId: request.ownerId,
      type: NOTIFICATION_TYPES.REQUEST_CLOSED,
      title: "Your tutor request has expired",
      body: `Your ${request.courseCode ?? request.courseName} request closed after no booking was made. You can post it again at any time.`,
      href: "/requests",
      entityType: "TutorRequest",
      entityId: request._id,
    });
  }

  const warned = await warnExpiringRequests({ now, settings });

  if (expired) {
    await recordAudit({
      actor: { role: "SYSTEM" },
      action: AUDIT_ACTIONS.REQUEST_EXPIRED,
      entityType: "TutorRequest",
      metadata: { expired },
    });
  }

  return { expired, warned, examined: due.length };
}

async function warnExpiringRequests({ now, settings }) {
  const leadDays = settings.matching?.requestExpiryWarningDays ?? 3;
  if (leadDays <= 0) return 0;

  const horizon = addDays(now, leadDays);
  const soon = await TutorRequest.find({
    status: REQUEST_STATUS.OPEN,
    expiryWarnedAt: null,
    expiresAt: { $gt: now, $lte: horizon },
  })
    .select("_id ownerId reference courseCode courseName expiresAt")
    .limit(500)
    .lean();

  let warned = 0;
  for (const request of soon) {
    // Claiming the stamp first is what makes the warning exactly-once.
    const claimed = await TutorRequest.updateOne(
      { _id: request._id, expiryWarnedAt: null },
      { $set: { expiryWarnedAt: now } },
    );
    if (!claimed.modifiedCount) continue;
    warned += 1;

    await notify({
      userId: request.ownerId,
      type: NOTIFICATION_TYPES.REQUEST_EXPIRING,
      title: "Your tutor request is about to expire",
      body: `Your ${request.courseCode ?? request.courseName} request closes soon. Shortlist a tutor or post it again to keep it open.`,
      href: `/requests/${request._id}`,
      entityType: "TutorRequest",
      entityId: request._id,
    });
  }

  return warned;
}

// --- Shared rules ----------------------------------------------------------

function assertOpen(request, message) {
  if (CLOSED_REQUEST_STATUSES.includes(request.status)) {
    throw new BusinessRuleError(message, "REQUEST_CLOSED");
  }
}

/**
 * Whether this tutor is allowed to know this request exists.
 *
 * A removed request is invisible to tutors whatever their match state, and an
 * invite-only request is visible only to someone the family actually named.
 */
function assertTutorMaySee(request, match) {
  if (request.status === REQUEST_STATUS.REMOVED) {
    throw new NotFoundError("That request no longer exists.");
  }
  if (request.visibility !== REQUEST_VISIBILITY.INVITE_ONLY) return;

  const invited =
    match &&
    [
      MATCH_STATUS.INVITED,
      MATCH_STATUS.TUTOR_INTERESTED,
      MATCH_STATUS.SHORTLISTED,
      MATCH_STATUS.BOOKED,
      MATCH_STATUS.TUTOR_DECLINED,
      MATCH_STATUS.WITHDRAWN,
      MATCH_STATUS.DECLINED,
    ].includes(match.status);

  if (!invited) throw new NotFoundError("That request no longer exists.");
}

function canTutorRespond(request, match) {
  if (CLOSED_REQUEST_STATUSES.includes(request.status)) return false;
  if (!match) return request.visibility !== REQUEST_VISIBILITY.INVITE_ONLY;
  if (TUTOR_CLOSED_MATCH_STATUSES.includes(match.status)) return false;
  if ([MATCH_STATUS.DECLINED, MATCH_STATUS.BOOKED].includes(match.status)) return false;
  return !match.message;
}

function tutorProfileFor(userId) {
  return TutorProfile.findOne({ userId })
    .select("_id courseIds subjectIds isSearchable status")
    .lean();
}

function tutorMatchFor(requestId, tutorUserId) {
  return TutorMatch.findOne({ requestId, tutorUserId }).select("status").lean();
}

/** Tell every tutor who actually pitched that something changed. */
async function notifyRespondents(request, payload) {
  const respondents = await TutorMatch.find({
    requestId: request._id,
    status: {
      $in: [MATCH_STATUS.TUTOR_INTERESTED, MATCH_STATUS.SHORTLISTED, MATCH_STATUS.INVITED],
    },
  })
    .select("tutorUserId")
    .lean();

  if (!respondents.length) return;

  await notifyMany(
    respondents.map((m) => m.tutorUserId),
    {
      ...payload,
      href: `/tutor/requests/${request._id}`,
      entityType: "TutorRequest",
      entityId: request._id,
    },
  );
}

/** Resolve a postal code or city to the coarse centroid used for distance. */
async function resolveLocation(input, course) {
  if (!input.postalCode && !input.city) return null;
  return geocode({
    postalCode: input.postalCode,
    city: input.city,
    province: input.provinceCode ?? course?.provinceCode,
  });
}
