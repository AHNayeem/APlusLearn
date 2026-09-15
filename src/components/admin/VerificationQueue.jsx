"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, X, MessageSquareWarning, FileText, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input, Modal,
  Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { formatDate, formatRelative } from "@/lib/utils/format";
import { useToday } from "@/hooks/useToday";

/** Verification queue with per-record decisions (§16). */
export function VerificationQueue({ records }) {
  const [decision, setDecision] = useState(null);

  if (records.length === 0) {
    return (
      <EmptyState
        icon={<Check className="size-7" />}
        title="Nothing waiting"
        description="Every verification document has been reviewed."
      />
    );
  }

  return (
    <>
      <div className="space-y-4">
        {records.map((record) => (
          <Card key={record.id}>
            <CardHeader
              title={record.label}
              description={
                <span>
                  {record.userId?.firstName} {record.userId?.lastName} ·{" "}
                  <span className="text-ink-400">{record.userId?.email}</span>
                </span>
              }
              action={
                <Badge tone="warning">
                  Submitted {formatRelative(record.submittedAt)}
                </Badge>
              }
            />
            <CardBody>
              <dl className="mb-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                <div>
                  <dt className="text-ink-400">Profile</dt>
                  <dd className="font-semibold text-ink-700">
                    {record.tutorProfileId?.slug ? (
                      <Link
                        href={`/tutors/${record.tutorProfileId.slug}`}
                        className="text-brand-600 hover:underline"
                      >
                        {record.tutorProfileId.headline?.slice(0, 40) ?? "View"}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-ink-400">Location</dt>
                  <dd className="font-semibold text-ink-700">
                    {record.tutorProfileId?.city}, {record.tutorProfileId?.province}
                  </dd>
                </div>
                {record.referenceNumber && (
                  <div>
                    <dt className="text-ink-400">Reference</dt>
                    <dd className="font-semibold text-ink-700">{record.referenceNumber}</dd>
                  </div>
                )}
              </dl>

              {record.documents?.length > 0 ? (
                <ul className="mb-4 space-y-2">
                  {record.documents.map((doc) => (
                    <li
                      key={doc.id}
                      className="flex items-center gap-3 rounded-lg border border-ink-200 p-2.5"
                    >
                      <FileText className="size-4 shrink-0 text-ink-400" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-700">
                        {doc.fileName}
                        <span className="ml-2 text-xs text-ink-400">
                          {(doc.sizeBytes / 1024).toFixed(0)} KB
                        </span>
                      </span>
                      <a
                        href={`/api/admin/verification/documents/${doc.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
                      >
                        Open
                        <ExternalLink className="size-3" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mb-4 text-sm text-warning-700">
                  No document uploaded — request one before deciding.
                </p>
              )}

              <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-4">
                <Button
                  size="sm"
                  onClick={() => setDecision({ record, status: "APPROVED" })}
                  iconLeft={<Check className="size-3.5" />}
                >
                  Approve badge
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setDecision({ record, status: "INFO_REQUESTED" })}
                  iconLeft={<MessageSquareWarning className="size-3.5" />}
                >
                  Request more
                </Button>
                <Button
                  variant="dangerGhost"
                  size="sm"
                  onClick={() => setDecision({ record, status: "REJECTED" })}
                  iconLeft={<X className="size-3.5" />}
                >
                  Reject
                </Button>
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <DecisionModal decision={decision} onClose={() => setDecision(null)} />
    </>
  );
}

function DecisionModal({ decision, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [referenceNumber, setReferenceNumber] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const today = useToday();

  const isApprove = decision?.status === "APPROVED";

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/admin/verification/${decision.record.id}`, {
      status: decision.status,
      note: note || undefined,
      referenceNumber: referenceNumber || undefined,
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
    });
    toast.success(
      isApprove ? "Badge granted" : "Decision recorded",
      "The tutor has been notified.",
    );
    onClose();
    setNote("");
    setReferenceNumber("");
    setExpiresAt("");
    router.refresh();
  });

  if (!decision) return null;

  const titles = {
    APPROVED: `Approve ${decision.record.label}`,
    REJECTED: `Reject ${decision.record.label}`,
    INFO_REQUESTED: "Request more information",
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={titles[decision.status]}
      description={
        isApprove
          ? "The badge appears on their profile immediately and families can filter by it."
          : "They'll be emailed your note and can upload a new document."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={decision.status === "REJECTED" ? "danger" : "primary"}
            onClick={submit}
            loading={pending}
            disabled={!isApprove && note.trim().length < 5}
          >
            {isApprove ? "Grant badge" : "Record decision"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        {isApprove && (
          <>
            <Field
              label="Reference number"
              htmlFor="verify-reference"
              hint="Optional — OCT registration, check reference, etc."
            >
              <Input
                id="verify-reference"
                value={referenceNumber}
                onChange={(e) => setReferenceNumber(e.target.value)}
                placeholder="482915"
              />
            </Field>

            <Field
              label="Expires on"
              htmlFor="verify-expires"
              hint="Background checks and OCT memberships lapse. Leave blank if it doesn't expire."
            >
              <Input
                id="verify-expires"
                type="date"
                value={expiresAt}
                onChange={(e) => setExpiresAt(e.target.value)}
                min={today}
              />
            </Field>
          </>
        )}

        <Field
          label={isApprove ? "Internal note (optional)" : "What do they need to do?"}
          htmlFor="verify-note"
          error={fieldErrors.note}
          required={!isApprove}
        >
          <Textarea
            id="verify-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            error={fieldErrors.note}
            placeholder={
              isApprove
                ? "Checked against the OCT public register — active member in good standing."
                : "The document you uploaded is a course transcript, not proof of your degree. Please upload your diploma or an official degree confirmation letter."
            }
          />
        </Field>
      </div>
    </Modal>
  );
}
