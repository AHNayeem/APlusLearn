"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * The photo column of a tutor card: one cover image plus a thumbnail strip
 * that swaps it in place.
 *
 * This is the only interactive part of the card, so it is the only part that
 * ships as a Client Component — `TutorCard` itself stays on the server.
 *
 * Tutors with no photos get a monogram cover rather than an empty box; an
 * unfinished gallery should never make a profile look broken (§14).
 */
export function TutorGallery({
  images = [],
  name,
  href,
  ribbon,
  monogram,
  aspect = "aspect-[4/3]",
  thumbAspect = "aspect-square",
  sizes = "(min-width: 1024px) 17rem, 100vw",
  className,
}) {
  const [active, setActive] = useState(0);
  const shown = images.slice(0, 5);
  const cover = shown[active] ?? shown[0];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className={cn("relative overflow-hidden rounded-xl bg-ink-100", aspect)}>
        {cover ? (
          <Image src={cover} alt="" fill sizes={sizes} className="object-cover" />
        ) : (
          <span className="flex size-full items-center justify-center bg-gradient-to-br from-brand-100 via-brand-50 to-plum-100 text-4xl font-extrabold tracking-tight text-brand-700">
            <span aria-hidden="true">{monogram}</span>
          </span>
        )}

        {ribbon && (
          <span className="absolute left-0 top-3 rounded-r-md bg-danger-500 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm">
            {ribbon}
          </span>
        )}

        {href && (
          <Link
            href={href}
            className="absolute inset-0 rounded-xl"
            aria-label={`View ${name}'s profile`}
          />
        )}
      </div>

      {shown.length > 1 && (
        <ul className="grid grid-cols-5 gap-1.5">
          {shown.map((src, index) => (
            <li key={src}>
              <button
                type="button"
                onClick={() => setActive(index)}
                aria-label={`Show photo ${index + 1} of ${shown.length}`}
                aria-pressed={index === active}
                className={cn(
                  "relative block w-full overflow-hidden rounded-lg",
                  thumbAspect,
                  "ring-1 ring-inset transition-[box-shadow,opacity] duration-150",
                  index === active
                    ? "ring-2 ring-brand-500"
                    : "opacity-80 ring-ink-200 hover:opacity-100 hover:ring-ink-300",
                )}
              >
                <Image src={src} alt="" fill sizes="96px" className="object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
