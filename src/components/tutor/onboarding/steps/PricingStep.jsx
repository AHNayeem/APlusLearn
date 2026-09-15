"use client";

import { useEffect, useState } from "react";
import { TrendingUp, Info } from "lucide-react";
import { Alert, Field, Input, Switch, InlineNote } from "@/components/ui";
import { formatMoney } from "@/lib/utils/format";
import { DEFAULT_SETTINGS } from "@/constants";

/**
 * Step 8 — pricing (§17, §20).
 *
 * The commission preview is computed with the same arithmetic the booking
 * service uses, so what a tutor sees here is exactly what they'll earn.
 */
export function PricingStep({ value, onChange, fieldErrors }) {
  const commissionPercent = DEFAULT_SETTINGS.commissionPercent;
  const rateCents = value.hourlyRateCents ?? 0;

  const commissionCents = Math.floor((rateCents * commissionPercent) / 100);
  const earningsCents = rateCents - commissionCents;

  const set = (key, next) => onChange({ ...value, [key]: next });

  return (
    <div className="space-y-6">
      <Field
        label="Your hourly rate"
        htmlFor="price-rate"
        hint="You can change this any time, and set a different rate for individual courses."
        error={fieldErrors.hourlyRateCents}
        required
      >
        <div className="relative">
          <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-ink-400">
            $
          </span>
          <input
            id="price-rate"
            type="number"
            inputMode="numeric"
            min={15}
            max={250}
            value={rateCents ? rateCents / 100 : ""}
            onChange={(e) =>
              set("hourlyRateCents", e.target.value ? Math.round(Number(e.target.value) * 100) : 0)
            }
            placeholder="55"
            className="h-14 w-full rounded-xl border-0 bg-white pl-9 pr-16 text-2xl font-bold text-ink-900 ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-ink-400">
            / hour
          </span>
        </div>
      </Field>

      {rateCents >= 1500 && (
        <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-4">
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900">
            <TrendingUp className="size-4 text-brand-600" />
            What you actually earn
          </h3>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Family pays</dt>
              <dd className="font-semibold text-ink-900">{formatMoney(rateCents)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">
                APlus Learn fee ({commissionPercent}%)
              </dt>
              <dd className="text-ink-500">− {formatMoney(commissionCents)}</dd>
            </div>
            <div className="flex justify-between gap-3 border-t border-ink-200 pt-2">
              <dt className="font-bold text-ink-900">You receive</dt>
              <dd className="text-base font-extrabold text-success-700">
                {formatMoney(earningsCents)}
              </dd>
            </div>
          </dl>
          <p className="mt-3 flex gap-1.5 text-xs leading-relaxed text-ink-500">
            <Info className="mt-0.5 size-3 shrink-0" />
            The fee only applies to completed lessons. Nothing to join, nothing when you&rsquo;re not
            teaching, and nothing on a cancelled lesson.
          </p>
        </div>
      )}

      <div className="space-y-4 rounded-xl border border-ink-200 p-4">
        <Switch
          label="Offer a free intro session"
          description="A short first session at no charge. Tutors who offer one get noticeably more first bookings."
          checked={value.offersFreeIntro ?? false}
          onChange={(e) => set("offersFreeIntro", e.target.checked)}
        />

        <Switch
          label="Accepting new students"
          description="Turn this off when you're full. You stay visible to existing students but stop appearing to new families."
          checked={value.acceptingNewStudents ?? true}
          onChange={(e) => set("acceptingNewStudents", e.target.checked)}
        />
      </div>

      <Field
        label="Trial lesson rate"
        htmlFor="price-trial"
        hint="Optional. A reduced rate for a first session, if you'd rather discount than offer it free."
        error={fieldErrors.trialRateCents}
      >
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
            $
          </span>
          <input
            id="price-trial"
            type="number"
            inputMode="numeric"
            min={0}
            value={value.trialRateCents ? value.trialRateCents / 100 : ""}
            onChange={(e) =>
              set(
                "trialRateCents",
                e.target.value ? Math.round(Number(e.target.value) * 100) : undefined,
              )
            }
            placeholder="No trial rate"
            className="h-11 w-full rounded-xl border-0 bg-white pl-7 pr-3 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
          />
        </div>
        {fieldErrors.trialRateCents && (
          <InlineNote tone="danger">{fieldErrors.trialRateCents}</InlineNote>
        )}
      </Field>

      <Alert tone="neutral" title="What do other tutors charge?">
        Most Ontario tutors on APlus Learn charge between $45 and $85 an hour. Certified teachers
        and senior-course specialists sit at the higher end; university students and elementary
        tutors at the lower end.
      </Alert>
    </div>
  );
}
