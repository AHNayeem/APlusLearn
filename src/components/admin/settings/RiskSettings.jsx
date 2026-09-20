"use client";

import { ShieldAlert } from "lucide-react";
import { Alert, Card, CardBody, CardHeader, Field, Input, Switch } from "@/components/ui";
import { useSettingsSection, toNumber } from "./useSettingsSection";
import { SectionForm } from "./SectionForm";

const NUMERIC = [
  "signalWindowDays",
  "reviewScore",
  "highScore",
  "noShowThreshold",
  "paymentFailureThreshold",
  "disputeThreshold",
];

const COERCE = Object.fromEntries(NUMERIC.map((key) => [key, toNumber]));

/**
 * Fraud and risk thresholds (§41 Phase 2).
 *
 * The panel leads with what is *not* here, because that is the part an
 * operator most needs to know: there is no automatic penalty, and there is no
 * setting that would create one.
 */
export function RiskSettings({ settings }) {
  const s = useSettingsSection("risk", { ...settings.risk }, { coerce: COERCE });
  const off = s.form.enabled === false;

  return (
    <SectionForm
      onSubmit={s.submit}
      pending={s.pending}
      error={s.error}
      fieldErrors={s.fieldErrors}
      label="Save risk rules"
    >
      <Alert
        tone="info"
        title="Detection only — nothing is restricted automatically"
        icon={<ShieldAlert className="size-3" />}
      >
        A case is a prompt for an administrator to look, never a penalty. Suspending an account is
        still a deliberate act from the account&rsquo;s page in Users, with its own audit entry.
        There is no score at which the platform acts on its own, and no setting that would add one.
      </Alert>

      <Card>
        <CardHeader title="Availability" />
        <CardBody>
          <div className="rounded-xl border border-ink-200 p-4">
            <Switch
              label="Risk detection is on"
              description="With this off, no new signals are recorded. Existing cases and their evidence are untouched."
              checked={s.form.enabled !== false}
              onChange={s.set("enabled")}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="When a case opens"
          description="A case's score is how many different kinds of signal fired inside the window — not how many events, and not a weighted total."
        />
        <CardBody className="space-y-5">
          <Field
            label="Days a signal keeps counting"
            htmlFor="set-risk-window"
            hint="Older signals stay on the record but stop adding to the score."
            error={s.errorFor("signalWindowDays")}
          >
            <Input
              id="set-risk-window"
              type="number"
              min={1}
              max={365}
              value={s.form.signalWindowDays ?? ""}
              onChange={s.set("signalWindowDays")}
              error={s.errorFor("signalWindowDays")}
              disabled={off}
              className="max-w-32"
            />
          </Field>

          <Field
            label="Different signals before a case opens"
            htmlFor="set-risk-review"
            hint="Lower catches more and wastes more of a reviewer's time. 1 opens a case for any single signal."
            error={s.errorFor("reviewScore")}
          >
            <Input
              id="set-risk-review"
              type="number"
              min={1}
              max={20}
              value={s.form.reviewScore ?? ""}
              onChange={s.set("reviewScore")}
              error={s.errorFor("reviewScore")}
              disabled={off}
              className="max-w-32"
            />
          </Field>

          <Field
            label="Different signals before a case is called high risk"
            htmlFor="set-risk-high"
            hint="Has to be at or above the number above."
            error={s.errorFor("highScore")}
          >
            <Input
              id="set-risk-high"
              type="number"
              min={1}
              max={20}
              value={s.form.highScore ?? ""}
              onChange={s.set("highScore")}
              error={s.errorFor("highScore")}
              disabled={off}
              className="max-w-32"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="When each signal fires"
          description="How much of a thing has to happen inside the window before it counts at all. Repeated cancellations are not here — they already use the cancellation-abuse threshold on the Marketplace tab, and a second copy would drift."
        />
        <CardBody className="space-y-5">
          <Field
            label="Unattended lessons"
            htmlFor="set-risk-no-shows"
            hint="One missed lesson is life. A pattern is worth a look."
            error={s.errorFor("noShowThreshold")}
          >
            <Input
              id="set-risk-no-shows"
              type="number"
              min={1}
              max={50}
              value={s.form.noShowThreshold ?? ""}
              onChange={s.set("noShowThreshold")}
              error={s.errorFor("noShowThreshold")}
              disabled={off}
              className="max-w-32"
            />
          </Field>

          <Field
            label="Declined payments"
            htmlFor="set-risk-payments"
            hint="A run of declines can be a card being tested rather than a card that expired."
            error={s.errorFor("paymentFailureThreshold")}
          >
            <Input
              id="set-risk-payments"
              type="number"
              min={1}
              max={50}
              value={s.form.paymentFailureThreshold ?? ""}
              onChange={s.set("paymentFailureThreshold")}
              error={s.errorFor("paymentFailureThreshold")}
              disabled={off}
              className="max-w-32"
            />
          </Field>

          <Field
            label="Disputes raised against an account"
            htmlFor="set-risk-disputes"
            hint="Counted against the account a dispute is about — never against the person who raised it. Disputes an administrator threw out are not counted at all."
            error={s.errorFor("disputeThreshold")}
          >
            <Input
              id="set-risk-disputes"
              type="number"
              min={1}
              max={50}
              value={s.form.disputeThreshold ?? ""}
              onChange={s.set("disputeThreshold")}
              error={s.errorFor("disputeThreshold")}
              disabled={off}
              className="max-w-32"
            />
          </Field>
        </CardBody>
      </Card>
    </SectionForm>
  );
}
