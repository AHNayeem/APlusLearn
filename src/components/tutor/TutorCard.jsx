import Link from "next/link";
import {
  MapPin, Video, Home, Navigation, BadgeCheck, Sparkles, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar, Button, Card, Rating, Tooltip } from "@/components/ui";
import { formatMoney, formatRate, formatDistance, formatRelative, truncate } from "@/lib/utils/format";
import { LESSON_MODES, IN_PERSON_LOCATIONS } from "@/constants";
import { VerificationBadges } from "./VerificationBadges";
import { FavouriteButton } from "./FavouriteButton";
import { TutorGallery } from "./TutorGallery";

/**
 * Search result card (§14).
 *
 * Shows exactly what the requirement lists: photos, first name + last initial,
 * rating, review count, badges, courses, experience, approximate distance,
 * lesson type, hourly rate and availability. Nothing that could identify a
 * home address.
 *
 * Two layouts, one visual language:
 *   `wide`    — the full-width row used on /find-a-tutor, where there is room
 *               for the gallery, the weekly availability strip and every
 *               service option side by side.
 *   `compact` — the same card folded into a column for the three-up rails on
 *               the homepage, course pages and dashboard lists.
 */
export function TutorCard({
  tutor,
  courseCode,
  layout = "compact",
  showSave = true,
  ribbon,
  /** Optional nodes pinned over the cover — e.g. "3 upcoming" on My tutors. */
  overlay,
  className,
}) {
  return layout === "wide" ? (
    <WideCard {...{ tutor, courseCode, showSave, ribbon, className }} />
  ) : (
    <CompactCard {...{ tutor, courseCode, showSave, ribbon, overlay, className }} />
  );
}

function WideCard({ tutor, courseCode, showSave, ribbon, className }) {
  const href = `/tutors/${tutor.slug}`;
  const courses = orderCourses(tutor, courseCode);

  return (
    <Card interactive className={cn("p-3.5 sm:p-4", className)}>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)] lg:gap-6">
        <div className="flex flex-col gap-2.5">
          <TutorGallery
            images={tutor.gallery}
            name={tutor.displayName}
            href={href}
            ribbon={ribbon ?? highlightRibbon(tutor)}
            monogram={monogram(tutor)}
            // A 4:3 cover and square thumbs are right in a 17rem column but
            // enormous once the card stacks to full width, so both flatten.
            aspect="aspect-[2/1] lg:aspect-[4/3]"
            thumbAspect="aspect-[3/2] lg:aspect-square"
            sizes="(min-width: 1024px) 17rem, 100vw"
          />
          {/* Pinned to the bottom so the photo column ends level with the text
              column instead of leaving a ragged gap under the button. */}
          <Button href={href} variant="plum" fullWidth className="mt-auto">
            View Profile
          </Button>
        </div>

        <div className="flex min-w-0 flex-col gap-3.5">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5 sm:flex-nowrap">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Link href={href} className="shrink-0 rounded-full">
                <Avatar src={tutor.avatarUrl} name={tutor.displayName} size="lg" />
              </Link>

              <div className="min-w-0">
                <h3 className="flex items-center gap-1.5 text-lg font-extrabold tracking-tight text-ink-900 sm:text-xl">
                  <Link href={href} className="truncate hover:text-brand-700">
                    {tutor.displayName}
                  </Link>
                  <VerifiedMark types={tutor.verifiedTypes} />
                </h3>

                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="inline-flex items-center gap-1 text-[13px] font-medium text-ink-600">
                    <MapPin className="size-3.5 shrink-0 text-ink-400" />
                    {locationLabel(tutor)}
                  </span>
                  <Rating
                    value={tutor.stats.ratingAverage}
                    count={padCount(tutor.stats.ratingCount)}
                    size="sm"
                  />
                  {showSave && (
                    <FavouriteButton
                      tutorProfileId={tutor.id}
                      initial={tutor.isFavourite}
                      withLabel
                      className="-ml-1"
                    />
                  )}
                </div>
              </div>
            </div>

            <PriceBlock tutor={tutor} className="sm:shrink-0" />
          </div>

          <AvailabilityStrip weekdays={tutor.availableWeekdays} />

          <div>
            <p className="text-[13px] font-bold text-ink-900">
              You can get teaching service direct at
            </p>
            <ServiceModes tutor={tutor} className="mt-2" />
          </div>

          <MetaLine tutor={tutor} />

          {tutor.bio && (
            <p className="line-clamp-2 text-[13px] leading-relaxed text-ink-600">
              {truncate(tutor.bio, 190)}
            </p>
          )}

          <CourseTags courses={courses} courseCode={courseCode} href={href} max={4} />
        </div>
      </div>
    </Card>
  );
}

function CompactCard({ tutor, courseCode, showSave, ribbon, overlay, className }) {
  const href = `/tutors/${tutor.slug}`;
  const courses = orderCourses(tutor, courseCode);

  return (
    <Card interactive className={cn("flex h-full flex-col overflow-hidden", className)}>
      <div className="relative">
        <TutorGallery
          images={tutor.gallery?.slice(0, 1)}
          name={tutor.displayName}
          href={href}
          ribbon={ribbon ?? highlightRibbon(tutor)}
          monogram={monogram(tutor)}
          aspect="aspect-[16/10]"
          sizes="(min-width: 1024px) 24rem, (min-width: 640px) 50vw, 100vw"
          className="[&>div]:rounded-none"
        />
        {showSave && (
          <FavouriteButton
            tutorProfileId={tutor.id}
            initial={tutor.isFavourite}
            className="absolute right-2 top-2 rounded-full bg-white/90 shadow-sm backdrop-blur-sm hover:bg-white"
          />
        )}
        {overlay && (
          <div className={cn("absolute right-2 flex flex-col items-end gap-1", showSave ? "top-12" : "top-2")}>
            {overlay}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
        <div className="flex min-w-0 items-start gap-3">
          <Link href={href} className="-mt-10 shrink-0 rounded-full ring-4 ring-white">
            <Avatar src={tutor.avatarUrl} name={tutor.displayName} size="lg" />
          </Link>
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-1.5 text-base font-extrabold tracking-tight text-ink-900">
              <Link href={href} className="truncate hover:text-brand-700">
                {tutor.displayName}
              </Link>
              <VerifiedMark types={tutor.verifiedTypes} />
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="inline-flex items-center gap-1 text-xs font-medium text-ink-500">
                <MapPin className="size-3.5 shrink-0 text-ink-400" />
                {locationLabel(tutor)}
              </span>
              <Rating
                value={tutor.stats.ratingAverage}
                count={padCount(tutor.stats.ratingCount)}
                size="sm"
              />
            </div>
          </div>
        </div>

        <AvailabilityStrip weekdays={tutor.availableWeekdays} size="sm" />

        <ServiceModes tutor={tutor} size="sm" />

        {tutor.bio && (
          <p className="line-clamp-2 text-sm leading-relaxed text-ink-500">
            {truncate(tutor.bio, 150)}
          </p>
        )}

        <CourseTags courses={courses} courseCode={courseCode} href={href} max={3} />

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-ink-100 pt-3">
          <PriceBlock tutor={tutor} size="sm" />
          <Button href={href} variant="plum" size="sm">
            View Profile
          </Button>
        </div>
      </div>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                              */
/* -------------------------------------------------------------------------- */

/** Monday-first, because that is how a tutoring week reads. */
const WEEK = [
  { weekday: 1, label: "Mon" },
  { weekday: 2, label: "Tue" },
  { weekday: 3, label: "Wed" },
  { weekday: 4, label: "Thu" },
  { weekday: 5, label: "Fri" },
  { weekday: 6, label: "Sat" },
  { weekday: 0, label: "Sun" },
];

/**
 * The weekly availability strip. Renders from the tutor's recurring rules, so
 * an empty set means "no weekly pattern published" rather than "never free" —
 * in that case the strip is dropped instead of showing seven dead days.
 */
function AvailabilityStrip({ weekdays, size = "md" }) {
  if (!weekdays?.length) return null;
  const open = new Set(weekdays);
  const small = size === "sm";

  return (
    <div className={cn("flex flex-wrap items-center", small ? "gap-1.5" : "gap-2 sm:gap-3")}>
      {!small && (
        <span className="text-[13px] font-bold text-ink-900">Availability</span>
      )}
      <ul className={cn("flex min-w-0 flex-wrap", small ? "gap-1" : "gap-1.5")}>
        {WEEK.map(({ weekday, label }) => {
          const available = open.has(weekday);
          return (
            <li key={weekday}>
              <span
                className={cn(
                  "inline-flex items-center justify-center rounded-md font-bold uppercase tracking-wide",
                  small ? "px-1.5 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]",
                  available
                    ? "bg-success-50 text-success-700 ring-1 ring-inset ring-success-100"
                    : "bg-ink-100 text-ink-400",
                )}
              >
                {label}
                <span className="sr-only">
                  {available ? " — available" : " — not available"}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Where lessons can happen. All four options always render so the row reads
 * as a comparison — the ones a tutor does not offer are visibly muted rather
 * than missing, which is what makes two cards scannable side by side.
 */
function ServiceModes({ tutor, size = "md", className }) {
  const modes = tutor.lessonModes ?? [];
  const places = tutor.inPersonLocationTypes ?? [];
  const inPerson = modes.includes(LESSON_MODES.IN_PERSON);
  const small = size === "sm";

  const options = [
    {
      key: "online",
      label: "Online",
      icon: Video,
      tone: "text-accent-500",
      on: modes.includes(LESSON_MODES.ONLINE),
    },
    {
      key: "offline",
      label: "Offline",
      icon: MapPin,
      tone: "text-info-500",
      on: inPerson,
    },
    {
      key: "student-place",
      label: "Student place",
      icon: Home,
      tone: "text-accent-600",
      on: inPerson && places.includes(IN_PERSON_LOCATIONS.STUDENT_HOME),
    },
    {
      key: "tutor-place",
      label: "Tutor place",
      icon: Navigation,
      tone: "text-success-600",
      on: inPerson && places.includes(IN_PERSON_LOCATIONS.TUTOR_LOCATION),
    },
  ];

  return (
    <ul
      className={cn(
        "grid gap-2",
        small ? "grid-cols-2" : "grid-cols-2 sm:grid-cols-4 sm:gap-2.5",
        className,
      )}
    >
      {options.map(({ key, label, icon: Icon, tone, on }) => (
        <li key={key}>
          <span
            className={cn(
              "flex h-full items-center justify-center gap-1.5 rounded-xl text-center font-semibold leading-tight",
              small ? "px-2 py-2 text-[11px]" : "px-2 py-2.5 text-xs xl:text-[13px]",
              on ? "bg-ink-50 text-ink-800" : "bg-ink-50/60 text-ink-400",
            )}
          >
            <Icon className={cn("shrink-0", small ? "size-3.5" : "size-4", on ? tone : "text-ink-300")} />
            <span>{label}</span>
            <span className="sr-only">{on ? " — offered" : " — not offered"}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function PriceBlock({ tutor, size = "md", className }) {
  const rate = tutor.displayRateCents ?? tutor.hourlyRateCents;
  const small = size === "sm";

  return (
    <div className={cn(small ? "" : "text-right", className)}>
      <p className={cn("font-medium text-ink-500", small ? "text-[11px]" : "text-xs")}>
        Starting from:
      </p>
      <p
        className={cn(
          "font-extrabold tracking-tight text-brand-600",
          small ? "text-lg" : "text-xl sm:text-2xl",
        )}
      >
        {small ? formatRate(rate) : `${formatMoney(rate)}/hr`}
      </p>
      {tutor.offersFreeIntro && (
        <p className={cn("font-semibold text-success-700", small ? "text-[11px]" : "mt-0.5 text-[11px]")}>
          Free intro session
        </p>
      )}
    </div>
  );
}

/**
 * The §14 details the redesigned card no longer has a dedicated row for —
 * experience, approximate distance and next availability — kept as one quiet
 * line so nothing the requirement lists is lost.
 */
function MetaLine({ tutor }) {
  const bits = [];
  if (tutor.yearsExperience > 0) {
    bits.push({
      icon: Sparkles,
      text: `${tutor.yearsExperience} ${tutor.yearsExperience === 1 ? "year" : "years"} experience`,
    });
  }
  if (tutor.stats.completedLessons > 0) {
    bits.push({ icon: BadgeCheck, text: `${tutor.stats.completedLessons} lessons taught` });
  }
  bits.push({
    icon: Clock,
    text: tutor.nextAvailableAt
      ? `Next available ${formatRelative(tutor.nextAvailableAt)}`
      : "Availability on request",
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      {bits.map(({ icon: Icon, text }) => (
        <span key={text} className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-500">
          <Icon className="size-3 shrink-0 text-ink-400" />
          {text}
        </span>
      ))}
      <VerificationBadges types={tutor.verifiedTypes} max={3} compact />
    </div>
  );
}

function CourseTags({ courses, courseCode, href, max }) {
  if (!courses.length) return null;
  const shown = courses.slice(0, max);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {shown.map((course) => (
        <span
          key={course.courseId}
          className={cn(
            "rounded-lg px-2.5 py-1.5 text-[11px] font-semibold",
            course.code === courseCode
              ? "bg-brand-600 text-white"
              : "bg-ink-100 text-ink-600",
          )}
        >
          {course.code ?? course.name}
        </span>
      ))}
      {courses.length > shown.length && (
        <Link
          href={href}
          aria-label={`See all ${courses.length} courses`}
          className="rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-ink-500 ring-1 ring-inset ring-ink-200 transition-colors hover:bg-ink-50 hover:text-ink-700"
        >
          …
        </Link>
      )}
    </div>
  );
}

function VerifiedMark({ types = [] }) {
  if (!types.length) return null;
  return (
    <Tooltip content={`${types.length} verification${types.length === 1 ? "" : "s"} completed by our team`}>
      <BadgeCheck className="size-4.5 shrink-0 text-success-600" aria-hidden="true" />
      <span className="sr-only">Verified tutor</span>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------------- */
/* Derivations                                                                */
/* -------------------------------------------------------------------------- */

/**
 * The ribbon is earned, never sold — it is derived from published reviews, in
 * keeping with the promise that ranking is "not by who paid for placement".
 */
/**
 * The badge across the card's cover.
 *
 * "Promoted" wins over "Top rated" when both apply, because one of them is a
 * disclosure and the other is a compliment. A paid placement a visitor cannot
 * see is an advertising problem, so the label is not optional and is not
 * allowed to be crowded out (§41 Phase 2).
 */
function highlightRibbon(tutor) {
  if (tutor.isPromoted) return "Promoted";
  return tutor.stats?.ratingAverage >= 4.8 && tutor.stats?.ratingCount >= 3
    ? "Top rated"
    : null;
}

/** If the search was for a specific course, lead with that one. */
function orderCourses(tutor, courseCode) {
  const courses = tutor.courses ?? [];
  if (!courseCode) return courses;
  return [...courses].sort((a) => (a.code === courseCode ? -1 : 1));
}

function locationLabel(tutor) {
  return tutor.distanceKm != null
    ? `${tutor.city} — ${formatDistance(tutor.distanceKm)} away`
    : [tutor.city, tutor.province].filter(Boolean).join(", ");
}

/** Review counts read as a set when they line up: (07), (12), (148). */
function padCount(count = 0) {
  return count < 10 ? `0${count}` : String(count);
}

function monogram(tutor) {
  return (tutor.displayName ?? "?").trim().charAt(0).toUpperCase();
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
