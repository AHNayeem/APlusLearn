"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, MessageSquare, Info, Lock } from "lucide-react";
import { api, qs, ApiError } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Badge, Button, Card, CardBody, Field, Select, Textarea, OptionCard,
  FormErrorSummary, useToast, Spinner,
} from "@/components/ui";
import { formatMoney, formatRate, formatDateTime, formatDuration } from "@/lib/utils/format";
import {
  LESSON_MODES, LESSON_MODE_LABELS, MEETING_PROVIDERS, MEETING_PROVIDER_LABELS,
  IN_PERSON_LOCATIONS, IN_PERSON_LOCATION_LABELS, LESSON_DURATIONS, RECURRENCE,
  RECURRENCE_LABELS, DEFAULT_LESSON_DURATION,
} from "@/constants";
import { AvailabilityPicker } from "./AvailabilityPicker";

/**
 * The booking flow (§19):
 *   student → course → lesson type → date/time → duration → price → payment
 *
 * Every price shown here comes from /api/bookings/quote. The client never
 * calculates a total (§20, §42).
 */
export function BookingWidget({ tutor, user, students = [] }) {
  const router = useRouter();
  const toast = useToast();

  const [studentProfileId, setStudentProfileId] = useState(students[0]?.id ?? "");
  const [courseId, setCourseId] = useState(tutor.courses[0]?.courseId ?? "");
  const [mode, setMode] = useState(tutor.lessonModes[0]);
  const [durationMinutes, setDurationMinutes] = useState(DEFAULT_LESSON_DURATION);
  const [startAt, setStartAt] = useState("");
  const [recurrence, setRecurrence] = useState(RECURRENCE.NONE);
  const [occurrences, setOccurrences] = useState(4);
  const [meetingProvider, setMeetingProvider] = useState(
    tutor.onlineMeetingProviders?.[0] ?? MEETING_PROVIDERS.ZOOM,
  );
  const [locationType, setLocationType] = useState(tutor.inPersonLocationTypes?.[0] ?? "");
  const [locationAddress, setLocationAddress] = useState("");
  const [notes, setNotes] = useState("");

  // `forDuration` records which lesson length the slots were fetched for, so
  // the loading flag is derived rather than set inside the effect.
  const [slots, setSlots] = useState({
    days: [],
    timeZone: tutor.timeZone,
    hasAvailability: false,
    forDuration: null,
  });
  const [quote, setQuote] = useState(null);

  const slotsLoading = slots.forDuration !== durationMinutes;

  // Slots depend on the lesson length: a 90-minute lesson needs a longer gap.
  useEffect(() => {
    let cancelled = false;

    api
      .get(`/api/tutors/${tutor.id}/availability${qs({ days: 21, durationMinutes })}`)
      .then((data) => {
        if (cancelled) return;
        setSlots({ ...data, forDuration: durationMinutes });
        // Drop a selected time that is no longer offered at this length.
        setStartAt((current) =>
          data.days.some((d) => d.slots.some((s) => s.startAt === current)) ? current : "",
        );
      })
      .catch(() => {
        if (cancelled) return;
        setSlots({ days: [], timeZone: tutor.timeZone, forDuration: durationMinutes });
      });

    return () => {
      cancelled = true;
    };
  }, [tutor.id, tutor.timeZone, durationMinutes]);

  // Re-quote whenever anything that affects the price changes.
  useEffect(() => {
    if (!courseId) return undefined;
    let cancelled = false;
    api
      .post("/api/bookings/quote", {
        tutorProfileId: tutor.id,
        courseId,
        durationMinutes,
        occurrences: recurrence === RECURRENCE.NONE ? 1 : occurrences,
      })
      .then((data) => !cancelled && setQuote(data))
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
  }, [tutor.id, courseId, durationMinutes, recurrence, occurrences]);

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const payload = {
      tutorProfileId: tutor.id,
      studentProfileId,
      courseId,
      mode,
      startAt,
      durationMinutes,
      recurrence,
      occurrences: recurrence === RECURRENCE.NONE ? 1 : occurrences,
      studentNotes: notes || undefined,
      ...(mode === LESSON_MODES.ONLINE ? { meetingProvider } : {}),
      ...(mode === LESSON_MODES.IN_PERSON
        ? {
            location: {
              type: locationType,
              label: IN_PERSON_LOCATION_LABELS[locationType],
              addressLine: locationAddress || undefined,
            },
          }
        : {}),
    };

    const result = await api.post("/api/bookings", payload);
    toast.success("Lesson reserved", "Complete payment to confirm it.");
    router.push(`/bookings/checkout/${result.payment.id}`);
    return result;
  });

  // --- Signed out: search and browsing are public, booking is not (§9) ---
  if (!user) {
    return (
      <BookingShell tutor={tutor}>
        <Alert tone="info" title="Sign in to book" className="mb-4">
          You can browse and message for free. Booking needs an account so we can hold your lesson
          and send confirmations.
        </Alert>
        <Button
          href={`/login?next=${encodeURIComponent(`/tutors/${tutor.slug}`)}`}
          fullWidth
          size="lg"
        >
          Sign in to book
        </Button>
        <Button
          href={`/register?next=${encodeURIComponent(`/tutors/${tutor.slug}`)}`}
          variant="secondary"
          fullWidth
          size="lg"
          className="mt-2"
        >
          Create an account
        </Button>
        <AvailabilityPreview slots={slots} loading={slotsLoading} />
      </BookingShell>
    );
  }

  // --- Tutors cannot book other tutors ---
  if (user.role === "TUTOR" || user.role === "ADMIN") {
    return (
      <BookingShell tutor={tutor}>
        <Alert tone="neutral" title="Booking is for parent and student accounts">
          You&rsquo;re signed in as {user.role === "TUTOR" ? "a tutor" : "an administrator"}, so this
          booking form is read-only.
        </Alert>
        <AvailabilityPreview slots={slots} loading={slotsLoading} />
      </BookingShell>
    );
  }

  // --- Parent with no children yet ---
  if (students.length === 0) {
    return (
      <BookingShell tutor={tutor}>
        <Alert tone="info" title="Add your child first" className="mb-4">
          We need to know who the lesson is for — their grade and courses help the tutor prepare.
        </Alert>
        <Button href="/children?new=1" fullWidth size="lg">
          Add a child
        </Button>
      </BookingShell>
    );
  }

  const canSubmit =
    studentProfileId && courseId && startAt && (mode !== LESSON_MODES.IN_PERSON || locationType);

  return (
    <BookingShell tutor={tutor}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-5"
      >
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Field label="Who is the lesson for?" htmlFor="booking-student" required>
          <Select
            id="booking-student"
            value={studentProfileId}
            onChange={(e) => setStudentProfileId(e.target.value)}
            error={fieldErrors.studentProfileId}
          >
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.firstName}
                {student.gradeName ? ` · ${student.gradeName}` : ""}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Course" htmlFor="booking-course" required error={fieldErrors.courseId}>
          <Select
            id="booking-course"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            error={fieldErrors.courseId}
          >
            {tutor.courses.map((course) => (
              <option key={course.courseId} value={course.courseId}>
                {course.code ? `${course.code} — ` : ""}
                {course.name} ({formatRate(course.hourlyRateCents)})
              </option>
            ))}
          </Select>
        </Field>

        {tutor.lessonModes.length > 1 && (
          <fieldset>
            <legend className="mb-2 block text-sm font-semibold text-ink-800">Lesson type</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {tutor.lessonModes.map((value) => (
                <OptionCard
                  key={value}
                  type="radio"
                  name="mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  selected={mode === value}
                  label={LESSON_MODE_LABELS[value]}
                  description={
                    value === LESSON_MODES.ONLINE ? "Video call" : `Around ${tutor.city}`
                  }
                />
              ))}
            </div>
          </fieldset>
        )}

        {mode === LESSON_MODES.ONLINE && tutor.onlineMeetingProviders?.length > 1 && (
          <Field label="Meeting platform" htmlFor="booking-provider">
            <Select
              id="booking-provider"
              value={meetingProvider}
              onChange={(e) => setMeetingProvider(e.target.value)}
            >
              {tutor.onlineMeetingProviders.map((provider) => (
                <option key={provider} value={provider}>
                  {MEETING_PROVIDER_LABELS[provider]}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {mode === LESSON_MODES.IN_PERSON && (
          <>
            <Field label="Where?" htmlFor="booking-location" required error={fieldErrors.location}>
              <Select
                id="booking-location"
                value={locationType}
                onChange={(e) => setLocationType(e.target.value)}
              >
                <option value="">Choose a location</option>
                {tutor.inPersonLocationTypes.map((type) => (
                  <option key={type} value={type}>
                    {IN_PERSON_LOCATION_LABELS[type]}
                  </option>
                ))}
              </Select>
            </Field>

            {locationType === IN_PERSON_LOCATIONS.STUDENT_HOME && (
              <Field
                label="Address"
                htmlFor="booking-address"
                hint="Only shared with your tutor once the lesson is confirmed."
              >
                <Textarea
                  id="booking-address"
                  rows={2}
                  value={locationAddress}
                  onChange={(e) => setLocationAddress(e.target.value)}
                  placeholder="Street address, unit, buzzer code…"
                />
              </Field>
            )}
          </>
        )}

        <Field label="Lesson length" htmlFor="booking-duration">
          <div className="flex flex-wrap gap-2">
            {LESSON_DURATIONS.map((minutes) => (
              <button
                key={minutes}
                type="button"
                onClick={() => setDurationMinutes(minutes)}
                aria-pressed={durationMinutes === minutes}
                className={
                  durationMinutes === minutes
                    ? "rounded-lg border border-brand-600 bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white"
                    : "rounded-lg border border-ink-200 bg-white px-3.5 py-2 text-xs font-semibold text-ink-700 hover:border-brand-400"
                }
              >
                {formatDuration(minutes)}
              </button>
            ))}
          </div>
        </Field>

        <div>
          <p className="mb-2 block text-sm font-semibold text-ink-800">
            Pick a time <span className="text-danger-600">*</span>
          </p>
          <AvailabilityPicker
            days={slots.days}
            loading={slotsLoading}
            selected={startAt}
            onSelect={setStartAt}
            timeZone={slots.timeZone}
          />
          {fieldErrors.startAt && (
            <p className="mt-2 text-xs font-medium text-danger-600">{fieldErrors.startAt}</p>
          )}
        </div>

        <Field label="Repeat this lesson?" htmlFor="booking-recurrence">
          <Select
            id="booking-recurrence"
            value={recurrence}
            onChange={(e) => setRecurrence(e.target.value)}
          >
            {Object.values(RECURRENCE).map((value) => (
              <option key={value} value={value}>
                {RECURRENCE_LABELS[value]}
              </option>
            ))}
          </Select>
        </Field>

        {recurrence !== RECURRENCE.NONE && (
          <Field
            label="How many lessons?"
            htmlFor="booking-occurrences"
            hint="All of them are reserved on the tutor's calendar and paid together."
          >
            <Select
              id="booking-occurrences"
              value={occurrences}
              onChange={(e) => setOccurrences(Number(e.target.value))}
            >
              {[2, 4, 6, 8, 12].map((n) => (
                <option key={n} value={n}>
                  {n} lessons
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label="Anything the tutor should know?"
          htmlFor="booking-notes"
          hint="Optional — what you'd like to cover, or what's been difficult."
        >
          <Textarea
            id="booking-notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={1000}
            placeholder="We're working through the unit on logarithms and the last test didn't go well…"
          />
        </Field>

        <PriceSummary quote={quote} startAt={startAt} timeZone={slots.timeZone} recurrence={recurrence} />

        <Button type="submit" size="lg" fullWidth loading={pending} disabled={!canSubmit}>
          {pending ? "Reserving…" : "Continue to payment"}
        </Button>

        <p className="flex items-center justify-center gap-1.5 text-xs text-ink-500">
          <Lock className="size-3" />
          You won&rsquo;t be charged until the next step
        </p>
      </form>
    </BookingShell>
  );
}

function BookingShell({ tutor, children }) {
  return (
    <Card id="availability" className="lg:sticky lg:top-24">
      <div className="border-b border-ink-100 bg-brand-50/40 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-2xl font-extrabold text-ink-900">{formatRate(tutor.hourlyRateCents)}</p>
          {tutor.offersFreeIntro && <Badge tone="accent">Free intro</Badge>}
        </div>
        <p className="mt-1 text-xs text-ink-500">
          Cancel free up to 24 hours before · Full refund if your tutor cancels
        </p>
      </div>
      <CardBody>{children}</CardBody>
      <div className="border-t border-ink-100 p-5 pt-4">
        <Button
          href={`#message`}
          variant="secondary"
          fullWidth
          iconLeft={<MessageSquare className="size-4" />}
        >
          Message {tutor.firstName} first
        </Button>
      </div>
    </Card>
  );
}

/** Read-only availability shown to signed-out visitors (§12). */
function AvailabilityPreview({ slots, loading }) {
  return (
    <div className="mt-6 border-t border-ink-100 pt-5">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-900">
        <CalendarDays className="size-4 text-ink-400" />
        Upcoming availability
      </h3>
      {loading ? (
        <Spinner className="size-4 text-ink-400" />
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {slots.days
            ?.filter((d) => d.slots.length)
            .slice(0, 4)
            .flatMap((day) =>
              day.slots.slice(0, 3).map((slot) => (
                <span
                  key={slot.startAt}
                  className="rounded-lg bg-ink-100 px-2.5 py-1.5 text-xs font-medium text-ink-600"
                >
                  {new Date(slot.startAt).toLocaleDateString("en-CA", {
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}{" "}
                  {slot.label}
                </span>
              )),
            )}
          {!slots.days?.some((d) => d.slots.length) && (
            <p className="text-sm text-ink-500">No published availability right now.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** Server-calculated totals. Nothing here is computed in the browser (§42). */
function PriceSummary({ quote, startAt, timeZone, recurrence }) {
  if (!quote) return null;

  const isSeries = recurrence !== RECURRENCE.NONE;
  const total = isSeries ? quote.series.totalCents : quote.lesson.totalCents;

  return (
    <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-4">
      <dl className="space-y-2 text-sm">
        {startAt && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">First lesson</dt>
            <dd className="text-right font-semibold text-ink-900">
              {formatDateTime(startAt, timeZone)}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-ink-500">
            {formatDuration(quote.lesson.durationMinutes)} at{" "}
            {formatRate(quote.lesson.hourlyRateCents)}
          </dt>
          <dd className="font-semibold text-ink-900">{formatMoney(quote.lesson.totalCents)}</dd>
        </div>
        {isSeries && (
          <div className="flex justify-between gap-3">
            <dt className="text-ink-500">× {quote.series.occurrences} lessons</dt>
            <dd className="font-semibold text-ink-900">{formatMoney(quote.series.totalCents)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t border-ink-200 pt-2">
          <dt className="font-bold text-ink-900">Total</dt>
          <dd className="text-base font-extrabold text-ink-900">{formatMoney(total)}</dd>
        </div>
      </dl>

      <details className="mt-3 text-xs [&_summary::-webkit-details-marker]:hidden">
        <summary className="flex cursor-pointer items-center gap-1.5 font-semibold text-ink-500 hover:text-ink-700">
          <Info className="size-3.5" />
          Cancellation policy
        </summary>
        <ul className="mt-2 space-y-1 text-ink-500">
          {quote.cancellationPolicy.map((line) => (
            <li key={line}>· {line}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
