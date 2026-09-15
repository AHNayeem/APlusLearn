"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { XCircle, CheckCircle2, Star, AlertTriangle, CalendarClock } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Field, Modal, Select, Textarea, FormErrorSummary, useToast, Rating,
} from "@/components/ui";
import { formatMoney, formatDateTime } from "@/lib/utils/format";
import { BOOKING_STATUS, DISPUTE_REASONS, DISPUTE_REASON_LABELS } from "@/constants";

/**
 * Actions on a lesson. Which ones appear comes from `booking.permissions`,
 * computed server-side — the client never decides what it is allowed to do
 * (§8, §26, §42).
 */
export function BookingActions({ booking, viewerRole, cancellationPolicy }) {
  const [modal, setModal] = useState(null);
  const close = () => setModal(null);

  const { canCancel, canComplete, canReview, canDispute } = booking.permissions ?? {};

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canReview && (
          <Button onClick={() => setModal("review")} iconLeft={<Star className="size-4" />}>
            Leave a review
          </Button>
        )}
        {canComplete && (
          <Button
            onClick={() => setModal("complete")}
            iconLeft={<CheckCircle2 className="size-4" />}
          >
            Mark as complete
          </Button>
        )}
        {canCancel && (
          <Button
            variant="secondary"
            onClick={() => setModal("cancel")}
            iconLeft={<XCircle className="size-4" />}
          >
            Cancel lesson
          </Button>
        )}
        {canCancel && (
          <Button
            variant="ghost"
            onClick={() => setModal("reschedule")}
            iconLeft={<CalendarClock className="size-4" />}
          >
            Reschedule
          </Button>
        )}
        {canDispute && (
          <Button
            variant="dangerGhost"
            onClick={() => setModal("dispute")}
            iconLeft={<AlertTriangle className="size-4" />}
          >
            Report a problem
          </Button>
        )}
      </div>

      <CancelModal
        open={modal === "cancel"}
        onClose={close}
        booking={booking}
        viewerRole={viewerRole}
        cancellationPolicy={cancellationPolicy}
      />
      <CompleteModal open={modal === "complete"} onClose={close} booking={booking} />
      <ReviewModal open={modal === "review"} onClose={close} booking={booking} />
      <DisputeModal open={modal === "dispute"} onClose={close} booking={booking} />
      <RescheduleModal open={modal === "reschedule"} onClose={close} booking={booking} />
    </>
  );
}

function CancelModal({ open, onClose, booking, viewerRole, cancellationPolicy }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [cancelSeries, setCancelSeries] = useState(false);

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post(`/api/bookings/${booking.id}/cancel`, { reason, cancelSeries });
    toast.success(
      result.cancelled > 1 ? `${result.cancelled} lessons cancelled` : "Lesson cancelled",
      result.refundCents > 0
        ? `${formatMoney(result.refundCents)} will be refunded.`
        : "No refund applies under the cancellation policy.",
    );
    onClose();
    router.refresh();
    return result;
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Cancel this lesson"
      description="The refund is worked out automatically from our cancellation policy."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep the lesson
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            loading={pending}
            disabled={reason.trim().length < 5}
          >
            Cancel lesson
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Alert tone="neutral" title="Cancellation policy">
          <ul className="mt-1 space-y-1 text-xs">
            {cancellationPolicy?.map((line) => (
              <li key={line}>· {line}</li>
            ))}
          </ul>
        </Alert>

        <Field
          label="Why are you cancelling?"
          htmlFor="cancel-reason"
          hint="Shared with the other person so they know what happened."
          error={fieldErrors.reason}
          required
        >
          <Textarea
            id="cancel-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            error={fieldErrors.reason}
            placeholder="Something came up and we can't make this time…"
          />
        </Field>

        {booking.seriesId && (
          <label className="flex items-start gap-3 rounded-xl border border-ink-200 p-3">
            <input
              type="checkbox"
              checked={cancelSeries}
              onChange={(e) => setCancelSeries(e.target.checked)}
              className="mt-0.5 size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
            />
            <span className="text-sm">
              <span className="font-semibold text-ink-800">Cancel the whole series</span>
              <span className="mt-0.5 block text-xs text-ink-500">
                Every remaining lesson in this recurring booking will be cancelled.
              </span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}

function CompleteModal({ open, onClose, booking }) {
  const router = useRouter();
  const toast = useToast();
  const [outcome, setOutcome] = useState(BOOKING_STATUS.COMPLETED);
  const [tutorNotes, setTutorNotes] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/bookings/${booking.id}/complete`, { outcome, tutorNotes });
    toast.success("Lesson updated", "Your earnings will be included in the next payout.");
    onClose();
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Mark lesson as complete"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending}>
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Field label="What happened?" htmlFor="complete-outcome">
          <Select id="complete-outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value={BOOKING_STATUS.COMPLETED}>The lesson went ahead</option>
            <option value={BOOKING_STATUS.NO_SHOW_STUDENT}>The student didn&rsquo;t attend</option>
          </Select>
        </Field>

        <Field
          label="Private lesson notes"
          htmlFor="complete-notes"
          hint="Only you can see these — useful for picking up where you left off."
        >
          <Textarea
            id="complete-notes"
            rows={4}
            value={tutorNotes}
            onChange={(e) => setTutorNotes(e.target.value)}
            maxLength={2000}
            placeholder="Covered logarithm laws; still shaky on change of base. Next: practice set 4."
          />
        </Field>
      </div>
    </Modal>
  );
}

function ReviewModal({ open, onClose, booking }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    rating: 5,
    knowledge: 5,
    communication: 5,
    reliability: 5,
    teaching: 5,
    title: "",
    body: "",
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post("/api/reviews", { bookingId: booking.id, ...form });
    toast.success("Review published", "Thanks — this helps other families choose.");
    onClose();
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How did the lesson go?"
      description="Your review is marked verified because it's tied to a completed lesson."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Not now
          </Button>
          <Button onClick={submit} loading={pending} disabled={form.body.trim().length < 20}>
            Publish review
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <StarInput
          label="Overall"
          value={form.rating}
          onChange={(v) => set("rating", v)}
          size="lg"
        />

        <div className="grid gap-4 border-t border-ink-100 pt-4 sm:grid-cols-2">
          <StarInput
            label="Subject knowledge"
            value={form.knowledge}
            onChange={(v) => set("knowledge", v)}
          />
          <StarInput
            label="Communication"
            value={form.communication}
            onChange={(v) => set("communication", v)}
          />
          <StarInput
            label="Reliability"
            value={form.reliability}
            onChange={(v) => set("reliability", v)}
          />
          <StarInput
            label="Teaching ability"
            value={form.teaching}
            onChange={(v) => set("teaching", v)}
          />
        </div>

        <Field label="Headline" htmlFor="review-title" hint="Optional">
          <input
            id="review-title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={120}
            placeholder="Turned the term around"
            className="block w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </Field>

        <Field
          label="Your review"
          htmlFor="review-body"
          hint="What worked, what to expect — the details other parents need."
          error={fieldErrors.body}
          required
        >
          <Textarea
            id="review-body"
            rows={5}
            value={form.body}
            onChange={(e) => set("body", e.target.value)}
            maxLength={2000}
            error={fieldErrors.body}
            placeholder="We'd tried two other tutors before this one. What made the difference was…"
          />
        </Field>
      </div>
    </Modal>
  );
}

function StarInput({ label, value, onChange, size = "md" }) {
  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold text-ink-800">{label}</p>
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-label={label} className="flex gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={value === star}
              aria-label={`${star} ${star === 1 ? "star" : "stars"}`}
              onClick={() => onChange(star)}
              className="rounded p-0.5 transition-transform hover:scale-110 motion-reduce:hover:scale-100"
            >
              <svg
                viewBox="0 0 20 20"
                className={size === "lg" ? "size-8" : "size-6"}
                fill={star <= value ? "currentColor" : "none"}
                stroke="currentColor"
                strokeWidth={star <= value ? 0 : 1.25}
                aria-hidden="true"
                style={{ color: star <= value ? "var(--color-accent-400)" : "var(--color-ink-300)" }}
              >
                <path d="M10 1.5l2.6 5.3 5.8.85-4.2 4.1 1 5.75L10 14.8l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85L10 1.5Z" strokeLinejoin="round" />
              </svg>
            </button>
          ))}
        </div>
        <span className="text-sm font-bold text-ink-700 tabular-nums">{value}.0</span>
      </div>
    </div>
  );
}

function DisputeModal({ open, onClose, booking }) {
  const router = useRouter();
  const toast = useToast();
  const [reason, setReason] = useState(DISPUTE_REASONS.LESSON_QUALITY);
  const [description, setDescription] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post("/api/disputes", { bookingId: booking.id, reason, description });
    toast.success("Dispute opened", "Our team will review it and be in touch.");
    onClose();
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report a problem"
      description="Our team reviews every dispute and decides on any refund."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={submit}
            loading={pending}
            disabled={description.trim().length < 20}
          >
            Open dispute
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Field label="What went wrong?" htmlFor="dispute-reason" required>
          <Select id="dispute-reason" value={reason} onChange={(e) => setReason(e.target.value)}>
            {Object.entries(DISPUTE_REASON_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Tell us what happened"
          htmlFor="dispute-description"
          hint="The more specific you are, the faster we can resolve it."
          error={fieldErrors.description}
          required
        >
          <Textarea
            id="dispute-description"
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            error={fieldErrors.description}
          />
        </Field>
      </div>
    </Modal>
  );
}

function RescheduleModal({ open, onClose, booking }) {
  const router = useRouter();
  const toast = useToast();
  const [startAt, setStartAt] = useState("");
  const [reason, setReason] = useState("");
  // Captured once rather than on every render, which would be an impure read
  // of the clock during rendering.
  const [earliest] = useState(() =>
    new Date(Date.now() + 86400000).toISOString().slice(0, 16),
  );

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/bookings/${booking.id}/reschedule`, {
      startAt: new Date(startAt).toISOString(),
      reason,
    });
    toast.success("Lesson rescheduled", "We've told the other person about the change.");
    onClose();
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reschedule this lesson"
      description="The new time must be free on the tutor's calendar."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!startAt}>
            Reschedule
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Alert tone="neutral">
          Currently {formatDateTime(booking.startAt, booking.timeZone)}.
        </Alert>

        <Field label="New date and time" htmlFor="reschedule-at" error={fieldErrors.startAt} required>
          <input
            id="reschedule-at"
            type="datetime-local"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            min={earliest}
            className="block w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </Field>

        <Field label="Reason" htmlFor="reschedule-reason" hint="Optional, shared with the other person.">
          <Textarea
            id="reschedule-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={600}
          />
        </Field>
      </div>
    </Modal>
  );
}
