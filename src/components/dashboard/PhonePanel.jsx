"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Smartphone, CheckCircle2, Trash2 } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input,
  FormErrorSummary, useToast,
} from "@/components/ui";

/**
 * Confirming a mobile number, so text notifications can be switched on
 * (§28, §41 Phase 2).
 *
 * Two steps, deliberately: a number is only trusted once a code sent *to it*
 * comes back. Until then nothing is texted to it, which is what stops a typo
 * sending a family's lesson times to a stranger.
 *
 * When the deployment has no carrier configured, the panel says so plainly
 * rather than leaving someone waiting for a message that was never sent.
 */
export function PhonePanel({ user }) {
  const router = useRouter();
  const toast = useToast();

  const verified = Boolean(user.phoneVerifiedAt);
  const optedOut = Boolean(user.smsOptOutAt);

  const [phone, setPhone] = useState(user.phone ?? "");
  const [code, setCode] = useState("");
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [simulated, setSimulated] = useState(false);

  const send = useSubmit(async () => {
    const result = await api.post("/api/users/me/phone", { phone });
    setAwaitingCode(true);
    setSimulated(result.providerConfigured === false);
    toast.success(
      result.providerConfigured ? "Code sent" : "Code generated",
      result.providerConfigured
        ? `Check ${phone} for a 6-digit code.`
        : "No SMS provider is configured on this deployment, so nothing was actually texted.",
    );
    return result;
  });

  const confirm = useSubmit(async () => {
    await api.patch("/api/users/me/phone", { code });
    toast.success("Mobile number confirmed", "Text notifications are now on.");
    setAwaitingCode(false);
    setCode("");
    router.refresh();
  });

  const remove = useSubmit(async () => {
    await api.delete("/api/users/me/phone");
    toast.success("Mobile number removed", "We'll stop sending you texts.");
    setPhone("");
    setAwaitingCode(false);
    router.refresh();
  });

  return (
    <Card id="phone">
      <CardHeader
        title="Mobile number"
        description="Confirm a number to receive lesson reminders and changes by text."
      />
      <CardBody className="space-y-5">
        {verified && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-success-200 bg-success-50/60 p-3">
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2 className="size-4 text-success-600" />
              <span className="font-semibold text-ink-800">{user.phone}</span>
              <Badge tone="success" size="sm">
                Confirmed
              </Badge>
            </div>
            <Button
              variant="dangerGhost"
              size="xs"
              onClick={remove.submit}
              loading={remove.pending}
              iconLeft={<Trash2 className="size-3.5" />}
            >
              Remove
            </Button>
          </div>
        )}

        {optedOut && (
          <Alert tone="warning" title="This number replied STOP">
            We can&rsquo;t text this number until you text START back to us. Your in-app and email
            notifications are unaffected.
          </Alert>
        )}

        {simulated && awaitingCode && (
          <Alert tone="warning" title="No SMS provider is configured here">
            The code was generated but not sent to a carrier. On a production deployment with an
            SMS provider configured, it would arrive as a text.
          </Alert>
        )}

        {!verified && !awaitingCode && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send.submit();
            }}
            className="space-y-4"
          >
            <FormErrorSummary error={send.error} fieldErrors={send.fieldErrors} />
            <Field
              label="Mobile number"
              htmlFor="phone-number"
              hint="Canadian mobile numbers only. Standard message rates apply."
              error={send.fieldErrors.phone}
              required
            >
              <Input
                id="phone-number"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                error={send.fieldErrors.phone}
                placeholder="(416) 555-0142"
              />
            </Field>
            <Button
              type="submit"
              loading={send.pending}
              disabled={!phone.trim()}
              iconLeft={<Smartphone className="size-4" />}
            >
              Send confirmation code
            </Button>
          </form>
        )}

        {awaitingCode && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              confirm.submit();
            }}
            className="space-y-4"
          >
            <FormErrorSummary error={confirm.error} fieldErrors={confirm.fieldErrors} />
            <Field
              label="Confirmation code"
              htmlFor="phone-code"
              hint="Six digits, valid for 10 minutes."
              error={confirm.fieldErrors.code}
              required
            >
              <Input
                id="phone-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                error={confirm.fieldErrors.code}
                placeholder="123456"
                className="max-w-40 tracking-[0.3em]"
              />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={confirm.pending} disabled={code.length !== 6}>
                Confirm number
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={send.submit}
                loading={send.pending}
              >
                Send a new code
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAwaitingCode(false)}>
                Use a different number
              </Button>
            </div>
          </form>
        )}

        {verified && (
          <p className="text-xs leading-relaxed text-ink-500">
            We only text you about lessons — confirmations, changes, cancellations, reminders and
            refunds. Reply STOP to any message to opt out at any time.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
