"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api, qs, ApiError } from "@/lib/api/client";
import { useToast } from "@/components/ui";

/**
 * Save/unsave a tutor (§20 favourites).
 *
 * Optimistic: the heart fills immediately and reverts if the request fails,
 * so the interaction never feels laggy.
 */
export function FavouriteButton({ tutorProfileId, initial = false, withLabel = false, className }) {
  const [saved, setSaved] = useState(initial);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const toggle = async (event) => {
    event.preventDefault();
    event.stopPropagation();

    const next = !saved;
    setSaved(next);

    try {
      if (next) await api.post("/api/favourites", { tutorProfileId });
      else await api.delete(`/api/favourites${qs({ tutorProfileId })}`);
      startTransition(() => router.refresh());
    } catch (error) {
      setSaved(!next);
      if (error instanceof ApiError && error.status === 401) {
        toast.info("Sign in to save tutors", "Saved tutors are kept with your account.");
        router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
        return;
      }
      toast.error("We couldn't save that", error.message);
    }
  };

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={saved}
      aria-label={saved ? "Remove from saved tutors" : "Save this tutor"}
      className={cn(
        "group inline-flex shrink-0 items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-semibold transition-colors",
        saved ? "text-danger-600" : "text-ink-400 hover:bg-ink-100 hover:text-ink-600",
        className,
      )}
    >
      <Heart
        className={cn(
          "size-5 transition-transform duration-200 group-active:scale-90 motion-reduce:group-active:scale-100",
          saved && "fill-current",
        )}
      />
      {withLabel && <span>{saved ? "Saved" : "Save"}</span>}
    </button>
  );
}
