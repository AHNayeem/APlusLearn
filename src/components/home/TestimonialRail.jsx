"use client";

import { useState } from "react";
import { Pause, Play, Quote } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Badge, Rating } from "@/components/ui";

/**
 * The reviews rail (§12).
 *
 * A grid of six quotes asks a parent to start reading six times. A rail that
 * drifts asks once, and carries the real point of the section — that there are
 * more of these than fit on a screen — without a "1 of 24" counter.
 *
 * Three things keep it from becoming the carousel everyone hates:
 *
 *  - It pauses on hover, on focus and on an explicit button, so nothing ever
 *    slides out from under someone mid-sentence (WCAG 2.2.2 wants a control,
 *    not just a hover).
 *  - The set is rendered twice and the track travels half its width, so the
 *    loop closes rather than snapping back.
 *  - Under `prefers-reduced-motion` the rail stops being a rail: the CSS in
 *    `globals.css` drops the clone and turns it into an ordinary scroller, and
 *    the pause button — meaningless once nothing moves — hides itself.
 *
 * The client boundary exists only for that pause button; everything else is
 * CSS, so the cards are server-rendered like the rest of the page.
 */
function ReviewCard({ review }) {
  return (
    <figure
      className={cn(
        "relative flex h-full w-[19.5rem] flex-col overflow-hidden rounded-2xl",
        "border border-ink-200 bg-white p-6 shadow-sm sm:w-[22rem]",
      )}
    >
      <Quote
        className="pointer-events-none absolute -top-2 right-3 size-16 text-brand-50"
        aria-hidden="true"
      />

      <Rating value={review.rating} showValue={false} className="relative" />

      {review.title && (
        <figcaption className="relative mt-4 text-sm font-bold tracking-tight text-ink-900">
          {review.title}
        </figcaption>
      )}

      <blockquote className="relative mt-2 line-clamp-6 text-sm leading-relaxed text-ink-600">
        “{review.body}”
      </blockquote>

      <div className="mt-auto flex items-center gap-2 border-t border-ink-100 pt-4 text-xs">
        <span className="font-semibold text-ink-700">{review.authorName}</span>
        {(review.courseCode || review.courseName) && (
          <>
            <span className="text-ink-300" aria-hidden="true">
              ·
            </span>
            <span className="text-ink-500">{review.courseCode ?? review.courseName}</span>
          </>
        )}
        <Badge tone="success" size="sm" className="ml-auto">
          Verified
        </Badge>
      </div>
    </figure>
  );
}

export function TestimonialRail({ reviews = [] }) {
  const [paused, setPaused] = useState(false);

  if (!reviews.length) return null;

  // The right-hand space is a margin on each card rather than a gap on the
  // track, so one full set is exactly half the track and the loop is seamless.
  const cards = reviews.map((review) => (
    <li key={review.id} className="shrink-0 pr-5 sm:pr-6">
      <ReviewCard review={review} />
    </li>
  ));

  return (
    <div>
      <div
        className={cn("marquee-rail -mx-4 py-1 sm:-mx-6 lg:-mx-8", paused && "is-paused")}
      >
        <div className="marquee-track">
          <ul className="flex shrink-0">{cards}</ul>
          {/* The closing half of the loop: the same quotes, so it must not be
              read out or counted twice. */}
          <ul className="marquee-clone flex shrink-0" aria-hidden="true">
            {cards}
          </ul>
        </div>
      </div>

      <div className="mt-8 flex justify-center motion-reduce:hidden">
        <button
          type="button"
          onClick={() => setPaused((value) => !value)}
          className={cn(
            "inline-flex items-center gap-2 rounded-xl border border-ink-200 bg-white",
            "px-3.5 py-2 text-xs font-semibold text-ink-600 shadow-xs",
            "transition-colors hover:border-brand-200 hover:text-brand-700",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500",
          )}
        >
          {paused ? (
            <Play className="size-3.5" aria-hidden="true" />
          ) : (
            <Pause className="size-3.5" aria-hidden="true" />
          )}
          {paused ? "Resume reviews" : "Pause reviews"}
        </button>
      </div>
    </div>
  );
}
