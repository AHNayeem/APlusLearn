"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, X, MessageSquareWarning, FileText, ExternalLink } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Modal,
  Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import {
  TUTOR_STATUS, VERIFICATION_TYPES, VERIFICATION_LABELS, VERIFICATION_STATUS,
} from "@/constants";
import { formatDate } from "@/lib/utils/format";

/**
 * Approve, reject or request more information on a tutor application (§16).
 *
 * Approving is the only path that makes a profile searchable, and the badges
 * granted here are recorded against the admin who granted them (§35, §42).
 */
export function ApplicationReview({ application, verification }) {
  const [decision, setDecision] = useState(null);

  const isPending = application.status === TUTOR_STATUS.PENDING_REVIEW;

  return (
    <>
      <Card className={isPending ? "border-brand-300" : undefined}>
        <CardHeader
          title="Decision"
          description={
            isPending
              ? "Approving makes this profile visible in search immediately."
              : `Already reviewed — currently ${application.status.replace(/_/g, " ").toLowerCase()}.`
          }
        />
        <CardBody>
          {application.reviewNotes?.length > 0 && (
            <div className="mb-5 space-y-2">
              {application.reviewNotes.map((note) => (
                <div key={note._id ?? note.createdAt} className="rounded-xl bg-ink-50 p-3">
                  <p className="flex items-center gap-2 text-xs font-bold text-ink-700">
                    <Badge tone="neutral" size="sm">
                      {note.action?.replace(/_/g, " ").toLowerCase()}
                    </Badge>
                    {formatDate(note.createdAt)}
                  </p>
                  {note.message && (
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{note.message}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setDecision(TUTOR_STATUS.APPROVED)} iconLeft={<Check className="size-4" />}>
              Approve
            </Button>
            <Button
              variant="secondary"
              onClick={() => setDecision(TUTOR_STATUS.INFO_REQUESTED)}
              iconLeft={<MessageSquareWarning className="size-4" />}
            >
              Request more info
            </Button>
            <Button
              variant="dangerGhost"
              onClick={() => setDecision(TUTOR_STATUS.REJECTED)}
              iconLeft={<X className="size-4" />}
            >
              Reject
            </Button>
          </div>
        </CardBody>
      </Card>

      <DecisionModal
        decision={decision}
        onClose={() => setDecision(null)}
        application={application}
        verification={verification}
      />
    </>
  );
}

function DecisionModal({ decision, onClose, application, verification }) {
  const router = useRouter();
  const toast = useToast();
  const [message, setMessage] = useState("");
  const [grantBadges, setGrantBadges] = useState([]);

  const isApprove = decision === TUTOR_STATUS.APPROVED;
  const isReject = decision === TUTOR_STATUS.REJECTED;

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/admin/applications/${application.id}`, {
      decision,
      message: message || undefined,
      grantBadges,
    });
    toast.success(
      isApprove ? "Tutor approved" : isReject ? "Application rejected" : "Information requested",
      isApprove ? "Their profile is now live in search." : "The tutor has been notified.",
    );
    onClose();
    setMessage("");
    setGrantBadges([]);
    router.push("/admin/applications");
    router.refresh();
  });

  const submittedTypes = verification
    ?.filter((r) => r.status !== VERIFICATION_STATUS.NOT_SUBMITTED)
    .map((r) => r.type) ?? [];

  const titles = {
    [TUTOR_STATUS.APPROVED]: "Approve this tutor",
    [TUTOR_STATUS.REJECTED]: "Reject this application",
    [TUTOR_STATUS.INFO_REQUESTED]: "Request more information",
  };

  return (
    <Modal
      open={Boolean(decision)}
      onClose={onClose}
      title={titles[decision] ?? ""}
      description={
        isApprove
          ? "Their profile becomes visible in search immediately."
          : "They'll be emailed your message and can update their application."
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={isReject ? "danger" : "primary"}
            onClick={submit}
            loading={pending}
            disabled={!isApprove && message.trim().length < 10}
          >
            {isApprove ? "Approve tutor" : isReject ? "Reject" : "Send request"}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        {isApprove && (
          <fieldset>
            <legend className="mb-2 block text-sm font-semibold text-ink-800">
              Grant verification badges
            </legend>
            <p className="mb-3 text-xs text-ink-500">
              Only grant a badge you&rsquo;ve seen the evidence for. Each one is recorded against
              your account.
            </p>
            <div className="space-y-3">
              {Object.values(VERIFICATION_TYPES).map((type) => {
                const record = verification?.find((r) => r.type === type);
                const hasDocuments = record?.documents?.length > 0;

                return (
                  <div key={type} className="rounded-xl border border-ink-200 p-3">
                    <Checkbox
                      label={VERIFICATION_LABELS[type]}
                      description={
                        hasDocuments
                          ? `${record.documents.length} document${record.documents.length === 1 ? "" : "s"} submitted`
                          : submittedTypes.includes(type)
                            ? "Requested, no document uploaded"
                            : "Not requested"
                      }
                      checked={grantBadges.includes(type)}
                      onChange={() =>
                        setGrantBadges((b) =>
                          b.includes(type) ? b.filter((t) => t !== type) : [...b, type],
                        )
                      }
                    />
                    {hasDocuments && (
                      <ul className="ml-7 mt-2 space-y-1">
                        {record.documents.map((doc) => (
                          <li key={doc.id}>
                            <a
                              href={`/api/admin/verification/documents/${doc.id}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
                            >
                              <FileText className="size-3" />
                              {doc.fileName}
                              <ExternalLink className="size-3" />
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        )}

        <Field
          label={isApprove ? "Note to the tutor (optional)" : "What do they need to know?"}
          htmlFor="decision-message"
          hint={
            isApprove
              ? "Included in their approval email."
              : "Be specific — this is what they'll act on."
          }
          error={fieldErrors.message}
          required={!isApprove}
        >
          <Textarea
            id="decision-message"
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1500}
            error={fieldErrors.message}
            placeholder={
              isApprove
                ? "Welcome aboard — your OCT registration checked out."
                : "We couldn't verify the degree you listed. Please upload an official transcript or a copy of your diploma."
            }
          />
        </Field>

        {isApprove && (
          <Alert tone="warning" title="Before you approve">
            Check that the bio is substantive, the courses match their stated qualifications, and
            the rate is within the platform range.
          </Alert>
        )}
      </div>
    </Modal>
  );
}
