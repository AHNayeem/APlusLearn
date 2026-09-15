"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Eye, Save } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Switch,
  Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { formatRate } from "@/lib/utils/format";
import { LESSON_MODE_LABELS, QUALIFICATION_LABELS } from "@/constants";

/**
 * Edit a live profile (§15).
 *
 * Deliberately narrower than onboarding: the fields here are the ones a tutor
 * changes routinely. Anything that affects verification goes back through the
 * verification flow so a badge can't be side-stepped by an edit.
 */
export function ProfileEditor({ profile }) {
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState({
    headline: profile.headline ?? "",
    bio: profile.bio ?? "",
    hourlyRateCents: profile.hourlyRateCents ?? 0,
    offersFreeIntro: profile.offersFreeIntro ?? false,
    acceptingNewStudents: profile.acceptingNewStudents ?? true,
    city: profile.city ?? "",
    travelRadiusKm: profile.travelRadiusKm ?? 15,
    introVideoUrl: profile.introVideoUrl ?? "",
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.patch("/api/tutor/profile", form);
    toast.success("Profile updated", "Changes are live immediately.");
    router.refresh();
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="min-w-0 space-y-6"
      >
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Card>
          <CardHeader title="How you appear in search" />
          <CardBody className="space-y-5">
            <Field
              label="Headline"
              htmlFor="edit-headline"
              hint="The first thing parents read on your card and profile."
              error={fieldErrors.headline}
            >
              <Input
                id="edit-headline"
                value={form.headline}
                onChange={(e) => set("headline", e.target.value)}
                error={fieldErrors.headline}
                maxLength={120}
              />
            </Field>

            <Field label="About you" htmlFor="edit-bio" error={fieldErrors.bio}>
              <Textarea
                id="edit-bio"
                rows={10}
                value={form.bio}
                onChange={(e) => set("bio", e.target.value)}
                error={fieldErrors.bio}
                maxLength={4000}
              />
            </Field>

            <Field
              label="Intro video"
              htmlFor="edit-video"
              hint="Optional YouTube or Vimeo link."
              error={fieldErrors.introVideoUrl}
            >
              <Input
                id="edit-video"
                type="url"
                value={form.introVideoUrl}
                onChange={(e) => set("introVideoUrl", e.target.value)}
                error={fieldErrors.introVideoUrl}
                placeholder="https://youtube.com/watch?v=…"
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Pricing and availability" />
          <CardBody className="space-y-5">
            <Field
              label="Hourly rate"
              htmlFor="edit-rate"
              hint="Applies to every course unless you've set a per-course rate."
              error={fieldErrors.hourlyRateCents}
            >
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-ink-400">
                  $
                </span>
                <input
                  id="edit-rate"
                  type="number"
                  inputMode="numeric"
                  min={15}
                  max={250}
                  value={form.hourlyRateCents ? form.hourlyRateCents / 100 : ""}
                  onChange={(e) =>
                    set(
                      "hourlyRateCents",
                      e.target.value ? Math.round(Number(e.target.value) * 100) : 0,
                    )
                  }
                  className="h-12 w-full rounded-xl border-0 bg-white pl-9 pr-16 text-lg font-bold text-ink-900 ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                />
                <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                  / hour
                </span>
              </div>
            </Field>

            <div className="space-y-4 rounded-xl border border-ink-200 p-4">
              <Switch
                label="Offer a free intro session"
                description="Shown as a badge on your search card."
                checked={form.offersFreeIntro}
                onChange={(e) => set("offersFreeIntro", e.target.checked)}
              />
              <Switch
                label="Accepting new students"
                description="Turn off when you're full. Existing students can still book you."
                checked={form.acceptingNewStudents}
                onChange={(e) => set("acceptingNewStudents", e.target.checked)}
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Service area"
            description="Your exact address is never shown — only your city and an approximate distance."
          />
          <CardBody className="space-y-5">
            <Field label="City" htmlFor="edit-city" error={fieldErrors.city}>
              <Input
                id="edit-city"
                value={form.city}
                onChange={(e) => set("city", e.target.value)}
                error={fieldErrors.city}
              />
            </Field>

            {profile.lessonModes?.includes("IN_PERSON") && (
              <Field
                label="Travel radius"
                htmlFor="edit-radius"
                hint="Families beyond this won't see you for in-person lessons."
              >
                <select
                  id="edit-radius"
                  value={form.travelRadiusKm}
                  onChange={(e) => set("travelRadiusKm", Number(e.target.value))}
                  className="block w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                >
                  {[5, 10, 15, 20, 25, 30, 40, 50].map((km) => (
                    <option key={km} value={km}>
                      Up to {km} km
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </CardBody>
        </Card>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={pending} iconLeft={<Save className="size-4" />}>
            Save changes
          </Button>
          {profile.isSearchable && (
            <Button
              href={`/tutors/${profile.slug}`}
              variant="secondary"
              iconLeft={<Eye className="size-4" />}
            >
              View public profile
            </Button>
          )}
        </div>
      </form>

      <div className="space-y-6">
        <Card>
          <CardHeader title="Courses you teach" />
          <CardBody>
            <div className="flex flex-wrap gap-1.5">
              {profile.courses?.map((course) => (
                <Badge key={course.courseId} tone="brand" size="sm">
                  {course.code ?? course.name}
                </Badge>
              ))}
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-500">
              Changing which courses you teach affects search results, so it goes through the
              application flow.
            </p>
            <Button href="/tutor/onboarding" variant="secondary" size="sm" fullWidth className="mt-3">
              Manage courses
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Verification" />
          <CardBody>
            {profile.verifiedTypes?.length > 0 ? (
              <ul className="space-y-2">
                {profile.verifiedTypes.map((type) => (
                  <li key={type} className="flex items-center gap-2 text-sm text-ink-700">
                    <span className="size-1.5 rounded-full bg-success-500" />
                    {type.replace(/_/g, " ").toLowerCase()}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-500">No badges yet.</p>
            )}
            <Button
              href="/tutor/verification"
              variant="secondary"
              size="sm"
              fullWidth
              className="mt-3"
            >
              Manage verification
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Lesson types" />
          <CardBody>
            <div className="flex flex-wrap gap-1.5">
              {profile.lessonModes?.map((mode) => (
                <Badge key={mode} tone="neutral" size="sm">
                  {LESSON_MODE_LABELS[mode]}
                </Badge>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
