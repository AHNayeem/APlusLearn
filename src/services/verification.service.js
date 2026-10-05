import "server-only";
import { Types } from "mongoose";
import {
  VerificationRecord, VerificationDocument, TutorProfile, TutorApplication,
} from "@/models";
import {
  VERIFICATION_STATUS,
  VERIFICATION_TYPES,
  VERIFICATION_LABELS,
  DOCUMENT_STATUS,
  NOTIFICATION_TYPES,
  AUDIT_ACTIONS,
  UPLOAD,
} from "@/constants";
import { NotFoundError, BusinessRuleError, AuthorizationError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { inspectDocument, safeFileName, documentExtensionFor } from "@/lib/images/inspect";
import { getStorageProvider, getStorageProviderForRead, STORAGE_SCOPES } from "./external/storage-provider";
import { getSettings } from "./settings.service";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";

/**
 * Tutor verification (§16).
 *
 * Badge state is controlled entirely by administrators. A tutor can upload
 * evidence and see their own status, but can never grant themselves a badge
 * or change a record's status (§42).
 *
 * Records and documents are keyed by the tutor's profile id. An applicant who
 * has not submitted yet has no profile, so the id is *reserved* on their
 * application the first time they upload (`TutorApplication.tutorProfileId`)
 * and the profile is created with it at submission — the wizard's uploads are
 * the profile's documents from the start, with nothing to carry across
 * (R13.11).
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export async function listVerificationRecords(tutorProfileId) {
  if (!tutorProfileId) return blankRecords();

  const records = await VerificationRecord.find({ tutorProfileId }).lean();
  const documents = await VerificationDocument.find({ tutorProfileId })
    .select("-storageKey")
    .sort({ uploadedAt: 1 })
    .lean();

  const byRecord = new Map();
  for (const doc of documents) {
    const key = String(doc.verificationRecordId);
    byRecord.set(key, [...(byRecord.get(key) ?? []), doc]);
  }

  // Present every badge type, including ones never submitted, so the tutor
  // can see what else is available to them.
  return Object.values(VERIFICATION_TYPES).map((type) => {
    const record = records.find((r) => r.type === type);
    return {
      type,
      label: VERIFICATION_LABELS[type],
      status: record?.status ?? VERIFICATION_STATUS.NOT_SUBMITTED,
      submittedAt: record?.submittedAt?.toISOString?.() ?? null,
      reviewedAt: record?.reviewedAt?.toISOString?.() ?? null,
      reviewerNote: record?.reviewerNote ?? null,
      referenceNumber: record?.referenceNumber ?? null,
      expiresAt: record?.expiresAt?.toISOString?.() ?? null,
      documentsDiscardedAt: record?.documentsDiscardedAt?.toISOString?.() ?? null,
      recordId: record ? String(record._id) : null,
      documents: toPlain(byRecord.get(String(record?._id)) ?? []),
    };
  });
}

function blankRecords() {
  return Object.values(VERIFICATION_TYPES).map((type) => ({
    type,
    label: VERIFICATION_LABELS[type],
    status: VERIFICATION_STATUS.NOT_SUBMITTED,
    submittedAt: null,
    reviewedAt: null,
    reviewerNote: null,
    referenceNumber: null,
    expiresAt: null,
    documentsDiscardedAt: null,
    recordId: null,
    documents: [],
  }));
}

/**
 * Where an applicant's documents go: their profile's id, reserved on their
 * own application when no profile exists yet.
 *
 * Ownership is the session's user and nothing else — the request names no
 * application or profile, so there is no id to point at somebody else's. The
 * reservation is a conditional write on an *unset* field, so two uploads
 * racing each other agree on one id.
 */
async function uploadTargetFor(userId) {
  const profile = await TutorProfile.findOne({ userId }).select("_id").lean();
  if (profile) return { tutorProfileId: profile._id, submitted: true };

  const application = await TutorApplication.findOne({ userId }).select("tutorProfileId").lean();
  if (!application) throw new NotFoundError("Start your tutor application first.");
  if (application.tutorProfileId) {
    return { tutorProfileId: application.tutorProfileId, submitted: false };
  }

  await TutorApplication.updateOne(
    { _id: application._id, tutorProfileId: null },
    { $set: { tutorProfileId: new Types.ObjectId() } },
  );
  const reserved = await TutorApplication.findById(application._id).select("tutorProfileId").lean();
  return { tutorProfileId: reserved.tutorProfileId, submitted: false };
}

export async function uploadVerificationDocument(
  { type, file, referenceNumber },
  actor,
) {
  if (!Object.values(VERIFICATION_TYPES).includes(type)) {
    throw new BusinessRuleError("Choose which badge this document supports.", "INVALID_TYPE");
  }

  const target = await uploadTargetFor(actor.id);

  if (file.size > UPLOAD.maxDocumentBytes) {
    throw new BusinessRuleError(
      `Documents must be smaller than ${Math.round(UPLOAD.maxDocumentBytes / 1024 / 1024)} MB.`,
      "FILE_TOO_LARGE",
    );
  }
  if (!UPLOAD.acceptedDocumentTypes.includes(file.type)) {
    throw new BusinessRuleError("Upload a PDF, JPG, PNG or WebP file.", "UNSUPPORTED_FILE_TYPE");
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // `file.type` is a claim the browser made. The stored content type is the
  // one the bytes actually are, so a script renamed to `.pdf` — or declared
  // as `application/pdf` — is refused rather than stored and later served
  // back to an administrator's browser (§16, §35). Checked before the record
  // is touched, so a refused file changes nobody's verification status.
  const contentType = inspectDocument(buffer);
  if (!contentType || !UPLOAD.acceptedDocumentTypes.includes(contentType)) {
    throw new BusinessRuleError(
      "That file is not a PDF, JPG, PNG or WebP. Upload the document in one of those formats.",
      "UNSUPPORTED_FILE_TYPE",
    );
  }
  if (contentType !== file.type) {
    throw new BusinessRuleError(
      "That file's contents do not match the type it claims to be.",
      "UNSUPPORTED_FILE_TYPE",
    );
  }

  // Kept as a label for the administrator, never as a path and never raw:
  // it ends up in a response header when the document is served back.
  const fileName = safeFileName(file.name, `${type}.pdf`);

  const stored = await (await getStorageProvider()).put({
    buffer,
    fileName,
    contentType,
    extension: documentExtensionFor(contentType),
    scope: STORAGE_SCOPES.DOCUMENTS,
  });

  try {
    // A submitted tutor's upload is a fresh submission for review. An
    // applicant's is evidence attached to a draft: it stays NOT_SUBMITTED,
    // out of the admin queue, until the application itself is submitted.
    const update = target.submitted
      ? {
          $set: {
            status: VERIFICATION_STATUS.PENDING,
            submittedAt: new Date(),
            ...(referenceNumber ? { referenceNumber } : {}),
          },
          // Clear any previous decision. The badge itself (and its expiry)
          // is untouched: a renewal uploaded early keeps the current badge
          // until it lapses or the new document is decided.
          $unset: { reviewerNote: "", reviewedAt: "", reviewedBy: "", documentsDiscardedAt: "" },
          $setOnInsert: { userId: actor.id },
        }
      : {
          ...(referenceNumber ? { $set: { referenceNumber } } : {}),
          $unset: { documentsDiscardedAt: "" },
          $setOnInsert: { userId: actor.id, status: VERIFICATION_STATUS.NOT_SUBMITTED },
        };

    const record = await VerificationRecord.findOneAndUpdate(
      { tutorProfileId: target.tutorProfileId, type },
      update,
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: false },
    );

    const document = await VerificationDocument.create({
      verificationRecordId: record._id,
      tutorProfileId: target.tutorProfileId,
      type,
      fileName,
      contentType,
      sizeBytes: stored.sizeBytes,
      storageKey: stored.storageKey,
      status: DOCUMENT_STATUS.UPLOADED,
    });

    return toPlain({ ...document.toObject(), storageKey: undefined });
  } catch (error) {
    // The bytes belong to nothing now. Take them back out rather than leave
    // identity paperwork orphaned in the store.
    await removeStoredDocument(stored.storageKey);
    throw error;
  }
}

/**
 * At submission: every badge the applicant asked for, or uploaded evidence
 * for, becomes a record awaiting review (§16). Records already decided are
 * left alone — resubmitting does not reopen an approved badge.
 */
export async function openVerificationRecords(profile, requestedBadges = []) {
  const now = new Date();
  const withDocuments = await VerificationRecord.find({
    tutorProfileId: profile._id,
    status: VERIFICATION_STATUS.NOT_SUBMITTED,
  })
    .select("type")
    .lean();
  const types = [...new Set([...requestedBadges, ...withDocuments.map((r) => r.type)])];

  for (const type of types) {
    await VerificationRecord.updateOne(
      { tutorProfileId: profile._id, type },
      { $setOnInsert: { userId: profile.userId, status: VERIFICATION_STATUS.PENDING, submittedAt: now } },
      { upsert: true },
    );
    await VerificationRecord.updateOne(
      { tutorProfileId: profile._id, type, status: VERIFICATION_STATUS.NOT_SUBMITTED },
      { $set: { status: VERIFICATION_STATUS.PENDING, submittedAt: now, userId: profile.userId } },
    );
  }
}

/** Stream a document to an administrator. Never reachable by anyone else. */
export async function readVerificationDocument(documentId, admin) {
  if (admin.role !== "ADMIN") {
    throw new AuthorizationError("Only administrators can view verification documents.");
  }

  const document = await VerificationDocument.findById(documentId)
    .select("+storageKey")
    .lean();
  if (!document) throw new NotFoundError("That document no longer exists.");
  if (document.discardedAt || !document.storageKey) {
    throw new NotFoundError("That document was deleted under the document retention policy.");
  }

  const buffer = await (await getStorageProviderForRead()).get({
    storageKey: document.storageKey,
    scope: STORAGE_SCOPES.DOCUMENTS,
  });

  // A view is its own event, never a grant (S15): who opened which person's
  // identity paperwork, and when.
  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.VERIFICATION_DOCUMENT_VIEWED,
    entityType: "VerificationDocument",
    entityId: document._id,
    metadata: {
      type: document.type,
      tutorProfileId: String(document.tutorProfileId),
      verificationRecordId: String(document.verificationRecordId),
    },
  });

  // Sanitised again on the way out: documents stored before the upload path
  // cleaned filenames must not become a header-injection vector now.
  return {
    buffer,
    contentType: document.contentType,
    fileName: safeFileName(document.fileName, "document"),
  };
}

export async function decideVerification(
  recordId,
  { status, note, referenceNumber, expiresAt, educationEntryIds },
  admin,
) {
  const record = await VerificationRecord.findById(recordId);
  if (!record) throw new NotFoundError("That verification record no longer exists.");

  const profile = await TutorProfile.findById(record.tutorProfileId);
  if (!profile) {
    throw new BusinessRuleError(
      "This applicant has not submitted their application yet.",
      "APPLICATION_NOT_SUBMITTED",
    );
  }

  if (status === "APPROVED") {
    await approveBadge(profile, record.type, admin, {
      expiresAt, note, referenceNumber, educationEntryIds,
    });
    await profile.save();
  } else {
    record.status =
      status === "REJECTED" ? VERIFICATION_STATUS.REJECTED : VERIFICATION_STATUS.INFO_REQUESTED;
    record.reviewedAt = new Date();
    record.reviewedBy = admin.id;
    record.reviewerNote = note;
    if (referenceNumber) record.referenceNumber = referenceNumber;
    await record.save();

    await VerificationDocument.updateMany(
      { verificationRecordId: record._id, discardedAt: { $exists: false } },
      { $set: { status: DOCUMENT_STATUS.REJECTED, reviewerNote: note } },
    );
    await revokeBadge(profile, record.type, admin, note);
  }

  const decided = await VerificationRecord.findById(recordId).lean();

  await notify({
    userId: decided.userId ?? profile.userId,
    type: NOTIFICATION_TYPES.VERIFICATION_UPDATED,
    title:
      status === "APPROVED"
        ? `${VERIFICATION_LABELS[record.type]} approved`
        : `${VERIFICATION_LABELS[record.type]} needs attention`,
    body: note ?? "Open your verification page for details.",
    href: "/tutor/verification",
    entityType: "VerificationRecord",
    entityId: record._id,
  });

  return toPlain(decided);
}

/**
 * When a badge being granted lapses (R11.5).
 *
 * The administrator's date when they gave one — it must be in the future —
 * otherwise a Background Check gets `backgroundCheckValidityMonths` from now,
 * because "recent" is the whole meaning of that badge. Other badges do not
 * lapse unless a date is set.
 */
export async function badgeExpiryFor(type, requested, now = new Date()) {
  if (requested) {
    const date = new Date(requested);
    if (Number.isNaN(date.getTime()) || date <= now) {
      throw new BusinessRuleError("Choose an expiry date in the future.", "INVALID_EXPIRY", {
        fieldErrors: { expiresAt: ["Choose an expiry date in the future."] },
      });
    }
    return date;
  }
  if (type !== VERIFICATION_TYPES.BACKGROUND_CHECK) return undefined;

  const { backgroundCheckValidityMonths } = await getSettings();
  const expiry = new Date(now);
  expiry.setUTCMonth(expiry.getUTCMonth() + backgroundCheckValidityMonths);
  return expiry;
}

/**
 * Grant one badge — the single implementation behind an application's
 * approval, a record decision and "Manage badges" (§16, R28.8).
 *
 * Mutates `profile` (the caller saves it, so an approval writes the profile
 * once) and settles the record and its documents. A badge already held is
 * replaced rather than skipped, so a renewal carries its new expiry.
 */
export async function approveBadge(
  profile,
  type,
  admin,
  { expiresAt, note, referenceNumber, educationEntryIds, now = new Date() } = {},
) {
  const expiry = await badgeExpiryFor(type, expiresAt, now);

  if (type === VERIFICATION_TYPES.EDUCATION && educationEntryIds?.length) {
    markEducationVerified(profile, educationEntryIds);
  }

  profile.verificationBadges = [
    ...(profile.verificationBadges ?? []).filter((b) => b.type !== type),
    { type, grantedBy: admin.id, grantedAt: now, ...(expiry ? { expiresAt: expiry } : {}) },
  ];
  if (!profile.verifiedTypes.includes(type)) profile.verifiedTypes.push(type);

  const record = await VerificationRecord.findOneAndUpdate(
    { tutorProfileId: profile._id, type },
    {
      $set: {
        status: VERIFICATION_STATUS.APPROVED,
        reviewedAt: now,
        reviewedBy: admin.id,
        ...(note ? { reviewerNote: note } : {}),
        ...(referenceNumber ? { referenceNumber } : {}),
        ...(expiry ? { expiresAt: expiry } : {}),
      },
      ...(expiry ? {} : { $unset: { expiresAt: "" } }),
      // Records created by a grant used to be written without the owner,
      // which left them invisible to anything that asks by account.
      $setOnInsert: { userId: profile.userId, submittedAt: now },
    },
    { upsert: true, returnDocument: "after" },
  );

  await VerificationDocument.updateMany(
    { verificationRecordId: record._id, discardedAt: { $exists: false } },
    { $set: { status: DOCUMENT_STATUS.APPROVED } },
  );

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.VERIFICATION_BADGE_GRANTED,
    entityType: "TutorProfile",
    entityId: profile._id,
    metadata: { type, expiresAt: expiry?.toISOString() ?? null },
  });

  return record;
}

/**
 * Mark education entries as checked against a document (R10.11). Only ever
 * set by an administrator; an id that is not one of this profile's entries
 * is refused rather than ignored, so a stale form cannot silently do nothing.
 */
export function markEducationVerified(profile, entryIds, { exact = false } = {}) {
  const wanted = new Set(entryIds.map(String));
  const known = new Set((profile.education ?? []).map((entry) => String(entry._id)));
  const unknown = [...wanted].filter((id) => !known.has(id));
  if (unknown.length) {
    throw new BusinessRuleError(
      "That education entry is not on this profile any more. Reload and try again.",
      "UNKNOWN_EDUCATION_ENTRY",
    );
  }
  for (const entry of profile.education ?? []) {
    if (wanted.has(String(entry._id))) entry.verified = true;
    else if (exact) entry.verified = false;
  }
}

async function revokeBadge(profile, type, admin, reason) {
  profile.verifiedTypes = profile.verifiedTypes.filter((t) => t !== type);
  profile.verificationBadges = profile.verificationBadges.filter((b) => b.type !== type);
  await profile.save();

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.VERIFICATION_BADGE_REVOKED,
    entityType: "TutorProfile",
    entityId: profile._id,
    metadata: { type, reason },
  });
}

/** Direct badge control from the admin tutor page (§16, R28.8). */
export async function mutateBadge(
  tutorProfileId,
  { type, action, reason, expiresAt, educationEntryIds },
  admin,
) {
  const profile = await TutorProfile.findById(tutorProfileId);
  if (!profile) throw new NotFoundError("That tutor no longer exists.");

  if (action === "GRANT") {
    await approveBadge(profile, type, admin, { expiresAt, note: reason, educationEntryIds });
    await profile.save();
  } else {
    await revokeBadge(profile, type, admin, reason);
    await VerificationRecord.updateOne(
      { tutorProfileId, type },
      {
        $set: {
          status: VERIFICATION_STATUS.REJECTED,
          reviewedAt: new Date(),
          reviewedBy: admin.id,
          reviewerNote: reason,
        },
      },
    );
  }

  await notify({
    userId: profile.userId,
    type: NOTIFICATION_TYPES.VERIFICATION_UPDATED,
    title:
      action === "GRANT"
        ? `You earned the ${VERIFICATION_LABELS[type]} badge`
        : `Your ${VERIFICATION_LABELS[type]} badge was removed`,
    body: reason,
    href: "/tutor/verification",
    entityType: "TutorProfile",
    entityId: profile._id,
  });

  return toPlain(profile);
}

/** Admin queue of everything awaiting a verification decision. */
export async function pendingVerificationQueue({ page = 1, pageSize = 20 } = {}) {
  const query = {
    status: { $in: [VERIFICATION_STATUS.PENDING, VERIFICATION_STATUS.INFO_REQUESTED] },
  };

  const [records, total] = await Promise.all([
    VerificationRecord.find(query)
      .sort({ submittedAt: 1 })
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .populate("userId", "firstName lastName email")
      .populate("tutorProfileId", "slug headline city province status")
      .lean(),
    VerificationRecord.countDocuments(query),
  ]);

  const documents = await VerificationDocument.find({
    verificationRecordId: { $in: records.map((r) => r._id) },
  })
    .select("-storageKey")
    .lean();

  const byRecord = new Map();
  for (const doc of documents) {
    const key = String(doc.verificationRecordId);
    byRecord.set(key, [...(byRecord.get(key) ?? []), doc]);
  }

  return {
    items: toPlain(records).map((record) => ({
      ...record,
      label: VERIFICATION_LABELS[record.type],
      documents: toPlain(byRecord.get(record.id) ?? []),
    })),
    total,
    page,
    pageSize,
  };
}

/**
 * Badges that have lapsed (R11.5).
 *
 * Driven by the *badge* on the profile, not by the record's status: a tutor
 * who uploads a renewal moves the record to PENDING, and that must not keep
 * an expired badge on their profile while the new document waits. Each badge
 * is claimed with a conditional pull — it only matches while an expired entry
 * of that type is still there — so overlapping runs, or a re-grant landing
 * between the read and the write, never remove a live badge or notify twice.
 */
export async function expireStaleVerifications({ now = new Date() } = {}) {
  const profiles = await TutorProfile.find({
    verificationBadges: { $elemMatch: { expiresAt: { $lt: now } } },
  })
    .select("_id userId verificationBadges")
    .lean();

  let expired = 0;
  for (const profile of profiles) {
    for (const badge of profile.verificationBadges ?? []) {
      if (!badge.expiresAt || badge.expiresAt >= now) continue;

      const claimed = await TutorProfile.updateOne(
        {
          _id: profile._id,
          verificationBadges: { $elemMatch: { type: badge.type, expiresAt: { $lt: now } } },
        },
        {
          $pull: {
            verifiedTypes: badge.type,
            verificationBadges: { type: badge.type, expiresAt: { $lt: now } },
          },
        },
      );
      if (!claimed.modifiedCount) continue;
      expired += 1;

      await VerificationRecord.updateOne(
        { tutorProfileId: profile._id, type: badge.type, status: VERIFICATION_STATUS.APPROVED },
        { $set: { status: VERIFICATION_STATUS.EXPIRED } },
      );
      await notify({
        userId: profile.userId,
        type: NOTIFICATION_TYPES.VERIFICATION_UPDATED,
        title: `Your ${VERIFICATION_LABELS[badge.type]} badge has expired`,
        body: "Upload a current document to restore the badge on your profile.",
        href: "/tutor/verification",
      });
    }
  }

  // Approved records past their date whose badge was already gone (removed
  // by hand, or by an earlier run that stopped part-way) settle quietly.
  const settled = await VerificationRecord.updateMany(
    { status: VERIFICATION_STATUS.APPROVED, expiresAt: { $lt: now } },
    { $set: { status: VERIFICATION_STATUS.EXPIRED } },
  );

  return { expired, recordsSettled: settled.modifiedCount };
}

// --- Document retention (S9, R30.10) ----------------------------------------

/** Best-effort removal of stored bytes on a failure path. Never throws. */
async function removeStoredDocument(storageKey) {
  if (!storageKey) return;
  try {
    await (await getStorageProviderForRead()).remove({ storageKey, scope: STORAGE_SCOPES.DOCUMENTS });
  } catch (error) {
    console.warn("[verification] could not remove an unreferenced document:", error.message);
  }
}

/**
 * Delete the stored bytes of every document under these records, keeping
 * each row's metadata (type, file name, size, decision) with `discardedAt`.
 *
 * Bytes first, row second, per document: a document whose bytes could not be
 * deleted keeps its key and is retried on the next run, and its record is not
 * marked as discarded. The read-side store is used because retention must run
 * even while uploads are switched off.
 */
async function discardDocumentsOf(recordIds, { now = new Date(), actor, reason }) {
  if (!recordIds.length) return { records: 0, discarded: 0, failed: 0 };

  const documents = await VerificationDocument.find({
    verificationRecordId: { $in: recordIds },
    discardedAt: { $exists: false },
  })
    .select("+storageKey")
    .lean();

  const storage = await getStorageProviderForRead();
  const failedRecords = new Set();
  let discarded = 0;

  for (const document of documents) {
    try {
      if (document.storageKey) {
        await storage.remove({ storageKey: document.storageKey, scope: STORAGE_SCOPES.DOCUMENTS });
      }
      const result = await VerificationDocument.updateOne(
        { _id: document._id, discardedAt: { $exists: false } },
        { $set: { discardedAt: now }, $unset: { storageKey: "" } },
      );
      discarded += result.modifiedCount;
    } catch (error) {
      failedRecords.add(String(document.verificationRecordId));
      console.warn(`[verification] could not discard document ${document._id}:`, error.message);
    }
  }

  const settled = recordIds.filter((id) => !failedRecords.has(String(id)));
  const marked = await VerificationRecord.updateMany(
    { _id: { $in: settled }, documentsDiscardedAt: { $exists: false } },
    { $set: { documentsDiscardedAt: now } },
  );

  if (discarded > 0) {
    await recordAudit({
      actor: actor ?? { role: "SYSTEM" },
      action: AUDIT_ACTIONS.VERIFICATION_DOCUMENTS_DISCARDED,
      entityType: "VerificationRecord",
      metadata: { reason, records: settled.length, documents: discarded, failed: failedRecords.size },
    });
  }

  return { records: marked.modifiedCount, discarded, failed: failedRecords.size };
}

/**
 * The `verification-document-retention` job (S9).
 *
 * Documents behind a declined badge, or a badge that has lapsed, are deleted
 * `verificationDocumentRetentionDays` after the decision or expiry. Approved,
 * pending and draft evidence is never touched. Idempotent: a record is
 * stamped only once all its bytes are gone, and a discarded document is
 * never selected again.
 */
export async function discardStaleVerificationDocuments({ now = new Date(), actor } = {}) {
  const { verificationDocumentRetentionDays } = await getSettings();
  const cutoff = new Date(now.getTime() - verificationDocumentRetentionDays * DAY_MS);

  const records = await VerificationRecord.find({
    documentsDiscardedAt: { $exists: false },
    $or: [
      { status: VERIFICATION_STATUS.REJECTED, reviewedAt: { $lt: cutoff } },
      { status: VERIFICATION_STATUS.EXPIRED, expiresAt: { $lt: cutoff } },
    ],
  })
    .select("_id")
    .limit(500)
    .lean();

  const result = await discardDocumentsOf(records.map((r) => r._id), {
    now, actor, reason: "RETENTION",
  });
  return { examined: records.length, discarded: result.discarded, failed: result.failed };
}

/**
 * Delete every verification document an account ever uploaded (S9).
 *
 * For account anonymisation. Records are found by owner *and* by the
 * account's profile id (reserved or real), because records written by older
 * grant paths can lack the owner.
 */
export async function discardVerificationDocuments({ userId, actor, now = new Date() }) {
  const [profile, application] = await Promise.all([
    TutorProfile.findOne({ userId }).select("_id").lean(),
    TutorApplication.findOne({ userId }).select("tutorProfileId").lean(),
  ]);
  const profileIds = [profile?._id, application?.tutorProfileId].filter(Boolean);

  const records = await VerificationRecord.find({
    $or: [{ userId }, ...(profileIds.length ? [{ tutorProfileId: { $in: profileIds } }] : [])],
  })
    .select("_id")
    .lean();

  return discardDocumentsOf(records.map((r) => r._id), { now, actor, reason: "ACCOUNT_DELETION" });
}
