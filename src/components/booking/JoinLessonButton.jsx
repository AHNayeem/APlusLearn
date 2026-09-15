"use client";

import { useEffect, useState } from "react";
import { Video } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * "Join lesson" button that becomes prominent as the lesson approaches.
 *
 * The comparison against the current time lives here, in an effect, rather
 * than during render — a render-time `Date.now()` would differ between the
 * server and client passes and is not a pure render.
 */
export function JoinLessonButton({ startAt, joinUrl, label = "Join lesson", className }) {
  const [imminent, setImminent] = useState(false);

  useEffect(() => {
    const check = () => {
      const minutesAway = (new Date(startAt).getTime() - Date.now()) / 60000;
      // Prominent from an hour before until an hour after the start time.
      setImminent(minutesAway <= 60 && minutesAway >= -60);
    };

    check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, [startAt]);

  if (!joinUrl) return null;

  return (
    <Button
      href={joinUrl}
      target="_blank"
      rel="noopener noreferrer"
      variant={imminent ? "primary" : "secondary"}
      className={className}
      iconLeft={<Video className="size-4" />}
    >
      {label}
    </Button>
  );
}
