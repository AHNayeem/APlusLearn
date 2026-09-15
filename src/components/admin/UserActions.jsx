"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, RotateCcw, MailCheck, LogOut, Trash2, MoreVertical } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Dropdown, DropdownItem, DropdownDivider, Field, Modal, Textarea,
  FormErrorSummary, useToast,
} from "@/components/ui";
import { USER_STATUS } from "@/constants";

/**
 * Admin actions on a user account (§24, §35).
 *
 * Suspending and deleting both require a recorded reason, which lands in the
 * audit log alongside the admin who did it.
 */
export function UserActions({ user }) {
  const [action, setAction] = useState(null);

  const suspended = user.status === USER_STATUS.SUSPENDED;
  const deleted = user.status === USER_STATUS.DELETED;

  if (deleted) return null;

  return (
    <>
      <Dropdown
        trigger={
          <span className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-ink-700 ring-1 ring-inset ring-ink-200 transition-colors hover:bg-ink-100">
            Actions
            <MoreVertical className="size-4" />
          </span>
        }
      >
        {suspended ? (
          <DropdownItem
            icon={<RotateCcw className="size-4" />}
            onClick={() => setAction("REINSTATE")}
          >
            Reinstate account
          </DropdownItem>
        ) : (
          <DropdownItem icon={<Ban className="size-4" />} danger onClick={() => setAction("SUSPEND")}>
            Suspend account
          </DropdownItem>
        )}

        {!user.emailVerifiedAt && (
          <DropdownItem
            icon={<MailCheck className="size-4" />}
            onClick={() => setAction("VERIFY_EMAIL")}
          >
            Mark email verified
          </DropdownItem>
        )}

        <DropdownItem icon={<LogOut className="size-4" />} onClick={() => setAction("FORCE_LOGOUT")}>
          Sign out everywhere
        </DropdownItem>

        <DropdownDivider />

        <DropdownItem icon={<Trash2 className="size-4" />} danger onClick={() => setAction("DELETE")}>
          Delete account
        </DropdownItem>
      </Dropdown>

      <ActionModal action={action} onClose={() => setAction(null)} user={user} />
    </>
  );
}

const COPY = {
  SUSPEND: {
    title: "Suspend this account",
    description:
      "They can't sign in, and a tutor profile is removed from search immediately.",
    confirm: "Suspend account",
    danger: true,
    needsReason: true,
  },
  REINSTATE: {
    title: "Reinstate this account",
    description: "They'll be able to sign in again. A tutor profile stays hidden until re-approved.",
    confirm: "Reinstate",
  },
  VERIFY_EMAIL: {
    title: "Mark email as verified",
    description: "Use this when someone has confirmed their identity through support.",
    confirm: "Mark verified",
  },
  FORCE_LOGOUT: {
    title: "Sign out everywhere",
    description: "Ends every active session. They'll need to sign in again.",
    confirm: "Sign out everywhere",
  },
  DELETE: {
    title: "Delete this account",
    description:
      "Personal details are removed and the account is anonymised. Lesson and payment records are kept for accounting.",
    confirm: "Delete account",
    danger: true,
    needsReason: true,
  },
};

function ActionModal({ action, onClose, user }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState("");

  const copy = COPY[action];

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/admin/users/${user.id}`, { action, reason: reason || undefined });
    toast.success("Account updated");
    onClose();
    setReason("");
    router.refresh();
  });

  if (!copy) return null;

  return (
    <Modal
      open={Boolean(action)}
      onClose={onClose}
      title={copy.title}
      description={copy.description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={copy.danger ? "danger" : "primary"}
            onClick={submit}
            loading={pending}
            disabled={copy.needsReason && reason.trim().length < 10}
          >
            {copy.confirm}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        {copy.needsReason && (
          <Field
            label="Reason"
            htmlFor="action-reason"
            hint="Recorded in the audit log. At least 10 characters."
            error={fieldErrors.reason}
            required
          >
            <Textarea
              id="action-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              error={fieldErrors.reason}
              placeholder="Repeated no-shows after two warnings (tickets #4412, #4530)."
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}
