"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Sparkles, Save } from "lucide-react";
import { api, qs } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Card, CardBody, CardHeader, Field, Input, OptionCard,
  Select, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import {
  LESSON_MODES, LESSON_MODE_LABELS, AVAILABILITY_WINDOWS, LESSON_DURATIONS,
  REQUEST_URGENCY, REQUEST_URGENCY_LABELS, REQUEST_VISIBILITY, REQUEST_VISIBILITY_LABELS,
  QUALIFICATION_TYPES, QUALIFICATION_LABELS,
} from "@/constants";
import { formatDuration } from "@/lib/utils/format";
import { useToday } from "@/hooks/useToday";

const LANGUAGE_OPTIONS = [
  "English", "French", "Mandarin", "Cantonese", "Punjabi", "Spanish",
  "Arabic", "Tagalog", "Urdu", "Tamil", "Farsi", "Russian",
];

/**
 * Post or edit a tutor request (§22, §41 Phase 2).
 *
 * One component for both, because the two are the same brief: a field that
 * may not be edited is one the server refuses, and having a second form would
 * be the obvious place for the two to drift apart. Posting runs the matcher
 * and lands on the comparison view; editing re-runs it against the new brief.
 */
export function RequestForm({ students, request = null }) {
  const router = useRouter();
  const toast = useToast();
  const editing = Boolean(request);

  const [form, setForm] = useState(() => initialForm(request, students));

  const [courses, setCourses] = useState([]);
  const [courseQuery, setCourseQuery] = useState("");
  const today = useToday();

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const toggle = (key, value) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(value) ? f[key].filter((v) => v !== value) : [...f[key], value],
    }));

  // Course list follows the selected child's grade — the most relevant subset.
  const student = students.find((s) => s.id === form.studentProfileId);

  useEffect(() => {
    if (editing) return undefined;
    const params = { province: form.provinceCode, pageSize: 60 };
    if (courseQuery.trim()) params.q = courseQuery.trim();
    else if (student?.gradeSlug) params.grade = student.gradeSlug;

    api
      .get(`/api/curriculum/courses${qs(params)}`)
      .then((data) => setCourses(data.courses ?? []))
      .catch(() => setCourses([]));
    return undefined;
  }, [editing, form.provinceCode, courseQuery, student?.gradeSlug]);

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const payload = {
      ...form,
      budgetMinCents: form.budgetMinCents
        ? Math.round(Number(form.budgetMinCents) * 100)
        : undefined,
      budgetMaxCents: Math.round(Number(form.budgetMaxCents) * 100),
      startDate: form.startDate ? new Date(form.startDate).toISOString() : undefined,
      title: form.title || undefined,
      city: form.city || undefined,
      postalCode: form.postalCode || undefined,
      notes: form.notes || undefined,
      minYearsExperience: form.minYearsExperience ? Number(form.minYearsExperience) : undefined,
    };

    if (editing) {
      // The server owns which fields are editable; sending the learner or the
      // course would simply be ignored, so they are not sent at all.
      delete payload.studentProfileId;
      delete payload.courseId;
      delete payload.provinceCode;

      const result = await api.patch(`/api/requests/${request.id}`, payload);
      toast.success(
        "Request updated",
        result.matchCount > 0
          ? `We re-matched ${result.matchCount} ${result.matchCount === 1 ? "tutor" : "tutors"}.`
          : "Your changes are live.",
      );
      router.push(`/requests/${request.id}`);
      router.refresh();
      return result;
    }

    const result = await api.post("/api/requests", payload);
    toast.success(
      "Request posted",
      result.matchCount > 0
        ? `We found ${result.matchCount} matching ${result.matchCount === 1 ? "tutor" : "tutors"}.`
        : "We'll notify you as matching tutors join.",
    );
    router.push(`/requests/${result.request.id}`);
    return result;
  });

  const wantsInPerson = form.modes.includes(LESSON_MODES.IN_PERSON);
  const canSubmit = editing
    ? Boolean(form.goal && form.budgetMaxCents)
    : Boolean(form.courseId && form.goal && form.budgetMaxCents);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-6"
    >
      <FormErrorSummary error={error} fieldErrors={fieldErrors} />

      <Card>
        <CardHeader title="Who and what" />
        <CardBody className="space-y-5">
          {editing ? (
            <Alert tone="neutral" title="Course and learner are fixed">
              Tutors have already read this brief. To ask about a different course or a different
              child, post a new request.
            </Alert>
          ) : (
            <Field
              label="Who needs help?"
              htmlFor="req-student"
              error={fieldErrors.studentProfileId}
              required
            >
              <Select
                id="req-student"
                value={form.studentProfileId}
                onChange={(e) => set("studentProfileId", e.target.value)}
              >
                {students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.firstName}
                    {s.gradeName ? ` · ${s.gradeName}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
          )}

          {!editing && (
            <Field
              label="Which course?"
              htmlFor="req-course"
              hint="Search by name or code — MHF4U, Advanced Functions, Grade 8 math…"
              error={fieldErrors.courseId}
              required
            >
              <Input
                id="req-course-search"
                value={courseQuery}
                onChange={(e) => setCourseQuery(e.target.value)}
                placeholder="Search courses"
                className="mb-2"
              />
              <Select
                id="req-course"
                value={form.courseId}
                onChange={(e) => set("courseId", e.target.value)}
                error={fieldErrors.courseId}
              >
                <option value="">Choose a course</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.code ? `${course.code} — ` : ""}
                    {course.name} (Grade {course.gradeLevel})
                  </option>
                ))}
              </Select>
            </Field>
          )}

          <Field
            label="Give it a headline"
            htmlFor="req-title"
            hint="Optional — what tutors see first on the request board."
            error={fieldErrors.title}
          >
            <Input
              id="req-title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              maxLength={120}
              error={fieldErrors.title}
              placeholder="Grade 12 Advanced Functions — exam prep, twice a week"
            />
          </Field>

          <Field
            label="What do you want to achieve?"
            htmlFor="req-goal"
            hint="Tutors read this first — be specific about the gap."
            error={fieldErrors.goal}
            required
          >
            <Textarea
              id="req-goal"
              rows={3}
              value={form.goal}
              onChange={(e) => set("goal", e.target.value)}
              maxLength={500}
              error={fieldErrors.goal}
              placeholder="Lift MHF4U from a 72 to the mid-80s before the final. Logarithms and rational functions are the weak units."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="How soon do you need to start?" htmlFor="req-urgency">
              <Select
                id="req-urgency"
                value={form.urgency}
                onChange={(e) => set("urgency", e.target.value)}
              >
                {Object.values(REQUEST_URGENCY).map((value) => (
                  <option key={value} value={value}>
                    {REQUEST_URGENCY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>

            <Field
              label="Who can see this request?"
              htmlFor="req-visibility"
              hint="Invite-only requests never appear on the tutor board."
            >
              <Select
                id="req-visibility"
                value={form.visibility}
                onChange={(e) => set("visibility", e.target.value)}
              >
                {Object.values(REQUEST_VISIBILITY).map((value) => (
                  <option key={value} value={value}>
                    {REQUEST_VISIBILITY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="How and where" />
        <CardBody className="space-y-5">
          <fieldset>
            <legend className="mb-2 block text-sm font-semibold text-ink-800">
              Lesson type <span className="text-danger-600">*</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.values(LESSON_MODES).map((mode) => (
                <OptionCard
                  key={mode}
                  type="checkbox"
                  checked={form.modes.includes(mode)}
                  onChange={() => toggle("modes", mode)}
                  selected={form.modes.includes(mode)}
                  label={LESSON_MODE_LABELS[mode]}
                  description={
                    mode === LESSON_MODES.ONLINE
                      ? "Anywhere in the province"
                      : "Within travelling distance"
                  }
                />
              ))}
            </div>
            {fieldErrors.modes && (
              <p className="mt-2 text-xs font-medium text-danger-600">{fieldErrors.modes}</p>
            )}
          </fieldset>

          {wantsInPerson && (
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="City" htmlFor="req-city" error={fieldErrors.city}>
                <Input
                  id="req-city"
                  value={form.city}
                  onChange={(e) => set("city", e.target.value)}
                  error={fieldErrors.city}
                  placeholder="Toronto"
                />
              </Field>
              <Field label="Postal code" htmlFor="req-postal" error={fieldErrors.postalCode}>
                <Input
                  id="req-postal"
                  value={form.postalCode}
                  onChange={(e) => set("postalCode", e.target.value.toUpperCase())}
                  error={fieldErrors.postalCode}
                  placeholder="M4W 1A8"
                />
              </Field>
              <Field label="Max distance" htmlFor="req-distance">
                <Select
                  id="req-distance"
                  value={form.maxDistanceKm}
                  onChange={(e) => set("maxDistanceKm", Number(e.target.value))}
                >
                  {[5, 10, 25, 50].map((km) => (
                    <option key={km} value={km}>
                      Within {km} km
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          )}

          <fieldset>
            <legend className="mb-2 block text-sm font-semibold text-ink-800">
              When could lessons happen? <span className="text-danger-600">*</span>
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {AVAILABILITY_WINDOWS.map((window) => (
                <OptionCard
                  key={window.value}
                  type="checkbox"
                  checked={form.preferredWindows.includes(window.value)}
                  onChange={() => toggle("preferredWindows", window.value)}
                  selected={form.preferredWindows.includes(window.value)}
                  label={window.label}
                />
              ))}
            </div>
            {fieldErrors.preferredWindows && (
              <p className="mt-2 text-xs font-medium text-danger-600">
                {fieldErrors.preferredWindows}
              </p>
            )}
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Lessons per week" htmlFor="req-frequency">
              <Select
                id="req-frequency"
                value={form.sessionsPerWeek}
                onChange={(e) => set("sessionsPerWeek", Number(e.target.value))}
              >
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n} per week
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Lesson length" htmlFor="req-duration">
              <Select
                id="req-duration"
                value={form.preferredDurationMinutes}
                onChange={(e) => set("preferredDurationMinutes", Number(e.target.value))}
              >
                {LESSON_DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatDuration(minutes)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Ideal start date" htmlFor="req-start">
              <Input
                id="req-start"
                type="date"
                value={form.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                min={today}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Tutor preferences"
          description="Preferences, not filters. They shape who we rank highest — tutors outside them can still respond."
        />
        <CardBody className="space-y-5">
          <fieldset>
            <legend className="mb-2 block text-sm font-semibold text-ink-800">
              Languages the tutor should speak
            </legend>
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_OPTIONS.map((language) => {
                const selected = form.languages.includes(language);
                return (
                  <button
                    key={language}
                    type="button"
                    onClick={() => toggle("languages", language)}
                    aria-pressed={selected}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      selected
                        ? "border-brand-600 bg-brand-50 text-brand-700"
                        : "border-ink-200 text-ink-600 hover:border-ink-300"
                    }`}
                  >
                    {language}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Minimum years of experience"
              htmlFor="req-experience"
              hint="Optional"
              error={fieldErrors.minYearsExperience}
            >
              <Select
                id="req-experience"
                value={form.minYearsExperience}
                onChange={(e) => set("minYearsExperience", e.target.value)}
              >
                <option value="">No preference</option>
                {[1, 2, 3, 5, 10].map((years) => (
                  <option key={years} value={years}>
                    {years}+ years
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 block text-sm font-semibold text-ink-800">
              Qualifications you&rsquo;d prefer
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.values(QUALIFICATION_TYPES).map((value) => (
                <OptionCard
                  key={value}
                  type="checkbox"
                  checked={form.preferredQualifications.includes(value)}
                  onChange={() => toggle("preferredQualifications", value)}
                  selected={form.preferredQualifications.includes(value)}
                  label={QUALIFICATION_LABELS[value]}
                />
              ))}
            </div>
          </fieldset>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Budget"
          description="Tutors see this before they respond, so only matching tutors get in touch."
        />
        <CardBody>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Minimum per hour" htmlFor="req-budget-min" hint="Optional">
              <Input
                id="req-budget-min"
                type="number"
                inputMode="numeric"
                min={15}
                value={form.budgetMinCents}
                onChange={(e) => set("budgetMinCents", e.target.value)}
                error={fieldErrors.budgetMinCents}
                placeholder="40"
              />
            </Field>
            <Field
              label="Maximum per hour"
              htmlFor="req-budget-max"
              error={fieldErrors.budgetMaxCents}
              required
            >
              <Input
                id="req-budget-max"
                type="number"
                inputMode="numeric"
                min={15}
                required
                value={form.budgetMaxCents}
                onChange={(e) => set("budgetMaxCents", e.target.value)}
                error={fieldErrors.budgetMaxCents}
                placeholder="75"
              />
            </Field>
          </div>

          <Field
            label="Anything else?"
            htmlFor="req-notes"
            hint="Optional — learning style, past tutoring, scheduling constraints."
            className="mt-5"
          >
            <Textarea
              id="req-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              maxLength={2000}
            />
          </Field>
        </CardBody>
      </Card>

      <Alert tone="info" title="What happens next" icon={<Sparkles className="size-3" />}>
        {editing
          ? "Saving re-runs matching against your new brief, and tells the tutors who already replied that it changed."
          : "We score every approved tutor against your course, location, budget, schedule and preferences, then notify the best matches."}
      </Alert>

      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          size="lg"
          loading={pending}
          iconLeft={editing ? <Save className="size-4" /> : <Megaphone className="size-4" />}
          disabled={!canSubmit}
          fullWidth={!editing}
        >
          {editing ? "Save changes" : "Post my request"}
        </Button>
        {editing && (
          <Button type="button" variant="ghost" size="lg" href={`/requests/${request.id}`}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** Seed the form from an existing request, or from sensible defaults. */
function initialForm(request, students) {
  return {
    studentProfileId: request?.studentProfileId?.id ?? students[0]?.id ?? "",
    courseId: request?.courseId ?? "",
    title: request?.title ?? "",
    modes: request?.modes ?? [LESSON_MODES.ONLINE],
    city: request?.city ?? "",
    postalCode: request?.postalCode ?? "",
    provinceCode: request?.provinceCode ?? "ON",
    maxDistanceKm: request?.maxDistanceKm ?? 25,
    preferredWindows: request?.preferredWindows ?? ["WEEKDAY_EVENING"],
    sessionsPerWeek: request?.sessionsPerWeek ?? 1,
    preferredDurationMinutes: request?.preferredDurationMinutes ?? 60,
    budgetMinCents: request?.budgetMinCents ? String(request.budgetMinCents / 100) : "",
    budgetMaxCents: request?.budgetMaxCents ? String(request.budgetMaxCents / 100) : "",
    languages: request?.languages ?? [],
    minYearsExperience: request?.minYearsExperience ? String(request.minYearsExperience) : "",
    preferredQualifications: request?.preferredQualifications ?? [],
    urgency: request?.urgency ?? REQUEST_URGENCY.FLEXIBLE,
    visibility: request?.visibility ?? REQUEST_VISIBILITY.PUBLIC,
    goal: request?.goal ?? "",
    startDate: request?.startDate ? String(request.startDate).slice(0, 10) : "",
    notes: request?.notes ?? "",
  };
}
