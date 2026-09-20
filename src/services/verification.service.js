import "server-only";
import { VerificationRecord, VerificationDocument, TutorProfile, User } from "@/models";
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
import { inspectDocument, safeFileName } from "@/lib/images/inspect";
import { getStorageProvider, getStorageProviderForRead, STORAGE_SCOPES } from "./external/storage-provider";
import { notify } from "./notification.service";
import { recordAudit } from "./audit.service";

/**
 * Tutor verification (§16).
 *
 * Badge state is controlled entirely by administrators. A tutor can upload
 * evidence and see their own status, but can never grant themselves a badge
 * or change a record's status (§42).
 */

export async function listVerificationRecords(tutorProfileId) {
  const records = await VerificationRecord.find({ tutorProfileId }).lean();
  const documents = await VerificationDocument.find({ tutorProfileId })
    .select("-storageKey")
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
      recordId: record ? String(record._id) : null,
      documents: toPlain(byRecord.get(String(record?._id)) ?? []),
    };
  });
}

export async function uploadVerificationDocument(
  { type, file, referenceNumber },
  actor,
) {
  const profile = await TutorProfile.findOne({ userId: actor.id }).select("_id").lean();
  if (!profile) throw new NotFoundError("Start your tutor application first.");

  if (file.size > UPLOAD.maxDocumentBytes) {
    throw new BusinessRuleError(
      `Documents must be smaller than ${Math.round(UPLOAD.maxDocumentBytes / 1024 / 1024)} MB.`,
      "FILE_TOO_LARGE",
    );
  }
  if (!UPLOAD.acceptedDocumentTypes.includes(file.type)) {
    throw new BusinessRuleError("Upload a PDF, JPG, PNG or WebP file.", "UNSUPPORTED_FILE_TYPE");
  }

  const record = await VerificationRecord.findOneAndUpdate(
    { tutorProfileId: profile._id, type },
    {
      $set: {
        status: VERIFICATION_STATUS.PENDING,
        submittedAt: new Date(),
        referenceNumber,
        // Clear any previous decision — this is a fresh submission.
        reviewerNote: undefined,
        reviewedAt: undefined,
        reviewedBy: undefined,
      },
      $setOnInsert: { tutorProfileId: profile._id, userId: actor.id, type },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  const buffer = Buffer.from(await file.arrayBuffer());

  // `file.type` is a claim the browser made. The stored content type is the
  // one the bytes actually are, so a script renamed to `.pdf` — or declared
  // as `application/pdf` — is refused rather than stored and later served
  // back to an administrator's browser (§16, §35).
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
    extension: extensionForDocument(contentType),
    scope: STORAGE_SCOPES.DOCUMENTS,
  });

  const document = await VerificationDocument.create({
    verificationRecordId: record._id,
    tutorProfileId: profile._id,
    type,
    fileName,
    contentType,
    sizeBytes: stored.sizeBytes,
    storageKey: stored.storageKey,
    status: DOCUMENT_STATUS.UPLOADED,
  });

  return toPlain({ ...document.toObject(), storageKey: undefined });
}

const DOCUMENT_EXTENSIONS = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function extensionForDocument(contentType) {
  return DOCUMENT_EXTENSIONS[contentType] ?? "";
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

  const buffer = await (await getStorageProviderForRead()).get({
    storageKey: document.storageKey,
    scope: STORAGE_SCOPES.DOCUMENTS,
  });

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.VERIFICATION_BADGE_GRANTED,
    entityType: "VerificationDocument",
    entityId: document._id,
    metadata: { viewed: true },
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
  { status, note, referenceNumber, expiresAt },
  admin,
) {
  const record = await VerificationRecord.findById(recordId);
  if (!record) throw new NotFoundError("That verification record no longer exists.");

  const profile = await TutorProfile.findById(record.tutorProfileId);
  if (!profile) throw new NotFoundError("That tutor profile no longer exists.");

  record.status =
    status === "APPROVED"
      ? VERIFICATION_STATUS.APPROVED
      : status === "REJECTED"
        ? VERIFICATION_STATUS.REJECTED
        : VERIFICATION_STATUS.INFO_REQUESTED;
  record.reviewedAt = new Date();
  record.reviewedBy = admin.id;
  record.reviewerNote = note;
  if (referenceNumber) record.referenceNumber = referenceNumber;
  if (expiresAt) record.expiresAt = new Date(expiresAt);
  await record.save();

  await VerificationDocument.updateMany(
    { verificationRecordId: record._id },
    {
      $set: {
        status: status === "APPROVED" ? DOCUMENT_STATUS.APPROVED : DOCUMENT_STATUS.REJECTED,
        reviewerNote: note,
      },
    },
  );

  if (status === "APPROVED") {
    await grantBadge(profile, record.type, admin, record.expiresAt);
  } else {
    await revokeBadge(profile, record.type, admin, note);
  }

  await notify({
    userId: record.userId,
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

  return toPlain(record);
}

async function grantBadge(profile, type, admin, expiresAt) {
  if (!profile.verifiedTypes.includes(type)) {
    profile.verificationBadges.push({
      type,
      grantedBy: admin.id,
      grantedAt: new Date(),
      expiresAt,
    });
    profile.verifiedTypes.push(type);
    await profile.save();
  }

  await recordAudit({
    actor: admin,
    action: AUDIT_ACTIONS.VERIFICATION_BADGE_GRANTED,
    entityType: "TutorProfile",
    entityId: profile._id,
    metadata: { type },
  });
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

/** Direct badge control from the admin tutor page (§16). */
export async function mutateBadge(tutorProfileId, { type, action, reason }, admin) {
  const profile = await TutorProfile.findById(tutorProfileId);
  if (!profile) throw new NotFoundError("That tutor no longer exists.");

  if (action === "GRANT") {
    await grantBadge(profile, type, admin);
    await VerificationRecord.findOneAndUpdate(
      { tutorProfileId, type },
      {
        $set: {
          status: VERIFICATION_STATUS.APPROVED,
          reviewedAt: new Date(),
          reviewedBy: admin.id,
          reviewerNote: reason,
        },
        $setOnInsert: { tutorProfileId, userId: profile.userId, type },
      },
      { upsert: true },
    );
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

/** Badges that have lapsed and need re-verification. */
export async function expireStaleVerifications() {
  const expired = await VerificationRecord.find({
    status: VERIFICATION_STATUS.APPROVED,
    expiresAt: { $lt: new Date() },
  }).lean();

  for (const record of expired) {
    await VerificationRecord.updateOne(
      { _id: record._id },
      { $set: { status: VERIFICATION_STATUS.EXPIRED } },
    );
    await TutorProfile.updateOne(
      { _id: record.tutorProfileId },
      {
        $pull: { verifiedTypes: record.type, verificationBadges: { type: record.type } },
      },
    );
    await notify({
      userId: record.userId,
      type: NOTIFICATION_TYPES.VERIFICATION_UPDATED,
      title: `Your ${VERIFICATION_LABELS[record.type]} badge has expired`,
      body: "Upload a current document to restore the badge on your profile.",
      href: "/tutor/verification",
    });
  }

  return { expired: expired.length };
}
