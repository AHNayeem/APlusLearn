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
 * Modelled on Stripe Connect's onboarding: start → provider collects details
 * → account becomes payable. The development provider completes on request.
 */
export function PayoutOnboarding({ account }) {
  const router = useRouter();
  const toast = useToast();

  const { submit: start, pending: starting } = useSubmit(async () => {
    const result = await api.post("/api/payouts/account", { action: "START" });
    toast.success("Payout setup started", "Complete the details to enable payouts.");
    router.refresh();
    return result;
  });

  const { submit: complete, pending: completing } = useSubmit(async () => {
    await api.post("/api/payouts/account", { action: "COMPLETE" });
    toast.success("Payouts enabled", "Your earnings will now be sent automatically.");
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
        <Alert tone="info" title="Development payment provider" className="mb-4">
          No real bank details are collected. In production this hands off to Stripe Connect, which
          collects and verifies them directly — we never see or store them.
        </Alert>

        {account?.onboardingStatus === "IN_PROGRESS" ? (
          <>
            <p className="mb-4 text-sm text-ink-600">
              Your account is created but not yet verified.
              {account.requirementsDue?.length > 0 && (
                <span className="mt-2 block">
                  Still needed:{" "}
                  {account.requirementsDue.map((r) => r.replace(/_/g, " ")).join(", ")}
                </span>
              )}
            </p>
            <Button
              onClick={complete}
              loading={completing}
              iconRight={<ArrowRight className="size-4" />}
            >
              Complete verification
            </Button>
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
