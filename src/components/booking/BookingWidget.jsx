"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, MessageSquare, Info, Lock, ClipboardList } from "lucide-react";
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
import { bookingWidgetHref, readBookingWidgetParams } from "@/lib/booking/widget-params";
import { VerifyEmailBanner } from "@/components/auth/VerifyEmailBanner";
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
  const searchParams = useSearchParams();

  /**
   * Where the widget starts. A link may carry a selection — "Book again", a
   * request's "Book", or a time a signed-out visitor picked before signing in
   * (§37 steps 11 and 18, R18.10) — and only what this tutor actually offers
   * survives into state. Read once: after that the form is the person's.
   */
  const [initial] = useState(() =>
    initialSelection(readBookingWidgetParams(searchParams), tutor, students),
  );
  const requestId = initial.requestId;

  const [studentProfileId, setStudentProfileId] = useState(initial.studentProfileId);
  const [courseId, setCourseId] = useState(initial.courseId);
  const [mode, setMode] = useState(initial.mode);
  const [durationMinutes, setDurationMinutes] = useState(initial.durationMinutes);
  // A carried-over slot is dropped by the availability fetch below if the
  // tutor no longer offers it, exactly like one picked by hand.
  const [startAt, setStartAt] = useState(initial.startAt);
  const [recurrence, setRecurrence] = useState(RECURRENCE.NONE);
  /**
   * Packages this family already paid for that could cover this lesson
   * (§41 Phase 2). Offered so nobody is charged twice for something they have
   * already bought. The server re-checks ownership, balance, tutor, course,
   * duration and mode — picking one here proves nothing (§42).
   */
  const [usablePackages, setUsablePackages] = useState([]);
  const [packagePurchaseId, setPackagePurchaseId] = useState("");
  const [occurrences, setOccurrences] = useState(4);
  const [meetingProvider, setMeetingProvider] = useState(initial.meetingProvider);
  const [locationType, setLocationType] = useState(initial.locationType);
  const [locationAddress, setLocationAddress] = useState("");
  /** Where an OTHER location is — required, and private until confirmed (R26.5). */
  const [locationDescription, setLocationDescription] = useState("");
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

  useEffect(() => {
    if (!user || !courseId) return undefined;

    let cancelled = false;
    api
      .get(
        `/api/packages/usable${qs({
          tutorProfileId: tutor.id,
          courseId,
          durationMinutes,
          mode,
        })}`,
      )
      .then((data) => {
        if (cancelled) return;
        setUsablePackages(data.packages ?? []);
      })
      .catch(() => {
        if (!cancelled) setUsablePackages([]);
      });

    return () => {
      cancelled = true;
    };
  }, [user, tutor.id, courseId, durationMinutes, mode]);

  // A package covers one lesson, so it is not offered for a repeating series.
  const selectedPackage = usablePackages.find((p) => p.id === packagePurchaseId) ?? null;
  const payWithPackage = Boolean(selectedPackage) && recurrence === RECURRENCE.NONE;

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
      ...(requestId ? { requestId } : {}),
      ...(payWithPackage ? { packagePurchaseId } : {}),
      ...(mode === LESSON_MODES.ONLINE ? { meetingProvider } : {}),
      ...(mode === LESSON_MODES.IN_PERSON
        ? {
            location: {
              type: locationType,
              addressLine:
                locationType === IN_PERSON_LOCATIONS.STUDENT_HOME ? locationAddress || undefined : undefined,
              description:
                locationType === IN_PERSON_LOCATIONS.OTHER ? locationDescription || undefined : undefined,
            },
          }
        : {}),
    };

    const result = await api.post("/api/bookings", payload);

    // A package lesson is paid for already, so there is no checkout to send
    // anybody to — it is confirmed the moment it is booked.
    if (result.paidFromPackage) {
      toast.success(
        "Lesson booked",
        `${result.paidFromPackage.sessionsRemaining} lesson${result.paidFromPackage.sessionsRemaining === 1 ? "" : "s"} left in ${result.paidFromPackage.title}.`,
      );
      router.push(`/bookings/${result.bookings[0].id}`);
      return result;
    }

    toast.success("Lesson reserved", "Complete payment to confirm it.");
    router.push(`/bookings/checkout/${result.payment.id}`);
    return result;
  }, {
    // A 403 means this page was drawn for an account that is not the one now
    // signed in (another tab switched it) or one that cannot book yet. Re-render
    // from the server so the widget shows what that account can actually do.
    onError: (err) => {
      if (err instanceof ApiError && err.status === 403) router.refresh();
    },
  });


  const policyLine = quote?.cancellationPolicy?.[0];

  // --- Signed out: search and browsing are public, booking is not (§9) ---
  //
  // A visitor gets the same picker a learner does, not a teaser (R10.14), and
  // what they pick rides through sign-in in `next`, so they come back to the
  // widget with it still selected (§37 step 11). The server re-checks it all.
  if (!user) {
    const next = bookingWidgetHref(tutor.slug, {
      requestId,
      courseId,
      mode,
      durationMinutes,
      startAt,
    });
    return (
      <BookingShell tutor={tutor} policyLine={policyLine}>
        <div className="space-y-5">
          <CourseField tutor={tutor} value={courseId} onChange={setCourseId} />
          <ModeField tutor={tutor} value={mode} onChange={setMode} />
          <DurationField value={durationMinutes} onChange={setDurationMinutes} />
          <div id="availability" className="scroll-mt-24">
            <p className="mb-2 block text-sm font-semibold text-ink-800">Pick a time</p>
            <AvailabilityPicker
              key={slotsLoading ? "loading" : `ready-${durationMinutes}`}
              days={slots.days}
              loading={slotsLoading}
              selected={startAt}
              onSelect={setStartAt}
              timeZone={slots.timeZone}
            />
          </div>

          <PriceSummary
            quote={quote}
            startAt={startAt}
            timeZone={slots.timeZone}
            recurrence={RECURRENCE.NONE}
          />

          <Alert tone="info" title={startAt ? "Sign in to book this time" : "Sign in to book"}>
            Browsing and messaging are free. Booking needs an account so we can hold your lesson and
            send confirmations{startAt ? " — we'll keep the time you picked" : ""}.
          </Alert>
          <div>
            <Button href={`/login?next=${encodeURIComponent(next)}`} fullWidth size="lg">
              {startAt ? "Sign in to continue" : "Sign in to book"}
            </Button>
            <Button
              href={`/register?next=${encodeURIComponent(next)}`}
              variant="secondary"
              fullWidth
              size="lg"
              className="mt-2"
            >
              Create an account
            </Button>
          </div>
        </div>
      </BookingShell>
    );
  }

  // --- Tutors cannot book other tutors ---
  if (user.role === "TUTOR" || user.role === "ADMIN") {
    return (
      <BookingShell tutor={tutor} policyLine={policyLine}>
        <Alert tone="neutral" title="Booking is for parent and student accounts">
          You&rsquo;re signed in as {user.role === "TUTOR" ? "a tutor" : "an administrator"}, so this
          booking form is read-only.
        </Alert>
        <AvailabilityPreview slots={slots} loading={slotsLoading} />
      </BookingShell>
    );
  }

  // --- Email not confirmed: booking is refused server-side (§9), so say so
  //     before the form is filled in rather than after it is submitted ---
  if (!user.emailVerified) {
    return (
      <BookingShell tutor={tutor} policyLine={policyLine}>
        <VerifyEmailBanner email={user.email} className="mb-4" />
        <AvailabilityPreview slots={slots} loading={slotsLoading} />
      </BookingShell>
    );
  }

  // --- Parent with no children yet ---
  if (students.length === 0) {
    return (
      <BookingShell tutor={tutor} policyLine={policyLine}>
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
    studentProfileId &&
    courseId &&
    startAt &&
    (mode !== LESSON_MODES.IN_PERSON ||
      (locationType &&
        (locationType !== IN_PERSON_LOCATIONS.OTHER || locationDescription.trim().length >= 3)));

  return (
    <BookingShell tutor={tutor} policyLine={policyLine}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="space-y-5"
      >
        {requestId && (
          <p className="flex items-start gap-2 rounded-xl border border-brand-200 bg-brand-50/60 p-3 text-xs text-ink-700">
            <ClipboardList className="mt-0.5 size-3.5 shrink-0 text-brand-600" />
            Booking from your tutor request. Once this lesson is paid for, the request is marked as
            filled and the other tutors are told.
          </p>
        )}

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

        <CourseField
          tutor={tutor}
          value={courseId}
          onChange={setCourseId}
          error={fieldErrors.courseId}
        />

        <ModeField tutor={tutor} value={mode} onChange={setMode} />

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

            {locationType === IN_PERSON_LOCATIONS.OTHER && (
              <Field
                label="Where exactly?"
                htmlFor="booking-location-other"
                required
                hint="Only shared with your tutor once the lesson is confirmed."
                error={fieldErrors["location.description"]}
              >
                <Textarea
                  id="booking-location-other"
                  rows={2}
                  maxLength={300}
                  value={locationDescription}
                  onChange={(e) => setLocationDescription(e.target.value)}
                  placeholder="e.g. Study room 2, North York Central Library"
                />
              </Field>
            )}
          </>
        )}

        <DurationField value={durationMinutes} onChange={setDurationMinutes} />

        <div id="availability" className="scroll-mt-24">
          <p className="mb-2 block text-sm font-semibold text-ink-800">
            Pick a time <span className="text-danger-600">*</span>
          </p>
          <AvailabilityPicker
            key={slotsLoading ? "loading" : `ready-${durationMinutes}`}
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

        {usablePackages.length > 0 && (
          <Field
            label="Pay with a package"
            htmlFor="booking-package"
            hint={
              recurrence === RECURRENCE.NONE
                ? "You've already paid for these lessons."
                : "Package lessons are booked one at a time, so this doesn't apply to a repeating series."
            }
          >
            <Select
              id="booking-package"
              value={packagePurchaseId}
              onChange={(e) => setPackagePurchaseId(e.target.value)}
              disabled={recurrence !== RECURRENCE.NONE}
            >
              <option value="">Pay for this lesson now</option>
              {usablePackages.map((pkg) => (
                <option key={pkg.id} value={pkg.id}>
                  {pkg.title} — {pkg.sessionsTotal - pkg.sessionsUsed} left
                </option>
              ))}
            </Select>
          </Field>
        )}

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

        {payWithPackage ? (
          <div className="rounded-xl border border-success-200 bg-success-50/60 p-4">
            <p className="text-sm font-semibold text-ink-800">
              Paid from {selectedPackage.title}
            </p>
            <p className="mt-1 text-xs text-ink-600">
              This lesson uses one of the{" "}
              {selectedPackage.sessionsTotal - selectedPackage.sessionsUsed} you have left. Nothing
              to pay now, and it&rsquo;s confirmed straight away.
            </p>
          </div>
        ) : (
          <PriceSummary
            quote={quote}
            startAt={startAt}
            timeZone={slots.timeZone}
            recurrence={recurrence}
          />
        )}

        {/* Beside the button, not atop a long form: a refusal from the server
            must be visible where the person just clicked. */}
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Button type="submit" size="lg" fullWidth loading={pending} disabled={!canSubmit}>
          {pending
            ? payWithPackage
              ? "Booking…"
              : "Reserving…"
            : payWithPackage
              ? "Book this lesson"
              : "Continue to payment"}
        </Button>

        <p className="flex items-center justify-center gap-1.5 text-xs text-ink-500">
          <Lock className="size-3" />
          {payWithPackage
            ? "Already paid for — nothing is charged"
            : "You won't be charged until the next step"}
        </p>
      </form>
    </BookingShell>
  );
}

/**
 * Keep only what this tutor offers out of a selection carried in the URL.
 * Anything else falls back to the widget's ordinary default.
 */
function initialSelection(wanted, tutor, students) {
  const pick = (value, allowed, fallback) =>
    value && (allowed ?? []).map(String).includes(String(value)) ? String(value) : fallback;
  const slot = wanted.startAt ? new Date(wanted.startAt) : null;

  return {
    requestId: /^[a-f\d]{24}$/i.test(wanted.requestId ?? "") ? wanted.requestId : null,
    studentProfileId: pick(
      wanted.studentProfileId,
      students.map((s) => s.id),
      students[0]?.id ?? "",
    ),
    courseId: pick(
      wanted.courseId,
      tutor.courses.map((c) => c.courseId),
      tutor.courses[0]?.courseId ?? "",
    ),
    mode: pick(wanted.mode, tutor.lessonModes, tutor.lessonModes[0]),
    durationMinutes: LESSON_DURATIONS.includes(wanted.durationMinutes)
      ? wanted.durationMinutes
      : DEFAULT_LESSON_DURATION,
    locationType: pick(
      wanted.locationType,
      tutor.inPersonLocationTypes,
      tutor.inPersonLocationTypes?.[0] ?? "",
    ),
    meetingProvider: pick(
      wanted.meetingProvider,
      tutor.onlineMeetingProviders,
      tutor.onlineMeetingProviders?.[0] ?? MEETING_PROVIDERS.ZOOM,
    ),
    // Normalised to the exact form the availability API returns, so the
    // carried slot is recognised (and kept) when the slots arrive.
    startAt: slot && !Number.isNaN(slot.getTime()) ? slot.toISOString() : "",
  };
}

function CourseField({ tutor, value, onChange, error }) {
  return (
    <Field label="Course" htmlFor="booking-course" required error={error}>
      <Select
        id="booking-course"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        error={error}
      >
        {tutor.courses.map((course) => (
          <option key={course.courseId} value={course.courseId}>
            {course.code ? `${course.code} — ` : ""}
            {course.name} ({formatRate(course.hourlyRateCents)})
          </option>
        ))}
      </Select>
    </Field>
  );
}

function ModeField({ tutor, value, onChange }) {
  if (tutor.lessonModes.length <= 1) return null;
  return (
    <fieldset>
      <legend className="mb-2 block text-sm font-semibold text-ink-800">Lesson type</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {tutor.lessonModes.map((mode) => (
          <OptionCard
            key={mode}
            type="radio"
            name="mode"
            value={mode}
            checked={value === mode}
            onChange={() => onChange(mode)}
            selected={value === mode}
            label={LESSON_MODE_LABELS[mode]}
            description={mode === LESSON_MODES.ONLINE ? "Video call" : `Around ${tutor.city}`}
          />
        ))}
      </div>
    </fieldset>
  );
}

function DurationField({ value, onChange }) {
  return (
    <Field label="Lesson length" htmlFor="booking-duration">
      <div className="flex flex-wrap gap-2">
        {LESSON_DURATIONS.map((minutes) => (
          <button
            key={minutes}
            type="button"
            onClick={() => onChange(minutes)}
            aria-pressed={value === minutes}
            className={
              value === minutes
                ? "rounded-lg border border-brand-600 bg-brand-600 px-3.5 py-2 text-xs font-semibold text-white"
                : "rounded-lg border border-ink-200 bg-white px-3.5 py-2 text-xs font-semibold text-ink-700 hover:border-brand-400"
            }
          >
            {formatDuration(minutes)}
          </button>
        ))}
      </div>
    </Field>
  );
}

function BookingShell({ tutor, policyLine, children }) {
  return (
    // `#book` is the widget, `#availability` its picker: search result cards
    // link to each (R9.12, R9.13), as do "Book again" and a request's "Book".
    <Card id="book" className="scroll-mt-24 lg:sticky lg:top-24">
      <div className="border-b border-ink-100 bg-brand-50/40 p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-2xl font-extrabold text-ink-900">{formatRate(tutor.hourlyRateCents)}</p>
          {tutor.offersFreeIntro && <Badge tone="accent">Free intro</Badge>}
        </div>
        {/* The platform's current terms, from the server's quote — never a
            literal that drifts from what an administrator set (R24.9). */}
        {policyLine && <p className="mt-1 text-xs text-ink-500">{policyLine}</p>}
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
    <div id="availability" className="mt-6 scroll-mt-24 border-t border-ink-100 pt-5">
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
