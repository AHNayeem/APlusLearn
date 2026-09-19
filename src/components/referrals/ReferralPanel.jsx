"use client";

import { useState } from "react";
import { Copy, Check, Gift, Share2 } from "lucide-react";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, StatCard, useToast,
} from "@/components/ui";
import { REFERRAL_STATUS, REFERRAL_STATUS_LABELS } from "@/constants";
import { formatMoney, formatRelative } from "@/lib/utils/format";

/**
 * A person's referral page (§41 Phase 2).
 *
 * The reward amounts come from platform settings rather than being written
 * into the copy, so an operator who has not priced referrals sees an honest
 * "invite a friend" page instead of a promise of money that will never
 * arrive.
 */
export function ReferralPanel({ summary, creditBalanceCents, shareUrl }) {
  const toast = useToast();
  const [copied, setCopied] = useState(null);

  const { code, rewards, stats, referrals, referredBy, enabled } = summary;
  const hasReward = rewards.referrerRewardCents > 0 || rewards.refereeRewardCents > 0;

  const copy = async (value, what) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      toast.success("Copied", what === "link" ? "Share it anywhere." : "Your code is on the clipboard.");
      setTimeout(() => setCopied(null), 2000);
    } catch {
      toast.error("Couldn't copy", "Select the text and copy it manually.");
    }
  };

  const share = async () => {
    if (!navigator.share) return copy(shareUrl, "link");
    try {
      await navigator.share({
        title: "Join me on APlus Learn",
        text: hasReward
          ? `Use my code ${code} when you sign up.`
          : `I'm using APlus Learn to find tutors — use my code ${code}.`,
        url: shareUrl,
      });
    } catch {
      // The person dismissed the share sheet. Not an error.
    }
    return undefined;
  };

  return (
    <div className="space-y-6">
      {!enabled && (
        <Alert tone="neutral" title="Referrals are paused">
          Your code is kept, but it is not accepting new sign-ups right now.
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Credit balance" value={formatMoney(creditBalanceCents)} />
        <StatCard label="People who joined" value={stats.joined} />
        <StatCard
          label="Credit earned"
          value={formatMoney(stats.earnedCents)}
          hint={stats.pending ? `${stats.pending} still to qualify` : undefined}
        />
      </div>

      <Card>
        <CardHeader
          title="Your code"
          description={
            hasReward
              ? `They get ${formatMoney(rewards.refereeRewardCents)} to start, and you get ${formatMoney(rewards.referrerRewardCents)} once they've taken ${rewards.qualifyingLessons} lesson${rewards.qualifyingLessons === 1 ? "" : "s"}.`
              : "Share it with anyone looking for a tutor."
          }
        />
        <CardBody className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <code className="rounded-xl bg-ink-900 px-5 py-3 font-mono text-lg font-bold tracking-[0.2em] text-white">
              {code}
            </code>
            <Button
              variant="secondary"
              onClick={() => copy(code, "code")}
              iconLeft={copied === "code" ? <Check className="size-4" /> : <Copy className="size-4" />}
            >
              {copied === "code" ? "Copied" : "Copy code"}
            </Button>
            <Button
              variant="secondary"
              onClick={share}
              iconLeft={<Share2 className="size-4" />}
            >
              Share link
            </Button>
          </div>

          <div className="rounded-xl border border-ink-200 bg-ink-50 p-3">
            <p className="text-xs font-semibold text-ink-500">Your link</p>
            <p className="mt-1 break-all font-mono text-xs text-ink-700">{shareUrl}</p>
          </div>

          {hasReward && (
            <p className="text-xs leading-relaxed text-ink-500">
              Credit comes off your next booking automatically. It is funded by us — your tutor is
              always paid in full.
            </p>
          )}

          {referredBy && (
            <p className="text-xs text-ink-500">
              You joined through {referredBy}&rsquo;s invitation.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="People who used your code" />
        <CardBody className="p-0">
          {referrals.length === 0 ? (
            <EmptyState
              icon={<Gift className="size-7" />}
              title="Nobody yet"
              description="Share your code with anyone looking for a tutor. We'll tell you when they join."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {referrals.map((referral) => (
                <li
                  key={referral.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-800">{referral.name}</p>
                    <p className="text-xs text-ink-500">
                      Joined {formatRelative(referral.joinedAt)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {referral.rewardCents > 0 && (
                      <span className="text-sm font-bold text-success-700">
                        +{formatMoney(referral.rewardCents)}
                      </span>
                    )}
                    <Badge
                      tone={
                        referral.status === REFERRAL_STATUS.REWARDED
                          ? "success"
                          : referral.status === REFERRAL_STATUS.REVERSED
                            ? "danger"
                            : "neutral"
                      }
                      size="sm"
                    >
                      {REFERRAL_STATUS_LABELS[referral.status]}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
