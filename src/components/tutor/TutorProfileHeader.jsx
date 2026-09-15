import {
  MapPin, Video, Clock, Languages, GraduationCap, CheckCircle2,
} from "lucide-react";
import { Avatar, Badge, Rating } from "@/components/ui";
import { formatRate, formatDuration, formatNumber } from "@/lib/utils/format";
import { LESSON_MODES } from "@/constants";
import { VerificationBadges } from "./VerificationBadges";
import { FavouriteButton } from "./FavouriteButton";

/**
 * Profile header (§15).
 *
 * Ordered to build trust before price: who they are, what they're verified
 * for, how they're rated — then the rate and the booking action.
 */
export function TutorProfileHeader({ tutor, isFavourite }) {
  const offersOnline = tutor.lessonModes?.includes(LESSON_MODES.ONLINE);
  const offersInPerson = tutor.lessonModes?.includes(LESSON_MODES.IN_PERSON);

  return (
    <div className="border-b border-ink-200 bg-white">
      <div className="container-page py-8 lg:py-10">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
          <Avatar
            src={tutor.avatarUrl}
            name={tutor.displayName}
            size="2xl"
            className="shrink-0 ring-4 ring-white shadow-md"
          />

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
                  {tutor.displayName}
                </h1>
                <p className="mt-1.5 text-base text-ink-600">{tutor.headline}</p>
              </div>
              <FavouriteButton
                tutorProfileId={tutor.id}
                initial={isFavourite}
                withLabel
                className="shrink-0 ring-1 ring-ink-200"
              />
            </div>

            <div className="mt-4">
              <VerificationBadges types={tutor.verifiedTypes} />
            </div>

            <dl className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 text-sm">
              <div className="flex items-center gap-2">
                <dt className="sr-only">Rating</dt>
                <dd>
                  <Rating
                    value={tutor.stats.ratingAverage}
                    count={tutor.stats.ratingCount}
                    size="lg"
                  />
                </dd>
              </div>

              {tutor.stats.completedLessons > 0 && (
                <Fact
                  icon={<CheckCircle2 className="size-4" />}
                  label="Lessons completed"
                  value={`${formatNumber(tutor.stats.completedLessons)} lessons`}
                />
              )}

              <Fact
                icon={<GraduationCap className="size-4" />}
                label="Experience"
                value={`${tutor.yearsExperience} ${tutor.yearsExperience === 1 ? "year" : "years"} teaching`}
              />

              <Fact
                icon={<MapPin className="size-4" />}
                label="Location"
                value={
                  tutor.distanceKm != null
                    ? `${Math.round(tutor.distanceKm)} km away · ${tutor.city}`
                    : `${tutor.city}, ${tutor.province}`
                }
              />

              <Fact
                icon={offersOnline ? <Video className="size-4" /> : <MapPin className="size-4" />}
                label="Lesson type"
                value={
                  offersOnline && offersInPerson
                    ? "Online & in person"
                    : offersOnline
                      ? "Online only"
                      : "In person only"
                }
              />

              {tutor.stats.responseTimeMinutes != null && (
                <Fact
                  icon={<Clock className="size-4" />}
                  label="Response time"
                  value={`Usually replies in ${formatDuration(tutor.stats.responseTimeMinutes)}`}
                />
              )}

              {tutor.languages?.length > 0 && (
                <Fact
                  icon={<Languages className="size-4" />}
                  label="Languages"
                  value={tutor.languages.join(", ")}
                />
              )}
            </dl>

            <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-ink-100 pt-5">
              <div>
                <p className="text-2xl font-extrabold text-ink-900">
                  {formatRate(tutor.hourlyRateCents)}
                </p>
                <p className="text-xs text-ink-500">
                  {tutor.courses?.some((c) => c.hourlyRateCents !== tutor.hourlyRateCents)
                    ? "Rate varies by course"
                    : "Same rate for every course"}
                </p>
              </div>
              {tutor.offersFreeIntro && (
                <Badge tone="accent">Offers a free intro session</Badge>
              )}
              {!tutor.acceptingNewStudents && (
                <Badge tone="warning">Not taking new students right now</Badge>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ icon, label, value }) {
  return (
    <div className="flex items-center gap-2 text-ink-600">
      <span className="shrink-0 text-ink-400">{icon}</span>
      <dt className="sr-only">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
