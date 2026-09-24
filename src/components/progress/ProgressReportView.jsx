"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, History, Target, Trophy } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Avatar, Badge, Button, Card, CardBody, CardHeader, useToast,
} from "@/components/ui";
import {
  PROGRESS_RATINGS, PROGRESS_RATING_LABELS, PROGRESS_RATING_SCALE,
  GOAL_PROGRESS, GOAL_PROGRESS_LABELS,
} from "@/constants";
import { formatDate } from "@/lib/utils/format";
import { AttachmentList } from "@/components/attachments/Attachments";

/**
 * A family reading a progress report (§41 Phase 2).
 *
 * Read-only by construction: there is no control here that changes anything
 * the tutor wrote, and no endpoint behind one if there were. The single
 * action is acknowledging that it has been read.
 */
export function ProgressReportView({ report, canAcknowledge }) {
  const router = useRouter();
  const toast = useToast();
  const [acknowledgedAt, setAcknowledgedAt] = useState(report.acknowledgedAt);

  const acknowledge = useSubmit(async () => {
    const { report: updated } = await api.post(`/api/progress/${report.id}`);
    setAcknowledgedAt(updated.acknowledgedAt);
    toast.success("Marked as read", "Your tutor has been told.");
    router.refresh();
  });

  const tutor = report.tutorProfileId;
  const ratings = Object.values(PROGRESS_RATINGS).filter((key) => report.ratings?.[key]);

  return (
    <div className="space-y-6">
      <Card>
        <CardBody>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <Avatar src={tutor?.avatarUrl} name={tutor?.displayName ?? "Tutor"} size="lg" />
              <div>
                <p className="text-sm font-bold text-ink-900">{tutor?.displayName}</p>
                <p className="text-xs text-ink-500">
                  {report.lessonCount} lesson{report.lessonCount === 1 ? "" : "s"}
                  {report.periodStart
                    ? ` · ${formatDate(report.periodStart)} to ${formatDate(report.periodEnd)}`
                    : ""}
                </p>
              </div>
            </div>

            {acknowledgedAt ? (
              <Badge tone="success" icon={<CheckCircle2 className="size-3" />}>
                Read {formatDate(acknowledgedAt)}
              </Badge>
            ) : (
              canAcknowledge && (
                <Button
                  size="sm"
                  loading={acknowledge.pending}
                  onClick={acknowledge.submit}
                  iconLeft={<CheckCircle2 className="size-4" />}
                >
                  Mark as read
                </Button>
              )
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="How it went" />
        <CardBody className="space-y-5">
          <p className="whitespace-pre-line text-sm leading-relaxed text-ink-700">
            {report.summary}
          </p>

          {(report.strengths || report.focusAreas) && (
            <div className="grid gap-5 border-t border-ink-100 pt-5 sm:grid-cols-2">
              {report.strengths && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                    Strengths
                  </h3>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-600">
                    {report.strengths}
                  </p>
                </div>
              )}
              {report.focusAreas && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                    What to work on
                  </h3>
                  <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-600">
                    {report.focusAreas}
                  </p>
                </div>
              )}
            </div>
          )}

          {(report.homework || report.homeworkAttachments?.length > 0) && (
            <div className="border-t border-ink-100 pt-5">
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                Practice before the next lesson
              </h3>
              {report.homework && (
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-ink-600">
                  {report.homework}
                </p>
              )}
              {/* The worksheet itself. Each link goes to a route that checks
                  this reader against the report before it sends a byte. */}
              <AttachmentList attachments={report.homeworkAttachments} />
            </div>
          )}
        </CardBody>
      </Card>

      {ratings.length > 0 && (
        <Card>
          <CardHeader title="How they're doing" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            {ratings.map((key) => {
              const value = report.ratings[key];
              const scale = PROGRESS_RATING_SCALE.find((s) => s.value === value);
              return (
                <div key={key}>
                  <p className="text-xs font-semibold text-ink-500">
                    {PROGRESS_RATING_LABELS[key]}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="flex gap-0.5" aria-hidden="true">
                      {[1, 2, 3, 4, 5].map((step) => (
                        <span
                          key={step}
                          className={`h-1.5 w-6 rounded-full ${
                            step <= value ? "bg-brand-600" : "bg-ink-200"
                          }`}
                        />
                      ))}
                    </div>
                    <span className="text-xs font-medium text-ink-700">{scale?.label}</span>
                  </div>
                </div>
              );
            })}
          </CardBody>
        </Card>
      )}

      {report.goals?.length > 0 && (
        <Card>
          <CardHeader title="Learning goals" />
          <CardBody className="space-y-3">
            {report.goals.map((goal, index) => (
              <div
                key={goal.goalId ?? `${goal.label}-${index}`}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-ink-100 p-3"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-ink-800">
                    <Target className="size-3.5 text-ink-400" />
                    {goal.label}
                  </p>
                  {goal.note && <p className="mt-1 text-xs text-ink-600">{goal.note}</p>}
                </div>
                <Badge
                  tone={goal.status === GOAL_PROGRESS.ACHIEVED ? "success" : "neutral"}
                  size="sm"
                >
                  {GOAL_PROGRESS_LABELS[goal.status]}
                </Badge>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {report.milestones?.length > 0 && (
        <Card>
          <CardHeader title="Milestones" />
          <CardBody className="space-y-2">
            {report.milestones.map((milestone) => (
              <p
                key={milestone.id ?? milestone.label}
                className="flex items-center gap-2 text-sm text-ink-700"
              >
                <Trophy className="size-3.5 text-accent-500" />
                {milestone.label}
                <span className="text-xs text-ink-400">{formatDate(milestone.achievedAt)}</span>
              </p>
            ))}
          </CardBody>
        </Card>
      )}

      {report.revisions?.length > 0 && (
        <Card>
          <CardHeader
            title="What changed"
            description="This report has been revised since it was first shared. Here is what it said before."
          />
          <CardBody className="space-y-3">
            {report.revisions.map((revision) => (
              <div key={revision.id ?? revision.at} className="rounded-lg bg-ink-50 p-3">
                <p className="flex items-center gap-1.5 text-xs font-semibold text-ink-700">
                  <History className="size-3" />
                  Before {formatDate(revision.at, { weekday: "short" })}
                  {revision.reason ? ` · ${revision.reason}` : ""}
                </p>
                <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-ink-600">
                  {revision.snapshot?.summary}
                </p>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      {!acknowledgedAt && canAcknowledge && (
        <Alert tone="info" title="Let your tutor know you've seen this">
          Marking it as read tells your tutor the report landed. It does not change anything they
          wrote.
        </Alert>
      )}
    </div>
  );
}
