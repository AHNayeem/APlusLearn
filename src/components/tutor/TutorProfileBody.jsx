import { GraduationCap, Briefcase, BookOpen, ShieldCheck } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Rating, RatingBar, EmptyState } from "@/components/ui";
import { TutorGallery } from "./TutorGallery";
import { formatRate, formatDate } from "@/lib/utils/format";
import { VERIFICATION_LABELS, VERIFICATION_DESCRIPTIONS } from "@/constants";

/**
 * The photos from the search card, at profile size. Same component, so what a
 * parent clicked on is exactly what they land on.
 */
export function GallerySection({ tutor }) {
  if (!tutor.gallery?.length) return null;

  return (
    <Card id="photos">
      <CardHeader title={`Where ${tutor.firstName} teaches`} />
      <CardBody>
        <TutorGallery
          images={tutor.gallery}
          name={tutor.displayName}
          monogram={tutor.firstName?.charAt(0)}
          aspect="aspect-[16/9]"
          sizes="(min-width: 1024px) 42rem, 100vw"
        />
      </CardBody>
    </Card>
  );
}

/** About / bio (§15). */
export function AboutSection({ tutor }) {
  return (
    <Card id="about">
      <CardHeader title={`About ${tutor.firstName}`} />
      <CardBody>
        <div className="space-y-4 text-sm leading-relaxed text-ink-600">
          {tutor.bio?.split("\n\n").map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

/** Courses taught, with per-course rates where they differ (§15). */
export function CoursesSection({ tutor }) {
  if (!tutor.courses?.length) return null;

  const byGrade = tutor.courses.reduce((acc, course) => {
    const key = course.gradeLevel ?? 0;
    acc[key] = [...(acc[key] ?? []), course];
    return acc;
  }, {});

  return (
    <Card id="courses">
      <CardHeader
        title="Courses taught"
        description={`${tutor.courses.length} ${tutor.courses.length === 1 ? "course" : "courses"} across the Ontario curriculum`}
      />
      <CardBody className="space-y-6">
        {Object.entries(byGrade)
          .sort(([a], [b]) => Number(b) - Number(a))
          .map(([grade, courses]) => (
            <div key={grade}>
              <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                Grade {grade}
              </h3>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {courses.map((course) => (
                  <li
                    key={course.courseId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 px-3.5 py-3"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-[10px] font-black text-brand-700">
                        {course.code ?? <BookOpen className="size-4" />}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-ink-900">
                          {course.name}
                        </span>
                        {course.yearsTeaching > 0 && (
                          <span className="block text-xs text-ink-500">
                            {course.yearsTeaching} {course.yearsTeaching === 1 ? "year" : "years"} teaching this
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-bold text-ink-800">
                      {formatRate(course.hourlyRateCents)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </CardBody>
    </Card>
  );
}

/** Education and experience (§15). */
export function CredentialsSection({ tutor }) {
  const hasEducation = tutor.education?.length > 0;
  const hasExperience = tutor.experience?.length > 0;
  if (!hasEducation && !hasExperience) return null;

  return (
    <Card id="credentials">
      <CardHeader title="Education & experience" />
      <CardBody className="space-y-8">
        {hasEducation && (
          <div>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-400">
              <GraduationCap className="size-3.5" />
              Education
            </h3>
            <ul className="mt-4 space-y-4">
              {tutor.education.map((entry, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-500" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">
                      {entry.credential}
                      {entry.fieldOfStudy && (
                        <span className="font-normal text-ink-600"> · {entry.fieldOfStudy}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {entry.institution}
                      {(entry.startYear || entry.endYear) && (
                        <>
                          {" · "}
                          {entry.startYear}
                          {entry.inProgress ? " – present" : entry.endYear ? `–${entry.endYear}` : ""}
                        </>
                      )}
                    </p>
                    {entry.verified && (
                      <Badge tone="success" size="sm" className="mt-1.5">
                        Verified
                      </Badge>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {hasExperience && (
          <div>
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-400">
              <Briefcase className="size-3.5" />
              Experience
            </h3>
            <ul className="mt-4 space-y-5">
              {tutor.experience.map((entry, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full bg-accent-500" />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{entry.title}</p>
                    <p className="mt-0.5 text-sm text-ink-500">
                      {entry.organisation}
                      {(entry.startYear || entry.endYear) && (
                        <>
                          {" · "}
                          {entry.startYear}
                          {entry.current ? " – present" : entry.endYear ? `–${entry.endYear}` : ""}
                        </>
                      )}
                    </p>
                    {entry.description && (
                      <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
                        {entry.description}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

/** What each badge on this profile actually means (§16). */
export function TrustSection({ tutor }) {
  if (!tutor.verifiedTypes?.length) return null;

  return (
    <Card id="verification">
      <CardHeader
        title="What we verified"
        description="Each badge means our team reviewed a specific document."
      />
      <CardBody>
        <ul className="space-y-4">
          {tutor.verifiedTypes.map((type) => (
            <li key={type} className="flex gap-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-success-50 text-success-700">
                <ShieldCheck className="size-4" />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink-900">{VERIFICATION_LABELS[type]}</p>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-500">
                  {VERIFICATION_DESCRIPTIONS[type]}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

/** Reviews with the sub-score breakdown (§23). */
export function ReviewsSection({ tutor, reviews, breakdown }) {
  return (
    <Card id="reviews">
      <CardHeader
        title="Reviews"
        description={
          tutor.stats.ratingCount
            ? `${tutor.stats.ratingCount} verified ${tutor.stats.ratingCount === 1 ? "review" : "reviews"} from families who completed a lesson`
            : "No reviews yet"
        }
      />

      {tutor.stats.ratingCount > 0 && (
        <CardBody className="border-b border-ink-100">
          <div className="grid gap-8 sm:grid-cols-[auto_1fr]">
            <div className="text-center sm:text-left">
              <p className="text-5xl font-extrabold tracking-tight text-ink-900">
                {tutor.stats.ratingAverage.toFixed(1)}
              </p>
              <Rating
                value={tutor.stats.ratingAverage}
                showValue={false}
                size="lg"
                className="mt-2 justify-center sm:justify-start"
              />
              <p className="mt-1 text-xs text-ink-500">
                {tutor.stats.ratingCount} {tutor.stats.ratingCount === 1 ? "review" : "reviews"}
              </p>
            </div>

            <div className="space-y-2.5">
              <RatingBar label="Subject knowledge" value={tutor.stats.ratingKnowledge} />
              <RatingBar label="Communication" value={tutor.stats.ratingCommunication} />
              <RatingBar label="Reliability" value={tutor.stats.ratingReliability} />
              <RatingBar label="Teaching ability" value={tutor.stats.ratingTeaching} />
            </div>
          </div>

          {breakdown?.total > 0 && (
            <div className="mt-6 space-y-1.5 border-t border-ink-100 pt-5">
              {[5, 4, 3, 2, 1].map((star) => (
                <div key={star} className="flex items-center gap-3 text-xs">
                  <span className="w-10 shrink-0 text-ink-500">{star} star</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
                    <span
                      className="block h-full rounded-full bg-accent-400"
                      style={{ width: `${breakdown.percentages[star]}%` }}
                    />
                  </span>
                  <span className="w-8 shrink-0 text-right tabular-nums text-ink-500">
                    {breakdown.counts[star]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      )}

      <CardBody>
        {reviews.length === 0 ? (
          <EmptyState
            compact
            title="No reviews yet"
            description={`${tutor.firstName} hasn't been reviewed yet. Reviews can only be left by families who completed a lesson.`}
          />
        ) : (
          <ul className="divide-y divide-ink-100">
            {reviews.map((review) => (
              <li key={review.id} className="py-5 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <Rating value={review.rating} showValue={false} size="sm" />
                  <span className="text-sm font-semibold text-ink-900">{review.authorName}</span>
                  <span className="text-xs text-ink-400">
                    {formatDate(review.createdAt, { month: "long" })}
                  </span>
                  {review.courseCode && (
                    <Badge tone="neutral" size="sm">
                      {review.courseCode}
                    </Badge>
                  )}
                  <Badge tone="success" size="sm" className="ml-auto">
                    Verified lesson
                  </Badge>
                </div>

                {review.title && (
                  <p className="mt-3 text-sm font-bold text-ink-900">{review.title}</p>
                )}
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{review.body}</p>

                {review.tutorReply && (
                  <div className="mt-4 rounded-xl border-l-2 border-brand-300 bg-brand-50/50 p-4">
                    <p className="text-xs font-bold text-brand-800">
                      Reply from {tutor.firstName}
                    </p>
                    <p className="mt-1 text-sm leading-relaxed text-ink-600">{review.tutorReply}</p>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
