"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, AlertTriangle } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Card, CardBody, CardHeader, Field, Input, Switch,
  FormErrorSummary, useToast,
} from "@/components/ui";
import { formatMoney } from "@/lib/utils/format";

/**
 * Platform settings (§20, §26).
 *
 * These values drive live business rules — commission, refunds, booking guard
 * rails — so each one explains its effect before it's changed.
 */
export function PlatformSettings({ settings }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState(settings);

  const set = (key) => (e) =>
    setForm((f) => ({
      ...f,
      [key]: e.target.type === "checkbox" ? e.target.checked : Number(e.target.value),
    }));

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const payload = Object.fromEntries(
      Object.entries(form).filter(
        ([key]) =>
          ![
            "id", "_id", "key", "createdAt", "updatedAt", "updatedBy", "__v",
          ].includes(key),
      ),
    );
    await api.patch("/api/admin/settings", payload);
    toast.success("Settings saved", "New bookings use these values immediately.");
    router.refresh();
  });

  // Worked example so the commission change is concrete, not abstract.
  const exampleRate = 6000;
  const exampleCommission = Math.floor((exampleRate * form.commissionPercent) / 100);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="max-w-2xl space-y-6"
    >
      <FormErrorSummary error={error} fieldErrors={fieldErrors} />

      <Alert tone="warning" title="These change live business rules" icon={<AlertTriangle className="size-3" />}>
        Bookings already made keep the commission and policy captured at the time they were
        created. Changes apply to new bookings only.
      </Alert>

      <Card>
        <CardHeader
          title="Commission"
          description="What the platform takes from each completed lesson."
        />
        <CardBody className="space-y-5">
          <Field
            label="Commission percentage"
            htmlFor="set-commission"
            error={fieldErrors.commissionPercent}
          >
            <div className="relative max-w-32">
              <Input
                id="set-commission"
                type="number"
                min={0}
                max={50}
                step="0.5"
                value={form.commissionPercent}
                onChange={set("commissionPercent")}
                error={fieldErrors.commissionPercent}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                %
              </span>
            </div>
          </Field>

          <div className="rounded-xl bg-ink-50 p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
              On a {formatMoney(exampleRate)} lesson
            </p>
            <dl className="mt-2 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-500">Family pays</dt>
                <dd className="font-semibold text-ink-900">{formatMoney(exampleRate)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-500">Platform keeps</dt>
                <dd className="font-semibold text-brand-700">{formatMoney(exampleCommission)}</dd>
              </div>
              <div className="flex justify-between border-t border-ink-200 pt-1.5">
                <dt className="font-bold text-ink-900">Tutor receives</dt>
                <dd className="font-bold text-success-700">
                  {formatMoney(exampleRate - exampleCommission)}
                </dd>
              </div>
            </dl>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Cancellations and refunds"
          description="The policy every cancellation across the platform resolves against."
        />
        <CardBody className="space-y-5">
          <Field
            label="Free cancellation window"
            htmlFor="set-window"
            hint="Hours before a lesson when a student can still cancel for a full refund."
            error={fieldErrors.freeCancellationWindowHours}
          >
            <div className="relative max-w-32">
              <Input
                id="set-window"
                type="number"
                min={0}
                max={168}
                value={form.freeCancellationWindowHours}
                onChange={set("freeCancellationWindowHours")}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-400">
                hrs
              </span>
            </div>
          </Field>

          <Field
            label="Late cancellation refund"
            htmlFor="set-late-refund"
            hint="What a student gets back when they cancel inside the window."
            error={fieldErrors.lateCancellationRefundPercent}
          >
            <div className="relative max-w-32">
              <Input
                id="set-late-refund"
                type="number"
                min={0}
                max={100}
                value={form.lateCancellationRefundPercent}
                onChange={set("lateCancellationRefundPercent")}
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                %
              </span>
            </div>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Student no-show refund"
              htmlFor="set-student-noshow"
              error={fieldErrors.studentNoShowRefundPercent}
            >
              <div className="relative">
                <Input
                  id="set-student-noshow"
                  type="number"
                  min={0}
                  max={100}
                  value={form.studentNoShowRefundPercent}
                  onChange={set("studentNoShowRefundPercent")}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                  %
                </span>
              </div>
            </Field>
            <Field
              label="Tutor no-show refund"
              htmlFor="set-tutor-noshow"
              error={fieldErrors.tutorNoShowRefundPercent}
            >
              <div className="relative">
                <Input
                  id="set-tutor-noshow"
                  type="number"
                  min={0}
                  max={100}
                  value={form.tutorNoShowRefundPercent}
                  onChange={set("tutorNoShowRefundPercent")}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-400">
                  %
                </span>
              </div>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Cancellation abuse threshold"
              htmlFor="set-abuse"
              hint="Cancellations before a warning is issued."
            >
              <Input
                id="set-abuse"
                type="number"
                min={1}
                max={20}
                value={form.cancellationAbuseThreshold}
                onChange={set("cancellationAbuseThreshold")}
              />
            </Field>
            <Field
              label="Abuse window"
              htmlFor="set-abuse-window"
              hint="Rolling period, in days."
            >
              <Input
                id="set-abuse-window"
                type="number"
                min={1}
                max={365}
                value={form.cancellationAbuseWindowDays}
                onChange={set("cancellationAbuseWindowDays")}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Booking rules" description="Guard rails on when lessons can be booked." />
        <CardBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Minimum notice"
              htmlFor="set-notice"
              hint="Hours ahead a lesson must be booked."
            >
              <Input
                id="set-notice"
                type="number"
                min={0}
                max={168}
                value={form.minimumBookingNoticeHours}
                onChange={set("minimumBookingNoticeHours")}
              />
            </Field>
            <Field
              label="Booking horizon"
              htmlFor="set-horizon"
              hint="How many days ahead families can book."
            >
              <Input
                id="set-horizon"
                type="number"
                min={1}
                max={365}
                value={form.bookingHorizonDays}
                onChange={set("bookingHorizonDays")}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Minimum hourly rate" htmlFor="set-min-rate" hint="In dollars.">
              <Input
                id="set-min-rate"
                type="number"
                min={0}
                value={form.minHourlyRate}
                onChange={set("minHourlyRate")}
              />
            </Field>
            <Field label="Maximum hourly rate" htmlFor="set-max-rate" hint="In dollars.">
              <Input
                id="set-max-rate"
                type="number"
                min={1}
                value={form.maxHourlyRate}
                onChange={set("maxHourlyRate")}
              />
            </Field>
          </div>

          <Field
            label="Default search radius"
            htmlFor="set-radius"
            hint="Kilometres, used when a family hasn't set one."
          >
            <Input
              id="set-radius"
              type="number"
              min={1}
              max={500}
              value={form.defaultSearchRadiusKm}
              onChange={set("defaultSearchRadiusKm")}
              className="max-w-32"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Payouts and moderation" />
        <CardBody className="space-y-5">
          <Field
            label="Payout hold period"
            htmlFor="set-hold"
            hint="Days after a completed lesson before earnings become payable."
          >
            <Input
              id="set-hold"
              type="number"
              min={0}
              max={60}
              value={form.payoutHoldDays}
              onChange={set("payoutHoldDays")}
              className="max-w-32"
            />
          </Field>

          <div className="rounded-xl border border-ink-200 p-4">
            <Switch
              label="Moderate reviews before publishing"
              description="When on, new reviews are held for approval instead of appearing immediately."
              checked={form.autoModerateReviews}
              onChange={set("autoModerateReviews")}
            />
          </div>
        </CardBody>
      </Card>

      <Button type="submit" loading={pending} iconLeft={<Save className="size-4" />}>
        Save settings
      </Button>
    </form>
  );
}
