"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus, Pencil, Archive, GraduationCap, School, Search, X, Target, Check,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api, qs } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Avatar, Badge, Button, Card, CardBody, ConfirmModal, EmptyState, Field, Input,
  Modal, Select, Switch, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { LEARNER_MODE_PREFERENCES, LEARNER_MODE_PREFERENCE_LABELS } from "@/constants";

/**
 * Child / student profiles (§5).
 *
 * Province, grade, subjects and courses are first-class fields read from the
 * curriculum: the grade list is the chosen province's, and courses can only
 * be picked from that province (the server re-checks both). The learning
 * details — goals, marks, areas to improve, how they learn best — are shared
 * only with tutors the family books, and the minor-privacy switch controls
 * whether those tutors see a full surname (§30).
 *
 * `canManage` (parents) adds and removes children; anyone may edit a learner
 * they own, including a self-serve student's own profile.
 */
export function ChildrenManager({ students, provinces, subjects, defaultProvince, canManage }) {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();

  const [editing, setEditing] = useState(null);
  const [archiving, setArchiving] = useState(null);

  // ?new=1 from elsewhere in the app opens the form straight away, adjusted
  // during render so the modal appears on the first paint.
  const [lastParams, setLastParams] = useState(params);
  if (lastParams !== params) {
    setLastParams(params);
    if (params.get("new") === "1" && canManage) setEditing({});
  }

  if (students.length === 0 && !editing) {
    return (
      <EmptyState
        icon={<GraduationCap className="size-7" />}
        title="No children added yet"
        description="Add your child's province, grade and courses so tutors know exactly what they're preparing for."
        action={
          canManage && (
            <Button onClick={() => setEditing({})} iconLeft={<Plus className="size-4" />}>
              Add a child
            </Button>
          )
        }
      />
    );
  }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {students.map((student) => (
          <LearnerCard
            key={student.id}
            student={student}
            provinces={provinces}
            canArchive={!student.isSelf && canManage}
            onEdit={() => setEditing(student)}
            onArchive={() => setArchiving(student)}
          />
        ))}

        {canManage && (
          <button
            type="button"
            onClick={() => setEditing({})}
            className="flex min-h-40 flex-col items-center justify-center rounded-2xl border-2 border-dashed border-ink-300 text-ink-500 transition-colors hover:border-brand-400 hover:bg-brand-50/40 hover:text-brand-600"
          >
            <Plus className="size-6" />
            <span className="mt-2 text-sm font-semibold">Add another child</span>
          </button>
        )}
      </div>

      <ChildForm
        open={Boolean(editing)}
        student={editing}
        provinces={provinces}
        subjects={subjects}
        defaultProvince={defaultProvince}
        onClose={() => {
          setEditing(null);
          router.replace("/children");
        }}
      />

      <ConfirmModal
        open={Boolean(archiving)}
        onClose={() => setArchiving(null)}
        title={`Remove ${archiving?.firstName}?`}
        description="Their lesson history and receipts are kept, but they won't appear when booking."
        confirmLabel="Remove"
        onConfirm={async () => {
          try {
            await api.delete(`/api/students/${archiving.id}`);
            toast.success(`${archiving.firstName} removed`);
            setArchiving(null);
            router.refresh();
          } catch (error) {
            toast.error("Couldn't remove", error.message);
          }
        }}
      />
    </>
  );
}

/** The learner at a glance, and the one-click search for them. */
function LearnerCard({ student, provinces, canArchive, onEdit, onArchive }) {
  const province = provinces.find((p) => p.code === student.provinceCode);
  const courses = student.currentCourses ?? [];
  const goals = student.learningGoals ?? [];

  return (
    <Card>
      <CardBody>
        <div className="flex items-start gap-3">
          <Avatar src={student.avatarUrl} firstName={student.firstName} lastName={student.lastName} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-ink-900">
              {student.firstName} {student.lastName}
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {student.gradeName && <Badge tone="brand" size="sm">{student.gradeName}</Badge>}
              {province && <Badge tone="neutral" size="sm">{province.name}</Badge>}
              {student.isSelf && <Badge tone="neutral" size="sm">You</Badge>}
              {student.isMinor && !student.shareFullNameWithTutor && (
                <Badge tone="success" size="sm">Name protected</Badge>
              )}
            </div>
          </div>
        </div>

        {student.school && (
          <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-500">
            <School className="size-3.5" />
            {student.school}
          </p>
        )}

        {(courses.length > 0 || (student.subjectsOfInterest ?? []).length > 0) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {courses.map((course) => (
              <Badge key={course.id} tone="accent" size="sm">
                {course.code ?? course.name}
              </Badge>
            ))}
            {(student.subjectsOfInterest ?? []).map((subject) => (
              <Badge key={subject.id} tone="neutral" size="sm">
                {subject.name}
              </Badge>
            ))}
          </div>
        )}

        <dl className="mt-3 space-y-1 text-xs text-ink-600">
          {student.lessonModePreference && (
            <div className="flex gap-1.5">
              <dt className="font-semibold text-ink-700">Prefers</dt>
              <dd>{LEARNER_MODE_PREFERENCE_LABELS[student.lessonModePreference]}</dd>
            </div>
          )}
          {(student.currentMark != null || student.targetMark != null) && (
            <div className="flex gap-1.5">
              <dt className="font-semibold text-ink-700">Marks</dt>
              <dd>
                {student.currentMark != null ? `${student.currentMark}% now` : "—"}
                {student.targetMark != null ? ` · aiming for ${student.targetMark}%` : ""}
              </dd>
            </div>
          )}
          {goals.length > 0 && (
            <div className="flex gap-1.5">
              <dt className="font-semibold text-ink-700">Goals</dt>
              <dd>
                {goals.filter((g) => g.achievedAt).length} of {goals.length} achieved
              </dd>
            </div>
          )}
        </dl>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-ink-100 pt-4">
          <Button variant="secondary" size="sm" onClick={onEdit} iconLeft={<Pencil className="size-3.5" />}>
            Edit
          </Button>
          <Button href={searchHrefFor(student)} variant="ghost" size="sm" iconLeft={<Search className="size-3.5" />}>
            Find tutors
          </Button>
          {canArchive && (
            <Button variant="ghost" size="sm" onClick={onArchive} iconLeft={<Archive className="size-3.5" />}>
              Remove
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

/**
 * A search scoped to this learner: their province and grade, the first
 * course they need help with (or subject), and their lesson preference.
 */
function searchHrefFor(student) {
  const course = (student.currentCourses ?? [])[0];
  const subject = (student.subjectsOfInterest ?? [])[0];
  const mode =
    student.lessonModePreference && student.lessonModePreference !== LEARNER_MODE_PREFERENCES.EITHER
      ? student.lessonModePreference
      : undefined;
  return `/find-a-tutor${qs({
    province: student.provinceCode,
    grade: course ? undefined : student.gradeId?.slug,
    course: course?.slug,
    subject: course ? undefined : subject?.slug,
    mode,
  })}`;
}

/** Fetch a curriculum list that depends on what the form has chosen. */
function useCurriculum(path, params, enabled = true) {
  const key = enabled ? `${path}${qs(params)}` : null;
  const [state, setState] = useState({ key: null, data: null });

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    api
      .get(key)
      .then((data) => !cancelled && setState({ key, data }))
      .catch(() => !cancelled && setState({ key, data: null }));
    return () => {
      cancelled = true;
    };
  }, [key]);

  return state.key === key ? state.data : null;
}

const idOf = (value) => (value && typeof value === "object" ? value.id : value);

function ChildForm({ open, student, provinces, subjects: allSubjects, defaultProvince, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const isEdit = Boolean(student?.id);

  const [form, setForm] = useState({});
  const [courseQuery, setCourseQuery] = useState("");
  // Course details by id, so chosen courses keep their label across searches.
  const [courseLabels, setCourseLabels] = useState({});

  // Seed the form when the modal opens on a different student. A `_seeded`
  // marker makes this idempotent, so it runs once per open rather than on
  // every render.
  const seedKey = open ? (student?.id ?? "new") : null;
  if (seedKey && form._seeded !== seedKey) {
    const courses = student?.currentCourses ?? [];
    setForm({
      _seeded: seedKey,
      firstName: student?.firstName ?? "",
      lastName: student?.lastName ?? "",
      birthYear: student?.birthYear ?? "",
      provinceCode: student?.provinceCode ?? defaultProvince ?? "",
      gradeId: idOf(student?.gradeId) ?? "",
      school: student?.school ?? "",
      subjectsOfInterest: (student?.subjectsOfInterest ?? []).map(idOf),
      currentCourses: courses.map(idOf),
      lessonModePreference: student?.lessonModePreference ?? "",
      currentMark: student?.currentMark ?? "",
      targetMark: student?.targetMark ?? "",
      learningGoals: (student?.learningGoals ?? []).map((goal) => ({
        label: goal.label,
        targetDate: goal.targetDate ? String(goal.targetDate).slice(0, 10) : "",
        achieved: Boolean(goal.achievedAt),
      })),
      areasForImprovement: student?.areasForImprovement ?? "",
      learningPreferences: student?.learningPreferences ?? "",
      notes: student?.notes ?? "",
      accessibilityNeeds: student?.accessibilityNeeds ?? "",
      shareFullNameWithTutor: student?.shareFullNameWithTutor ?? false,
    });
    setCourseLabels(Object.fromEntries(courses.filter((c) => typeof c === "object").map((c) => [c.id, c])));
    setCourseQuery("");
  }

  const grades = useCurriculum("/api/curriculum/grades", { province: form.provinceCode }, Boolean(form.provinceCode))?.grades ?? [];
  const selectedGrade = grades.find((g) => g.id === form.gradeId);
  const provinceSubjects =
    useCurriculum(
      "/api/curriculum/subjects",
      { province: form.provinceCode, grade: selectedGrade?.slug },
      Boolean(form.provinceCode),
    )?.subjects ?? (form.provinceCode ? [] : allSubjects);
  const courseResults =
    useCurriculum(
      "/api/curriculum/courses",
      { province: form.provinceCode, grade: selectedGrade?.slug, q: courseQuery.trim() || undefined, pageSize: 20 },
      Boolean(form.provinceCode),
    )?.courses ?? [];

  const set = (key) => (event) =>
    setForm((f) => ({
      ...f,
      [key]: event.target.type === "checkbox" ? event.target.checked : event.target.value,
    }));

  const toggleIn = (key, id) =>
    setForm((f) => ({
      ...f,
      [key]: f[key].includes(id) ? f[key].filter((v) => v !== id) : [...f[key], id],
    }));

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    // On an edit an emptied field is sent as null, which clears it; on a new
    // child it is simply left out.
    const empty = isEdit ? null : undefined;
    const text = (value) => (String(value ?? "").trim() ? String(value).trim() : empty);
    const number = (value) => (value === "" || value === null || value === undefined ? empty : Number(value));

    const payload = {
      firstName: form.firstName,
      lastName: text(form.lastName),
      birthYear: number(form.birthYear),
      provinceCode: text(form.provinceCode),
      gradeId: text(form.gradeId),
      school: text(form.school),
      subjectsOfInterest: form.subjectsOfInterest,
      currentCourses: form.currentCourses,
      lessonModePreference: text(form.lessonModePreference),
      currentMark: number(form.currentMark),
      targetMark: number(form.targetMark),
      learningGoals: form.learningGoals
        .filter((goal) => goal.label.trim())
        .map((goal) => ({ label: goal.label.trim(), targetDate: goal.targetDate || undefined, achieved: goal.achieved })),
      areasForImprovement: text(form.areasForImprovement),
      learningPreferences: text(form.learningPreferences),
      notes: text(form.notes),
      accessibilityNeeds: text(form.accessibilityNeeds),
      shareFullNameWithTutor: form.shareFullNameWithTutor,
    };

    if (isEdit) await api.patch(`/api/students/${student.id}`, payload);
    else await api.post("/api/students", payload);

    toast.success(isEdit ? "Profile updated" : `${form.firstName} added`);
    onClose();
    router.refresh();
  });

  const currentYear = new Date().getFullYear();
  const chosenCourses = (form.currentCourses ?? []).map((id) => courseLabels[id] ?? { id, name: "Course" });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? `Edit ${student.firstName}'s profile` : "Add a child"}
      description="Province, grade and courses help tutors prepare — everything else is optional."
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!form.firstName}>
            {isEdit ? "Save changes" : "Add child"}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" htmlFor="child-first" error={fieldErrors.firstName} required>
            <Input id="child-first" value={form.firstName ?? ""} onChange={set("firstName")} error={fieldErrors.firstName} />
          </Field>
          <Field label="Last name" htmlFor="child-last" error={fieldErrors.lastName}>
            <Input id="child-last" value={form.lastName ?? ""} onChange={set("lastName")} error={fieldErrors.lastName} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Province" htmlFor="child-province" error={fieldErrors.provinceCode}>
            <Select
              id="child-province"
              value={form.provinceCode ?? ""}
              onChange={(e) =>
                // A new province strands the grade and courses chosen under the old one.
                setForm((f) => ({ ...f, provinceCode: e.target.value, gradeId: "", currentCourses: [] }))
              }
            >
              <option value="">Choose a province</option>
              {provinces.map((province) => (
                <option key={province.code} value={province.code}>
                  {province.name}
                  {province.isActive ? "" : " (tutoring coming soon)"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Grade" htmlFor="child-grade" error={fieldErrors.gradeId}>
            <Select
              id="child-grade"
              value={form.gradeId ?? ""}
              onChange={set("gradeId")}
              disabled={!form.provinceCode}
            >
              <option value="">{form.provinceCode ? "Choose a grade" : "Choose a province first"}</option>
              {grades.map((grade) => (
                <option key={grade.id} value={grade.id}>
                  {grade.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Year of birth"
            htmlFor="child-birth"
            hint="Only the year, never a full date of birth."
            error={fieldErrors.birthYear}
          >
            <Select id="child-birth" value={form.birthYear ?? ""} onChange={set("birthYear")}>
              <option value="">Prefer not to say</option>
              {Array.from({ length: 25 }, (_, i) => currentYear - 4 - i).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="School" htmlFor="child-school" hint="Optional">
          <Input id="child-school" value={form.school ?? ""} onChange={set("school")} />
        </Field>

        <fieldset>
          <legend className="text-sm font-semibold text-ink-800">Courses they need help with</legend>
          <p className="mt-0.5 text-xs text-ink-500">
            From {provinces.find((p) => p.code === form.provinceCode)?.name ?? "their province"}&rsquo;s curriculum
            {selectedGrade ? `, ${selectedGrade.name}` : ""}.
          </p>
          {fieldErrors.currentCourses && (
            <p className="mt-1 text-xs font-medium text-danger-600">{fieldErrors.currentCourses}</p>
          )}
          {chosenCourses.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Chosen courses">
              {chosenCourses.map((course) => (
                <li key={course.id}>
                  <button
                    type="button"
                    onClick={() => toggleIn("currentCourses", course.id)}
                    className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-1 pl-2.5 pr-1.5 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-200 hover:bg-brand-100"
                  >
                    {course.code ? `${course.code} — ${course.name}` : course.name}
                    <X className="size-3" aria-hidden="true" />
                    <span className="sr-only">Remove</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2">
            <Input
              value={courseQuery}
              onChange={(e) => setCourseQuery(e.target.value)}
              placeholder={form.provinceCode ? "Search by course name or code" : "Choose a province first"}
              disabled={!form.provinceCode}
              iconLeft={<Search className="size-4" />}
              aria-label="Search courses"
            />
          </div>
          {form.provinceCode && (
            <ul className="mt-2 max-h-44 divide-y divide-ink-100 overflow-y-auto rounded-xl border border-ink-200">
              {courseResults.length === 0 ? (
                <li className="p-3 text-center text-xs text-ink-500">No courses match.</li>
              ) : (
                courseResults.map((course) => {
                  const chosen = form.currentCourses.includes(course.id);
                  return (
                    <li key={course.id}>
                      <button
                        type="button"
                        aria-pressed={chosen}
                        onClick={() => {
                          setCourseLabels((labels) => ({ ...labels, [course.id]: course }));
                          toggleIn("currentCourses", course.id);
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 px-3 py-2 text-left text-sm",
                          chosen ? "bg-brand-50" : "hover:bg-ink-50",
                        )}
                      >
                        <span className="flex-1">
                          <span className="font-semibold text-ink-900">{course.code ?? course.name}</span>
                          {course.code && <span className="text-ink-600"> — {course.name}</span>}
                          <span className="block text-xs text-ink-500">Grade {course.gradeLevel} · {course.subjectName}</span>
                        </span>
                        {chosen && <Check className="size-4 text-brand-600" aria-hidden="true" />}
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          )}
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-ink-800">Subjects</legend>
          {fieldErrors.subjectsOfInterest && (
            <p className="mt-1 text-xs font-medium text-danger-600">{fieldErrors.subjectsOfInterest}</p>
          )}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {provinceSubjects.map((subject) => {
              const chosen = form.subjectsOfInterest?.includes(subject.id);
              return (
                <button
                  key={subject.id}
                  type="button"
                  aria-pressed={chosen}
                  onClick={() => toggleIn("subjectsOfInterest", subject.id)}
                  className={cn(
                    "rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-inset transition-colors",
                    chosen ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-ink-700 ring-ink-200 hover:bg-ink-50",
                  )}
                >
                  {subject.name}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-ink-800">Lessons</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {Object.values(LEARNER_MODE_PREFERENCES).map((mode) => (
              <label
                key={mode}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm",
                  form.lessonModePreference === mode ? "border-brand-400 bg-brand-50" : "border-ink-200",
                )}
              >
                <input
                  type="radio"
                  name="lessonModePreference"
                  value={mode}
                  checked={form.lessonModePreference === mode}
                  onChange={set("lessonModePreference")}
                  className="size-4 border-ink-300 text-brand-600 focus:ring-brand-500"
                />
                {LEARNER_MODE_PREFERENCE_LABELS[mode]}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Current mark (%)" htmlFor="child-current-mark" hint="Optional" error={fieldErrors.currentMark}>
            <Input
              id="child-current-mark"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={form.currentMark ?? ""}
              onChange={set("currentMark")}
              error={fieldErrors.currentMark}
            />
          </Field>
          <Field label="Target mark (%)" htmlFor="child-target-mark" hint="Optional" error={fieldErrors.targetMark}>
            <Input
              id="child-target-mark"
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              value={form.targetMark ?? ""}
              onChange={set("targetMark")}
              error={fieldErrors.targetMark}
            />
          </Field>
        </div>

        <GoalsEditor
          goals={form.learningGoals ?? []}
          error={fieldErrors.learningGoals}
          onChange={(learningGoals) => setForm((f) => ({ ...f, learningGoals }))}
        />

        <Field
          label="Areas needing improvement"
          htmlFor="child-areas"
          hint="Optional. Shared with tutors you book, so they can prepare."
        >
          <Textarea
            id="child-areas"
            rows={2}
            value={form.areasForImprovement ?? ""}
            onChange={set("areasForImprovement")}
            maxLength={1000}
            placeholder="Multi-step word problems; showing work on tests."
          />
        </Field>

        <Field label="How they learn best" htmlFor="child-preferences" hint="Optional">
          <Textarea
            id="child-preferences"
            rows={2}
            value={form.learningPreferences ?? ""}
            onChange={set("learningPreferences")}
            maxLength={1000}
            placeholder="Visual examples first; short practice sets."
          />
        </Field>

        <Field label="Accessibility or learning needs" htmlFor="child-needs" hint="Optional. Only shared with tutors you book.">
          <Textarea
            id="child-needs"
            rows={2}
            value={form.accessibilityNeeds ?? ""}
            onChange={set("accessibilityNeeds")}
            maxLength={1000}
          />
        </Field>

        <Field label="Anything else for tutors" htmlFor="child-notes" hint="Optional">
          <Textarea id="child-notes" rows={2} value={form.notes ?? ""} onChange={set("notes")} maxLength={1500} />
        </Field>

        <div className="rounded-xl border border-ink-200 p-4">
          <Switch
            label="Share their full name with tutors"
            description="Off by default for anyone under 18. Tutors see a first name and last initial, which is enough to teach."
            checked={form.shareFullNameWithTutor ?? false}
            onChange={set("shareFullNameWithTutor")}
          />
        </div>
      </div>
    </Modal>
  );
}

/** General learning goals, each optionally dated and ticked off when met. */
function GoalsEditor({ goals, onChange, error }) {
  const update = (index, patch) => onChange(goals.map((goal, i) => (i === index ? { ...goal, ...patch } : goal)));

  return (
    <fieldset>
      <legend className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
        <Target className="size-4 text-brand-600" aria-hidden="true" />
        Learning goals
      </legend>
      {error && <p className="mt-1 text-xs font-medium text-danger-600">{error}</p>}
      <ul className="mt-2 space-y-2">
        {goals.map((goal, index) => (
          <li key={index} className="grid gap-2 rounded-xl border border-ink-200 p-2.5 sm:grid-cols-[1fr_10rem_auto_auto] sm:items-center">
            <Input
              value={goal.label}
              onChange={(e) => update(index, { label: e.target.value })}
              placeholder="Raise their math mark to 85% by the final"
              aria-label={`Goal ${index + 1}`}
              maxLength={160}
            />
            <Input
              type="date"
              value={goal.targetDate ?? ""}
              onChange={(e) => update(index, { targetDate: e.target.value })}
              aria-label={`Goal ${index + 1} target date`}
            />
            <label className="flex items-center gap-1.5 text-xs font-medium text-ink-600">
              <input
                type="checkbox"
                checked={goal.achieved}
                onChange={(e) => update(index, { achieved: e.target.checked })}
                className="size-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
              />
              Achieved
            </label>
            <button
              type="button"
              onClick={() => onChange(goals.filter((_, i) => i !== index))}
              aria-label={`Remove goal ${index + 1}`}
              className="justify-self-end rounded-lg p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600"
            >
              <X className="size-4" />
            </button>
          </li>
        ))}
      </ul>
      {goals.length < 10 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-2"
          onClick={() => onChange([...goals, { label: "", targetDate: "", achieved: false }])}
          iconLeft={<Plus className="size-3.5" />}
        >
          Add a goal
        </Button>
      )}
    </fieldset>
  );
}
