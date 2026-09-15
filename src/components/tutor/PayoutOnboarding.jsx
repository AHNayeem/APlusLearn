"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Banknote, Check, ArrowRight } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { Alert, Badge, Button, Card, CardBody, CardHeader, useToast } from "@/components/ui";

/**
 * Payout account setup (§20, §38).
 *
 * Start → the provider collects and verifies the details → the account
 * becomes payable. With Stripe Connect the details are collected on Stripe's
 * own hosted pages, so this component hands off to `onboardingUrl` and never
 * sees a bank account; the development provider keeps the flow in-app.
 */
export function PayoutOnboarding({ account, mode = "development" }) {
  const router = useRouter();
  const toast = useToast();
  const hosted = mode === "production";

  const { submit: start, pending: starting } = useSubmit(async () => {
    const result = await api.post("/api/payouts/account", { action: "START" });
    const url = result.account?.onboardingUrl;

    // A hosted provider returns an absolute URL to its own onboarding.
    if (hosted && /^https?:\/\//.test(url ?? "")) {
      window.location.href = url;
      return result;
    }

    toast.success("Payout setup started", "Complete the details to enable payouts.");
    router.refresh();
    return result;
  });

  const { submit: complete, pending: completing } = useSubmit(async () => {
    const result = await api.post("/api/payouts/account", { action: "REFRESH" });
    if (result.account?.payoutsEnabled) {
      toast.success("Payouts enabled", "Your earnings will now be sent automatically.");
    } else {
      toast.info(
        "Not verified yet",
        result.account?.requirementsDue?.length
          ? `Still needed: ${result.account.requirementsDue.map((r) => r.replace(/_/g, " ")).join(", ")}.`
          : "Our payments partner is still reviewing your details.",
      );
    }
    router.refresh();
  });

  if (account?.payoutsEnabled) {
    return (
      <Card>
        <CardHeader
          title="Payout account"
          action={<Badge tone="success" icon={<Check className="size-3" />}>Active</Badge>}
        />
        <CardBody>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Bank</dt>
              <dd className="font-semibold text-ink-900">{account.bankName ?? "Connected"}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Account</dt>
              <dd className="font-semibold text-ink-900">
                {account.accountLast4 ? `···· ${account.accountLast4}` : "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink-500">Currency</dt>
              <dd className="font-semibold text-ink-900">{account.currency ?? "CAD"}</dd>
            </div>
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-ink-500">
            Payouts are sent automatically once a lesson clears its hold period. You&rsquo;ll get a
            notification each time one goes out.
          </p>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className="border-brand-200">
      <CardHeader
        title="Set up payouts"
        description="Connect where your earnings should be sent."
      />
      <CardBody>
        {hosted ? (
          <Alert tone="info" title="Verified by Stripe" className="mb-4">
            Your identity and bank details are collected and verified by Stripe on their own secure
            pages. They are never sent to or stored by APlus Learn.
          </Alert>
        ) : (
          <Alert tone="info" title="Development payment provider" className="mb-4">
            No real bank details are collected. In production this hands off to Stripe Connect,
            which collects and verifies them directly — we never see or store them.
          </Alert>
        )}

        {account?.onboardingStatus === "IN_PROGRESS" ? (
          <>
            <p className="mb-4 text-sm text-ink-600">
              Your account is created but not yet verified.
              {account.disabledReason && (
                <span className="mt-2 block">
                  Reason given: {account.disabledReason.replace(/_/g, " ")}
                </span>
              )}
              {account.requirementsDue?.length > 0 && (
                <span className="mt-2 block">
                  Still needed:{" "}
                  {account.requirementsDue.map((r) => r.replace(/_/g, " ")).join(", ")}
                </span>
              )}
            </p>
            <div className="flex flex-wrap gap-2">
              {hosted && (
                <Button
                  onClick={start}
                  loading={starting}
                  iconRight={<ArrowRight className="size-4" />}
                >
                  Continue setup
                </Button>
              )}
              <Button
                variant={hosted ? "secondary" : "primary"}
                onClick={complete}
                loading={completing}
                iconRight={hosted ? undefined : <ArrowRight className="size-4" />}
              >
                {hosted ? "Refresh status" : "Complete verification"}
              </Button>
            </div>
          </>
        ) : (
          <Button
            onClick={start}
            loading={starting}
            size="lg"
            iconLeft={<Banknote className="size-4" />}
          >
            Set up payouts
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
