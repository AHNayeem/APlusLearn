"use client";

import { Gift } from "lucide-react";
import { Alert, Card, CardBody, CardHeader, Field, Input, Switch } from "@/components/ui";
import { formatMoney } from "@/lib/utils/format";
import { useSettingsSection, toNumber } from "./useSettingsSection";
import { SectionForm } from "./SectionForm";

const NUMERIC = [
  "referrerRewardCents",
  "refereeRewardCents",
  "qualifyingLessons",
  "rewardExpiryDays",
  "maxRewardsPerReferrer",
];

const COERCE = Object.fromEntries(NUMERIC.map((key) => [key, toNumber]));

/**
 * Referral rules (§41 Phase 2).
 *
 * The amounts ship at zero because the requirements name referrals without
 * pricing them. The panel says so plainly rather than leaving an operator to
 * wonder why nothing is being paid out.
 */
export function ReferralSettings({ settings }) {
  const s = useSettingsSection(
    "referrals",
    { ...settings.referrals },
    { coerce: COERCE },
  );

  const off = s.form.enabled === false;
  const referrer = Number(s.form.referrerRewardCents) || 0;
  const referee = Number(s.form.refereeRewardCents) || 0;
  const unpriced = referrer === 0 && referee === 0;

  return (
    <SectionForm
      onSubmit={s.submit}
      pending={s.pending}
      error={s.error}
      fieldErrors={s.fieldErrors}
      label="Save referral rules"
    >
      <Alert tone="info" title="Credit is funded by the platform" icon={<Gift className="size-3" />}>
        A tutor is paid their full earnings on a discounted booking — the commission absorbs the
        credit. A referral is the platform&rsquo;s marketing cost, not one tutor paying for
        another party&rsquo;s introduction.
      </Alert>

      {unpriced && !off && (
        <Alert tone="warning" title="No reward is configured">
          Referrals are live — codes work, sign-ups are attributed, referrals qualify and
          administrators can review them — but nobody is being credited anything. Set an amount
          below to start paying rewards.
        </Alert>
      )}

      <Card>
        <CardHeader title="Availability" />
        <CardBody>
          <div className="rounded-xl border border-ink-200 p-4">
            <Switch
              label="Referrals are open"
              description="With this off, codes stop working and no new referral is attributed. Rewards already granted are untouched."
              checked={s.form.enabled !== false}
              onChange={s.set("enabled")}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Rewards"
          description="Credit granted once a referred account has taken its first lessons."
        />
        <CardBody className="space-y-5">
          <Field
            label="Credit for the person who shared the code (cents)"
            htmlFor="set-referrer-reward"
            hint={referrer > 0 ? `Currently ${formatMoney(referrer)}.` : "0 means no reward."}
            error={s.errorFor("referrerRewardCents")}
          >
            <Input
              id="set-referrer-reward"
              type="number"
              min={0}
              max={100000}
              step={100}
              value={s.form.referrerRewardCents ?? ""}
              onChange={s.set("referrerRewardCents")}
              error={s.errorFor("referrerRewardCents")}
              disabled={off}
              className="max-w-40"
            />
          </Field>

          <Field
            label="Credit for the person who used it (cents)"
            htmlFor="set-referee-reward"
            hint={referee > 0 ? `Currently ${formatMoney(referee)}.` : "0 means no welcome credit."}
            error={s.errorFor("refereeRewardCents")}
          >
            <Input
              id="set-referee-reward"
              type="number"
              min={0}
              max={100000}
              step={100}
              value={s.form.refereeRewardCents ?? ""}
              onChange={s.set("refereeRewardCents")}
              error={s.errorFor("refereeRewardCents")}
              disabled={off}
              className="max-w-40"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Qualifying and limits"
          description="What a referral has to do before it earns, and how much one account can earn."
        />
        <CardBody className="space-y-5">
          <Field
            label="Completed lessons before a referral qualifies"
            htmlFor="set-qualifying"
            hint="Rewards are earned by lessons taken and paid for, not by sign-ups. This is what makes the scheme expensive to farm."
            error={s.errorFor("qualifyingLessons")}
          >
            <Input
              id="set-qualifying"
              type="number"
              min={1}
              max={20}
              value={s.form.qualifyingLessons ?? ""}
              onChange={s.set("qualifyingLessons")}
              error={s.errorFor("qualifyingLessons")}
              disabled={off}
              className="max-w-32"
            />
          </Field>

          <Field
            label="Rewarded referrals per account per year"
            htmlFor="set-max-rewards"
            hint="Past this, referrals are still recorded and flagged for review, but no reward is granted."
            error={s.errorFor("maxRewardsPerReferrer")}
          >
            <Input
              id="set-max-rewards"
              type="number"
              min={1}
              max={1000}
              value={s.form.maxRewardsPerReferrer ?? ""}
              onChange={s.set("maxRewardsPerReferrer")}
              error={s.errorFor("maxRewardsPerReferrer")}
              disabled={off}
              className="max-w-32"
            />
          </Field>

          <Field
            label="Days a granted credit stays usable"
            htmlFor="set-reward-expiry"
            hint="0 means it never expires."
            error={s.errorFor("rewardExpiryDays")}
          >
            <Input
              id="set-reward-expiry"
              type="number"
              min={0}
              max={3650}
              value={s.form.rewardExpiryDays ?? ""}
              onChange={s.set("rewardExpiryDays")}
              error={s.errorFor("rewardExpiryDays")}
              disabled={off}
              className="max-w-32"
            />
          </Field>
        </CardBody>
      </Card>
    </SectionForm>
  );
}
