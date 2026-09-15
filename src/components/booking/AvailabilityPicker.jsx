"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CalendarX2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Skeleton } from "@/components/ui";
import { formatDate } from "@/lib/utils/format";

/**
 * Slot picker (§18, §19).
 *
 * Renders only slots the server says are bookable — the client never derives
 * availability from rules, so what you can click is exactly what can be booked.
 */
export function AvailabilityPicker({
  days = [],
  loading = false,
  selected,
  onSelect,
  timeZone,
  className,
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const perPage = 7;

  const visible = useMemo(
    () => days.slice(weekOffset * perPage, weekOffset * perPage + perPage),
    [days, weekOffset],
  );

  const maxOffset = Math.max(0, Math.ceil(days.length / perPage) - 1);
  const hasAny = days.some((d) => d.slots.length > 0);

  if (loading) {
    return (
      <div className={cn("space-y-3", className)} role="status" aria-label="Loading availability">
        <div className="grid grid-cols-7 gap-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-32 rounded-xl" />
        <span className="sr-only">Loading availability…</span>
      </div>
    );
  }

  if (!hasAny) {
    return (
      <div
        className={cn(
          "flex flex-col items-center rounded-xl border border-dashed border-ink-300 px-6 py-10 text-center",
          className,
        )}
      >
        <CalendarX2 className="size-8 text-ink-300" />
        <p className="mt-3 text-sm font-semibold text-ink-800">No availability in this period</p>
        <p className="mt-1 text-sm text-ink-500">
          Send a message to ask about other times — tutors often open slots on request.
        </p>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-ink-500">
          Times shown in {timeZone?.split("/")[1]?.replace("_", " ") ?? "the tutor's timezone"}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setWeekOffset((v) => Math.max(0, v - 1))}
            disabled={weekOffset === 0}
            aria-label="Previous week"
            className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-ink-100 disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset((v) => Math.min(maxOffset, v + 1))}
            disabled={weekOffset >= maxOffset}
            aria-label="Next week"
            className="rounded-lg p-1.5 text-ink-500 transition-colors hover:bg-ink-100 disabled:opacity-30"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="no-scrollbar -mx-1 grid grid-flow-col auto-cols-[minmax(3.25rem,1fr)] gap-2 overflow-x-auto px-1 pb-1">
        {visible.map((day) => {
          const date = new Date(`${day.dayKey}T12:00:00Z`);
          const isSelectedDay = selected && selected.startsWith(day.dayKey);
          const disabled = day.slots.length === 0;

          return (
            <button
              key={day.dayKey}
              type="button"
              disabled={disabled}
              onClick={() => onSelect(day.slots[0]?.startAt)}
              aria-pressed={isSelectedDay}
              className={cn(
                "flex flex-col items-center rounded-xl border px-2 py-2.5 transition-all duration-150",
                disabled
                  ? "cursor-not-allowed border-ink-100 bg-ink-50 opacity-50"
                  : isSelectedDay
                    ? "border-brand-500 bg-brand-50 ring-1 ring-brand-500"
                    : "border-ink-200 bg-white hover:border-brand-300 hover:bg-brand-50/40",
              )}
            >
              <span className="text-[10px] font-bold uppercase tracking-wide text-ink-400">
                {date.toLocaleDateString("en-CA", { weekday: "short", timeZone: "UTC" })}
              </span>
              <span
                className={cn(
                  "mt-0.5 text-base font-bold tabular-nums",
                  isSelectedDay ? "text-brand-700" : "text-ink-900",
                )}
              >
                {date.getUTCDate()}
              </span>
              <span
                className={cn(
                  "mt-0.5 text-[10px] font-semibold",
                  disabled ? "text-ink-400" : "text-success-600",
                )}
              >
                {disabled ? "—" : `${day.slots.length}`}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 space-y-4">
        {visible
          .filter((day) => day.slots.length > 0)
          .map((day) => (
            <div key={day.dayKey}>
              <h4 className="text-xs font-bold uppercase tracking-wide text-ink-500">
                {formatDate(`${day.dayKey}T12:00:00Z`, { weekday: "long", timeZone: "UTC" })}
              </h4>
              <div
                role="radiogroup"
                aria-label={`Times on ${day.dayKey}`}
                className="mt-2 flex flex-wrap gap-2"
              >
                {day.slots.map((slot) => {
                  const isSelected = selected === slot.startAt;
                  return (
                    <button
                      key={slot.startAt}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => onSelect(slot.startAt)}
                      className={cn(
                        "rounded-lg border px-3 py-2 text-xs font-semibold tabular-nums transition-all duration-150",
                        isSelected
                          ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                          : "border-ink-200 bg-white text-ink-700 hover:border-brand-400 hover:bg-brand-50",
                      )}
                    >
                      {slot.label}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
