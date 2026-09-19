import Link from "next/link";
import * as Icons from "lucide-react";
import { ArrowRight, BookOpen, GraduationCap, Sparkles, Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Badge, Card } from "@/components/ui";
import { truncate } from "@/lib/utils/format";

/**
 * Course result card (§13).
 *
 * Two layouts, one visual language — the same pairing the tutor card uses, so
 * /courses and /find-a-tutor read as one search product:
 *   `wide`    — the full-width row on /courses, where the code plate, the
 *               curriculum trail and the supply line all fit on one line.
 *   `compact` — the same card folded into a column for the grids on the
 *               homepage and subject pages.
 *
 * The card links to the tutor search for that exact course rather than to a
 * course page, because finding a tutor is the only thing a visitor came here
 * to do.
 */
export function CourseCard({ course, layout = "wide", className }) {
  return layout === "wide" ? (
    <WideCard course={course} className={className} />
  ) : (
    <CompactCard course={course} className={className} />
  );
}

function WideCard({ course, className }) {
  const href = tutorSearchHref(course);
  const Icon = Icons[course.subjectIcon] ?? BookOpen;

  return (
    <Card interactive className={cn("group relative p-4 sm:p-5", className)}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <CodePlate course={course} />

        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h3 className="text-base font-extrabold tracking-tight text-ink-900 sm:text-lg">
                <Link href={href} className="hover:text-brand-700">
                  {/* Stretches the hover/click target over the whole card
                      without nesting the supply link inside another anchor. */}
                  <span className="absolute inset-0" aria-hidden="true" />
                  {course.name}
                </Link>
              </h3>
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-600">
                <span className="inline-flex items-center gap-1.5 font-medium">
                  <Icon className="size-3.5 shrink-0 text-ink-400" />
                  {course.subjectName}
                </span>
                <span className="text-ink-300">·</span>
                <span className="inline-flex items-center gap-1.5">
                  <GraduationCap className="size-3.5 shrink-0 text-ink-400" />
                  {gradeLabel(course)}
                </span>
                <span className="text-ink-300">·</span>
                <span>{course.provinceCode}</span>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {course.isPopular && (
                <Badge tone="accent" size="sm" icon={<Sparkles className="size-3" />}>
                  Popular
                </Badge>
              )}
              {course.stream && (
                <Badge tone="neutral" size="sm">
                  {course.stream}
                </Badge>
              )}
              {course.credits ? (
                <Badge tone="neutral" size="sm">
                  {course.credits} credit{course.credits === 1 ? "" : "s"}
                </Badge>
              ) : null}
            </div>
          </div>

          {course.description && (
            <p className="line-clamp-2 text-[13px] leading-relaxed text-ink-600">
              {truncate(course.description, 210)}
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-ink-100 pt-3">
            <TutorSupply course={course} />
            <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-brand-600 transition-transform group-hover:translate-x-0.5 motion-reduce:group-hover:translate-x-0">
              {course.tutorCount > 0 ? "See tutors" : "Request a tutor"}
              <ArrowRight className="size-4" />
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function CompactCard({ course, className }) {
  const href = tutorSearchHref(course);

  return (
    <Card interactive className={cn("group relative flex h-full flex-col p-5", className)}>
      <div className="flex items-start gap-3">
        <CodePlate course={course} size="sm" />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-ink-900 group-hover:text-brand-700">
            <Link href={href}>
              <span className="absolute inset-0" aria-hidden="true" />
              {course.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-ink-500">
            {gradeLabel(course)} · {course.subjectName}
            {course.stream ? ` · ${course.stream}` : ""}
          </p>
        </div>
      </div>

      {course.description && (
        <p className="mt-3 line-clamp-3 text-xs leading-relaxed text-ink-500">
          {course.description}
        </p>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 pt-4">
        <TutorSupply course={course} />
        <span className="text-xs font-semibold text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">
          Find tutors →
        </span>
      </div>
    </Card>
  );
}

/**
 * The code plate is tinted by the code's opening letter, because in Ontario's
 * system that letter *is* the discipline — M mathematics, E English, S
 * science, F French, B business. Courses without a code fall back to the
 * subject icon rather than inventing a code.
 */
function CodePlate({ course, size = "md" }) {
  const Icon = Icons[course.subjectIcon] ?? BookOpen;
  const dimensions = size === "sm" ? "size-11 rounded-xl" : "size-14 rounded-2xl sm:size-16";

  return (
    <span
      className={cn(
        "flex shrink-0 flex-col items-center justify-center gap-0.5 font-black tracking-tight",
        dimensions,
        codeTone(course.code),
      )}
      aria-hidden="true"
    >
      {course.code ? (
        <span className={size === "sm" ? "text-[10px]" : "text-[11px] sm:text-xs"}>
          {course.code}
        </span>
      ) : (
        <Icon className={size === "sm" ? "size-5" : "size-6"} />
      )}
    </span>
  );
}

function TutorSupply({ course }) {
  if (!course.tutorCount) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-400">
        <Users className="size-3.5" />
        No tutors yet
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-700">
      <span className="size-1.5 rounded-full bg-success-500" />
      {course.tutorCount} {course.tutorCount === 1 ? "tutor" : "tutors"} available
    </span>
  );
}

function tutorSearchHref(course) {
  return course.code
    ? `/find-a-tutor?courseCode=${course.code}&province=${course.provinceCode}`
    : `/find-a-tutor?course=${course.slug}&grade=${course.gradeSlug}&province=${course.provinceCode}`;
}

function gradeLabel(course) {
  return course.gradeLevel === 0 ? "Kindergarten" : `Grade ${course.gradeLevel}`;
}

function codeTone(code) {
  return (
    {
      M: "bg-brand-100 text-brand-700",
      E: "bg-accent-100 text-accent-700",
      S: "bg-success-100 text-success-700",
      F: "bg-info-100 text-info-600",
      B: "bg-warning-100 text-warning-700",
      C: "bg-info-100 text-info-600",
      I: "bg-ink-200 text-ink-700",
    }[code?.[0]] ?? "bg-ink-100 text-ink-600"
  );
}
