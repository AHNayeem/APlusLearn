"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { User, Bell, Lock, Trash2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Card, CardBody, CardHeader, Field, Input, Select, Switch,
  Modal, FormErrorSummary, useToast,
} from "@/components/ui";
import { CANADIAN_TIMEZONES } from "@/lib/utils/time";
import { NOTIFICATION_CHANNELS } from "@/constants";

/** Profile, notifications, password and account deletion (§24, §35). */
export function SettingsPanels({ user }) {
  return (
    <div className="max-w-2xl space-y-6">
      <ProfilePanel user={user} />
      <NotificationPanel user={user} />
      <PasswordPanel />
      <DangerPanel user={user} />
    </div>
  );
}

function ProfilePanel({ user }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({
    firstName: user.firstName ?? "",
    lastName: user.lastName ?? "",
    phone: user.phone ?? "",
    city: user.city ?? "",
    province: user.province ?? "ON",
    postalCode: user.postalCode ?? "",
    timeZone: user.timeZone ?? "America/Toronto",
  });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.patch("/api/users/me", {
      ...form,
      phone: form.phone || undefined,
      postalCode: form.postalCode || undefined,
    });
    toast.success("Profile updated");
    router.refresh();
  });

  return (
    <Card id="profile">
      <CardHeader
        title="Your details"
        description="Tutors only ever see your first name and last initial."
      />
      <CardBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-5"
        >
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="First name" htmlFor="set-first" error={fieldErrors.firstName}>
              <Input id="set-first" value={form.firstName} onChange={set("firstName")} error={fieldErrors.firstName} />
            </Field>
            <Field label="Last name" htmlFor="set-last" error={fieldErrors.lastName}>
              <Input id="set-last" value={form.lastName} onChange={set("lastName")} error={fieldErrors.lastName} />
            </Field>
          </div>

          <Field
            label="Email address"
            htmlFor="set-email"
            hint="Contact support to change the email on your account."
          >
            <Input id="set-email" value={user.email} disabled readOnly />
          </Field>

          <Field label="Phone" htmlFor="set-phone" hint="Optional" error={fieldErrors.phone}>
            <Input
              id="set-phone"
              type="tel"
              value={form.phone}
              onChange={set("phone")}
              error={fieldErrors.phone}
              placeholder="416 555 0142"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" htmlFor="set-city" error={fieldErrors.city}>
              <Input id="set-city" value={form.city} onChange={set("city")} error={fieldErrors.city} />
            </Field>
            <Field label="Province" htmlFor="set-province">
              <Select id="set-province" value={form.province} onChange={set("province")}>
                {["ON", "BC", "AB", "QC", "MB", "SK", "NS", "NB", "NL", "PE", "NT", "NU", "YT"].map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
              </Select>
            </Field>
            <Field label="Postal code" htmlFor="set-postal" error={fieldErrors.postalCode}>
              <Input
                id="set-postal"
                value={form.postalCode}
                onChange={(e) => setForm((f) => ({ ...f, postalCode: e.target.value.toUpperCase() }))}
                error={fieldErrors.postalCode}
                placeholder="M5V 2K3"
              />
            </Field>
          </div>

          <Field
            label="Timezone"
            htmlFor="set-tz"
            hint="Lesson times are shown in this timezone."
          >
            <Select id="set-tz" value={form.timeZone} onChange={set("timeZone")}>
              {CANADIAN_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>{tz.label}</option>
              ))}
            </Select>
          </Field>

          <Button type="submit" loading={pending}>
            Save changes
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function NotificationPanel({ user }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState(user.notificationPreferences ?? {});

  const toggle = async (channel, enabled) => {
    setPrefs((p) => ({ ...p, [channel]: enabled }));
    try {
      await api.patch("/api/users/me/notifications", { [channel]: enabled });
    } catch (error) {
      setPrefs((p) => ({ ...p, [channel]: !enabled }));
      toast.error("Couldn't save that", error.message);
    }
  };

  const CHANNELS = [
    {
      key: NOTIFICATION_CHANNELS.IN_APP,
      label: "In-app notifications",
      description: "Always on — this is your notification centre.",
      locked: true,
    },
    {
      key: NOTIFICATION_CHANNELS.EMAIL,
      label: "Email",
      description: "Booking confirmations, cancellations and refunds.",
    },
    {
      key: NOTIFICATION_CHANNELS.SMS,
      label: "Text message",
      description: "Lesson reminders by SMS.",
      comingSoon: true,
    },
    {
      key: NOTIFICATION_CHANNELS.PUSH,
      label: "Push notifications",
      description: "Requires the mobile app.",
      comingSoon: true,
    },
  ];

  return (
    <Card id="notifications">
      <CardHeader title="Notifications" description="Choose how we reach you." />
      <CardBody className="space-y-5">
        {CHANNELS.map((channel) => (
          <Switch
            key={channel.key}
            label={channel.label}
            description={
              channel.comingSoon ? `${channel.description} Coming soon.` : channel.description
            }
            checked={channel.locked ? true : (prefs[channel.key] ?? false)}
            disabled={channel.locked || channel.comingSoon}
            onChange={(e) => toggle(channel.key, e.target.checked)}
          />
        ))}
      </CardBody>
    </Card>
  );
}

function PasswordPanel() {
  const toast = useToast();
  const [form, setForm] = useState({ currentPassword: "", password: "", confirmPassword: "" });
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.patch("/api/auth/password", form);
    toast.success("Password updated", "You've been signed out of other devices.");
    setForm({ currentPassword: "", password: "", confirmPassword: "" });
  });

  return (
    <Card id="password">
      <CardHeader
        title="Password"
        description="Changing your password signs you out everywhere else."
      />
      <CardBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-5"
        >
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />

          <Field
            label="Current password"
            htmlFor="current-password"
            error={fieldErrors.currentPassword}
            required
          >
            <Input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={form.currentPassword}
              onChange={set("currentPassword")}
              error={fieldErrors.currentPassword}
              iconLeft={<Lock className="size-4" />}
            />
          </Field>

          <Field label="New password" htmlFor="new-pw" error={fieldErrors.password} required>
            <Input
              id="new-pw"
              type="password"
              autoComplete="new-password"
              value={form.password}
              onChange={set("password")}
              error={fieldErrors.password}
              iconLeft={<Lock className="size-4" />}
            />
          </Field>

          <Field
            label="Confirm new password"
            htmlFor="confirm-pw"
            error={fieldErrors.confirmPassword}
            required
          >
            <Input
              id="confirm-pw"
              type="password"
              autoComplete="new-password"
              value={form.confirmPassword}
              onChange={set("confirmPassword")}
              error={fieldErrors.confirmPassword}
              iconLeft={<Lock className="size-4" />}
            />
          </Field>

          <Button type="submit" loading={pending} disabled={!form.currentPassword || !form.password}>
            Update password
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

function DangerPanel({ user }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post("/api/users/me/delete", { confirmation, password });
    toast.success("Account deleted");
    router.push("/");
    router.refresh();
  });

  return (
    <>
      <Card id="danger" className="border-danger-200">
        <CardHeader
          title="Delete your account"
          description="Your lesson history and receipts are kept for accounting, but every personal detail is removed."
        />
        <CardBody>
          <Alert tone="warning" title="This cannot be undone" className="mb-4">
            You&rsquo;ll need to cancel any upcoming lessons first. Past bookings stay on record in
            anonymised form, as tax rules require.
          </Alert>
          <Button variant="danger" onClick={() => setOpen(true)} iconLeft={<Trash2 className="size-4" />}>
            Delete my account
          </Button>
        </CardBody>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account"
        description="This permanently removes your personal information."
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={submit}
              loading={pending}
              disabled={confirmation !== "DELETE MY ACCOUNT"}
            >
              Delete permanently
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />

          <Field
            label="Type DELETE MY ACCOUNT to confirm"
            htmlFor="delete-confirm"
            error={fieldErrors.confirmation}
            required
          >
            <Input
              id="delete-confirm"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              error={fieldErrors.confirmation}
              placeholder="DELETE MY ACCOUNT"
              autoComplete="off"
            />
          </Field>

          <Field label="Your password" htmlFor="delete-password" error={fieldErrors.password}>
            <Input
              id="delete-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={fieldErrors.password}
              iconLeft={<Lock className="size-4" />}
            />
          </Field>
        </div>
      </Modal>
    </>
  );
}
