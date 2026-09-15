"use client";

import { Video, MapPin } from "lucide-react";
import { Checkbox, OptionCard } from "@/components/ui";
import {
  LESSON_MODES, LESSON_MODE_LABELS, MEETING_PROVIDERS, MEETING_PROVIDER_LABELS,
  IN_PERSON_LOCATIONS, IN_PERSON_LOCATION_LABELS,
} from "@/constants";

/** Step 6 — online, in person, or both (§17, §27). */
export function LessonTypeStep({ value, onChange, fieldErrors }) {
  const modes = value.lessonModes ?? [];
  const providers = value.onlineMeetingProviders ?? [];
  const locations = value.inPersonLocationTypes ?? [];

  const set = (key, next) => onChange({ ...value, [key]: next });

  const toggle = (key, list, item) =>
    set(key, list.includes(item) ? list.filter((v) => v !== item) : [...list, item]);

  const offersOnline = modes.includes(LESSON_MODES.ONLINE);
  const offersInPerson = modes.includes(LESSON_MODES.IN_PERSON);

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 block text-sm font-semibold text-ink-800">
          How do you want to teach? <span className="text-danger-600">*</span>
        </legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <OptionCard
            type="checkbox"
            checked={offersOnline}
            onChange={() => toggle("lessonModes", modes, LESSON_MODES.ONLINE)}
            selected={offersOnline}
            icon={<Video className="size-5" />}
            label={LESSON_MODE_LABELS.ONLINE}
            description="Teach anyone in the province, no travel"
          />
          <OptionCard
            type="checkbox"
            checked={offersInPerson}
            onChange={() => toggle("lessonModes", modes, LESSON_MODES.IN_PERSON)}
            selected={offersInPerson}
            icon={<MapPin className="size-5" />}
            label={LESSON_MODE_LABELS.IN_PERSON}
            description="Travel within an area you choose"
          />
        </div>
        {fieldErrors.lessonModes && (
          <p className="mt-2 text-xs font-medium text-danger-600">{fieldErrors.lessonModes}</p>
        )}
      </fieldset>

      {offersOnline && (
        <fieldset className="rounded-xl border border-ink-200 p-4">
          <legend className="px-1 text-sm font-semibold text-ink-800">
            Which platforms can you use?
          </legend>
          <p className="mb-3 text-xs text-ink-500">
            A meeting link is generated automatically when a lesson is booked.
          </p>
          <div className="space-y-3">
            {Object.values(MEETING_PROVIDERS).map((provider) => (
              <Checkbox
                key={provider}
                label={MEETING_PROVIDER_LABELS[provider]}
                checked={providers.includes(provider)}
                onChange={() => toggle("onlineMeetingProviders", providers, provider)}
              />
            ))}
          </div>
          {fieldErrors.onlineMeetingProviders && (
            <p className="mt-2 text-xs font-medium text-danger-600">
              {fieldErrors.onlineMeetingProviders}
            </p>
          )}
        </fieldset>
      )}

      {offersInPerson && (
        <fieldset className="rounded-xl border border-ink-200 p-4">
          <legend className="px-1 text-sm font-semibold text-ink-800">
            Where can you teach in person?
          </legend>
          <p className="mb-3 text-xs text-ink-500">
            Families choose from these when booking. An exact address is only shared with you once
            a lesson is confirmed.
          </p>
          <div className="space-y-3">
            {Object.values(IN_PERSON_LOCATIONS).map((type) => (
              <Checkbox
                key={type}
                label={IN_PERSON_LOCATION_LABELS[type]}
                checked={locations.includes(type)}
                onChange={() => toggle("inPersonLocationTypes", locations, type)}
              />
            ))}
          </div>
          {fieldErrors.inPersonLocationTypes && (
            <p className="mt-2 text-xs font-medium text-danger-600">
              {fieldErrors.inPersonLocationTypes}
            </p>
          )}
        </fieldset>
      )}
    </div>
  );
}
