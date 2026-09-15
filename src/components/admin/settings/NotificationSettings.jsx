"use client";

import { ShieldAlert } from "lucide-react";
import { Alert, Card, CardBody, CardHeader, Switch } from "@/components/ui";
import { useSettingsSection } from "./useSettingsSection";
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

export function NotificationSettings({ settings }) {
  const s = useSettingsSection("notifications", { ...settings.notifications });
  const allOff = s.form.emailEnabled === false;

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
    </SectionForm>
  );
}
