"use client";

import { ShieldAlert } from "lucide-react";
import { Alert, Card, CardBody, CardHeader, Field, Input, Switch } from "@/components/ui";
import { useSettingsSection, toNumber } from "./useSettingsSection";
import { SectionForm } from "./SectionForm";

/**
 * Platform communication settings (§26, §28).
 *
 * These are a layer above each person's own preferences, not a replacement for
 * them: an individual who has turned email off still gets none, and a category
 * switched off here reaches nobody. In-app notifications are always written
 * either way, so nothing is lost — only the email is suppressed.
 */
const CATEGORIES = [
  {
    key: "bookingEmails",
    label: "Booking email",
    description: "Confirmations, changes, cancellations, reminders and refunds.",
  },
  {
    key: "applicationEmails",
    label: "Tutor application email",
    description: "Submission acknowledgements, approvals and requests for more information.",
  },
  { key: "reviewEmails", label: "Review email", description: "Notifying a tutor of a new review." },
  { key: "payoutEmails", label: "Payout email", description: "Payout setup and payment confirmations." },
  {
    key: "announcementEmails",
    label: "System announcements",
    description: "Anything that isn't one of the categories above.",
  },
];

export function NotificationSettings({ settings, smsProvider }) {
  const s = useSettingsSection(
    "notifications",
    { ...settings.notifications },
    { coerce: { smsPerNumberHourlyLimit: toNumber } },
  );
  const allOff = s.form.emailEnabled === false;
  const smsOff = s.form.smsEnabled === false;

  return (
    <SectionForm onSubmit={s.submit} pending={s.pending} error={s.error} fieldErrors={s.fieldErrors}>
      <Alert tone="warning" title="Security email cannot be switched off" icon={<ShieldAlert className="size-3" />}>
        Email verification, password resets and &ldquo;your password was changed&rdquo; alerts are
        sent regardless of everything on this page. They are how someone keeps control of their
        account, so there is deliberately no switch for them.
      </Alert>

      <Card>
        <CardHeader title="Email delivery" description="The master switch for non-security email." />
        <CardBody>
          <div className="rounded-xl border border-ink-200 p-4">
            <Switch
              label="Send notification email"
              description="With this off, notifications are still written in-app — no email leaves the platform."
              checked={s.form.emailEnabled !== false}
              onChange={s.set("emailEnabled")}
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="By category"
          description="Each person's own notification preferences still apply on top of these."
        />
        <CardBody className="space-y-4">
          {CATEGORIES.map((category) => (
            <div
              key={category.key}
              className={`rounded-xl border border-ink-200 p-4 ${allOff ? "opacity-60" : ""}`}
            >
              <Switch
                label={category.label}
                description={category.description}
                checked={s.form[category.key] !== false}
                onChange={s.set(category.key)}
                disabled={allOff}
              />
            </div>
          ))}
          {allOff && (
            <p className="text-xs text-ink-500">
              Individual categories are inactive while email delivery is switched off.
            </p>
          )}
        </CardBody>
      </Card>
      <Card>
        <CardHeader
          title="Text messages"
          description="Only lesson events are ever texted, and only to a number its owner has confirmed."
        />
        <CardBody className="space-y-4">
          {smsProvider && !smsProvider.ok ? (
            <Alert tone="danger" title="SMS is misconfigured">
              {smsProvider.error}
            </Alert>
          ) : smsProvider?.mode === "development" ? (
            <Alert tone="warning" title="No SMS provider is configured">
              Texts will be written to the delivery log and printed to the server console, but no
              carrier will receive them. Set <code>SMS_PROVIDER</code> and its credentials to send
              real messages.
            </Alert>
          ) : null}

          <div className="rounded-xl border border-ink-200 p-4">
            <Switch
              label="Send notification texts"
              description="With this off, nobody is texted — whatever they have chosen for themselves."
              checked={s.form.smsEnabled === true}
              onChange={s.set("smsEnabled")}
            />
          </div>

          <Field
            label="Maximum texts per number per hour"
            htmlFor="set-sms-limit"
            hint="Guards both the bill and the recipient. 0 removes the limit."
            error={s.errorFor("smsPerNumberHourlyLimit")}
          >
            <Input
              id="set-sms-limit"
              type="number"
              min={0}
              max={50}
              value={s.form.smsPerNumberHourlyLimit ?? ""}
              onChange={s.set("smsPerNumberHourlyLimit")}
              error={s.errorFor("smsPerNumberHourlyLimit")}
              disabled={smsOff}
              className="max-w-32"
            />
          </Field>
        </CardBody>
      </Card>
    </SectionForm>
  );
}
