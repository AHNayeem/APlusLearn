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
  VerificationRecord,
} from "@/models";
import {
  TUTOR_STATUS,
  REVIEW_STATUS,
  BOOKING_STATUS,
  VERIFICATION_STATUS,
  AUDIT_ACTIONS,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  PAGE_SIZES,
  EMAIL_CATEGORIES,
} from "@/constants";
import { NotFoundError, BusinessRuleError, ConflictError } from "@/lib/api/errors";
import { toPlain, compact } from "@/lib/utils/serialize";
import { slugify } from "@/lib/utils/slug";
import { publicName } from "@/lib/utils/format";
import { rateForCourse } from "@/lib/booking/pricing";
import { geocode } from "./external/geocoding-provider";
import { ONBOARDING_STEPS } from "@/models/TutorApplication";
import { sendEmail, brandedEmailTemplates } from "./external/email-provider";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";
import { refreshCourseTutorCounts } from "./curriculum.service";

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

  const profile = await materialiseProfile(user, application);

  application.status = TUTOR_STATUS.PENDING_REVIEW;
  application.submittedAt = new Date();
  application.tutorProfileId = profile._id;
  await application.save();

  await createVerificationRecords(profile, application.data?.DOCUMENTS?.requestedBadges ?? []);

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
  const courseIds = (d.COURSES?.courses ?? []).map((c) => c.courseId);
  const courseDocs = await Course.find({ _id: { $in: courseIds } }).lean();
  const courseMap = new Map(courseDocs.map((c) => [String(c._id), c]));

  const courses = (d.COURSES?.courses ?? [])
    .map((entry) => {
      const course = courseMap.get(String(entry.courseId));
      if (!course) return null;
      return {
        courseId: course._id,
        code: course.code,
        name: course.name,
        subjectId: course.subjectId,
        subjectSlug: course.subjectSlug,
        gradeLevel: course.gradeLevel,
        gradeSlug: course.gradeSlug,
        provinceCode: course.provinceCode,
        hourlyRateCents: entry.hourlyRateCents,
        yearsTeaching: entry.yearsTeaching ?? 0,
      };
    })
    .filter(Boolean);

  const geo = await geocode({
    postalCode: d.LOCATION?.postalCode,
    city: d.LOCATION?.city,
    province: d.LOCATION?.province,
  });

  const hourlyRateCents = d.PRICING?.hourlyRateCents ?? 5000;
  const rates = [hourlyRateCents, ...courses.map((c) => c.hourlyRateCents).filter(Boolean)];

  const payload = compact({
    userId: user._id,
    headline: d.PROFILE?.headline,
    bio: d.PROFILE?.bio,
    introVideoUrl: d.PROFILE?.introVideoUrl,
    languages: d.PROFILE?.languages,

    education: d.EDUCATION?.education ?? [],
    experience: d.QUALIFICATIONS?.experience ?? [],
    qualifications: d.QUALIFICATIONS?.qualifications ?? [],
    octNumber: d.QUALIFICATIONS?.octNumber,
    yearsExperience: d.QUALIFICATIONS?.yearsExperience ?? 0,

    courses,
    courseIds: courses.map((c) => c.courseId),
    courseCodes: courses.map((c) => c.code).filter(Boolean),
    subjectIds: [...new Set(courses.map((c) => String(c.subjectId)).filter(Boolean))],
    subjectSlugs: [...new Set(courses.map((c) => c.subjectSlug).filter(Boolean))],
    gradeLevels: [...new Set(courses.map((c) => c.gradeLevel).filter((v) => v !== undefined))],
    provinceCodes: [...new Set(courses.map((c) => c.provinceCode).filter(Boolean))],

    lessonModes: d.LESSON_TYPE?.lessonModes,
    onlineMeetingProviders: d.LESSON_TYPE?.onlineMeetingProviders ?? [],
    inPersonLocationTypes: d.LESSON_TYPE?.inPersonLocationTypes ?? [],

    city: d.LOCATION?.city,
    province: d.LOCATION?.province,
    postalCodePrefix: d.LOCATION?.postalCode?.slice(0, 3),
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

  const existing = await TutorProfile.findOne({ userId: user._id });
  let profile;

  if (existing) {
    Object.assign(existing, payload);
    profile = await existing.save();
  } else {
    profile = await TutorProfile.create({
      ...payload,
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
        avatarUrl: d.PROFILE?.avatarUrl,
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

async function createVerificationRecords(profile, requestedBadges) {
  const ops = requestedBadges.map((type) => ({
    updateOne: {
      filter: { tutorProfileId: profile._id, type },
      update: {
        $setOnInsert: {
          tutorProfileId: profile._id,
          userId: profile.userId,
          type,
          status: VERIFICATION_STATUS.PENDING,
          submittedAt: new Date(),
        },
      },
      upsert: true,
    },
  }));
  if (ops.length) await VerificationRecord.bulkWrite(ops);
}

// --- Profile editing (approved tutors) -------------------------------------

export async function updateTutorProfile(userId, patch) {
  const profile = await TutorProfile.findOne({ userId });
  if (!profile) throw new NotFoundError("Finish your tutor onboarding first.");

  const update = compact(patch);

  if (update.courses) {
    const courseDocs = await Course.find({
      _id: { $in: update.courses.map((c) => c.courseId) },
    }).lean();
    const courseMap = new Map(courseDocs.map((c) => [String(c._id), c]));

    const courses = update.courses
      .map((entry) => {
        const course = courseMap.get(String(entry.courseId));
        if (!course) return null;
        return {
          courseId: course._id,
          code: course.code,
          name: course.name,
          subjectId: course.subjectId,
          subjectSlug: course.subjectSlug,
          gradeLevel: course.gradeLevel,
          gradeSlug: course.gradeSlug,
          provinceCode: course.provinceCode,
          hourlyRateCents: entry.hourlyRateCents,
          yearsTeaching: entry.yearsTeaching ?? 0,
        };
      })
      .filter(Boolean);

    if (!courses.length) {
      throw new BusinessRuleError("Keep at least one valid course on your profile.");
    }

    update.courses = courses;
    update.courseIds = courses.map((c) => c.courseId);
    update.courseCodes = courses.map((c) => c.code).filter(Boolean);
    update.subjectIds = [...new Set(courses.map((c) => String(c.subjectId)).filter(Boolean))];
    update.subjectSlugs = [...new Set(courses.map((c) => c.subjectSlug).filter(Boolean))];
    update.gradeLevels = [...new Set(courses.map((c) => c.gradeLevel).filter((v) => v !== undefined))];
    update.provinceCodes = [...new Set(courses.map((c) => c.provinceCode).filter(Boolean))];
  }

  if (update.city || update.postalCode || update.province) {
    const geo = await geocode({
      postalCode: update.postalCode,
      city: update.city ?? profile.city,
      province: update.province ?? profile.province,
    });
    if (geo) update.location = { type: "Point", coordinates: geo.coordinates };
    if (update.postalCode) update.postalCodePrefix = update.postalCode.slice(0, 3);
    delete update.postalCode;
  }

  Object.assign(profile, update);

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
  const wasSearchable = profile.isSearchable;
  profile.isSearchable = deriveSearchable(profile);
  const searchableChanged = wasSearchable !== profile.isSearchable;

  await profile.save();

  // Course facet counts are drawn from searchable tutors, so they have to be
  // rebuilt when either the course list or search eligibility moved.
  if (update.courses || searchableChanged) await refreshCourseTutorCounts();

  // Personal fields that live on the user record.
  const userPatch = compact({
    avatarUrl: patch.avatarUrl,
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

export async function reviewApplication(applicationId, { decision, message, grantBadges }, admin) {
  const application = await TutorApplication.findById(applicationId);
  if (!application) throw new NotFoundError("That application no longer exists.");

  const profile = await TutorProfile.findById(application.tutorProfileId);
  if (!profile) throw new NotFoundError("That tutor profile no longer exists.");

  const user = await User.findById(application.userId).lean();

  application.status = decision;
  application.reviewedAt = new Date();
  application.reviewedBy = admin.id;
  application.reviewNotes.push({ adminId: admin.id, action: decision, message });
  await application.save();

  profile.status = decision;

  if (decision === TUTOR_STATUS.APPROVED) {
    profile.approvedAt = new Date();
    profile.isSearchable = deriveSearchable(profile);
    profile.rejectionReason = undefined;
    profile.infoRequestedMessage = undefined;

    for (const type of grantBadges ?? []) {
      if (!profile.verifiedTypes.includes(type)) {
        profile.verificationBadges.push({ type, grantedBy: admin.id, grantedAt: new Date() });
        profile.verifiedTypes.push(type);
      }
      await VerificationRecord.updateOne(
        { tutorProfileId: profile._id, type },
        {
          $set: {
            status: VERIFICATION_STATUS.APPROVED,
            reviewedAt: new Date(),
            reviewedBy: admin.id,
          },
        },
        { upsert: true },
      );
    }
  } else {
    // Rejected or more information requested — never searchable.
    profile.isSearchable = false;
    if (decision === TUTOR_STATUS.REJECTED) profile.rejectionReason = message;
    if (decision === TUTOR_STATUS.INFO_REQUESTED) profile.infoRequestedMessage = message;
  }

  await profile.save();
  await refreshCourseTutorCounts();

  const approved = decision === TUTOR_STATUS.APPROVED;
  if (user) {
    await sendEmail(
      {
        to: user.email,
        ...(approved
          ? (await brandedEmailTemplates()).applicationApproved({ firstName: user.firstName })
          : (await brandedEmailTemplates()).applicationNeedsAttention({
              firstName: user.firstName,
              message: message ?? "Please review your application.",
              approved: false,
            })),
      },
      { category: EMAIL_CATEGORIES.APPLICATION },
    );
  }

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
    body: approved
      ? "Parents can now find and book you. Set your availability to start receiving bookings."
      : message,
    href: approved ? "/tutor/calendar" : "/tutor/onboarding",
    entityType: "TutorApplication",
    entityId: application._id,
    channels: [NOTIFICATION_CHANNELS.IN_APP],
  });

  await recordAudit({
    actor: admin,
    action: approved ? AUDIT_ACTIONS.TUTOR_APPROVED : AUDIT_ACTIONS.TUTOR_REJECTED,
    entityType: "TutorProfile",
    entityId: profile._id,
    metadata: { decision, grantBadges },
  });

  return toPlain(application);
}

/**
 * The one rule that decides whether a tutor appears in search (§16, §42).
 *
 * Two conditions, both read from the stored record: an administrator has
 * approved the profile, and the profile still carries everything a parent
 * needs. Every write that can affect either must run this — approval,
 * administrative suspension, and any profile edit.
 */
export function deriveSearchable(profile) {
  return profile.status === TUTOR_STATUS.APPROVED && isProfileComplete(profile);
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

export async function setTutorSearchable(tutorProfileId, searchable, admin, reason) {
  const profile = await TutorProfile.findById(tutorProfileId);
  if (!profile) throw new NotFoundError("That tutor no longer exists.");

  if (searchable && profile.status !== TUTOR_STATUS.APPROVED) {
    throw new BusinessRuleError("Approve the tutor before making the profile searchable.");
  }
  if (searchable && !isProfileComplete(profile)) {
    throw new BusinessRuleError("This profile is missing required information.");
  }

  profile.isSearchable = searchable;
  if (!searchable) profile.status = TUTOR_STATUS.SUSPENDED;
  await profile.save();
  await refreshCourseTutorCounts();

  await recordAudit({
    actor: admin,
    action: searchable ? AUDIT_ACTIONS.TUTOR_APPROVED : AUDIT_ACTIONS.USER_SUSPENDED,
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

/** Tutors a learner has actually had lessons with ("My tutors", §24). */
export async function listMyTutors(userId) {
  const rows = await Booking.aggregate([
    { $match: { purchaserId: toObjectId(userId) } },
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
