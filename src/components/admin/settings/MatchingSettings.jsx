"use client";

import { Sparkles } from "lucide-react";
import {
  Alert, Card, CardBody, CardHeader, Field, Input,
} from "@/components/ui";
import {
  MATCH_FACTOR_KEYS,
  MATCH_FACTOR_LABELS,
  MATCH_FACTOR_HINTS,
  normaliseWeights,
} from "@/lib/matching/weights";
import { useSettingsSection, toNumber } from "./useSettingsSection";
import { SectionForm } from "./SectionForm";

const MATCHING_KEYS = [
  "minimumScore",
  "maxSuggestions",
  "notifyTopTutors",
  "requestTtlDays",
  "requestExpiryWarningDays",
  "maxOpenRequestsPerOwner",
  "maxInvitesPerRequest",
];

const MATCHING_COERCE = Object.fromEntries(MATCHING_KEYS.map((key) => [key, toNumber]));
const WEIGHT_COERCE = Object.fromEntries(MATCH_FACTOR_KEYS.map((key) => [key, toNumber]));

/**
 * How the marketplace ranks tutors against a request (§22, §41 Phase 2).
 *
 * Two forms rather than one: the weights decide *order* and the controls
 * decide *volume*, and an operator retuning a weight should not have to think
 * about how long a request lives. The live percentage column is computed with
 * the same `normaliseWeights` the scorer uses, so what is previewed here is
 * exactly what will be applied.
 */
export function MatchingSettings({ settings }) {
  const controls = useSettingsSection(
    "matching",
    Object.fromEntries(MATCHING_KEYS.map((key) => [key, settings.matching?.[key]])),
    { coerce: MATCHING_COERCE },
  );

  const weights = useSettingsSection(
    "matchWeights",
    Object.fromEntries(MATCH_FACTOR_KEYS.map((key) => [key, settings.matchWeights?.[key]])),
    { coerce: WEIGHT_COERCE },
  );

  const effective = normaliseWeights(weights.form);
  const rawTotal = MATCH_FACTOR_KEYS.reduce((sum, key) => sum + (Number(weights.form[key]) || 0), 0);

  return (
    <div className="space-y-8">
      <SectionForm
        onSubmit={weights.submit}
        pending={weights.pending}
        error={weights.error}
        fieldErrors={weights.fieldErrors}
        label="Save matching weights"
      >
        <Alert tone="info" title="Weights are relative" icon={<Sparkles className="size-3" />}>
          Enter whatever numbers make sense to you — they are rescaled to a total of 100 before
          scoring, so every match score stays comparable. The &ldquo;effective&rdquo; column is
          what will actually be used. Weights change the <em>order</em> tutors appear in; they can
          never surface an unapproved, suspended or out-of-area tutor.
        </Alert>

        <Card>
          <CardHeader
            title="Factor weights"
            description={`Current total: ${Math.round(rawTotal * 10) / 10}. Anything above zero works.`}
          />
          <CardBody className="space-y-5">
            {MATCH_FACTOR_KEYS.map((key) => (
              <Field
                key={key}
                label={MATCH_FACTOR_LABELS[key]}
                htmlFor={`weight-${key}`}
                hint={MATCH_FACTOR_HINTS[key]}
                error={weights.errorFor(key)}
              >
                <div className="flex items-center gap-3">
                  <Input
                    id={`weight-${key}`}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    step={1}
                    value={weights.form[key] ?? ""}
                    onChange={weights.set(key)}
                    error={weights.errorFor(key)}
                    className="max-w-28"
                  />
                  <span className="text-xs font-semibold tabular-nums text-ink-500">
                    effective {Math.round(effective[key])}%
                  </span>
                </div>
              </Field>
            ))}
          </CardBody>
        </Card>
      </SectionForm>

      <SectionForm
        onSubmit={controls.submit}
        pending={controls.pending}
        error={controls.error}
        fieldErrors={controls.fieldErrors}
        label="Save request rules"
      >
        <Card>
          <CardHeader
            title="Suggestions"
            description="How many tutors a request surfaces, and how many of them hear about it."
          />
          <CardBody className="space-y-5">
            <Field
              label="Minimum score to suggest"
              htmlFor="set-min-score"
              hint="0–100. Below this, a tutor is not shown to the family at all."
              error={controls.errorFor("minimumScore")}
            >
              <Input
                id="set-min-score"
                type="number"
                min={0}
                max={100}
                value={controls.form.minimumScore ?? ""}
                onChange={controls.set("minimumScore")}
                error={controls.errorFor("minimumScore")}
                className="max-w-32"
              />
            </Field>

            <Field
              label="Maximum suggestions per request"
              htmlFor="set-max-suggestions"
              error={controls.errorFor("maxSuggestions")}
            >
              <Input
                id="set-max-suggestions"
                type="number"
                min={1}
                max={100}
                value={controls.form.maxSuggestions ?? ""}
                onChange={controls.set("maxSuggestions")}
                error={controls.errorFor("maxSuggestions")}
                className="max-w-32"
              />
            </Field>

            <Field
              label="Tutors notified per request"
              htmlFor="set-notify-top"
              hint="The strongest matches are told a request exists. Set to 0 to notify nobody."
              error={controls.errorFor("notifyTopTutors")}
            >
              <Input
                id="set-notify-top"
                type="number"
                min={0}
                max={50}
                value={controls.form.notifyTopTutors ?? ""}
                onChange={controls.set("notifyTopTutors")}
                error={controls.errorFor("notifyTopTutors")}
                className="max-w-32"
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Request lifetime"
            description="How long a request stays open, and how many a family may hold at once."
          />
          <CardBody className="space-y-5">
            <Field
              label="Days a request stays open"
              htmlFor="set-ttl"
              hint="The request-expiry job closes it after this."
              error={controls.errorFor("requestTtlDays")}
            >
              <Input
                id="set-ttl"
                type="number"
                min={1}
                max={365}
                value={controls.form.requestTtlDays ?? ""}
                onChange={controls.set("requestTtlDays")}
                error={controls.errorFor("requestTtlDays")}
                className="max-w-32"
              />
            </Field>

            <Field
              label="Warn the family this many days before"
              htmlFor="set-warn"
              hint="Sent once per request. Set to 0 for no warning."
              error={controls.errorFor("requestExpiryWarningDays")}
            >
              <Input
                id="set-warn"
                type="number"
                min={0}
                max={60}
                value={controls.form.requestExpiryWarningDays ?? ""}
                onChange={controls.set("requestExpiryWarningDays")}
                error={controls.errorFor("requestExpiryWarningDays")}
                className="max-w-32"
              />
            </Field>

            <Field
              label="Open requests per family"
              htmlFor="set-max-open"
              error={controls.errorFor("maxOpenRequestsPerOwner")}
            >
              <Input
                id="set-max-open"
                type="number"
                min={1}
                max={100}
                value={controls.form.maxOpenRequestsPerOwner ?? ""}
                onChange={controls.set("maxOpenRequestsPerOwner")}
                error={controls.errorFor("maxOpenRequestsPerOwner")}
                className="max-w-32"
              />
            </Field>

            <Field
              label="Tutors a family may invite per request"
              htmlFor="set-max-invites"
              error={controls.errorFor("maxInvitesPerRequest")}
            >
              <Input
                id="set-max-invites"
                type="number"
                min={1}
                max={50}
                value={controls.form.maxInvitesPerRequest ?? ""}
                onChange={controls.set("maxInvitesPerRequest")}
                error={controls.errorFor("maxInvitesPerRequest")}
                className="max-w-32"
              />
            </Field>
          </CardBody>
        </Card>
      </SectionForm>
    </div>
  );
}
