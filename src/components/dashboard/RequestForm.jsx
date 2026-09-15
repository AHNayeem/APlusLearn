"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Sparkles } from "lucide-react";
import { api, qs } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, OptionCard,
  Select, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import {
  LESSON_MODES, LESSON_MODE_LABELS, AVAILABILITY_WINDOWS, LESSON_DURATIONS,
} from "@/constants";
import { formatDuration } from "@/lib/utils/format";
import { useToday } from "@/hooks/useToday";

/**
 * Post a tutor request (§22). Submitting runs the matching service, so the
 * parent lands on a comparison view with suggestions already scored.
 */
export function RequestForm({ students, provinces }) {
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState({
    studentProfileId: students[0]?.id ?? "",
    courseId: "",
    modes: [LESSON_MODES.ONLINE],
    city: "",
    postalCode: "",
    provinceCode: "ON",
    maxDistanceKm: 25,
    preferredWindows: ["WEEKDAY_EVENING"],
    sessionsPerWeek: 1,
    preferredDurationMinutes: 60,
    budgetMinCents: "",
    budgetMaxCents: "",
    goal: "",
    startDate: "",
    notes: "",
  });

  const [courses, setCourses] = useState([]);
  const [courseQuery, setCourseQuery] = useState("");
  const today = useToday();

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  // Course list follows the selected child's grade — the most relevant subset.
  const student = students.find((s) => s.id === form.studentProfileId);

  useEffect(() => {
    const params = { province: form.provinceCode, pageSize: 60 };
    if (courseQuery.trim()) params.q = courseQuery.trim();
    else if (student?.gradeSlug) params.grade = student.gradeSlug;

    api
      .get(`/api/curriculum/courses${qs(params)}`)
      .then((data) => setCourses(data.courses ?? []))
      .catch(() => setCourses([]));
  }, [form.provinceCode, courseQuery, student?.gradeSlug]);

  const toggleMode = (mode) =>
    set(
      "modes",
      form.modes.includes(mode) ? form.modes.filter((m) => m !== mode) : [...form.modes, mode],
    );

  const toggleWindow = (value) =>
    set(
      "preferredWindows",
      form.preferredWindows.includes(value)
        ? form.preferredWindows.filter((w) => w !== value)
        : [...form.preferredWindows, value],
    );

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post("/api/requests", {
      ...form,
      budgetMinCents: form.budgetMinCents ? Math.round(Number(form.budgetMinCents) * 100) : undefined,
      budgetMaxCents: Math.round(Number(form.budgetMaxCents) * 100),
      startDate: form.startDate ? new Date(form.startDate).toISOString() : undefined,
      city: form.city || undefined,
      postalCode: form.postalCode || undefined,
      notes: form.notes || undefined,
    });

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
          <Field label="Who needs help?" htmlFor="req-student" error={fieldErrors.studentProfileId} required>
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
                  onChange={() => toggleMode(mode)}
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
                  onChange={() => toggleWindow(window.value)}
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
        We score every approved tutor against your course, location, budget and availability, then
        notify the best matches. You&rsquo;ll see who&rsquo;s interested and can compare them side by side.
      </Alert>

      <Button
        type="submit"
        size="lg"
        fullWidth
        loading={pending}
        iconLeft={<Megaphone className="size-4" />}
        disabled={!form.courseId || !form.goal || !form.budgetMaxCents}
      >
        Post my request
      </Button>
    </form>
  );
}
