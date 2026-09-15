"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, ShieldCheck, Clock, X, Check, FileText, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ApiError } from "@/lib/api/client";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Spinner, useToast } from "@/components/ui";
import {
  VERIFICATION_STATUS, VERIFICATION_DESCRIPTIONS, UPLOAD,
} from "@/constants";
import { formatDate } from "@/lib/utils/format";

const STATUS_META = {
  [VERIFICATION_STATUS.NOT_SUBMITTED]: { tone: "neutral", label: "Not submitted", icon: Upload },
  [VERIFICATION_STATUS.PENDING]: { tone: "warning", label: "Under review", icon: Clock },
  [VERIFICATION_STATUS.INFO_REQUESTED]: { tone: "warning", label: "More info needed", icon: AlertTriangle },
  [VERIFICATION_STATUS.APPROVED]: { tone: "success", label: "Verified", icon: Check },
  [VERIFICATION_STATUS.REJECTED]: { tone: "danger", label: "Not approved", icon: X },
  [VERIFICATION_STATUS.EXPIRED]: { tone: "warning", label: "Expired", icon: Clock },
};

/**
 * Tutor's own view of their verification badges (§16).
 *
 * A tutor can upload evidence and see the decision, but never grants or
 * changes a badge — that is an administrator action only (§42).
 */
export function VerificationPanel({ records, justSubmitted }) {
  const approved = records.filter((r) => r.status === VERIFICATION_STATUS.APPROVED);

  return (
    <div className="space-y-6">
      {justSubmitted && (
        <Alert tone="success" title="Application submitted">
          Our team reviews applications and documents within two business days. You&rsquo;ll be
          emailed as soon as there&rsquo;s a decision.
        </Alert>
      )}

      <Alert tone="info" title="Badges are earned one at a time" icon={<ShieldCheck className="size-3" />}>
        Each badge means our team verified one specific document. Families filter by them, and
        profiles with more badges get noticeably more bookings.
        {approved.length > 0 && (
          <span className="mt-2 block font-semibold">
            You&rsquo;ve earned {approved.length} of {records.length}.
          </span>
        )}
      </Alert>

      <div className="space-y-4">
        {records.map((record) => (
          <VerificationCard key={record.type} record={record} />
        ))}
      </div>
    </div>
  );
}

function VerificationCard({ record }) {
  const meta = STATUS_META[record.status] ?? STATUS_META.NOT_SUBMITTED;
  const Icon = meta.icon;
  const canUpload =
    record.status !== VERIFICATION_STATUS.APPROVED &&
    record.status !== VERIFICATION_STATUS.PENDING;

  return (
    <Card>
      <CardHeader
        title={record.label}
        description={VERIFICATION_DESCRIPTIONS[record.type]}
        action={
          <Badge tone={meta.tone} icon={<Icon className="size-3" />}>
            {meta.label}
          </Badge>
        }
      />
      <CardBody>
        {record.reviewerNote && (
          <Alert
            tone={record.status === VERIFICATION_STATUS.APPROVED ? "success" : "warning"}
            title="From our team"
            className="mb-4"
          >
            {record.reviewerNote}
          </Alert>
        )}

        <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
          {record.submittedAt && (
            <div>
              <dt className="text-ink-400">Submitted</dt>
              <dd className="font-semibold text-ink-700">{formatDate(record.submittedAt)}</dd>
            </div>
          )}
          {record.reviewedAt && (
            <div>
              <dt className="text-ink-400">Reviewed</dt>
              <dd className="font-semibold text-ink-700">{formatDate(record.reviewedAt)}</dd>
            </div>
          )}
          {record.referenceNumber && (
            <div>
              <dt className="text-ink-400">Reference</dt>
              <dd className="font-semibold text-ink-700">{record.referenceNumber}</dd>
            </div>
          )}
          {record.expiresAt && (
            <div>
              <dt className="text-ink-400">Expires</dt>
              <dd className="font-semibold text-ink-700">{formatDate(record.expiresAt)}</dd>
            </div>
          )}
        </dl>

        {record.documents?.length > 0 && (
          <ul className="mb-4 space-y-2">
            {record.documents.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center gap-3 rounded-lg border border-ink-200 p-2.5"
              >
                <FileText className="size-4 shrink-0 text-ink-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-ink-800">
                    {doc.fileName}
                  </span>
                  <span className="text-xs text-ink-500">
                    {(doc.sizeBytes / 1024).toFixed(0)} KB · uploaded{" "}
                    {formatDate(doc.uploadedAt ?? doc.createdAt)}
                  </span>
                </span>
                <Badge
                  tone={doc.status === "APPROVED" ? "success" : doc.status === "REJECTED" ? "danger" : "neutral"}
                  size="sm"
                >
                  {doc.status.toLowerCase().replace("_", " ")}
                </Badge>
              </li>
            ))}
          </ul>
        )}

        {canUpload && <DocumentUpload type={record.type} />}

        {record.status === VERIFICATION_STATUS.PENDING && (
          <p className="text-sm text-ink-500">
            Your document is with our team. We&rsquo;ll email you when it&rsquo;s been reviewed.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function DocumentUpload({ type }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const upload = async (file) => {
    if (!file) return;

    if (file.size > UPLOAD.maxDocumentBytes) {
      toast.error(
        "File too large",
        `Documents must be under ${Math.round(UPLOAD.maxDocumentBytes / 1024 / 1024)} MB.`,
      );
      return;
    }
    if (!UPLOAD.acceptedDocumentTypes.includes(file.type)) {
      toast.error("Unsupported file", "Upload a PDF, JPG, PNG or WebP.");
      return;
    }

    setUploading(true);
    const form = new FormData();
    form.append("type", type);
    form.append("file", file);

    try {
      const response = await fetch("/api/tutor/verification/upload", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        throw new ApiError(payload?.error?.message ?? "Upload failed");
      }
      toast.success("Document uploaded", "Our team will review it shortly.");
      router.refresh();
    } catch (error) {
      toast.error("Upload failed", error.message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <label
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(e.dataTransfer.files?.[0]);
      }}
      className={cn(
        "flex cursor-pointer items-center justify-center gap-3 rounded-xl border-2 border-dashed p-5 transition-colors",
        dragging ? "border-brand-500 bg-brand-50" : "border-ink-300 hover:border-brand-400",
      )}
    >
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept={UPLOAD.acceptedDocumentTypes.join(",")}
        onChange={(e) => upload(e.target.files?.[0])}
        disabled={uploading}
      />
      {uploading ? (
        <>
          <Spinner className="size-4 text-brand-600" />
          <span className="text-sm text-ink-600">Uploading…</span>
        </>
      ) : (
        <>
          <Upload className="size-4 text-ink-400" />
          <span className="text-sm text-ink-600">
            <span className="font-semibold text-brand-600">Choose a file</span> or drag it here
          </span>
        </>
      )}
    </label>
  );
}
