"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Eye, X } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Field, Modal, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { REPORT_STATUS } from "@/constants";

const DECISIONS = {
  [REPORT_STATUS.REVIEWING]: {
    title: "Mark as under review",
    description: "Tells other administrators that somebody has picked this up.",
    confirm: "Mark under review",
    toast: "Marked under review",
    variant: "primary",
  },
  [REPORT_STATUS.RESOLVED]: {
    title: "Resolve this report",
    description:
      "Use this when the report was justified and you have acted on it. Record what you did.",
    confirm: "Resolve report",
    toast: "Report resolved",
    variant: "primary",
  },
  [REPORT_STATUS.DISMISSED]: {
    title: "Dismiss this report",
    description: "Use this when nothing in the thread breaks the rules.",
    confirm: "Dismiss report",
    toast: "Report dismissed",
    variant: "danger",
  },
};

/** Record a decision on a reported conversation (§21). */
export function ConversationModeration({ conversation }) {
  const [decision, setDecision] = useState(null);
  const isOpen = conversation.reportStatus === REPORT_STATUS.OPEN;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {isOpen && (
          <Button
            variant="secondary"
            size="xs"
            onClick={() => setDecision(REPORT_STATUS.REVIEWING)}
            iconLeft={<Eye className="size-3.5" />}
          >
            Under review
          </Button>
        )}
        <Button
          size="xs"
          onClick={() => setDecision(REPORT_STATUS.RESOLVED)}
          iconLeft={<Check className="size-3.5" />}
        >
          Resolve
        </Button>
        <Button
          variant="dangerGhost"
          size="xs"
          onClick={() => setDecision(REPORT_STATUS.DISMISSED)}
          iconLeft={<X className="size-3.5" />}
        >
          Dismiss
        </Button>
      </div>

      <DecisionModal
        decision={decision}
        conversation={conversation}
        onClose={() => setDecision(null)}
      />
    </>
  );
}

function DecisionModal({ decision, conversation, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [note, setNote] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/admin/conversations/${conversation.id}`, {
      status: decision,
      note: note || undefined,
    });
    toast.success(DECISIONS[decision].toast, "The decision is in the audit log.");
    onClose();
    setNote("");
    router.refresh();
  });

  if (!decision) return null;
  const copy = DECISIONS[decision];

  return (
    <Modal
      open
      onClose={onClose}
      title={copy.title}
      description={copy.description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={copy.variant} onClick={submit} loading={pending}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <div className="rounded-xl border border-warning-100 bg-warning-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-warning-700">
            Reported because
          </p>
          <p className="mt-1 text-sm text-ink-700">{conversation.reportReason}</p>
        </div>

        <Field
          label="What did you decide, and why?"
          htmlFor="moderate-conversation-note"
          hint="Recorded against the conversation and in the audit log."
        >
          <Textarea
            id="moderate-conversation-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={600}
            placeholder={
              decision === REPORT_STATUS.DISMISSED
                ? "Read the whole thread — a disagreement about scheduling, nothing that breaks the rules."
                : "Messages pushed the family to pay outside the platform. Warned the tutor and restricted the account."
            }
          />
        </Field>
      </div>
    </Modal>
  );
}
