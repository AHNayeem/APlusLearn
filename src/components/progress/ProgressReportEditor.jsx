"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Send, Archive, Plus, X, History } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Select,
  Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import {
  PROGRESS_REPORT_STATUS, PROGRESS_RATINGS, PROGRESS_RATING_LABELS,
  PROGRESS_RATING_SCALE, GOAL_PROGRESS, GOAL_PROGRESS_LABELS,
} from "@/constants";
import { formatDate } from "@/lib/utils/format";

/**
 * Writing a progress report (§41 Phase 2).
 *
 * A draft saves freely. Once a report has been shared, every save is a
 * revision: the editor asks what changed and says plainly that the family has
 * already read the previous version — because the server keeps that version
 * whether or not the tutor remembers it exists.
 */
export function ProgressReportEditor({ report: initial }) {
  const router = useRouter();
  const toast = useToast();

  const [report, setReport] = useState(initial);
  const shared = report.status === PROGRESS_REPORT_STATUS.SUBMITTED;
  const archived = report.status === PROGRESS_REPORT_STATUS.ARCHIVED;

  const [form, setForm] = useState({
    summary: report.summary ?? "",
    strengths: report.strengths ?? "",
    focusAreas: report.focusAreas ?? "",
    homework: report.homework ?? "",
    privateNote: report.privateNote ?? "",
    revisionReason: "",
    ratings: { ...(report.ratings ?? {}) },
    goals: (report.goals ?? []).map((g) => ({ ...g })),
    milestones: (report.milestones ?? []).map((m) => ({ ...m })),
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const setRating = (key, value) =>
    setForm((f) => ({ ...f, ratings: { ...f.ratings, [key]: value ? Number(value) : undefined } }));

  const setGoal = (index, patch) =>
    setForm((f) => ({
      ...f,
      goals: f.goals.map((g, i) => (i === index ? { ...g, ...patch } : g)),
    }));

  const payload = () => ({
    summary: form.summary,
    strengths: form.strengths || undefined,
    focusAreas: form.focusAreas || undefined,
    homework: form.homework || undefined,
    privateNote: form.privateNote || undefined,
    revisionReason: shared ? form.revisionReason || undefined : undefined,
    ratings: Object.fromEntries(
      Object.entries(form.ratings).filter(([, v]) => Number.isFinite(v)),
    ),
    goals: form.goals.map((g) => ({
      goalId: g.goalId,
      label: g.label,
      status: g.status,
      note: g.note || undefined,
    })),
    milestones: form.milestones.map((m) => ({ label: m.label, achievedAt: m.achievedAt })),
  });

  const save = useSubmit(async () => {
    const { report: updated } = await api.patch(`/api/tutor/progress/${report.id}`, payload());
    setReport(updated);
    set("revisionReason", "");
    toast.success(shared ? "Revision saved" : "Draft saved");
    router.refresh();
  });

  const share = useSubmit(async () => {
    await api.patch(`/api/tutor/progress/${report.id}`, payload());
    const { report: submitted } = await api.post(`/api/tutor/progress/${report.id}`);
    setReport(submitted);
    toast.success("Report shared", "The family has been notified.");
    router.refresh();
  });

  const archive = useSubmit(async () => {
    const { report: archivedReport } = await api.delete(`/api/tutor/progress/${report.id}`);
    setReport(archivedReport);
    toast.success("Report archived", "The family keeps their copy.");
    router.refresh();
  });

  return (
    <div className="space-y-6">
      <FormErrorSummary error={save.error ?? share.error} fieldErrors={save.fieldErrors} />

      {archived && (
        <Alert tone="neutral" title="This report is archived">
          It stays readable to the family and to our team, but it can no longer be edited.
        </Alert>
      )}

      {shared && (
        <Alert tone="warning" title="This report has already been shared">
          The family has read this version. Saving keeps what they were shown in the report&rsquo;s
          history and adds your changes on top.
        </Alert>
      )}

      <Card>
        <CardHeader
          title="This period"
          description={`${report.lessonCount} lesson${report.lessonCount === 1 ? "" : "s"}${
            report.periodStart
              ? ` · ${formatDate(report.periodStart)} to ${formatDate(report.periodEnd)}`
              : ""
          }`}
        />
        <CardBody className="space-y-5">
          <Field
            label="How did it go?"
            htmlFor="report-summary"
            hint="The family reads this first. Be specific about what changed."
            error={save.fieldErrors.summary}
            required
          >
            <Textarea
              id="report-summary"
              rows={5}
              maxLength={3000}
              value={form.summary}
              onChange={(e) => set("summary", e.target.value)}
              error={save.fieldErrors.summary}
              disabled={archived}
              placeholder="Covered logarithmic functions and started on rational graphs. Aisha now solves change-of-base questions unprompted, which was the main gap in October."
            />
          </Field>

          <div className="grid gap-5 sm:grid-cols-2">
            <Field label="Strengths" htmlFor="report-strengths">
              <Textarea
                id="report-strengths"
                rows={3}
                maxLength={2000}
                value={form.strengths}
                onChange={(e) => set("strengths", e.target.value)}
                disabled={archived}
              />
            </Field>
            <Field label="What to work on" htmlFor="report-focus">
              <Textarea
                id="report-focus"
                rows={3}
                maxLength={2000}
                value={form.focusAreas}
                onChange={(e) => set("focusAreas", e.target.value)}
                disabled={archived}
              />
            </Field>
          </div>

          <Field
            label="Practice before the next lesson"
            htmlFor="report-homework"
            hint="Optional."
          >
            <Textarea
              id="report-homework"
              rows={2}
              maxLength={2000}
              value={form.homework}
              onChange={(e) => set("homework", e.target.value)}
              disabled={archived}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="How they're doing" description="Optional, but families find it useful." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          {Object.values(PROGRESS_RATINGS).map((key) => (
            <Field key={key} label={PROGRESS_RATING_LABELS[key]} htmlFor={`rating-${key}`}>
              <Select
                id={`rating-${key}`}
                value={form.ratings[key] ?? ""}
                onChange={(e) => setRating(key, e.target.value)}
                disabled={archived}
              >
                <option value="">Not rated</option>
                {PROGRESS_RATING_SCALE.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.value} — {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          ))}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Learning goals"
          description="The goals the family set. Marking one achieved adds it to the learner's record."
        />
        <CardBody className="space-y-4">
          {form.goals.length === 0 && (
            <p className="text-sm text-ink-500">
              This learner has no goals recorded yet. You can add one below.
            </p>
          )}

          {form.goals.map((goal, index) => (
            <div key={goal.goalId ?? `${goal.label}-${index}`} className="rounded-xl border border-ink-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Field label="Goal" htmlFor={`goal-${index}`}>
                    <Input
                      id={`goal-${index}`}
                      value={goal.label}
                      onChange={(e) => setGoal(index, { label: e.target.value })}
                      maxLength={200}
                      disabled={archived || Boolean(goal.goalId)}
                    />
                  </Field>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={archived}
                  onClick={() =>
                    setForm((f) => ({ ...f, goals: f.goals.filter((_, i) => i !== index) }))
                  }
                  iconLeft={<X className="size-3.5" />}
                >
                  Remove
                </Button>
              </div>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <Field label="Where it stands" htmlFor={`goal-status-${index}`}>
                  <Select
                    id={`goal-status-${index}`}
                    value={goal.status}
                    onChange={(e) => setGoal(index, { status: e.target.value })}
                    disabled={archived}
                  >
                    {Object.values(GOAL_PROGRESS).map((value) => (
                      <option key={value} value={value}>
                        {GOAL_PROGRESS_LABELS[value]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Note" htmlFor={`goal-note-${index}`} hint="Optional.">
                  <Input
                    id={`goal-note-${index}`}
                    value={goal.note ?? ""}
                    onChange={(e) => setGoal(index, { note: e.target.value })}
                    maxLength={500}
                    disabled={archived}
                  />
                </Field>
              </div>
            </div>
          ))}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={archived || form.goals.length >= 20}
            onClick={() =>
              setForm((f) => ({
                ...f,
                goals: [...f.goals, { label: "", status: GOAL_PROGRESS.IN_PROGRESS }],
              }))
            }
            iconLeft={<Plus className="size-3.5" />}
          >
            Add a goal
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Your private notes"
          description="Only you ever see this. It is never shown to the family."
        />
        <CardBody>
          <Field label="Private note" htmlFor="report-private" hint="Optional.">
            <Textarea
              id="report-private"
              rows={3}
              maxLength={2000}
              value={form.privateNote}
              onChange={(e) => set("privateNote", e.target.value)}
              disabled={archived}
            />
          </Field>
        </CardBody>
      </Card>

      {shared && (
        <Card>
          <CardHeader title="Recording a change" />
          <CardBody>
            <Field
              label="What changed?"
              htmlFor="report-revision"
              hint="Kept with the previous version so the family can see what moved."
            >
              <Input
                id="report-revision"
                value={form.revisionReason}
                onChange={(e) => set("revisionReason", e.target.value)}
                maxLength={300}
                disabled={archived}
                placeholder="Corrected the unit test date."
              />
            </Field>
          </CardBody>
        </Card>
      )}

      {report.revisions?.length > 0 && (
        <Card>
          <CardHeader
            title="Revision history"
            description="What this report said before each change."
          />
          <CardBody className="space-y-3">
            {report.revisions.map((revision) => (
              <div key={revision.id ?? revision.at} className="rounded-lg bg-ink-50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                  <History className="size-3" />
                  {formatDate(revision.at, { weekday: "short" })}
                  {revision.reason ? ` · ${revision.reason}` : ""}
                </p>
                <p className="mt-1 line-clamp-3 text-xs text-ink-600">
                  {revision.snapshot?.summary}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {!archived && (
        <div className="flex flex-wrap gap-3">
          <Button
            variant={shared ? "primary" : "secondary"}
            loading={save.pending}
            onClick={save.submit}
            iconLeft={<Save className="size-4" />}
          >
            {shared ? "Save revision" : "Save draft"}
          </Button>

          {!shared && (
            <Button
              loading={share.pending}
              onClick={share.submit}
              disabled={form.summary.trim().length < 20}
              iconLeft={<Send className="size-4" />}
            >
              Share with the family
            </Button>
          )}

          <Button
            variant="ghost"
            loading={archive.pending}
            onClick={archive.submit}
            iconLeft={<Archive className="size-4" />}
          >
            Archive
          </Button>

          {shared && report.acknowledgedAt && (
            <Badge tone="success" className="self-center">
              Read by the family
            </Badge>
          )}
        </div>
      )}
    </div>
  );
}
