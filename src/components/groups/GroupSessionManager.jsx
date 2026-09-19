"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Users, Send, XCircle, ClipboardCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input,
  Modal, Select, Textarea, FormErrorSummary, Progress, useToast,
} from "@/components/ui";
import {
  GROUP_SESSION_STATUS, GROUP_SESSION_STATUS_LABELS, LESSON_MODES,
  LESSON_MODE_LABELS, LESSON_DURATIONS, MEETING_PROVIDER_LABELS,
  IN_PERSON_LOCATIONS, IN_PERSON_LOCATION_LABELS,
} from "@/constants";
import { formatMoney, formatDate, formatTime, formatDuration } from "@/lib/utils/format";

/**
 * A tutor's group sessions (§41 Phase 2).
 *
 * A draft holds no time on the calendar; publishing is what reserves it, and
 * that is where the availability rules are checked. The button says so, so a
 * refusal at that point is expected rather than surprising.
 */
export function GroupSessionManager({ initial, courses, meetingProviders, lessonModes }) {
  const router = useRouter();
  const toast = useToast();
  const [sessions, setSessions] = useState(initial ?? []);
  const [creating, setCreating] = useState(false);
  const [cancelling, setCancelling] = useState(null);

  const publish = async (session) => {
    try {
      const { session: published } = await api.post(`/api/tutor/groups/${session.id}`);
      setSessions((current) => current.map((s) => (s.id === session.id ? published : s)));
      toast.success("Session published", "It now holds that time on your calendar.");
      router.refresh();
    } catch (error) {
      toast.error("Couldn't publish", error.message);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Group sessions"
        description="Teach several learners at once. They each pay for a seat."
        action={
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            disabled={courses.length === 0}
            iconLeft={<Plus className="size-4" />}
          >
            New session
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {courses.length === 0 && (
          <Alert tone="neutral" title="Add a course first">
            A group session is for a specific course, so you need at least one on your profile.
          </Alert>
        )}

        {sessions.length === 0 ? (
          <EmptyState
            icon={<Users className="size-7" />}
            title="No group sessions yet"
            description="A revision session for six people at a lower price each often earns more than one lesson — and fills a slot that would otherwise go empty."
          />
        ) : (
          sessions.map((session) => (
            <div key={session.id} className="rounded-xl border border-ink-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/groups/${session.id}`}
                      className="text-sm font-bold text-ink-900 hover:text-brand-700"
                    >
                      {session.title}
                    </Link>
                    <Badge tone={statusTone(session.status)} size="sm">
                      {GROUP_SESSION_STATUS_LABELS[session.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {session.courseCode ? `${session.courseCode} · ` : ""}
                    {formatDate(session.startAt, { weekday: "short" })} at{" "}
                    {formatTime(session.startAt, session.timeZone)} ·{" "}
                    {formatDuration(session.durationMinutes)} ·{" "}
                    {LESSON_MODE_LABELS[session.mode]}
                  </p>
                  <p className="mt-2 text-sm">
                    <span className="font-bold text-ink-900">
                      {formatMoney(session.pricePerSeatCents)}
                    </span>
                    <span className="text-ink-500"> a seat</span>
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {session.status === GROUP_SESSION_STATUS.DRAFT && (
                    <Button
                      size="xs"
                      onClick={() => publish(session)}
                      iconLeft={<Send className="size-3.5" />}
                    >
                      Publish
                    </Button>
                  )}
                  {session.status === GROUP_SESSION_STATUS.COMPLETED ? null : (
                    <Button
                      variant="ghost"
                      size="xs"
                      href={`/groups/${session.id}`}
                      iconLeft={<ClipboardCheck className="size-3.5" />}
                    >
                      Manage
                    </Button>
                  )}
                  {![GROUP_SESSION_STATUS.CANCELLED, GROUP_SESSION_STATUS.COMPLETED].includes(
                    session.status,
                  ) && (
                    <Button
                      variant="dangerGhost"
                      size="xs"
                      onClick={() => setCancelling(session)}
                      iconLeft={<XCircle className="size-3.5" />}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>

              <div className="mt-4">
                <Progress
                  value={session.seatsTaken}
                  max={session.maxParticipants}
                  tone={session.seatsTaken >= session.minParticipants ? "success" : "warning"}
                  label={`${session.seatsTaken} of ${session.maxParticipants} seats · needs ${session.minParticipants} to run`}
                />
                {session.waitlistCount > 0 && (
                  <p className="mt-1 text-xs text-ink-500">
                    {session.waitlistCount} waiting for a seat
                  </p>
                )}
              </div>

              {session.status === GROUP_SESSION_STATUS.PUBLISHED &&
                session.seatsTaken < session.minParticipants && (
                  <p className="mt-3 text-xs text-warning-700">
                    Needs {session.minParticipants - session.seatsTaken} more by{" "}
                    {formatDate(session.confirmBy, { weekday: "short" })}, or it is cancelled and
                    everybody refunded.
                  </p>
                )}
            </div>
          ))
        )}
      </CardBody>

      {creating && (
        <SessionForm
          courses={courses}
          meetingProviders={meetingProviders}
          lessonModes={lessonModes}
          onClose={() => setCreating(false)}
          onCreated={(session) => {
            setSessions((current) => [session, ...current]);
            setCreating(false);
            router.refresh();
          }}
        />
      )}

      {cancelling && (
        <CancelDialog
          session={cancelling}
          onClose={() => setCancelling(null)}
          onCancelled={(session) => {
            setSessions((current) => current.map((s) => (s.id === session.id ? session : s)));
            setCancelling(null);
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}

function statusTone(status) {
  if (status === GROUP_SESSION_STATUS.CONFIRMED) return "success";
  if (status === GROUP_SESSION_STATUS.PUBLISHED) return "brand";
  if (status === GROUP_SESSION_STATUS.CANCELLED) return "danger";
  return "neutral";
}

function SessionForm({ courses, meetingProviders, lessonModes, onClose, onCreated }) {
  const toast = useToast();
  const [form, setForm] = useState({
    title: "",
    description: "",
    courseId: courses[0]?.courseId ?? "",
    mode: lessonModes?.[0] ?? LESSON_MODES.ONLINE,
    meetingProvider: meetingProviders?.[0] ?? "ZOOM",
    locationType: IN_PERSON_LOCATIONS.LIBRARY,
    locationLabel: "",
    date: "",
    time: "17:00",
    durationMinutes: 60,
    minParticipants: 3,
    maxParticipants: 6,
    price: "",
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const startAt = new Date(`${form.date}T${form.time}:00`).toISOString();
    const { session } = await api.post("/api/tutor/groups", {
      title: form.title,
      description: form.description || undefined,
      courseId: form.courseId,
      mode: form.mode,
      ...(form.mode === LESSON_MODES.ONLINE
        ? { meetingProvider: form.meetingProvider }
        : {
            location: {
              type: form.locationType,
              label: form.locationLabel || IN_PERSON_LOCATION_LABELS[form.locationType],
            },
          }),
      startAt,
      durationMinutes: Number(form.durationMinutes),
      minParticipants: Number(form.minParticipants),
      maxParticipants: Number(form.maxParticipants),
      pricePerSeatCents: Math.round(Number(form.price || 0) * 100),
    });

    toast.success("Session created", "Publish it when you're ready for sign-ups.");
    onCreated(session);
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="New group session"
      description="It stays a draft — and holds no time on your calendar — until you publish it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={pending}
            disabled={!form.title || !form.date || !form.price}
          >
            Create draft
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Field label="Name" htmlFor="group-title" error={fieldErrors.title} required>
          <Input
            id="group-title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={120}
            error={fieldErrors.title}
            placeholder="MHF4U final exam review"
          />
        </Field>

        <Field label="Course" htmlFor="group-course" error={fieldErrors.courseId} required>
          <Select
            id="group-course"
            value={form.courseId}
            onChange={(e) => set("courseId", e.target.value)}
          >
            {courses.map((course) => (
              <option key={course.courseId} value={course.courseId}>
                {course.code ? `${course.code} — ` : ""}
                {course.name}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date" htmlFor="group-date" error={fieldErrors.startAt} required>
            <Input
              id="group-date"
              type="date"
              value={form.date}
              onChange={(e) => set("date", e.target.value)}
              error={fieldErrors.startAt}
            />
          </Field>
          <Field label="Start time" htmlFor="group-time" required>
            <Input
              id="group-time"
              type="time"
              value={form.time}
              onChange={(e) => set("time", e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Length" htmlFor="group-duration">
            <Select
              id="group-duration"
              value={form.durationMinutes}
              onChange={(e) => set("durationMinutes", Number(e.target.value))}
            >
              {LESSON_DURATIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {formatDuration(minutes)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Lesson type" htmlFor="group-mode">
            <Select id="group-mode" value={form.mode} onChange={(e) => set("mode", e.target.value)}>
              {(lessonModes ?? Object.values(LESSON_MODES)).map((mode) => (
                <option key={mode} value={mode}>
                  {LESSON_MODE_LABELS[mode]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {form.mode === LESSON_MODES.ONLINE ? (
          <Field label="Meeting platform" htmlFor="group-provider">
            <Select
              id="group-provider"
              value={form.meetingProvider}
              onChange={(e) => set("meetingProvider", e.target.value)}
            >
              {(meetingProviders ?? []).map((provider) => (
                <option key={provider} value={provider}>
                  {MEETING_PROVIDER_LABELS[provider]}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Where" htmlFor="group-location-type">
              <Select
                id="group-location-type"
                value={form.locationType}
                onChange={(e) => set("locationType", e.target.value)}
              >
                {Object.values(IN_PERSON_LOCATIONS).map((type) => (
                  <option key={type} value={type}>
                    {IN_PERSON_LOCATION_LABELS[type]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Place name" htmlFor="group-location-label" hint="Shown publicly.">
              <Input
                id="group-location-label"
                value={form.locationLabel}
                onChange={(e) => set("locationLabel", e.target.value)}
                maxLength={120}
                placeholder="Toronto Reference Library"
              />
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Minimum" htmlFor="group-min" error={fieldErrors.minParticipants}>
            <Input
              id="group-min"
              type="number"
              min={2}
              max={12}
              value={form.minParticipants}
              onChange={(e) => set("minParticipants", e.target.value)}
              error={fieldErrors.minParticipants}
            />
          </Field>
          <Field label="Maximum" htmlFor="group-max" error={fieldErrors.maxParticipants}>
            <Input
              id="group-max"
              type="number"
              min={2}
              max={12}
              value={form.maxParticipants}
              onChange={(e) => set("maxParticipants", e.target.value)}
              error={fieldErrors.maxParticipants}
            />
          </Field>
          <Field label="Price a seat" htmlFor="group-price" error={fieldErrors.pricePerSeatCents}>
            <Input
              id="group-price"
              type="number"
              min={0}
              value={form.price}
              onChange={(e) => set("price", e.target.value)}
              error={fieldErrors.pricePerSeatCents}
              placeholder="25"
            />
          </Field>
        </div>

        {form.price && form.maxParticipants && (
          <p className="rounded-lg bg-ink-50 p-3 text-xs text-ink-600">
            A full session earns{" "}
            <span className="font-semibold">
              {formatMoney(Math.round(Number(form.price) * 100) * Number(form.maxParticipants))}
            </span>{" "}
            before commission. It needs {form.minParticipants} people to go ahead.
          </p>
        )}

        <Field label="Description" htmlFor="group-description" hint="Optional.">
          <Textarea
            id="group-description"
            rows={3}
            maxLength={2000}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder="We'll work through the past three years of final exam questions on rational and trigonometric functions."
          />
        </Field>
      </div>
    </Modal>
  );
}

function CancelDialog({ session, onClose, onCancelled }) {
  const toast = useToast();
  const [reason, setReason] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.delete(`/api/tutor/groups/${session.id}`, {
      body: { reason: reason || undefined },
    });
    toast.success(
      "Session cancelled",
      result.refundedCents > 0
        ? `${formatMoney(result.refundedCents)} refunded to ${result.cancelledBookings} ${result.cancelledBookings === 1 ? "person" : "people"}.`
        : "Nobody had paid yet.",
    );
    onCancelled(result);
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Cancel this session?"
      description={
        session.seatsTaken > 0
          ? `${session.seatsTaken} ${session.seatsTaken === 1 ? "person" : "people"} will be refunded in full.`
          : "Nobody has joined yet."
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button variant="danger" onClick={submit} loading={pending}>
            Cancel session
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />
        <p className="text-sm text-ink-600">
          Everybody who paid is refunded in full, whatever the notice — a session that does not
          run is not a late cancellation on their part. Repeated cancellations affect your
          reliability score.
        </p>
        <Field label="Why?" htmlFor="group-cancel-reason" hint="Shared with everybody who joined.">
          <Textarea
            id="group-cancel-reason"
            rows={3}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
