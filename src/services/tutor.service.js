import "server-only";
import { Types } from "mongoose";
import {
  TutorProfile,
  TutorApplication,
  User,
  Course,
  Availability,
  Review,
  Booking,
  VerificationDocument,
} from "@/models";
import {
  TUTOR_STATUS,
  USER_STATUS,
  REVIEW_STATUS,
  BOOKING_STATUS,
  VERIFICATION_TYPES,
  AUDIT_ACTIONS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  PAGE_SIZES,
  EMAIL_CATEGORIES,
} from "@/constants";
import { NotFoundError, BusinessRuleError, ConflictError } from "@/lib/api/errors";
import { toPlain, compact } from "@/lib/utils/serialize";
import { slugify } from "@/lib/utils/slug";
import { escapeRegex } from "@/lib/security/sanitize";
import { publicName, formatMoney } from "@/lib/utils/format";
import { rateForCourse } from "@/lib/booking/pricing";
import { geocode } from "./external/geocoding-provider";
import { ONBOARDING_STEPS } from "@/models/TutorApplication";
import { sendEmail, brandedEmailTemplates } from "./external/email-provider";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";
import { refreshCourseTutorCounts, activeProvinceCodes } from "./curriculum.service";
import { getSettings } from "./settings.service";
import {
  approveBadge, markEducationVerified, openVerificationRecords, listVerificationRecords,
} from "./verification.service";
import { STUDENT_RELATIONSHIP_STATUSES } from "./student.service";
import { rebuildTaughtCourses, flattenTaughtCourses } from "@/lib/curriculum/taught";

/**
 * Tutor profiles, onboarding and the approval gate (§15, §16, §17).
 *
 * The single most important invariant here: `isSearchable` is derived, never
 * set by a client, and is only ever true for an APPROVED, complete profile.
 */

// --- Public reads ----------------------------------------------------------

/**
 * Shape a tutor for public consumption. Surnames, exact coordinates and
 * internal notes never cross this boundary (§15, §42).
 */
export function toPublicTutor(profile, user, { distanceKm } = {}) {
  const owner = user ?? profile.userId ?? {};
  return {
    id: String(profile._id ?? profile.id),
    slug: profile.slug,
    displayName: publicName(owner.firstName ?? "", owner.lastName ?? ""),
    firstName: owner.firstName,
    avatarUrl: owner.avatarUrl ?? null,
    headline: profile.headline,
    bio: profile.bio,
    introVideoUrl: profile.introVideoUrl ?? null,
    gallery: profile.gallery ?? [],

    // Approximate location only — city level, never an address.
    city: profile.city,
    province: profile.province,
    distanceKm: distanceKm ?? null,
    travelRadiusKm: profile.travelRadiusKm,

    lessonModes: profile.lessonModes ?? [],
    onlineMeetingProviders: profile.onlineMeetingProviders ?? [],
    inPersonLocationTypes: profile.inPersonLocationTypes ?? [],

    hourlyRateCents: profile.hourlyRateCents,
    minHourlyRateCents: profile.minHourlyRateCents ?? profile.hourlyRateCents,
    offersFreeIntro: profile.offersFreeIntro ?? false,
    trialRateCents: profile.trialRateCents ?? null,

    courses: (profile.courses ?? []).map((c) => ({
      courseId: String(c.courseId),
      code: c.code,
      name: c.name,
      subjectSlug: c.subjectSlug,
      gradeLevel: c.gradeLevel,
      hourlyRateCents: c.hourlyRateCents ?? profile.hourlyRateCents,
      yearsTeaching: c.yearsTeaching ?? 0,
    })),

    education: (profile.education ?? []).map((e) => ({
      institution: e.institution,
      credential: e.credential,
      fieldOfStudy: e.fieldOfStudy,
      startYear: e.startYear,
      endYear: e.endYear,
      inProgress: e.inProgress,
      verified: e.verified,
    })),
    // Sub-documents keep an ObjectId `_id`; mapping the fields the profile
    // actually shows keeps this object plain enough to cross to a Client
    // Component (see `toPlain` — a lean() read does not convert these).
    experience: (profile.experience ?? []).map((e) => ({
      title: e.title,
      organisation: e.organisation,
      startYear: e.startYear,
      endYear: e.endYear,
      current: e.current,
      description: e.description,
    })),
    qualifications: profile.qualifications ?? [],
    yearsExperience: profile.yearsExperience ?? 0,
    languages: profile.languages ?? [],

    verifiedTypes: profile.verifiedTypes ?? [],
    stats: {
      ratingAverage: profile.stats?.ratingAverage ?? 0,
      ratingCount: profile.stats?.ratingCount ?? 0,
      ratingKnowledge: profile.stats?.ratingKnowledge ?? 0,
      ratingCommunication: profile.stats?.ratingCommunication ?? 0,
      ratingReliability: profile.stats?.ratingReliability ?? 0,
      ratingTeaching: profile.stats?.ratingTeaching ?? 0,
      completedLessons: profile.stats?.completedLessons ?? 0,
      totalStudents: profile.stats?.totalStudents ?? 0,
      responseTimeMinutes: profile.stats?.responseTimeMinutes ?? null,
    },

    nextAvailableAt: profile.nextAvailableAt ?? null,
    acceptingNewStudents: profile.acceptingNewStudents ?? true,
    timeZone: profile.timeZone,
  };
}

/**
 * Attach the weekdays each tutor teaches on (0 = Sunday), so a search card can
 * show a MON–SUN strip without a query per card. Weekly rules only — one-off
 * exceptions are a calendar detail, not a signal for a summary card.
 */
export async function attachAvailableWeekdays(tutors) {
  if (!tutors.length) return tutors;

  const docs = await Availability.find({ tutorProfileId: { $in: tutors.map((t) => t.id) } })
    .select("tutorProfileId weeklyRules")
    .lean();

  const byTutor = new Map(
    docs.map((doc) => [
      String(doc.tutorProfileId),
      [...new Set((doc.weeklyRules ?? []).map((rule) => rule.weekday))].sort((a, b) => a - b),
    ]),
  );

  return tutors.map((tutor) => ({
    ...tutor,
    availableWeekdays: byTutor.get(tutor.id) ?? [],
  }));
}

export async function getPublicTutorBySlug(slug) {
  const profile = await TutorProfile.findOne({ slug, isSearchable: true })
    .populate("userId", "firstName lastName avatarUrl")
    .lean();
  if (!profile) return null;
  return toPublicTutor(profile, profile.userId);
}

export async function getPublicTutorById(id) {
  const profile = await TutorProfile.findOne({ _id: id, isSearchable: true })
    .populate("userId", "firstName lastName avatarUrl")
    .lean();
  if (!profile) return null;
  return toPublicTutor(profile, profile.userId);
}

/** Reviews shown on a public profile (§23). */
export async function listTutorReviews(tutorProfileId, { page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.reviews;
  const query = { tutorProfileId, status: REVIEW_STATUS.PUBLISHED };

  const [items, total] = await Promise.all([
    Review.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("authorId", "firstName lastName")
      .lean(),
    Review.countDocuments(query),
  ]);

  return {
    items: toPlain(items).map((review) => ({
      id: review.id,
      rating: review.rating,
      knowledge: review.knowledge,
      communication: review.communication,
      reliability: review.reliability,
      teaching: review.teaching,
      title: review.title,
      body: review.body,
      courseCode: review.courseCode,
      courseName: review.courseName,
      isVerified: review.isVerified,
      tutorReply: review.tutorReply,
      tutorRepliedAt: review.tutorRepliedAt,
      createdAt: review.createdAt,
      // Reviewers are shown as "Priya S." — never a full surname.
      authorName: publicName(review.authorId?.firstName ?? "A", review.authorId?.lastName ?? ""),
    })),
    total,
    page,
    pageSize: size,
  };
}

// --- Owner reads -----------------------------------------------------------

export async function getTutorProfileByUserId(userId) {
  const profile = await TutorProfile.findOne({ userId })
    .populate("userId", "firstName lastName email avatarUrl phone timeZone")
    .lean();
  return profile ? toPlain(profile) : null;
}

export async function requireTutorProfile(userId) {
  const profile = await getTutorProfileByUserId(userId);
  if (!profile) {
    throw new NotFoundError("Finish your tutor onboarding before using this.");
  }
  return profile;
}

/**
 * The signed-in tutor's own verification records — before submission too
 * (R13.11). Keyed by the profile, or by the profile id reserved on their
 * application when the first document was uploaded; an applicant who has
 * uploaded nothing yet gets the blank list.
 */
export async function listOwnVerification(userId) {
  const profile = await TutorProfile.findOne({ userId }).select("_id").lean();
  const profileId =
    profile?._id ?? (await TutorApplication.findOne({ userId }).select("tutorProfileId").lean())?.tutorProfileId;
  return listVerificationRecords(profileId ?? null);
}

/**
 * The saved courses of an application, as the picker shows them — code,
 * name, grade, subject and province — so a returning applicant sees what
 * they chose rather than a list of ids.
 */
export async function applicationCourseDetails(application) {
  const ids = (application?.data?.COURSES?.courses ?? []).map((c) => c.courseId);
  if (!ids.length) return [];
  const docs = await Course.find({ _id: { $in: ids } })
    .select("code name gradeLevel gradeSlug subjectName subjectSlug provinceCode stream isActive")
    .lean();
  return toPlain(docs);
}

// --- Onboarding (§17) ------------------------------------------------------

export async function getOrCreateApplication(userId) {
  let application = await TutorApplication.findOne({ userId }).lean();
  if (!application) {
    application = (await TutorApplication.create({ userId })).toObject();
  }
  return toPlain(application);
}

/**
 * Persist one step of the wizard. Steps validate independently so a tutor can
 * save progress and come back, but submission re-checks everything.
 */
export async function saveOnboardingStep(userId, { step, data }) {
  const application = await TutorApplication.findOne({ userId });
  if (!application) throw new NotFoundError("Start your tutor application first.");

  if (
    application.status === TUTOR_STATUS.PENDING_REVIEW ||
    application.status === TUTOR_STATUS.APPROVED
  ) {
    throw new BusinessRuleError(
      "Your application is with our team. Edit your profile from the dashboard instead.",
      "APPLICATION_LOCKED",
    );
  }

  // The rules a step's schema cannot know: which courses are offered today,
  // and the platform's current rate range (R13.6, R13.9).
  if (step === "COURSES") {
    await loadTeachableCourses(data.courses ?? []);
    assertRatesWithinPolicy({ courses: data.courses }, await ratePolicy());
  }
  if (step === "PRICING") {
    assertRatesWithinPolicy({ hourlyRateCents: data.hourlyRateCents }, await ratePolicy());
  }

  application.data = { ...(application.data ?? {}), [step]: data };
  if (!application.completedSteps.includes(step)) application.completedSteps.push(step);

  const index = ONBOARDING_STEPS.indexOf(step);
  const next = ONBOARDING_STEPS[index + 1];
  if (next) application.currentStep = next;

  // A tutor answering an information request moves back to DRAFT.
  if (application.status === TUTOR_STATUS.INFO_REQUESTED) {
    application.status = TUTOR_STATUS.DRAFT;
  }

  application.markModified("data");
  await application.save();

  return toPlain(application);
}

/**
 * Submit for review. This materialises (or updates) the TutorProfile in
 * PENDING_REVIEW — visible to admins, invisible to search.
 */
export async function submitApplication(userId) {
  const application = await TutorApplication.findOne({ userId });
  if (!application) throw new NotFoundError("Start your tutor application first.");

  if (
    application.status === TUTOR_STATUS.PENDING_REVIEW ||
    application.status === TUTOR_STATUS.APPROVED
  ) {
    throw new BusinessRuleError(
      "Your application is already with our team.",
      "APPLICATION_LOCKED",
    );
  }

  const required = ONBOARDING_STEPS.filter((s) => s !== "REVIEW");
  const missing = required.filter((step) => !application.completedSteps.includes(step));
  if (missing.length) {
    throw new BusinessRuleError(
      `Finish these steps before submitting: ${missing.join(", ")}.`,
      "INCOMPLETE_APPLICATION",
    );
  }

  const user = await User.findById(userId);
  if (!user) throw new NotFoundError("We couldn't find your account.");

  // The photo is part of the profile (§13, R13.2). It is uploaded through the
  // account's own avatar endpoint, so the check is on the account.
  if (!user.avatarUrl) {
    throw new BusinessRuleError(
      "Add a profile photo before submitting — families want to see who they are booking.",
      "PHOTO_REQUIRED",
      { fieldErrors: { photo: ["Add a profile photo."] } },
    );
  }

  const profile = await materialiseProfile(user, application);

  application.status = TUTOR_STATUS.PENDING_REVIEW;
  application.submittedAt = new Date();
  application.tutorProfileId = profile._id;
  await application.save();

  // Badges asked for, and any the applicant uploaded evidence for inside the
  // wizard, now go to the verification queue (R13.11).
  await openVerificationRecords(profile, application.data?.DOCUMENTS?.requestedBadges ?? []);

  // Through `sendEmail`, not the provider directly: that is where the platform
  // notification switches are applied and where a provider outage is absorbed
  // instead of failing a submitted application (§26, §28).
  await sendEmail(
    {
      to: user.email,
      ...(await brandedEmailTemplates()).applicationSubmitted({ firstName: user.firstName }),
    },
    { category: EMAIL_CATEGORIES.APPLICATION },
  );

  await notify({
    userId,
    type: NOTIFICATION_TYPES.APPLICATION_SUBMITTED,
    title: "Application submitted",
    body: "Our team reviews tutor applications within two business days.",
    href: "/tutor/verification",
    entityType: "TutorApplication",
    entityId: application._id,
  });

  await recordAudit({
    actor: user,
    action: AUDIT_ACTIONS.TUTOR_APPLICATION_SUBMITTED,
    entityType: "TutorProfile",
    entityId: profile._id,
  });

  return toPlain(application);
}

/** Build the profile document from the wizard's saved answers. */
async function materialiseProfile(user, application) {
  const d = application.data ?? {};
  // Re-checked at submission: a course can be withdrawn, or the rate range
  // tightened, between the step being saved and the application being sent.
  const courseMap = await loadTeachableCourses(d.COURSES?.courses ?? []);
  const courses = rebuildTaughtCourses(d.COURSES?.courses ?? [], courseMap);
  assertRatesWithinPolicy(
    { hourlyRateCents: d.PRICING?.hourlyRateCents, courses: d.COURSES?.courses },
    await ratePolicy(),
  );

  const geo = await geocode({
    postalCode: d.LOCATION?.postalCode,
    city: d.LOCATION?.city,
    province: d.LOCATION?.province,
  });

  const hourlyRateCents = d.PRICING?.hourlyRateCents;
  const rates = [hourlyRateCents, ...courses.map((c) => c.hourlyRateCents).filter(Boolean)];
  const existing = await TutorProfile.findOne({ userId: user._id });

  const payload = compact({
    userId: user._id,
    headline: d.PROFILE?.headline,
    bio: d.PROFILE?.bio,
    introVideoUrl: d.PROFILE?.introVideoUrl,
    languages: d.PROFILE?.languages,

    // A resubmission keeps an administrator's "verified" mark on an entry
    // the tutor did not change (R10.11).
    education: carryEducationVerification(existing?.education, d.EDUCATION?.education ?? []),
    experience: d.QUALIFICATIONS?.experience ?? [],
    qualifications: d.QUALIFICATIONS?.qualifications ?? [],
    octNumber: d.QUALIFICATIONS?.octNumber,
    otherCredentials: d.QUALIFICATIONS?.otherCredentials ?? [],
    yearsExperience: d.QUALIFICATIONS?.yearsExperience ?? 0,

    courses,
    ...flattenTaughtCourses(courses),

    lessonModes: d.LESSON_TYPE?.lessonModes,
    onlineMeetingProviders: d.LESSON_TYPE?.onlineMeetingProviders ?? [],
    inPersonLocationTypes: d.LESSON_TYPE?.inPersonLocationTypes ?? [],

    city: d.LOCATION?.city,
    province: d.LOCATION?.province,
    postalCodePrefix: d.LOCATION?.postalCode?.slice(0, 3),
    // Only a place the geocoder actually found (R29.1) — see below for the
    // update case, where a stale one has to be removed.
    location: geo ? { type: "Point", coordinates: geo.coordinates } : undefined,
    travelRadiusKm: d.LOCATION?.travelRadiusKm ?? 15,

    hourlyRateCents,
    minHourlyRateCents: Math.min(...rates),
    offersFreeIntro: d.PRICING?.offersFreeIntro ?? false,
    trialRateCents: d.PRICING?.trialRateCents,
    acceptingNewStudents: d.PRICING?.acceptingNewStudents ?? true,

    timeZone: d.PERSONAL?.timeZone ?? "America/Toronto",
    status: TUTOR_STATUS.PENDING_REVIEW,
    // Explicitly not searchable until an admin approves (§42).
    isSearchable: false,
  });

  let profile;

  if (existing) {
    Object.assign(existing, payload);
    if (!geo) existing.location = undefined;
    profile = await existing.save();
  } else {
    profile = await TutorProfile.create({
      ...payload,
      // The id reserved when the applicant first uploaded a document, so
      // those documents are this profile's from the start (R13.11).
      ...(application.tutorProfileId ? { _id: application.tutorProfileId } : {}),
      slug: await uniqueSlug(user),
    });
  }

  // Personal details from step 1 belong on the user record.
  await User.updateOne(
    { _id: user._id },
    {
      $set: compact({
        firstName: d.PERSONAL?.firstName,
        lastName: d.PERSONAL?.lastName,
        phone: d.PERSONAL?.phone,
        timeZone: d.PERSONAL?.timeZone,
        city: d.LOCATION?.city,
        province: d.LOCATION?.province,
        // No `avatarUrl` — the photo is uploaded, not declared. `avatar` on
        // the user record is written by `uploadAvatar` alone (§16).
      }),
    },
  );

  await upsertAvailability(profile, d.AVAILABILITY, d.PERSONAL?.timeZone);

  return profile;
}

async function uniqueSlug(user) {
  const base = slugify(`${user.firstName}-${user.lastName?.charAt(0) ?? ""}`) || "tutor";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 8);
    const candidate = `${base}-${suffix}`;
    const taken = await TutorProfile.exists({ slug: candidate });
    if (!taken) return candidate;
  }
  return `tutor-${Date.now().toString(36)}`;
}

async function upsertAvailability(profile, availabilityData, timeZone) {
  if (!availabilityData?.weeklyRules?.length) return;
  await Availability.findOneAndUpdate(
    { tutorProfileId: profile._id },
    {
      $set: {
        userId: profile.userId,
        timeZone: timeZone ?? profile.timeZone ?? "America/Toronto",
        weeklyRules: availabilityData.weeklyRules,
        bufferMinutes: availabilityData.bufferMinutes ?? 0,
        slotIncrementMinutes: availabilityData.slotIncrementMinutes ?? 30,
        minNoticeHours: availabilityData.minNoticeHours ?? 4,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
}

/**
 * The courses a tutor may list (R6.5, R13.6): each id must name a course that
 * exists, is switched on, and belongs to a province that is live. The client
 * picked from the same public lists, but the server does not take its word
 * for it. Returns the course map the taught-course copies are built from.
 */
async function loadTeachableCourses(entries = []) {
  const ids = entries.map((entry) => String(entry.courseId));
  const refuse = (message) => {
    throw new BusinessRuleError(message, "COURSE_UNAVAILABLE", { fieldErrors: { courses: [message] } });
  };

  if (new Set(ids).size !== ids.length) refuse("Each course can only be added once.");

  const [docs, liveProvinces] = await Promise.all([
    Course.find({ _id: { $in: ids } }).lean(),
    activeProvinceCodes(),
  ]);
  const live = new Set(liveProvinces);
  const courseMap = new Map(
    docs.filter((c) => c.isActive && live.has(c.provinceCode)).map((c) => [String(c._id), c]),
  );

  if (ids.some((id) => !courseMap.has(id))) {
    refuse("One of the courses you chose is not offered any more. Remove it and choose again.");
  }
  return courseMap;
}

/** The platform's hourly-rate range, from settings (R13.9), in cents. */
async function ratePolicy() {
  const { minHourlyRate, maxHourlyRate } = await getSettings();
  return { minCents: minHourlyRate * 100, maxCents: maxHourlyRate * 100 };
}

/**
 * Every rate a tutor sets — the standard one and each per-course override —
 * sits inside the configured range. One check for onboarding, submission and
 * later edits, so an edit cannot do what the wizard refused.
 */
function assertRatesWithinPolicy({ hourlyRateCents, courses = [] }, { minCents, maxCents }) {
  const range = `between ${formatMoney(minCents)} and ${formatMoney(maxCents)} an hour`;
  const outside = (cents) => cents < minCents || cents > maxCents;
  const fieldErrors = {};

  if (hourlyRateCents !== undefined && hourlyRateCents !== null && outside(hourlyRateCents)) {
    fieldErrors.hourlyRateCents = [`Set a rate ${range}.`];
  }
  if ((courses ?? []).some((c) => c.hourlyRateCents != null && outside(c.hourlyRateCents))) {
    fieldErrors.courses = [`Course rates must also be ${range}.`];
  }

  if (Object.keys(fieldErrors).length) {
    throw new BusinessRuleError(`Rates must be ${range}.`, "RATE_OUT_OF_RANGE", { fieldErrors });
  }
}

/**
 * Keep an administrator's "verified" mark on education entries the tutor
 * did not change (R10.11). The tutor's own payload never carries the flag —
 * the schema strips it — so an edited entry is unverified until checked again.
 */
function carryEducationVerification(previous = [], next = []) {
  const key = (entry) =>
    [entry.institution, entry.credential, entry.fieldOfStudy ?? "", entry.endYear ?? ""]
      .map((value) => String(value).trim().toLowerCase())
      .join("|");
  const verified = new Set((previous ?? []).filter((entry) => entry.verified).map(key));
  return next.map((entry) => ({ ...entry, verified: verified.has(key(entry)) }));
}

// --- Profile editing (approved tutors) -------------------------------------

export async function updateTutorProfile(userId, patch) {
  const profile = await TutorProfile.findOne({ userId });
  if (!profile) throw new NotFoundError("Finish your tutor onboarding first.");

  const update = compact(patch);

  // The same range the wizard enforced, on the standard rate and on every
  // per-course override (R13.9).
  assertRatesWithinPolicy(
    { hourlyRateCents: update.hourlyRateCents, courses: update.courses },
    await ratePolicy(),
  );

  if (update.courses) {
    const courseMap = await loadTeachableCourses(update.courses);
    const courses = rebuildTaughtCourses(update.courses, courseMap);

    if (!courses.length) {
      throw new BusinessRuleError("Keep at least one valid course on your profile.");
    }

    update.courses = courses;
    Object.assign(update, flattenTaughtCourses(courses));
  }

  if (update.education) {
    update.education = carryEducationVerification(profile.education, update.education);
  }

  // An OCT badge vouches for one registration number. Changing the number
  // under it would carry the badge onto something nobody checked.
  if (
    update.octNumber !== undefined &&
    update.octNumber !== profile.octNumber &&
    profile.verifiedTypes?.includes(VERIFICATION_TYPES.OCT)
  ) {
    throw new BusinessRuleError(
      "Your OCT number is verified. Contact support to change it, so the badge can be checked again.",
      "OCT_VERIFIED",
      { fieldErrors: { octNumber: ["A verified OCT number cannot be changed here."] } },
    );
  }

  // Re-geocode only when the place actually changed — the edit form resends
  // the city on every save, and re-resolving an unchanged city would replace
  // a postal-code centroid with a coarser city one. A place that no longer
  // resolves removes the old coordinates rather than keeping a stale point
  // (R29.1).
  const placeChanged =
    update.postalCode ||
    (update.city && update.city !== profile.city) ||
    (update.province && update.province !== profile.province);
  let geo = null;
  if (placeChanged) {
    geo = await geocode({
      postalCode: update.postalCode,
      city: update.city ?? profile.city,
      province: update.province ?? profile.province,
    });
    if (update.postalCode) update.postalCodePrefix = update.postalCode.slice(0, 3);
  }
  delete update.postalCode;

  Object.assign(profile, update);
  if (placeChanged) {
    profile.location = geo ? { type: "Point", coordinates: geo.coordinates } : undefined;
  }

  // Keep the derived cheapest rate in step with any rate change.
  const rates = [
    profile.hourlyRateCents,
    ...(profile.courses ?? []).map((c) => c.hourlyRateCents).filter(Boolean),
  ];
  profile.minHourlyRateCents = Math.min(...rates);

  // Search eligibility is derived, never carried over. An edit that strips
  // the profile back below the bar has to take it out of search on the same
  // write, and an edit can never put an unapproved profile into search (§16,
  // §42) — approval is checked from the stored status, not from the patch.
  const owner = await User.findById(userId).select("status").lean();
  const wasSearchable = profile.isSearchable;
  profile.isSearchable = deriveSearchable(profile, owner);
  const searchableChanged = wasSearchable !== profile.isSearchable;

  await profile.save();

  // Course facet counts are drawn from searchable tutors, so they have to be
  // rebuilt when either the course list or search eligibility moved.
  if (update.courses || searchableChanged) await refreshCourseTutorCounts();

  // Personal fields that live on the user record.
  const userPatch = compact({
    timeZone: patch.timeZone,
    city: patch.city,
    province: patch.province,
  });
  if (Object.keys(userPatch).length) {
    await User.updateOne({ _id: userId }, { $set: userPatch });
  }

  return toPlain(profile);
}

// --- Admin review (§16) ----------------------------------------------------

/**
 * The admin applications list (R28.4).
 *
 * DRAFT is a tab of its own: a tutor answering an information request moves
 * their application back to DRAFT while they edit, and without this it would
 * vanish from every queue until they resubmitted.
 */
export async function listApplications({ status = TUTOR_STATUS.PENDING_REVIEW, q, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
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
      .sort(status === TUTOR_STATUS.DRAFT ? { updatedAt: -1 } : { submittedAt: 1, createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("userId", "firstName lastName email phone city province createdAt avatarUrl")
      .populate("tutorProfileId", "slug headline hourlyRateCents courseCodes yearsExperience city province qualifications")
      .lean(),
    TutorApplication.countDocuments(filter),
  ]);

  return { items: toPlain(items), total, page, pageSize: size };
}

/**
 * Everything a reviewer needs for one application (R28.4, R28.5).
 *
 * The profile is loaded by the id on the application rather than populated
 * through it: before submission that id is only a reservation, and the
 * documents uploaded inside the wizard already hang off it.
 */
export async function getApplicationForReview(applicationId) {
  const application = await TutorApplication.findById(applicationId)
    .populate("userId", "firstName lastName email phone city province createdAt emailVerifiedAt avatarUrl status")
    .lean();
  if (!application) return null;

  const profileId = application.tutorProfileId;
  const [profile, verification] = await Promise.all([
    profileId ? TutorProfile.findById(profileId).lean() : null,
    listVerificationRecords(profileId),
  ]);

  return {
    application: toPlain({ ...application, tutorProfileId: profileId ? String(profileId) : null }),
    profile: profile ? toPlain(profile) : null,
    verification,
  };
}

export async function reviewApplication(
  applicationId,
  { decision, message, grantBadges = [], badgeExpiresAt = {}, verifiedEducationIds },
  admin,
) {
  const application = await TutorApplication.findById(applicationId);
  if (!application) throw new NotFoundError("That application no longer exists.");

  // A draft is still being written — never submitted, or reopened by the
  // tutor after an information request. Its profile is the last submitted
  // version, so a decision now would be about answers the tutor is changing.
  if (application.status === TUTOR_STATUS.DRAFT) {
    throw new BusinessRuleError(
      "The tutor is still editing this application. Decide once they resubmit it.",
      "APPLICATION_IN_PROGRESS",
    );
  }

  const profile = await TutorProfile.findById(application.tutorProfileId);
  if (!profile) throw new NotFoundError("That tutor profile no longer exists.");

  const user = await User.findById(application.userId).lean();
  const approved = decision === TUTOR_STATUS.APPROVED;

  // The site promises every tutor's identity was checked (§11, R11.1), so an
  // approval needs an approved identity verification — already held, or
  // approved in this same review against a document the applicant uploaded.
  if (approved && !profile.verifiedTypes.includes(VERIFICATION_TYPES.IDENTITY)) {
    if (!grantBadges.includes(VERIFICATION_TYPES.IDENTITY)) {
      throw new BusinessRuleError(
        "Approve the applicant's identity document before approving the application.",
        "IDENTITY_REQUIRED",
        { fieldErrors: { grantBadges: ["Identity Verified is required to approve a tutor."] } },
      );
    }
    const hasDocument = await VerificationDocument.exists({
      tutorProfileId: profile._id,
      type: VERIFICATION_TYPES.IDENTITY,
      discardedAt: { $exists: false },
    });
    if (!hasDocument) {
      throw new BusinessRuleError(
        "There is no identity document to approve. Request more information instead.",
        "IDENTITY_REQUIRED",
        { fieldErrors: { grantBadges: ["No identity document has been uploaded."] } },
      );
    }
  }

  if (verifiedEducationIds) markEducationVerified(profile, verifiedEducationIds, { exact: true });

  if (approved) {
    // Through the one badge-granting implementation, so an approval sets the
    // same expiry, record state and audit entry as any other grant (R11.5).
    for (const type of grantBadges) {
      await approveBadge(profile, type, admin, { expiresAt: badgeExpiresAt?.[type] });
    }
  }

  application.status = decision;
  application.reviewedAt = new Date();
  application.reviewedBy = admin.id;
  application.reviewNotes.push({ adminId: admin.id, action: decision, message });
  await application.save();

  profile.status = decision;

  if (approved) {
    profile.approvedAt = new Date();
    profile.isSearchable = deriveSearchable(profile, user);
    profile.rejectionReason = undefined;
    profile.infoRequestedMessage = undefined;
  } else {
    // Rejected or more information requested — never searchable.
    profile.isSearchable = false;
    if (decision === TUTOR_STATUS.REJECTED) profile.rejectionReason = message;
    if (decision === TUTOR_STATUS.INFO_REQUESTED) profile.infoRequestedMessage = message;
  }

  await profile.save();
  await refreshCourseTutorCounts();

  if (user) {
    const templates = await brandedEmailTemplates();
    await sendEmail(
      {
        to: user.email,
        ...(approved
          ? // The reviewer's note is promised as part of the approval email
            // (R28.6); the template renders `note` when there is one.
            templates.applicationApproved({ firstName: user.firstName, note: message })
          : templates.applicationNeedsAttention({
              firstName: user.firstName,
              message: message ?? "Please review your application.",
              approved: false,
            })),
      },
      { category: EMAIL_CATEGORIES.APPLICATION },
    );
  }

  const welcome = "Parents can now find and book you. Set your availability to start receiving bookings.";
  await notify({
    userId: application.userId,
    type: approved
      ? NOTIFICATION_TYPES.APPLICATION_APPROVED
      : decision === TUTOR_STATUS.REJECTED
        ? NOTIFICATION_TYPES.APPLICATION_REJECTED
        : NOTIFICATION_TYPES.APPLICATION_INFO_REQUESTED,
    title: approved
      ? "Your tutor profile is live"
      : decision === TUTOR_STATUS.REJECTED
        ? "Your application was not approved"
        : "We need more information",
    body: approved ? (message ? `${welcome} From our team: ${message}` : welcome) : message,
    href: approved ? "/tutor/calendar" : "/tutor/onboarding",
    entityType: "TutorApplication",
    entityId: application._id,
    channels: [NOTIFICATION_CHANNELS.IN_APP],
  });

  await recordAudit({
    actor: admin,
    action: approved
      ? AUDIT_ACTIONS.TUTOR_APPROVED
      : decision === TUTOR_STATUS.REJECTED
        ? AUDIT_ACTIONS.TUTOR_REJECTED
        : AUDIT_ACTIONS.TUTOR_INFO_REQUESTED,
    entityType: "TutorProfile",
    entityId: profile._id,
    metadata: { decision, grantBadges, verifiedEducationIds },
  });

  return toPlain(application);
}

/**
 * The one rule that decides whether a tutor appears in search (§16, §42).
 *
 * Three conditions, all read from stored records: an administrator has
 * approved the profile, the profile still carries everything a parent needs,
 * and the account behind it is ACTIVE — a suspended, banned or deleted
 * account is never listed, whatever its profile says (R13.13, R28.2). Every
 * write that can affect any of them must run this — approval, removal from
 * search, account status changes (`syncSearchableForUser`) and profile edits.
 */
export function deriveSearchable(profile, owner) {
  return (
    profile.status === TUTOR_STATUS.APPROVED &&
    isProfileComplete(profile) &&
    owner?.status === USER_STATUS.ACTIVE
  );
}

/** A profile must carry everything a parent needs before it can be listed. */
export function isProfileComplete(profile) {
  return Boolean(
    profile.headline &&
      profile.bio &&
      profile.bio.length >= 120 &&
      profile.courses?.length &&
      profile.lessonModes?.length &&
      profile.hourlyRateCents > 0 &&
      profile.city &&
      profile.province,
  );
}

/**
 * Re-derive search eligibility after the *account* changed (R28.2).
 *
 * Called by user management on suspend, ban, reinstate and delete. It never
 * forces a value: reinstating an account whose profile an administrator had
 * removed from search leaves it out, because the derivation says so.
 */
export async function syncSearchableForUser(userId) {
  const profile = await TutorProfile.findOne({ userId });
  if (!profile) return null;

  const owner = await User.findById(userId).select("status").lean();
  const next = deriveSearchable(profile, owner);
  if (profile.isSearchable !== next) {
    profile.isSearchable = next;
    await profile.save();
    await refreshCourseTutorCounts();
  }
  return { tutorProfileId: String(profile._id), isSearchable: next };
}

/**
 * "Remove from search" / "Restore to search" (R28.8).
 *
 * Removal parks an approved profile as SUSPENDED; restoring brings a profile
 * that was approved back to APPROVED and *derives* search eligibility again,
 * so it cannot list an incomplete profile or one whose account is suspended.
 */
export async function setTutorSearchable(tutorProfileId, searchable, admin, reason) {
  const profile = await TutorProfile.findById(tutorProfileId);
  if (!profile) throw new NotFoundError("That tutor no longer exists.");

  if (searchable) {
    const wasApproved =
      profile.status === TUTOR_STATUS.APPROVED ||
      (profile.status === TUTOR_STATUS.SUSPENDED && profile.approvedAt);
    if (!wasApproved) {
      throw new BusinessRuleError("Approve the tutor before making the profile searchable.");
    }
    if (!isProfileComplete(profile)) {
      throw new BusinessRuleError("This profile is missing required information.");
    }
    const owner = await User.findById(profile.userId).select("status").lean();
    if (owner?.status !== USER_STATUS.ACTIVE) {
      throw new BusinessRuleError(
        "This tutor's account is not active. Reinstate the account before restoring the profile to search.",
        "ACCOUNT_NOT_ACTIVE",
      );
    }
    profile.status = TUTOR_STATUS.APPROVED;
    profile.isSearchable = deriveSearchable(profile, owner);
  } else {
    profile.isSearchable = false;
    profile.status = TUTOR_STATUS.SUSPENDED;
  }

  await profile.save();
  await refreshCourseTutorCounts();

  await recordAudit({
    actor: admin,
    action: searchable ? AUDIT_ACTIONS.TUTOR_SEARCH_RESTORED : AUDIT_ACTIONS.TUTOR_SEARCH_HIDDEN,
    entityType: "TutorProfile",
    entityId: profile._id,
    metadata: { searchable, reason },
  });

  return toPlain(profile);
}

// --- Stats -----------------------------------------------------------------

/** Recompute a tutor's rating aggregates after a review changes (§23). */
export async function refreshTutorStats(tutorProfileId) {
  const [agg] = await Review.aggregate([
    { $match: { tutorProfileId: toObjectId(tutorProfileId), status: REVIEW_STATUS.PUBLISHED } },
    {
      $group: {
        _id: null,
        ratingAverage: { $avg: "$rating" },
        ratingCount: { $sum: 1 },
        ratingKnowledge: { $avg: "$knowledge" },
        ratingCommunication: { $avg: "$communication" },
        ratingReliability: { $avg: "$reliability" },
        ratingTeaching: { $avg: "$teaching" },
      },
    },
  ]);

  const [lessons] = await Booking.aggregate([
    { $match: { tutorProfileId: toObjectId(tutorProfileId), status: BOOKING_STATUS.COMPLETED } },
    {
      $group: {
        _id: null,
        completedLessons: { $sum: 1 },
        students: { $addToSet: "$studentProfileId" },
      },
    },
  ]);

  const round1 = (v) => Math.round((v ?? 0) * 10) / 10;

  await TutorProfile.updateOne(
    { _id: tutorProfileId },
    {
      $set: {
        "stats.ratingAverage": round1(agg?.ratingAverage),
        "stats.ratingCount": agg?.ratingCount ?? 0,
        "stats.ratingKnowledge": round1(agg?.ratingKnowledge),
        "stats.ratingCommunication": round1(agg?.ratingCommunication),
        "stats.ratingReliability": round1(agg?.ratingReliability),
        "stats.ratingTeaching": round1(agg?.ratingTeaching),
        "stats.completedLessons": lessons?.completedLessons ?? 0,
        "stats.totalStudents": lessons?.students?.length ?? 0,
      },
    },
  );
}

function toObjectId(value) {
  return typeof value === "string" ? new Types.ObjectId(value) : value;
}

/**
 * Tutors a family has a real lesson relationship with ("My tutors", §24,
 * R22.3): a confirmed lesson or anything after one. An abandoned checkout, an
 * expired hold or a cancelled booking is not a relationship — the same
 * statuses that put a learner on a tutor's roster.
 */
export async function listMyTutors(userId) {
  const rows = await Booking.aggregate([
    {
      $match: {
        purchaserId: toObjectId(userId),
        status: { $in: STUDENT_RELATIONSHIP_STATUSES },
      },
    },
    {
      $group: {
        _id: "$tutorProfileId",
        lessonCount: { $sum: { $cond: [{ $eq: ["$status", BOOKING_STATUS.COMPLETED] }, 1, 0] } },
        lastLessonAt: { $max: "$startAt" },
        upcomingCount: {
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
      },
    },
    { $sort: { lastLessonAt: -1 } },
    { $limit: 50 },
  ]);

  const profiles = await TutorProfile.find({ _id: { $in: rows.map((r) => r._id) } })
    .populate("userId", "firstName lastName avatarUrl")
    .lean();
  const profileMap = new Map(profiles.map((p) => [String(p._id), p]));

  const tutors = rows
    .map((row) => {
      const profile = profileMap.get(String(row._id));
      if (!profile) return null;
      return {
        ...toPublicTutor(profile, profile.userId),
        lessonCount: row.lessonCount,
        upcomingCount: row.upcomingCount,
        lastLessonAt: row.lastLessonAt?.toISOString?.() ?? null,
      };
    })
    .filter(Boolean);

  return attachAvailableWeekdays(tutors);
}

export { rateForCourse };
