import Link from "next/link";
import {
  MapPin, Video, Clock, MessageSquare, CalendarDays, Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar, Badge, Button, Card, Rating } from "@/components/ui";
import { formatRate, formatDistance, formatRelative, truncate } from "@/lib/utils/format";
import { LESSON_MODES } from "@/constants";
import { VerificationBadges } from "./VerificationBadges";
import { FavouriteButton } from "./FavouriteButton";

/**
 * Search result card (§14).
 *
 * Shows exactly what the requirement lists: photo, first name + last initial,
 * rating, review count, badges, courses, experience, approximate distance,
 * lesson type, hourly rate and next availability. Nothing that could identify
 * a home address.
 */
export function TutorCard({ tutor, courseCode, showSave = true, className }) {
  const offersOnline = tutor.lessonModes?.includes(LESSON_MODES.ONLINE);
  const offersInPerson = tutor.lessonModes?.includes(LESSON_MODES.IN_PERSON);
  const rate = tutor.displayRateCents ?? tutor.hourlyRateCents;

  // If the search was for a specific course, lead with that one.
  const courses = courseCode
    ? [...tutor.courses].sort((a) => (a.code === courseCode ? -1 : 1))
    : tutor.courses ?? [];

  return (
    <Card interactive className={cn("flex h-full flex-col", className)}>
      <div className="flex items-start gap-4 p-5 pb-4">
        <Link href={`/tutors/${tutor.slug}`} className="shrink-0 rounded-full">
          <Avatar src={tutor.avatarUrl} name={tutor.displayName} size="lg" />
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-base font-bold text-ink-900">
                <Link href={`/tutors/${tutor.slug}`} className="hover:text-brand-700">
                  {tutor.displayName}
                </Link>
              </h3>
              <p className="mt-0.5 line-clamp-1 text-sm text-ink-500">{tutor.headline}</p>
            </div>
            {showSave && <FavouriteButton tutorProfileId={tutor.id} initial={tutor.isFavourite} />}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <Rating value={tutor.stats.ratingAverage} count={tutor.stats.ratingCount} size="sm" />
            {tutor.stats.completedLessons > 0 && (
              <span className="text-xs text-ink-500">
                {tutor.stats.completedLessons} lessons taught
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="px-5">
        <VerificationBadges types={tutor.verifiedTypes} max={3} compact />
      </div>

      {courses.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5 px-5">
          {courses.slice(0, 4).map((course) => (
            <span
              key={course.courseId}
              className={cn(
                "rounded-md px-2 py-1 text-[11px] font-semibold",
                course.code === courseCode
                  ? "bg-brand-600 text-white"
                  : "bg-ink-100 text-ink-600",
              )}
            >
              {course.code ?? course.name}
            </span>
          ))}
          {courses.length > 4 && (
            <span className="rounded-md bg-ink-100 px-2 py-1 text-[11px] font-semibold text-ink-500">
              +{courses.length - 4} more
            </span>
          )}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 px-5 text-xs">
        <Meta
          icon={offersOnline && offersInPerson ? <Video className="size-3.5" /> : offersOnline ? <Video className="size-3.5" /> : <MapPin className="size-3.5" />}
          label="Lesson type"
          value={
            offersOnline && offersInPerson
              ? "Online & in person"
              : offersOnline
                ? "Online only"
                : "In person"
          }
        />
        <Meta
          icon={<MapPin className="size-3.5" />}
          label="Location"
          value={
            tutor.distanceKm != null
              ? `${formatDistance(tutor.distanceKm)} away`
              : `${tutor.city}, ${tutor.province}`
          }
        />
        <Meta
          icon={<Sparkles className="size-3.5" />}
          label="Experience"
          value={`${tutor.yearsExperience} ${tutor.yearsExperience === 1 ? "year" : "years"}`}
        />
        <Meta
          icon={<Clock className="size-3.5" />}
          label="Next available"
          value={tutor.nextAvailableAt ? formatRelative(tutor.nextAvailableAt) : "Check calendar"}
        />
      </dl>

      {tutor.bio && (
        <p className="mt-4 line-clamp-2 px-5 text-sm leading-relaxed text-ink-500">
          {truncate(tutor.bio, 150)}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-ink-100 p-5 pt-4">
        <div>
          <p className="text-lg font-extrabold text-ink-900">{formatRate(rate)}</p>
          {tutor.offersFreeIntro && (
            <Badge tone="accent" size="sm" className="mt-1">
              Free intro session
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            href={`/tutors/${tutor.slug}#message`}
            variant="secondary"
            size="sm"
            iconLeft={<MessageSquare className="size-3.5" />}
          >
            Message
          </Button>
          <Button
            href={`/tutors/${tutor.slug}#availability`}
            size="sm"
            iconLeft={<CalendarDays className="size-3.5" />}
          >
            Book
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Meta({ icon, label, value }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="shrink-0 text-ink-400">{icon}</span>
      <span className="min-w-0">
        <dt className="sr-only">{label}</dt>
        <dd className="truncate font-medium text-ink-600">{value}</dd>
      </span>
    </div>
  );
}

/** Condensed variant for sidebars and "my tutors" lists. */
export function TutorCardCompact({ tutor, action, className }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-xl border border-ink-200 bg-white p-3",
        className,
      )}
    >
      <Avatar src={tutor.avatarUrl} name={tutor.displayName} size="md" />
      <div className="min-w-0 flex-1">
        <Link
          href={`/tutors/${tutor.slug}`}
          className="block truncate text-sm font-bold text-ink-900 hover:text-brand-700"
        >
          {tutor.displayName}
        </Link>
        <div className="mt-0.5 flex items-center gap-2">
          <Rating value={tutor.stats?.ratingAverage ?? 0} size="sm" showValue={false} />
          <span className="text-xs text-ink-500">{formatRate(tutor.hourlyRateCents)}</span>
        </div>
      </div>
      {action}
    </div>
  );
}
