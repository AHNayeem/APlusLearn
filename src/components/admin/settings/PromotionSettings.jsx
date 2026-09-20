"use client";

import { Megaphone } from "lucide-react";
import { Alert, Card, CardBody, CardHeader, Field, Input, Switch } from "@/components/ui";
import { PAGE_SIZES } from "@/constants";
import { useSettingsSection, toNumber } from "./useSettingsSection";
import { SectionForm } from "./SectionForm";

const NUMERIC = [
  "maxPromotedPerSearch",
  "maxActive",
  "defaultDurationDays",
  "maxDurationDays",
];

const COERCE = Object.fromEntries(NUMERIC.map((key) => [key, toNumber]));

/**
 * Promoted profiles (§41 Phase 2).
 *
 * Two of the rules that make this feature defensible are not on this panel,
 * because they are not an operator's to change: a promoted result is always
 * labelled, and a promotion never overrides an ordering the visitor chose for
 * themselves. The panel says so, so nobody goes looking for the switch.
 */
export function PromotionSettings({ settings }) {
  const s = useSettingsSection("promotions", { ...settings.promotions }, { coerce: COERCE });

  const off = s.form.enabled === false;
  const perSearch = Number(s.form.maxPromotedPerSearch) || 0;

  return (
    <SectionForm
      onSubmit={s.submit}
      pending={s.pending}
      error={s.error}
      fieldErrors={s.fieldErrors}
      label="Save promotion rules"
    >
      <Alert
        tone="info"
        title="What a promotion can and cannot do"
        icon={<Megaphone className="size-3" />}
      >
        A promotion lifts an already-eligible tutor up the default &ldquo;Best match&rdquo;
        ordering. It never makes an unapproved or hidden profile visible, never changes a
        visitor&rsquo;s own sort order, and every promoted result carries a
        &ldquo;Promoted&rdquo; label. None of those three is configurable.
      </Alert>

      <Card>
        <CardHeader title="Availability" />
        <CardBody>
          <div className="rounded-xl border border-ink-200 p-4">
            <Switch
              label="Promoted profiles are available"
              description="With this off, no new promotion can be created and running ones stop affecting search. The records are kept."
              checked={s.form.enabled !== false}
              onChange={s.set("enabled")}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="How much of a page a promotion may take"
          description="The fairness ceiling. However many promotions are running, only this many results are lifted in any one set."
        />
        <CardBody className="space-y-5">
          <Field
            label="Promoted results per set of results"
            htmlFor="set-max-promoted"
            hint={
              perSearch === 0
                ? "0 means promotions are recorded but change nothing."
                : `${perSearch} of a ${PAGE_SIZES.tutorSearch}-result page.`
            }
            error={s.errorFor("maxPromotedPerSearch")}
          >
            <Input
              id="set-max-promoted"
              type="number"
              min={0}
              max={10}
              value={s.form.maxPromotedPerSearch ?? ""}
              onChange={s.set("maxPromotedPerSearch")}
              error={s.errorFor("maxPromotedPerSearch")}
              disabled={off}
              className="max-w-32"
            />
          </Field>

          <Field
            label="Promotions that may run at the same time"
            htmlFor="set-max-active"
            hint="A marketplace-wide ceiling. Past it, a new promotion is refused until one ends."
            error={s.errorFor("maxActive")}
          >
            <Input
              id="set-max-active"
              type="number"
              min={0}
              max={500}
              value={s.form.maxActive ?? ""}
              onChange={s.set("maxActive")}
              error={s.errorFor("maxActive")}
              disabled={off}
              className="max-w-32"
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="How long a promotion runs"
          description="Every promotion has an end date. There is no indefinite placement."
        />
        <CardBody className="space-y-5">
          <Field
            label="Default window, in days"
            htmlFor="set-promotion-default-days"
            hint="Used when an administrator does not name an end date."
            error={s.errorFor("defaultDurationDays")}
          >
            <Input
              id="set-promotion-default-days"
              type="number"
              min={1}
              max={365}
              value={s.form.defaultDurationDays ?? ""}
              onChange={s.set("defaultDurationDays")}
              error={s.errorFor("defaultDurationDays")}
              disabled={off}
              className="max-w-32"
            />
          </Field>

          <Field
            label="Longest window that can be set at once, in days"
            htmlFor="set-promotion-max-days"
            hint="A longer placement is still possible — it has to be extended deliberately, which leaves an audit trail."
            error={s.errorFor("maxDurationDays")}
          >
            <Input
              id="set-promotion-max-days"
              type="number"
              min={1}
              max={365}
              value={s.form.maxDurationDays ?? ""}
              onChange={s.set("maxDurationDays")}
              error={s.errorFor("maxDurationDays")}
              disabled={off}
              className="max-w-32"
            />
          </Field>
        </CardBody>
      </Card>
    </SectionForm>
  );
}
