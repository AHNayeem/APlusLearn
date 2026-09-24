"use client";

import Link from "next/link";
import { ArrowRight, ShieldCheck, Lock } from "lucide-react";
import { Alert, Card, CardBody, CardHeader, Switch } from "@/components/ui";
import { FEATURES } from "@/constants";
import { useSettingsSection } from "./useSettingsSection";
import { SectionForm } from "./SectionForm";

/**
 * Feature toggles (§26).
 *
 * Switching something off here removes it from the navigation *and* makes its
 * endpoints answer 403 — the API check runs in the same request pipeline as
 * the permission check, so a direct call cannot get past it. `bun run qa`
 * asserts exactly that.
 */
const GROUPS = [
  {
    title: "Marketplace features",
    description: "Turning one off hides it everywhere and refuses its API calls.",
    items: [
      {
        key: FEATURES.MESSAGING,
        label: "Messaging",
        description: "Families and tutors can message each other before and after booking.",
      },
      {
        key: FEATURES.TUTOR_REQUESTS,
        label: "Tutor requests",
        description: "Families post what they need and matching tutors respond.",
      },
      {
        key: FEATURES.FAVOURITES,
        label: "Saved tutors",
        description: "Families can shortlist tutors to compare later.",
      },
      {
        key: FEATURES.REVIEWS,
        label: "Reviews",
        description: "Verified reviews after completed lessons, with tutor replies.",
      },
    ],
  },
  {
    title: "Lesson delivery",
    description: "At least one must stay on, or no lesson can be booked at all.",
    items: [
      {
        key: FEATURES.ONLINE_LESSONS,
        label: "Online lessons",
        description: "Video lessons with an automatically generated meeting link.",
      },
      {
        key: FEATURES.IN_PERSON_LESSONS,
        label: "In-person lessons",
        description: "Lessons at an address, with distance-based search.",
      },
    ],
  },
];

export function FeatureSettings({ settings }) {
  const s = useSettingsSection("features", { ...settings.features });

  const noLessonMode =
    !s.form[FEATURES.ONLINE_LESSONS] && !s.form[FEATURES.IN_PERSON_LESSONS];

  return (
    <SectionForm onSubmit={s.submit} pending={s.pending} error={s.error} fieldErrors={s.fieldErrors}>
      <Alert tone="info" title="Enforced on the server" icon={<ShieldCheck className="size-3" />}>
        A disabled feature is refused by its API endpoints, not just hidden in the interface.
        Existing data is untouched — turning a feature back on restores it as it was.
      </Alert>

      {noLessonMode && (
        <Alert tone="warning" title="No lesson type is enabled">
          With both online and in-person lessons off, no new booking can be created. Existing
          bookings are unaffected.
        </Alert>
      )}

      {GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader title={group.title} description={group.description} />
          <CardBody className="space-y-4">
            {group.items.map((item) => (
              <div key={item.key} className="rounded-xl border border-ink-200 p-4">
                <Switch
                  label={item.label}
                  description={item.description}
                  checked={s.form[item.key] !== false}
                  onChange={s.set(item.key)}
                />
              </div>
            ))}
          </CardBody>
        </Card>
      ))}

      {/*
        Google and Apple sign-in are configured where their credentials live,
        so the switch and the thing it switches cannot disagree.
      */}
      <Card>
        <CardHeader
          title="Sign-in methods"
          description="Email and password always remain available."
        />
        <CardBody>
          <p className="text-sm text-ink-600">
            Continue with Google and Continue with Apple are switched on and off, together with
            their credentials, under{" "}
            <Link
              href="/admin/settings/integrations"
              className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline"
            >
              External modules → Social sign-in
              <ArrowRight className="size-3.5" aria-hidden="true" />
            </Link>
            .
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Not configurable"
          description="These are the platform, not features of it."
        />
        <CardBody>
          <ul className="space-y-2.5 text-sm text-ink-600">
            {[
              "Tutor search, booking and payments — the marketplace is these things.",
              "Tutor approval before appearing in search — a safety rule, not a preference (§16).",
              "Identity and document verification.",
              "Password reset and account security email.",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2.5">
                <Lock className="mt-0.5 size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                {item}
              </li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </SectionForm>
  );
}
