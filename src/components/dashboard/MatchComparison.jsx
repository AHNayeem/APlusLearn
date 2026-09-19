"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, X, MessageSquare, CalendarDays, Send, Users } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/client";
import {
  Avatar, Badge, Button, Card, CardBody, EmptyState, Rating, useToast,
} from "@/components/ui";
import { formatRate, formatDistance } from "@/lib/utils/format";
import { MATCH_STATUS, MATCH_STATUS_LABELS, REQUEST_VISIBILITY } from "@/constants";
import { VerificationBadges } from "@/components/tutor/VerificationBadges";

/**
 * Compare tutors who responded to a request (§22).
 *
 * Interested tutors come first, then scored suggestions. Each card explains
 * *why* the tutor was matched, so the ranking is never a black box.
 */
export function MatchComparison({ matches, requestId, request }) {
  const router = useRouter();
  const toast = useToast();
  const [pendingId, setPendingId] = useState(null);

  const isOpen = request ? request.status === "OPEN" : true;
  const inviteOnly = request?.visibility === REQUEST_VISIBILITY.INVITE_ONLY;

  const respond = async (matchId, action) => {
    setPendingId(matchId);
    try {
      await api.patch(`/api/matches/${matchId}`, { action });
      toast.success(action === "SHORTLIST" ? "Shortlisted" : "Declined");
      router.refresh();
    } catch (error) {
      toast.error("Couldn't update", error.message);
    } finally {
      setPendingId(null);
    }
  };

  /**
   * Invite one suggested tutor. The same endpoint the bulk invite uses, so
   * the eligibility and cap checks are identical whichever way it is reached.
   */
  const invite = async (match) => {
    setPendingId(match.id);
    try {
      await api.post(`/api/requests/${requestId}/invite`, {
        tutorProfileIds: [match.tutor.id],
      });
      toast.success("Invitation sent", `${match.tutor.displayName} has been notified.`);
      router.refresh();
    } catch (error) {
      toast.error("Couldn't invite", error.message);
    } finally {
      setPendingId(null);
    }
  };

  if (matches.length === 0) {
    return (
      <EmptyState
        icon={<Users className="size-7" />}
        title="No matches yet"
        description="We've notified tutors who teach this course. Responses usually arrive within a day or two — we'll let you know."
        action={
          <Button href="/find-a-tutor" variant="secondary">
            Search tutors yourself
          </Button>
        }
      />
    );
  }

  const interested = matches.filter((m) =>
    [MATCH_STATUS.TUTOR_INTERESTED, MATCH_STATUS.SHORTLISTED, MATCH_STATUS.BOOKED].includes(m.status),
  );
  const invited = matches.filter((m) => m.status === MATCH_STATUS.INVITED);
  const suggested = matches.filter((m) => m.status === MATCH_STATUS.SUGGESTED);
  // Everything that has ended, whichever side ended it.
  const closed = matches.filter((m) =>
    [MATCH_STATUS.DECLINED, MATCH_STATUS.TUTOR_DECLINED, MATCH_STATUS.WITHDRAWN].includes(m.status),
  );

  return (
    <div className="space-y-8">
      {interested.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-bold text-ink-900">
            Tutors who responded ({interested.length})
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {interested.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                onRespond={respond}
                pending={pendingId === match.id}
              />
            ))}
          </div>
        </section>
      )}

      {invited.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-bold text-ink-900">
            Invited ({invited.length})
          </h2>
          <p className="mb-3 text-xs text-ink-500">
            You invited these tutors directly. We&rsquo;ll tell you as soon as they reply.
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {invited.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                onRespond={respond}
                pending={pendingId === match.id}
              />
            ))}
          </div>
        </section>
      )}

      {suggested.length > 0 && (
        <section>
          <h2 className="mb-1 text-sm font-bold text-ink-900">
            Suggested matches ({suggested.length})
          </h2>
          <p className="mb-3 text-xs text-ink-500">
            {inviteOnly
              ? "Your request is invite-only, so these tutors have not been told about it. Invite the ones you like."
              : "These tutors have been notified but haven't responded yet. You can invite or message them directly."}
          </p>
          <div className="grid gap-4 lg:grid-cols-2">
            {suggested.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                onRespond={respond}
                onInvite={isOpen ? invite : undefined}
                pending={pendingId === match.id}
              />
            ))}
          </div>
        </section>
      )}

      {closed.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-bold text-ink-400">
            Not going ahead ({closed.length})
          </h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {closed.map((match) => (
              <MatchCard key={match.id} match={match} onRespond={respond} muted />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function MatchCard({ match, onRespond, onInvite, pending, muted }) {
  const { tutor } = match;
  const isShortlisted = match.status === MATCH_STATUS.SHORTLISTED;
  const hasResponded = Boolean(match.message);

  return (
    <Card
      className={cn(
        "flex h-full flex-col",
        isShortlisted && "border-brand-300 ring-1 ring-brand-300",
        muted && "opacity-60",
      )}
    >
      <CardBody className="flex flex-1 flex-col">
        <div className="flex items-start gap-3">
          <Avatar src={tutor.avatarUrl} name={tutor.displayName} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <Link
                  href={`/tutors/${tutor.slug}`}
                  className="text-sm font-bold text-ink-900 hover:text-brand-700"
                >
                  {tutor.displayName}
                </Link>
                <p className="mt-0.5 line-clamp-1 text-xs text-ink-500">{tutor.headline}</p>
              </div>
              <Badge tone={match.score >= 80 ? "success" : "neutral"} size="sm">
                {match.score}% match
              </Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <Rating value={tutor.stats.ratingAverage} count={tutor.stats.ratingCount} size="sm" />
              <span className="text-xs font-bold text-ink-800">
                {formatRate(match.proposedRateCents ?? tutor.hourlyRateCents)}
              </span>
              {match.proposedRateCents && match.proposedRateCents !== tutor.hourlyRateCents && (
                <Badge tone="accent" size="sm">
                  Rate offered for you
                </Badge>
              )}
            </div>
          </div>
        </div>

        <div className="mt-3">
          <VerificationBadges types={tutor.verifiedTypes} max={3} compact />
        </div>

        {match.reasons?.length > 0 && (
          <ul className="mt-3 space-y-1">
            {match.reasons.map((reason) => (
              <li key={reason} className="flex items-center gap-1.5 text-xs text-ink-600">
                <Check className="size-3 shrink-0 text-success-600" />
                {reason}
              </li>
            ))}
          </ul>
        )}

        {match.message && (
          <blockquote className="mt-4 rounded-xl border-l-2 border-brand-300 bg-brand-50/50 p-3 text-sm leading-relaxed text-ink-600">
            {match.message}
          </blockquote>
        )}

        {match.status === MATCH_STATUS.TUTOR_DECLINED && (
          <p className="mt-3 text-xs italic text-ink-500">
            This tutor declined{match.declineReason ? `: “${match.declineReason}”` : "."}
          </p>
        )}
        {match.status === MATCH_STATUS.WITHDRAWN && (
          <p className="mt-3 text-xs italic text-ink-500">This tutor withdrew their reply.</p>
        )}
        {!hasResponded && match.status === MATCH_STATUS.SUGGESTED && (
          <p className="mt-3 text-xs italic text-ink-400">
            Suggested by our matching service — hasn&rsquo;t responded yet.
          </p>
        )}
        {match.status === MATCH_STATUS.INVITED && (
          <p className="mt-3 text-xs italic text-ink-400">Invited — waiting for a reply.</p>
        )}

        <div className="mt-auto flex flex-wrap gap-2 border-t border-ink-100 pt-4">
          <Button
            href={`/messages?tutor=${tutor.id}`}
            variant="secondary"
            size="sm"
            iconLeft={<MessageSquare className="size-3.5" />}
          >
            Message
          </Button>
          <Button
            href={`/tutors/${tutor.slug}#availability`}
            size="sm"
            iconLeft={<CalendarDays className="size-3.5" />}
          >
            Book
          </Button>

          {!muted && onInvite && !hasResponded && (
            <Button
              variant="subtle"
              size="sm"
              loading={pending}
              onClick={() => onInvite(match)}
              iconLeft={<Send className="size-3.5" />}
            >
              Invite
            </Button>
          )}

          {!muted && hasResponded && !isShortlisted && (
            <>
              <Button
                variant="ghost"
                size="sm"
                loading={pending}
                onClick={() => onRespond(match.id, "SHORTLIST")}
              >
                Shortlist
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onRespond(match.id, "DECLINE")}
                iconLeft={<X className="size-3.5" />}
              >
                Decline
              </Button>
            </>
          )}
          {isShortlisted && (
            <Badge tone="brand" className="self-center">
              Shortlisted
            </Badge>
          )}
          {muted && (
            <Badge tone="neutral" className="self-center">
              {MATCH_STATUS_LABELS[match.status]}
            </Badge>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
