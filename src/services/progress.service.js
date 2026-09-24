import "server-only";
import {
  ProgressReport,
  StudentProfile,
  TutorProfile,
  Booking,
  Course,
} from "@/models";
import {
  PROGRESS_REPORT_STATUS,
  GOAL_PROGRESS,
  BOOKING_STATUS,
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
import { publicName, learnerDisplayName } from "@/lib/utils/format";
import { toPublicAttachment } from "@/models/Attachment";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";
import {
  ATTACHMENT_LIMITS,
  storeAttachments,
  discardAttachments,
  readAttachmentBytes,
} from "./attachment.service";

/** Where a browser asks for a homework attachment's bytes. */
const PROGRESS_ATTACHMENT_HREF = "/api/progress/attachments";

/**
 * Student progress reports (§41 Phase 2).
 *
 * Three rules shape everything here:
 *
 *   **A report is authored by the tutor who taught the lessons.** Not by the
 *   family, not by another tutor, and not by a tutor who has never taught
 *   this learner — which is checked against completed bookings rather than
 *   against anything in the request.
 *
 *   **A family reads and acknowledges; it does not edit.** There is no code
 *   path by which a learner or their parent changes a word of a tutor's
 *   assessment. What they can do is say they have read it.
 *
 *   **History is preserved, not overwritten.** A draft is the tutor's own
 *   workspace and can change freely. The moment a report is shared, every
 *   later edit snapshots the previous version into `revisions` first, so what
 *   the family was originally shown remains readable.
 */

// --- Authoring -------------------------------------------------------------

/**
 * Start a report for one learner.
 *
 * The lessons it covers are resolved from completed bookings rather than
 * supplied: a report is about teaching that actually happened, and letting a
 * caller name the lessons would let it claim teaching that did not.
 */
export async function createProgressReport(input, actor) {
  const [profile, student] = await Promise.all([
    tutorProfileFor(actor.id),
    StudentProfile.findById(input.studentProfileId).lean(),
  ]);

  if (!profile) throw new NotFoundError("You do not have a tutor profile.");
  if (!student) throw new NotFoundError("We couldn't find that student.");

  const lessons = await taughtLessons(profile._id, student._id, {
    from: input.periodStart,
    to: input.periodEnd,
    courseId: input.courseId,
  });

  if (!lessons.length) {
    throw new BusinessRuleError(
      "You can only write a progress report for a student you have completed lessons with.",
      "NO_COMPLETED_LESSONS",
    );
  }

  // An unsubmitted draft for the same learner is reused rather than stacked
  // up, so a tutor who navigates away and comes back finds their work.
  const existingDraft = await ProgressReport.findOne({
    tutorUserId: actor.id,
    studentProfileId: student._id,
    status: PROGRESS_REPORT_STATUS.DRAFT,
  });
  if (existingDraft) {
    throw new ConflictError("You already have a draft report for this student.");
  }

  const course = input.courseId
    ? await Course.findById(input.courseId).lean()
    : await Course.findById(lessons[0].courseId).lean();

  const report = await ProgressReport.create({
    reference: publicReference("PRG"),
    tutorUserId: actor.id,
    tutorProfileId: profile._id,
    studentProfileId: student._id,
    ownerId: student.ownerId,
    courseId: course?._id,
    courseCode: course?.code,
    courseName: course?.name,
    bookingIds: lessons.map((l) => l._id),
    lessonCount: lessons.length,
    periodStart: lessons.at(-1).startAt,
    periodEnd: lessons[0].endAt,
    // The learner's own goals are carried in so the tutor assesses what the
    // family actually asked for rather than inventing a parallel list.
    goals: (student.learningGoals ?? []).map((goal) => ({
      goalId: goal._id,
      label: goal.label,
      status: goal.achievedAt ? GOAL_PROGRESS.ACHIEVED : GOAL_PROGRESS.IN_PROGRESS,
    })),
  });

  return toPlain(report);
}

/** The fields a tutor may write. Everything else is derived or lifecycle. */
const WRITABLE_FIELDS = [
  "summary",
  "strengths",
  "focusAreas",
  "homework",
  "ratings",
  "goals",
  "milestones",
  "privateNote",
];

/**
 * Edit a report.
 *
 * A draft edits in place. A shared report snapshots what it said first — the
 * family has already read it, and quietly rewriting history is exactly what
 * this model exists to prevent.
 */
export async function updateProgressReport(id, input, actor) {
  const report = await ProgressReport.findById(id).select("+privateNote");
  if (!report) throw new NotFoundError("That report no longer exists.");
  assertAuthor(report, actor);

  if (report.status === PROGRESS_REPORT_STATUS.ARCHIVED) {
    throw new BusinessRuleError("An archived report cannot be edited.", "REPORT_ARCHIVED");
  }

  const wasShared = report.status === PROGRESS_REPORT_STATUS.SUBMITTED;
  if (wasShared) {
    report.revisions.push({
      at: new Date(),
      byId: actor.id,
      reason: input.revisionReason,
      snapshot: snapshotOf(report),
    });
  }

  for (const field of WRITABLE_FIELDS) {
    if (input[field] === undefined) continue;
    report[field] = input[field];
  }

  await report.save();

  if (wasShared) {
    await notify({
      userId: report.ownerId,
      type: NOTIFICATION_TYPES.PROGRESS_REPORT_UPDATED,
      title: "A progress report was updated",
      body: `Your tutor revised the ${report.courseCode ?? report.courseName ?? "progress"} report.`,
      href: `/progress/${report._id}`,
      entityType: "ProgressReport",
      entityId: report._id,
    });

    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.PROGRESS_REPORT_REVISED,
      entityType: "ProgressReport",
      entityId: report._id,
      metadata: { reference: report.reference, revisions: report.revisions.length },
    });
  }

  return toPlain(report);
}

/**
 * Share the report with the family.
 *
 * Also the moment a goal marked achieved reaches the learner's own record —
 * the report is the tutor's assessment, `StudentProfile.learningGoals` is the
 * learner's history, and the second should only change when the first is
 * something the family has actually been shown.
 */
export async function submitProgressReport(id, actor) {
  const report = await ProgressReport.findById(id);
  if (!report) throw new NotFoundError("That report no longer exists.");
  assertAuthor(report, actor);

  if (report.status !== PROGRESS_REPORT_STATUS.DRAFT) {
    throw new ConflictError("That report has already been shared.");
  }
  if (!report.summary || report.summary.trim().length < 20) {
    throw new BusinessRuleError(
      "Write a summary of at least 20 characters before sharing the report.",
      "SUMMARY_REQUIRED",
    );
  }

  report.status = PROGRESS_REPORT_STATUS.SUBMITTED;
  report.submittedAt = new Date();
  await report.save();

  await applyAchievedGoals(report);

  const student = await StudentProfile.findById(report.studentProfileId)
    .select("firstName")
    .lean();

  await notify({
    userId: report.ownerId,
    type: NOTIFICATION_TYPES.PROGRESS_REPORT_SHARED,
    title: `New progress report for ${student?.firstName ?? "your student"}`,
    body: report.summary.slice(0, 160),
    href: `/progress/${report._id}`,
    entityType: "ProgressReport",
    entityId: report._id,
  });

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.PROGRESS_REPORT_SUBMITTED,
    entityType: "ProgressReport",
    entityId: report._id,
    metadata: { reference: report.reference, lessons: report.lessonCount },
  });

  return toPlain(report);
}

/**
 * Archive a report.
 *
 * Not a delete: a shared report is part of a learner's record and stays
 * readable to the family and to an administrator. Archiving takes it out of
 * the tutor's working list, nothing more.
 */
export async function archiveProgressReport(id, actor) {
  const report = await ProgressReport.findById(id);
  if (!report) throw new NotFoundError("That report no longer exists.");
  assertAuthor(report, actor);

  if (report.status === PROGRESS_REPORT_STATUS.ARCHIVED) {
    throw new ConflictError("That report is already archived.");
  }

  report.status = PROGRESS_REPORT_STATUS.ARCHIVED;
  report.archivedAt = new Date();
  await report.save();

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.PROGRESS_REPORT_ARCHIVED,
    entityType: "ProgressReport",
    entityId: report._id,
    metadata: { reference: report.reference },
  });

  return toPlain(report);
}

// --- Reading ---------------------------------------------------------------

/** The tutor's own reports, drafts included. */
export async function listReportsForTutor(actor, { studentProfileId, status, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.bookings;
  const query = { tutorUserId: actor.id };
  if (studentProfileId) query.studentProfileId = studentProfileId;
  if (status) query.status = status;

  const [items, total] = await Promise.all([
    ProgressReport.find(query)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("studentProfileId", "firstName lastName gradeName isMinor shareFullNameWithTutor")
      .lean(),
    ProgressReport.countDocuments(query),
  ]);

  return {
    items: toPlain(items).map(maskLearnerForTutor),
    total,
    page,
    pageSize: size,
  };
}

/**
 * The family's history.
 *
 * Drafts are absent by construction, not by filtering in the UI: a tutor's
 * unfinished thinking is not part of the learner's record until they share it.
 */
export async function listReportsForOwner(actor, { studentProfileId, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.bookings;
  const query = {
    ownerId: actor.id,
    status: { $in: [PROGRESS_REPORT_STATUS.SUBMITTED, PROGRESS_REPORT_STATUS.ARCHIVED] },
  };
  if (studentProfileId) query.studentProfileId = studentProfileId;

  const [items, total, unread] = await Promise.all([
    ProgressReport.find(query)
      .sort({ submittedAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("studentProfileId", "firstName lastName gradeName")
      .populate({ path: "tutorProfileId", populate: { path: "userId", select: "firstName lastName avatarUrl" } })
      .lean(),
    ProgressReport.countDocuments(query),
    ProgressReport.countDocuments({ ...query, acknowledgedAt: null }),
  ]);

  return { items: toPlain(items).map(withTutorSummary), total, unread, page, pageSize: size };
}

/** One report, scoped to who is asking. */
export async function getProgressReport(id, actor) {
  const isAuthorView = actor.role === ROLES.TUTOR;
  const query = ProgressReport.findById(id)
    .populate("studentProfileId", "firstName lastName gradeName isMinor shareFullNameWithTutor")
    .populate({ path: "tutorProfileId", populate: { path: "userId", select: "firstName lastName avatarUrl" } });

  // The private note is the tutor's own; it is not selected for anyone else.
  if (isAuthorView) query.select("+privateNote");

  const report = await query.lean();
  if (!report) throw new NotFoundError("That report no longer exists.");

  const isAuthor = String(report.tutorUserId) === String(actor.id);
  const isOwner = String(report.ownerId) === String(actor.id);
  const isAdmin = actor.role === ROLES.ADMIN;

  if (!isAuthor && !isOwner && !isAdmin) {
    throw new AuthorizationError("You do not have access to this report.");
  }

  // A draft is the tutor's workspace. Nobody else sees one — including an
  // administrator, who has no support reason to read unfinished thinking.
  if (report.status === PROGRESS_REPORT_STATUS.DRAFT && !isAuthor) {
    throw new NotFoundError("That report no longer exists.");
  }

  const shaped = isAuthor ? maskLearnerForTutor(toPlain(report)) : withTutorSummary(toPlain(report));
  if (!isAuthor) delete shaped.privateNote;
  // Replaced rather than serialised: the public shape carries the id and the
  // route that checks the reader, and never the key.
  shaped.homeworkAttachments = publicHomeworkAttachments(report).attachments;

  return { report: shaped, canEdit: isAuthor, canAcknowledge: isOwner };
}

/**
 * The family says they have read it.
 *
 * The one write a family is allowed, and it touches nothing the tutor wrote.
 */
export async function acknowledgeProgressReport(id, actor) {
  const report = await ProgressReport.findById(id);
  if (!report) throw new NotFoundError("That report no longer exists.");

  if (String(report.ownerId) !== String(actor.id)) {
    throw new AuthorizationError("That report is not yours to acknowledge.");
  }
  if (report.status === PROGRESS_REPORT_STATUS.DRAFT) {
    throw new NotFoundError("That report no longer exists.");
  }
  if (report.acknowledgedAt) return toPlain(report);

  report.acknowledgedAt = new Date();
  report.acknowledgedBy = actor.id;
  await report.save();

  await notify({
    userId: report.tutorUserId,
    type: NOTIFICATION_TYPES.PROGRESS_REPORT_UPDATED,
    title: "A family read your progress report",
    body: `Your ${report.courseCode ?? report.courseName ?? ""} report has been read.`.trim(),
    href: `/tutor/progress/${report._id}`,
    entityType: "ProgressReport",
    entityId: report._id,
  });

  return toPlain(report);
}

/** Every shared report, for support and moderation (§35). */
export async function listAllProgressReports({ status, page = 1, pageSize } = {}) {
  const size = pageSize ?? PAGE_SIZES.adminTable;
  // Drafts are excluded here too: an administrator's support need begins when
  // a report has been shared with a family.
  const query = {
    status: status && status !== PROGRESS_REPORT_STATUS.DRAFT
      ? status
      : { $in: [PROGRESS_REPORT_STATUS.SUBMITTED, PROGRESS_REPORT_STATUS.ARCHIVED] },
  };

  const [items, total] = await Promise.all([
    ProgressReport.find(query)
      .sort({ submittedAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .populate("studentProfileId", "firstName gradeName")
      .populate("tutorUserId", "firstName lastName email")
      .lean(),
    ProgressReport.countDocuments(query),
  ]);

  return { items: toPlain(items), total, page, pageSize: size };
}

/** Students this tutor may write a report about, for the picker. */
export async function reportableStudents(actor) {
  const profile = await tutorProfileFor(actor.id);
  if (!profile) return { students: [] };

  const rows = await Booking.aggregate([
    { $match: { tutorProfileId: profile._id, status: BOOKING_STATUS.COMPLETED } },
    {
      $group: {
        _id: "$studentProfileId",
        lessons: { $sum: 1 },
        lastLessonAt: { $max: "$endAt" },
        courseId: { $last: "$courseId" },
        courseCode: { $last: "$courseCode" },
        courseName: { $last: "$courseName" },
      },
    },
    { $sort: { lastLessonAt: -1 } },
    { $limit: 100 },
  ]);

  const students = await StudentProfile.find({ _id: { $in: rows.map((r) => r._id) } })
    .select("firstName lastName gradeName isMinor shareFullNameWithTutor learningGoals")
    .lean();
  const byId = new Map(students.map((s) => [String(s._id), s]));

  return {
    students: rows
      .filter((row) => byId.has(String(row._id)))
      .map((row) => {
        const student = byId.get(String(row._id));
        return {
          id: String(row._id),
          // A minor's surname stays masked from the tutor unless the family
          // opted in — the same rule as everywhere else (§35).
          displayName: learnerDisplayName(student),
          gradeName: student.gradeName ?? null,
          goalCount: student.learningGoals?.length ?? 0,
          lessons: row.lessons,
          lastLessonAt: row.lastLessonAt,
          courseId: String(row.courseId),
          courseCode: row.courseCode,
          courseName: row.courseName,
        };
      }),
  };
}

// --- Homework files (§41 Phase 3) -------------------------------------------

/**
 * Attach the worksheet to the homework the tutor already wrote.
 *
 * `homework` has always been the instruction; this is the thing being handed
 * over. Only the report's author may add one, checked against the loaded
 * record — and the capacity check is part of the same conditional update
 * rather than a read followed by a write, so a tutor double-clicking cannot
 * push a report past its cap.
 *
 * Adding to an already-submitted report is deliberately allowed and
 * deliberately does *not* snapshot a revision: a new file is additive, the
 * way a milestone is, and nothing the family was previously shown changes.
 * Removing one is the case that rewrites history, and that is handled below.
 */
export async function addHomeworkAttachments(id, files, actor) {
  const existing = await ProgressReport.findById(id)
    .select("tutorUserId status ownerId homeworkAttachments courseCode courseName")
    .lean();
  if (!existing) throw new NotFoundError("That report no longer exists.");
  assertAuthor(existing, actor);

  const already = existing.homeworkAttachments?.length ?? 0;
  const room = ATTACHMENT_LIMITS.maxPerReport - already;
  if (room <= 0) {
    throw new BusinessRuleError(
      `A report can carry at most ${ATTACHMENT_LIMITS.maxPerReport} files.`,
      "TOO_MANY_ATTACHMENTS",
    );
  }

  const attachments = await storeAttachments(files, actor, {
    max: room,
    label: "homework",
  });
  if (!attachments.length) throw new BusinessRuleError("Choose a file to attach.");

  // The guard and the write are one operation: the update applies only while
  // the array is still short enough to hold what is being added.
  const capacityKey = `homeworkAttachments.${ATTACHMENT_LIMITS.maxPerReport - attachments.length}`;
  const report = await ProgressReport.findOneAndUpdate(
    { _id: id, tutorUserId: actor.id, [capacityKey]: { $exists: false } },
    { $push: { homeworkAttachments: { $each: attachments } } },
    { returnDocument: "after" },
  ).lean();

  if (!report) {
    await discardAttachments(attachments);
    throw new ConflictError(
      `A report can carry at most ${ATTACHMENT_LIMITS.maxPerReport} files.`,
    );
  }

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.PROGRESS_ATTACHMENT_ADDED,
    entityType: "ProgressReport",
    entityId: report._id,
    metadata: {
      count: attachments.length,
      files: attachments.map((a) => ({
        fileName: a.fileName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
      })),
    },
  });

  // A family watching for "anything new?" should hear about a worksheet that
  // arrived after the report was shared.
  if (report.status !== PROGRESS_REPORT_STATUS.DRAFT) {
    await notify({
      userId: report.ownerId,
      type: NOTIFICATION_TYPES.PROGRESS_REPORT_UPDATED,
      title: "New homework from your tutor",
      body: `${attachments.length} file${attachments.length === 1 ? "" : "s"} added to your ${report.courseCode ?? report.courseName ?? ""} report.`.trim(),
      href: `/progress/${report._id}`,
      entityType: "ProgressReport",
      entityId: report._id,
    });
  }

  return publicHomeworkAttachments(report);
}

/**
 * Take a worksheet back off a report.
 *
 * Allowed after submission, because the case that matters is a tutor who
 * attached the wrong learner's work and needs it gone now — refusing that in
 * the name of an immutable history would turn a mistake into a standing
 * privacy breach. What preserves the history instead is the same mechanism
 * every other post-submission edit uses: the report as it read is snapshotted
 * into `revisions` first, so the record still says the file was there.
 *
 * The bytes go last and only once the document no longer points at them.
 */
export async function removeHomeworkAttachment(id, attachmentId, actor) {
  const report = await ProgressReport.findById(id).select("+homeworkAttachments.storageKey");
  if (!report) throw new NotFoundError("That report no longer exists.");
  assertAuthor(report, actor);

  const attachment = report.homeworkAttachments.id(attachmentId);
  if (!attachment) throw new NotFoundError("That file is no longer attached.");

  if (report.status !== PROGRESS_REPORT_STATUS.DRAFT) {
    report.revisions.push({
      at: new Date(),
      byId: actor.id,
      reason: `Removed attachment: ${attachment.fileName}`,
      snapshot: snapshotOf(report),
    });
  }

  const removed = { storageKey: attachment.storageKey, fileName: attachment.fileName };
  report.homeworkAttachments.pull(attachmentId);
  await report.save();

  await recordAudit({
    actor,
    action: AUDIT_ACTIONS.PROGRESS_ATTACHMENT_REMOVED,
    entityType: "ProgressReport",
    entityId: report._id,
    metadata: { attachmentId: String(attachmentId), fileName: removed.fileName },
  });

  await discardAttachments([removed]);

  return publicHomeworkAttachments(report.toObject());
}

/**
 * Read one homework file, for somebody entitled to it.
 *
 * The audience is the report's, not the file's: the tutor who wrote it, the
 * family it was written for, and an administrator. It is resolved from the
 * stored report — `ownerId` was set at creation from the learner, never from
 * a request — so there is no parameter through which one family could reach
 * another's worksheet.
 *
 * A draft's files are the tutor's own, exactly as a draft's text is.
 */
export async function readHomeworkAttachment(attachmentId, actor) {
  // Only the deselected path is named: Mongo refuses a projection that asks
  // for both `homeworkAttachments` and `homeworkAttachments.storageKey`, and
  // `+path` on its own returns the whole document with that path added —
  // which still leaves `privateNote` behind, because it was not asked for.
  const report = await ProgressReport.findOne({ "homeworkAttachments._id": attachmentId })
    .select("+homeworkAttachments.storageKey")
    .lean();
  if (!report) throw new NotFoundError("That file is no longer available.");

  const isAuthor = String(report.tutorUserId) === String(actor.id);
  const isOwner = String(report.ownerId) === String(actor.id);
  const isAdmin = actor.role === ROLES.ADMIN;

  if (!isAuthor && !isOwner && !isAdmin) {
    throw new AuthorizationError("You do not have access to this file.");
  }
  if (report.status === PROGRESS_REPORT_STATUS.DRAFT && !isAuthor) {
    throw new NotFoundError("That file is no longer available.");
  }

  const attachment = (report.homeworkAttachments ?? []).find(
    (candidate) => String(candidate._id) === String(attachmentId),
  );
  if (!attachment) throw new NotFoundError("That file is no longer available.");

  if (isAdmin && !isAuthor && !isOwner) {
    await recordAudit({
      actor,
      action: AUDIT_ACTIONS.ATTACHMENT_ADMIN_VIEWED,
      entityType: "ProgressReport",
      entityId: report._id,
      metadata: {
        attachmentId: String(attachment._id),
        fileName: attachment.fileName,
        contentType: attachment.contentType,
      },
    });
  }

  const { buffer, contentType, fileName } = await readAttachmentBytes(attachment);
  return { buffer, contentType, fileName, sizeBytes: attachment.sizeBytes };
}

/**
 * The attachments of one report, in the shape a browser may hold.
 *
 * Every read path runs through this rather than serialising the array, for
 * the reason written on `AttachmentSchema`: a hydrated report loaded with
 * `+homeworkAttachments.storageKey` carries the keys, and `toPlain()` would
 * publish them.
 */
export function publicHomeworkAttachments(report) {
  return {
    attachments: (report?.homeworkAttachments ?? []).map((attachment) =>
      toPublicAttachment(attachment, PROGRESS_ATTACHMENT_HREF),
    ),
  };
}

// --- Internals -------------------------------------------------------------

function assertAuthor(report, actor) {
  if (String(report.tutorUserId) !== String(actor.id)) {
    // Checked against the loaded record, never a field in the request (§42).
    throw new AuthorizationError("Only the tutor who wrote this report can change it.");
  }
}

/** The lessons a report can legitimately be about. */
function taughtLessons(tutorProfileId, studentProfileId, { from, to, courseId } = {}) {
  const query = {
    tutorProfileId,
    studentProfileId,
    status: BOOKING_STATUS.COMPLETED,
  };
  if (courseId) query.courseId = courseId;
  if (from || to) {
    query.startAt = {};
    if (from) query.startAt.$gte = new Date(from);
    if (to) query.startAt.$lte = new Date(to);
  }

  return Booking.find(query)
    .select("_id startAt endAt courseId courseCode courseName")
    .sort({ startAt: -1 })
    .limit(200)
    .lean();
}

/**
 * Carry a goal the tutor marked achieved onto the learner's own record.
 *
 * One direction only: a report can mark a goal achieved, and never un-achieve
 * one. A later tutor disagreeing should write that in their own report rather
 * than erasing something the learner earned.
 */
async function applyAchievedGoals(report) {
  const achieved = (report.goals ?? []).filter(
    (goal) => goal.goalId && goal.status === GOAL_PROGRESS.ACHIEVED,
  );
  if (!achieved.length) return;

  const student = await StudentProfile.findById(report.studentProfileId).select("learningGoals");
  if (!student) return;

  let changed = false;
  for (const goal of achieved) {
    const entry = student.learningGoals.id(goal.goalId);
    if (entry && !entry.achievedAt) {
      entry.achievedAt = report.submittedAt ?? new Date();
      changed = true;
    }
  }
  if (changed) await student.save();
}

/** Exactly the fields a revision needs to reconstruct what was shown. */
function snapshotOf(report) {
  return {
    summary: report.summary,
    strengths: report.strengths,
    focusAreas: report.focusAreas,
    homework: report.homework,
    // Names only. A revision records *that* a worksheet was shared and what
    // it was called; the key that addresses the bytes belongs nowhere near a
    // `Mixed` field that the audit viewer will later render (§35).
    homeworkAttachments: (report.homeworkAttachments ?? []).map((a) => ({
      fileName: a.fileName,
      contentType: a.contentType,
      sizeBytes: a.sizeBytes,
    })),
    ratings: report.ratings ? { ...report.ratings.toObject?.() ?? report.ratings } : undefined,
    goals: (report.goals ?? []).map((g) => ({ label: g.label, status: g.status, note: g.note })),
    milestones: (report.milestones ?? []).map((m) => ({ label: m.label, achievedAt: m.achievedAt })),
  };
}

function maskLearnerForTutor(report) {
  const student = report.studentProfileId;
  if (!student || typeof student !== "object") return report;

  return {
    ...report,
    studentProfileId: {
      id: student.id ?? String(student._id),
      displayName: learnerDisplayName(student),
      gradeName: student.gradeName ?? null,
    },
  };
}

/** The family sees the tutor as the marketplace shows them everywhere else. */
function withTutorSummary(report) {
  const profile = report.tutorProfileId;
  if (!profile || typeof profile !== "object") return report;

  const account = profile.userId;
  return {
    ...report,
    tutorProfileId: {
      id: profile.id ?? String(profile._id),
      slug: profile.slug,
      displayName: account
        ? publicName(account.firstName, account.lastName)
        : "Your tutor",
      avatarUrl: account?.avatarUrl ?? null,
    },
  };
}

function tutorProfileFor(userId) {
  return TutorProfile.findOne({ userId }).select("_id").lean();
}
