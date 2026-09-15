"use client";

import { Check, AlertTriangle, Pencil } from "lucide-react";
import { Alert, Badge, Checkbox } from "@/components/ui";
import { ONBOARDING_STEPS, ONBOARDING_STEP_META } from "@/constants/onboarding";
import {
  LESSON_MODE_LABELS, QUALIFICATION_LABELS, VERIFICATION_LABELS, WEEKDAYS,
} from "@/constants";
import { formatMoney, formatRate } from "@/lib/utils/format";
import { minutesToLabel } from "@/lib/utils/time";

/**
 * Step 11 — review and submit (§17).
 *
 * A single summary of everything the tutor entered, with any missing step
 * called out before they can submit.
 */
export function ReviewStep({ value, onChange, fieldErrors, application }) {
  const data = application?.data ?? {};
  const completed = application?.completedSteps ?? [];
  const required = ONBOARDING_STEPS.filter((s) => s !== "REVIEW");
  const missing = required.filter((step) => !completed.includes(step));

  return (
    <div className="space-y-6">
      {missing.length > 0 ? (
        <Alert tone="warning" title="Some steps still need finishing" icon={<AlertTriangle className="size-3" />}>
          <ul className="mt-1 space-y-1">
            {missing.map((step) => (
              <li key={step}>· {ONBOARDING_STEP_META[step].title}</li>
            ))}
          </ul>
        </Alert>
      ) : (
        <Alert tone="success" title="Everything's ready" icon={<Check className="size-3" />}>
          Check the summary below, then submit. Our team reviews applications within two business
          days and you&rsquo;ll be emailed either way.
        </Alert>
      )}

      <div className="divide-y divide-ink-100 rounded-xl border border-ink-200">
        <Section title="About you">
          <Row label="Name" value={`${data.PERSONAL?.firstName ?? ""} ${data.PERSONAL?.lastName ?? ""}`.trim()} />
          <Row label="Phone" value={data.PERSONAL?.phone} />
          <Row label="Location" value={[data.LOCATION?.city, data.LOCATION?.province].filter(Boolean).join(", ")} />
          <Row label="Headline" value={data.PROFILE?.headline} />
          <Row label="Languages" value={data.PROFILE?.languages?.join(", ")} />
        </Section>

        <Section title="Education & qualifications">
          {data.EDUCATION?.education?.map((entry, i) => (
            <Row
              key={i}
              label={entry.credential}
              value={`${entry.institution}${entry.fieldOfStudy ? ` · ${entry.fieldOfStudy}` : ""}`}
            />
          ))}
          <Row
            label="Qualifications"
            value={data.QUALIFICATIONS?.qualifications
              ?.map((q) => QUALIFICATION_LABELS[q])
              .join(", ")}
          />
          <Row
            label="Experience"
            value={
              data.QUALIFICATIONS?.yearsExperience != null
                ? `${data.QUALIFICATIONS.yearsExperience} years`
                : undefined
            }
          />
          {data.QUALIFICATIONS?.octNumber && (
            <Row label="OCT number" value={data.QUALIFICATIONS.octNumber} />
          )}
        </Section>

        <Section title="Courses">
          <div className="flex flex-wrap gap-1.5">
            {data.COURSES?.courses?.length ? (
              <Badge tone="brand">
                {data.COURSES.courses.length}{" "}
                {data.COURSES.courses.length === 1 ? "course" : "courses"} selected
              </Badge>
            ) : (
              <span className="text-sm text-ink-400">None selected</span>
            )}
          </div>
        </Section>

        <Section title="Lessons & pricing">
          <Row
            label="Lesson type"
            value={data.LESSON_TYPE?.lessonModes?.map((m) => LESSON_MODE_LABELS[m]).join(" and ")}
          />
          <Row
            label="Hourly rate"
            value={data.PRICING?.hourlyRateCents ? formatRate(data.PRICING.hourlyRateCents) : undefined}
          />
          {data.PRICING?.offersFreeIntro && <Row label="Free intro session" value="Yes" />}
          {data.LOCATION?.travelRadiusKm > 0 &&
            data.LESSON_TYPE?.lessonModes?.includes("IN_PERSON") && (
              <Row label="Travel radius" value={`Up to ${data.LOCATION.travelRadiusKm} km`} />
            )}
        </Section>

        <Section title="Availability">
          {data.AVAILABILITY?.weeklyRules?.length ? (
            <ul className="space-y-1 text-sm">
              {WEEKDAYS.map((day) => {
                const rules = data.AVAILABILITY.weeklyRules.filter((r) => r.weekday === day.value);
                if (!rules.length) return null;
                return (
                  <li key={day.value} className="flex gap-3">
                    <span className="w-24 shrink-0 font-medium text-ink-600">{day.label}</span>
                    <span className="text-ink-800">
                      {rules
                        .map((r) => `${minutesToLabel(r.startMinutes)}–${minutesToLabel(r.endMinutes)}`)
                        .join(", ")}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <span className="text-sm text-ink-400">Not set</span>
          )}
        </Section>

        <Section title="Verification requested">
          <div className="flex flex-wrap gap-1.5">
            {data.DOCUMENTS?.requestedBadges?.length ? (
              data.DOCUMENTS.requestedBadges.map((type) => (
                <Badge key={type} tone="success" size="sm">
                  {VERIFICATION_LABELS[type]}
                </Badge>
              ))
            ) : (
              <span className="text-sm text-ink-400">None selected</span>
            )}
          </div>
        </Section>
      </div>

      <div className="rounded-xl border border-ink-200 p-4">
        <Checkbox
          label="Everything above is accurate and I have the right to teach these courses"
          description="Misrepresenting qualifications leads to permanent removal from the platform."
          checked={value.confirmAccurate ?? false}
          onChange={(e) => onChange({ ...value, confirmAccurate: e.target.checked })}
        />
        {fieldErrors.confirmAccurate && (
          <p className="ml-7 mt-2 text-xs font-medium text-danger-600">
            {fieldErrors.confirmAccurate}
          </p>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div className="p-4">
      <h3 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-400">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="flex flex-wrap gap-x-3 text-sm">
      <span className="w-32 shrink-0 text-ink-500">{label}</span>
      <span className="min-w-0 flex-1 font-medium text-ink-800">{value}</span>
    </div>
  );
}
