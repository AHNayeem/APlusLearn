"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Eye, BadgeCheck, MoreVertical } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Button, Dropdown, DropdownItem, DropdownDivider, Field, Modal, Select,
  Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { VERIFICATION_TYPES, VERIFICATION_LABELS } from "@/constants";

/** Suspend a tutor from search, or grant/revoke a badge directly (§16, §42). */
export function TutorRowActions({ tutor }) {
  const [modal, setModal] = useState(null);

  return (
    <>
      <Dropdown
        align="end"
        trigger={
          <span className="inline-flex size-8 items-center justify-center rounded-lg text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-600">
            <MoreVertical className="size-4" />
            <span className="sr-only">Tutor actions</span>
          </span>
        }
      >
        <DropdownItem href={`/tutors/${tutor.slug}`} icon={<Eye className="size-4" />}>
          View public profile
        </DropdownItem>
        <DropdownItem
          href={`/admin/users/${tutor.userId?.id ?? tutor.userId}`}
          icon={<Eye className="size-4" />}
        >
          View account
        </DropdownItem>

        <DropdownDivider />

        <DropdownItem icon={<BadgeCheck className="size-4" />} onClick={() => setModal("badge")}>
          Manage badges
        </DropdownItem>

        {tutor.isSearchable ? (
          <DropdownItem icon={<EyeOff className="size-4" />} danger onClick={() => setModal("hide")}>
            Remove from search
          </DropdownItem>
        ) : (
          <DropdownItem icon={<Eye className="size-4" />} onClick={() => setModal("show")}>
            Restore to search
          </DropdownItem>
        )}
      </Dropdown>

      <SearchableModal
        open={modal === "hide" || modal === "show"}
        searchable={modal === "show"}
        onClose={() => setModal(null)}
        tutor={tutor}
      />
      <BadgeModal open={modal === "badge"} onClose={() => setModal(null)} tutor={tutor} />
    </>
  );
}

function SearchableModal({ open, searchable, onClose, tutor }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/admin/tutors/${tutor.id}/searchable`, {
      searchable,
      reason: reason || undefined,
    });
    toast.success(searchable ? "Restored to search" : "Removed from search");
    onClose();
    setReason("");
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={searchable ? "Restore this tutor to search" : "Remove this tutor from search"}
      description={
        searchable
          ? "Families will be able to find and book them again."
          : "Their profile disappears from search immediately. Existing bookings are unaffected."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={searchable ? "primary" : "danger"}
            onClick={submit}
            loading={pending}
            disabled={!searchable && reason.trim().length < 10}
          >
            {searchable ? "Restore" : "Remove from search"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />
        {!searchable && (
          <Field
            label="Reason"
            htmlFor="searchable-reason"
            hint="Recorded in the audit log."
            error={fieldErrors.reason}
            required
          >
            <Textarea
              id="searchable-reason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              error={fieldErrors.reason}
              placeholder="Three unresolved disputes about lesson quality in the last month."
            />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function BadgeModal({ open, onClose, tutor }) {
  const router = useRouter();
  const toast = useToast();
  const [type, setType] = useState(VERIFICATION_TYPES.IDENTITY);
  const [action, setAction] = useState("GRANT");
  const [reason, setReason] = useState("");

  const held = tutor.verifiedTypes ?? [];

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/admin/tutors/${tutor.id}/badges`, {
      type,
      action,
      reason: reason || undefined,
    });
    toast.success(action === "GRANT" ? "Badge granted" : "Badge revoked");
    onClose();
    setReason("");
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Manage verification badges"
      description="Only grant a badge you've personally verified the evidence for."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={action === "REVOKE" ? "danger" : "primary"}
            onClick={submit}
            loading={pending}
          >
            {action === "GRANT" ? "Grant badge" : "Revoke badge"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <div className="rounded-xl bg-ink-50 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
            Currently holds
          </p>
          <p className="mt-1 text-sm text-ink-700">
            {held.length
              ? held.map((t) => VERIFICATION_LABELS[t]).join(", ")
              : "No badges"}
          </p>
        </div>

        <Field label="Action" htmlFor="badge-action">
          <Select id="badge-action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="GRANT">Grant a badge</option>
            <option value="REVOKE">Revoke a badge</option>
          </Select>
        </Field>

        <Field label="Badge" htmlFor="badge-type">
          <Select id="badge-type" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.values(VERIFICATION_TYPES).map((value) => (
              <option key={value} value={value}>
                {VERIFICATION_LABELS[value]}
                {held.includes(value) ? " (held)" : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Reason" htmlFor="badge-reason" hint="Recorded in the audit log.">
          <Textarea
            id="badge-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            placeholder="Vulnerable Sector Check verified — dated 14 March, within 12 months."
          />
        </Field>
      </div>
    </Modal>
  );
}
