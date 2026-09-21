"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Video, Pencil, KeyRound, Link2Off, RotateCw, ShieldAlert } from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  ConfirmModal,
  Field,
  Input,
  Modal,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { MEETING_PROVIDERS, MEETING_PROVIDER_LABELS, MEETING_SOURCES } from "@/constants";
import { JoinLessonButton } from "./JoinLessonButton";

/**
 * The online classroom, as the people involved see it (§27).
 *
 * One component for both kinds of online lesson — a one-to-one booking and a
 * group session — because a learner should not have to learn two layouts for
 * the same thing, and because the states that matter are the same either way:
 *
 *   ready      a link, the platform it is on, a passcode if there is one
 *   pending    an online lesson with no room yet — said out loud rather than
 *              rendered as an absence, which is what it used to be
 *   withdrawn  a link the host has taken back while they arrange another
 *   past       the lesson is over or cancelled; it says which platform it was
 *              on and offers nothing to click
 *
 * Everything the panel *offers* is decided by `canManage`, which the server
 * computes from the loaded record. Hiding a button is a courtesy to the person
 * looking, never the control: the endpoint refuses the same request whether or
 * not the form was on screen.
 */
export function MeetingPanel({
  meeting: initialMeeting,
  startAt,
  endAt,
  timeZone,
  live = true,
  canManage = false,
  endpoint,
  providerOptions,
}) {
  /**
   * The panel's own copy of the room.
   *
   * Seeded from the server-rendered lesson and replaced with whatever the API
   * returns, so the card reflects a change the moment it is saved. The parent
   * is usually a Server Component and cannot take a callback, so
   * `router.refresh()` re-runs it afterwards and the rest of the page — the
   * status badge, the confirmation banner — catches up from the server rather
   * than from a second copy of the rule held here.
   */
  const [meeting, setMeeting] = useState(initialMeeting ?? null);
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const toast = useToast();
  const router = useRouter();

  const joinable = Boolean(meeting?.joinUrl) && !meeting?.disabled && live;
  const providers = providerOptions?.length ? providerOptions : Object.values(MEETING_PROVIDERS);

  const applied = (next) => {
    setMeeting(next ?? null);
    router.refresh();
  };

  const act = useSubmit(async (body) => {
    const result = await api.post(endpoint, body);
    applied(result.meeting);
    return result;
  });

  const run = async (body, message) => {
    const result = await act.submit(body);
    if (result) {
      toast.success(message);
      setConfirming(null);
    }
  };

  return (
    <section
      aria-labelledby="meeting-heading"
      className="rounded-xl border border-brand-200 bg-brand-50/60 p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3
            id="meeting-heading"
            className="flex items-center gap-2 text-sm font-bold text-brand-900"
          >
            <Video className="size-4 shrink-0" aria-hidden="true" />
            Online class
          </h3>
          <p className="mt-1 text-xs text-brand-700/80">
            {meeting?.provider
              ? `${MEETING_PROVIDER_LABELS[meeting.provider] ?? "Online"} · ${formatWindow(startAt, endAt, timeZone)}`
              : formatWindow(startAt, endAt, timeZone)}
          </p>
        </div>
        <MeetingStatusBadge meeting={meeting} live={live} />
      </div>

      {act.error && (
        <Alert tone="danger" className="mt-3">
          {act.error}
        </Alert>
      )}

      <div className="mt-3">
        {joinable ? (
          <div className="flex flex-wrap items-center gap-2">
            <JoinLessonButton
              startAt={startAt}
              joinUrl={meeting.joinUrl}
              label={`Join ${MEETING_PROVIDER_LABELS[meeting.provider] ?? "lesson"}`}
            />
            {meeting.meetingId && (
              <Badge tone="neutral">Meeting ID {meeting.meetingId}</Badge>
            )}
            {meeting.passcode && (
              <Badge tone="neutral">
                <KeyRound className="mr-1 size-3" aria-hidden="true" />
                Passcode {meeting.passcode}
              </Badge>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-700">{emptyMessage(meeting, live, canManage)}</p>
        )}

        {meeting?.instructions && joinable && (
          <p className="mt-2 text-sm text-ink-700">{meeting.instructions}</p>
        )}
      </div>

      {canManage && (
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-brand-200/70 pt-3">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setEditing(true)}
            disabled={act.pending}
            iconLeft={<Pencil className="size-3.5" />}
          >
            {meeting?.joinUrl ? "Edit joining details" : "Add joining details"}
          </Button>

          {!meeting?.joinUrl && (
            <Button
              size="sm"
              variant="ghost"
              loading={act.pending}
              onClick={() => run({ action: "retry" }, "A meeting room has been created.")}
              iconLeft={<RotateCw className="size-3.5" />}
            >
              Create one automatically
            </Button>
          )}

          {meeting?.joinUrl && !meeting.disabled && (
            <Button
              size="sm"
              variant="ghost"
              disabled={act.pending}
              onClick={() => setConfirming("disable")}
              iconLeft={<Link2Off className="size-3.5" />}
            >
              Withdraw link
            </Button>
          )}

          {meeting?.joinUrl && meeting.disabled && (
            <Button
              size="sm"
              variant="ghost"
              loading={act.pending}
              onClick={() => run({ action: "enable" }, "The link is available again.")}
            >
              Restore link
            </Button>
          )}

          {meeting && (
            <Button
              size="sm"
              variant="dangerGhost"
              disabled={act.pending}
              onClick={() => setConfirming("clear")}
            >
              Remove
            </Button>
          )}
        </div>
      )}

      {canManage && meeting?.source === MEETING_SOURCES.MANUAL && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-500">
          <ShieldAlert className="mt-0.5 size-3 shrink-0" aria-hidden="true" />
          Entered by hand. This room belongs to whoever created it, so rescheduling the lesson
          won&rsquo;t move it and removing it here won&rsquo;t close it.
        </p>
      )}

      {editing && (
        <MeetingForm
          meeting={meeting}
          providers={providers}
          endpoint={endpoint}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            applied(next);
            setEditing(false);
          }}
        />
      )}

      <ConfirmModal
        open={confirming === "disable"}
        onClose={() => setConfirming(null)}
        onConfirm={() => run({ action: "disable" }, "The link has been withdrawn.")}
        loading={act.pending}
        title="Withdraw the joining link?"
        confirmLabel="Withdraw it"
        tone="warning"
      >
        Everyone attending stops seeing the link and is told you&rsquo;re arranging a new one. The
        lesson itself is unchanged, and you can restore the same link afterwards.
        {meeting?.source !== MEETING_SOURCES.MANUAL && (
          <> This does not close the room on the meeting platform.</>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={confirming === "clear"}
        onClose={() => setConfirming(null)}
        onConfirm={() => run({ action: "clear" }, "The joining details have been removed.")}
        loading={act.pending}
        title="Remove the joining details?"
        confirmLabel="Remove them"
        tone="danger"
      >
        {meeting?.source === MEETING_SOURCES.MANUAL
          ? "The link is forgotten here. The room stays open in your own account — close it there if you want it gone."
          : "The room is closed on the meeting platform and the link stops working for everyone."}{" "}
        The lesson still goes ahead, so you&rsquo;ll need to add new joining details.
      </ConfirmModal>
    </section>
  );
}

/**
 * The form.
 *
 * Only the fields the domain actually has. There is no "waiting room" or
 * "require authentication" switch here, because nothing in this application
 * could honour one: the Zoom adapter sets a waiting room on every room it
 * creates, and a link typed in by hand is governed by whatever its owner
 * configured in their own account. A switch that changed nothing would be
 * worse than no switch.
 */
function MeetingForm({ meeting, providers, endpoint, onClose, onSaved }) {
  const toast = useToast();
  const [form, setForm] = useState({
    provider: meeting?.provider ?? providers[0],
    joinUrl: meeting?.joinUrl ?? "",
    meetingId: meeting?.meetingId ?? "",
    passcode: meeting?.passcode ?? "",
    instructions: meeting?.instructions ?? "",
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const { meeting: saved } = await api.post(endpoint, {
      action: "manual",
      provider: form.provider,
      joinUrl: form.joinUrl.trim(),
      // An emptied field is a deliberate clear, which the API spells `null`;
      // sending "" would fail validation rather than remove the value.
      meetingId: form.meetingId.trim() || null,
      passcode: form.passcode.trim() || null,
      instructions: form.instructions.trim() || null,
    });

    toast.success("Joining details saved", "Everyone attending has been told.");
    onSaved(saved);
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={meeting?.joinUrl ? "Edit joining details" : "Add joining details"}
      description="Paste a link from a meeting you've already set up. We store it and show it to the people attending — we don't create or change anything on the meeting platform."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending}>
            Save joining details
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        {error && <Alert tone="danger">{error}</Alert>}

        <Field label="Platform" htmlFor="meeting-provider" required error={fieldErrors.provider}>
          <Select
            id="meeting-provider"
            value={form.provider}
            error={fieldErrors.provider}
            onChange={(e) => set("provider", e.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider} value={provider}>
                {MEETING_PROVIDER_LABELS[provider] ?? provider}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Joining link"
          htmlFor="meeting-url"
          required
          error={fieldErrors.joinUrl}
          hint="The full https:// link people click to join."
        >
          <Input
            id="meeting-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://zoom.us/j/1234567890"
            value={form.joinUrl}
            error={fieldErrors.joinUrl}
            onChange={(e) => set("joinUrl", e.target.value)}
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Meeting ID"
            htmlFor="meeting-id"
            error={fieldErrors.meetingId}
            hint="Optional."
          >
            <Input
              id="meeting-id"
              autoComplete="off"
              placeholder="123 4567 8901"
              value={form.meetingId}
              error={fieldErrors.meetingId}
              onChange={(e) => set("meetingId", e.target.value)}
            />
          </Field>

          <Field
            label="Passcode"
            htmlFor="meeting-passcode"
            error={fieldErrors.passcode}
            hint="Only if the room needs one."
          >
            <Input
              id="meeting-passcode"
              autoComplete="off"
              value={form.passcode}
              error={fieldErrors.passcode}
              onChange={(e) => set("passcode", e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Joining notes"
          htmlFor="meeting-instructions"
          error={fieldErrors.instructions}
          hint="Shown beside the join button — anything they should know before clicking."
        >
          <Textarea
            id="meeting-instructions"
            rows={3}
            maxLength={500}
            placeholder="I'll let you in from the waiting room — please join a couple of minutes early."
            value={form.instructions}
            error={fieldErrors.instructions}
            onChange={(e) => set("instructions", e.target.value)}
          />
        </Field>
      </form>
    </Modal>
  );
}

function MeetingStatusBadge({ meeting, live }) {
  if (!live) return <Badge tone="neutral">Finished</Badge>;
  if (!meeting?.joinUrl && !meeting?.provider) return <Badge tone="warning">Room pending</Badge>;
  if (meeting.disabled) return <Badge tone="warning">Link withdrawn</Badge>;
  if (!meeting.joinUrl) return <Badge tone="warning">Room pending</Badge>;
  return <Badge tone="success">Ready to join</Badge>;
}

function emptyMessage(meeting, live, canManage) {
  if (!live) {
    return meeting?.provider
      ? `This lesson was held on ${MEETING_PROVIDER_LABELS[meeting.provider] ?? "an online platform"}. The room is closed.`
      : "This lesson is no longer scheduled.";
  }
  if (meeting?.disabled) {
    return canManage
      ? "You've withdrawn this link. Restore it, or add new joining details."
      : "Your tutor is arranging a new joining link. The lesson time is unchanged.";
  }
  return canManage
    ? "No room yet. Create one automatically, or paste in a link from a meeting you've already set up."
    : "The joining link isn't ready yet. It will appear here, and we'll email it to you.";
}

/** "Mon 6 Oct, 16:00 – 17:00" in the lesson's own time zone. */
function formatWindow(startAt, endAt, timeZone) {
  if (!startAt) return "Time to be confirmed";
  const zone = timeZone || undefined;
  const day = new Intl.DateTimeFormat("en-CA", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: zone,
  }).format(new Date(startAt));
  const time = (value) =>
    new Intl.DateTimeFormat("en-CA", { hour: "2-digit", minute: "2-digit", timeZone: zone }).format(
      new Date(value),
    );

  return endAt ? `${day}, ${time(startAt)} – ${time(endAt)}` : `${day}, ${time(startAt)}`;
}
