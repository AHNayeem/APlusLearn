"use client";

import { Plus, Trash2, CalendarClock } from "lucide-react";
import { Alert, Button, EmptyState, Field, Select } from "@/components/ui";
import { WEEKDAYS } from "@/constants";
import { minutesToLabel, minutesToTime, timeToMinutes } from "@/lib/utils/time";

/** Half-hour options across the day. */
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30);

/**
 * Step 9 — weekly availability (§17, §18).
 *
 * Stored as minutes-from-midnight in the tutor's own timezone, so a Tuesday
 * evening slot stays a Tuesday evening slot across DST changes.
 */
export function AvailabilityStep({ value, onChange, fieldErrors }) {
  const rules = value.weeklyRules ?? [];

  const set = (key, next) => onChange({ ...value, [key]: next });

  const addRule = (weekday = 1) =>
    set("weeklyRules", [
      ...rules,
      { weekday, startMinutes: 16 * 60, endMinutes: 20 * 60 },
    ]);

  const updateRule = (index, patch) =>
    set(
      "weeklyRules",
      rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)),
    );

  const removeRule = (index) =>
    set("weeklyRules", rules.filter((_, i) => i !== index));

  // Group by weekday so the week reads top to bottom.
  const byDay = WEEKDAYS.map((day) => ({
    ...day,
    rules: rules
      .map((rule, index) => ({ ...rule, index }))
      .filter((rule) => rule.weekday === day.value),
  }));

  const totalHours =
    rules.reduce((sum, r) => sum + Math.max(0, r.endMinutes - r.startMinutes), 0) / 60;

  return (
    <div className="space-y-6">
      <Alert tone="info" title="You control your calendar">
        These are the hours you&rsquo;re generally free. You can block specific dates, take a holiday, or
        change this any time from your calendar — and a booked lesson is never moved without you.
      </Alert>

      {fieldErrors.weeklyRules && (
        <p className="text-xs font-medium text-danger-600">{fieldErrors.weeklyRules}</p>
      )}

      {rules.length === 0 ? (
        <EmptyState
          compact
          icon={<CalendarClock className="size-6" />}
          title="No availability set"
          description="Add at least one weekly window so families can book you."
          action={
            <Button onClick={() => addRule(1)} iconLeft={<Plus className="size-4" />}>
              Add availability
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {byDay.map((day) => (
            <div
              key={day.value}
              className="grid gap-3 rounded-xl border border-ink-200 p-4 sm:grid-cols-[6rem_1fr]"
            >
              <div className="flex items-center justify-between sm:block">
                <p className="text-sm font-bold text-ink-900">{day.label}</p>
                {day.rules.length === 0 && (
                  <button
                    type="button"
                    onClick={() => addRule(day.value)}
                    className="text-xs font-semibold text-brand-600 hover:underline sm:mt-1 sm:block"
                  >
                    + Add hours
                  </button>
                )}
              </div>

              <div className="space-y-2">
                {day.rules.length === 0 ? (
                  <p className="text-sm text-ink-400">Not available</p>
                ) : (
                  day.rules.map((rule) => (
                    <div key={rule.index} className="flex flex-wrap items-center gap-2">
                      <label className="sr-only" htmlFor={`start-${rule.index}`}>
                        {day.label} start time
                      </label>
                      <Select
                        id={`start-${rule.index}`}
                        value={rule.startMinutes}
                        onChange={(e) =>
                          updateRule(rule.index, { startMinutes: Number(e.target.value) })
                        }
                        className="h-10 w-32"
                      >
                        {TIME_OPTIONS.map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutesToLabel(minutes)}
                          </option>
                        ))}
                      </Select>

                      <span className="text-sm text-ink-400">to</span>

                      <label className="sr-only" htmlFor={`end-${rule.index}`}>
                        {day.label} end time
                      </label>
                      <Select
                        id={`end-${rule.index}`}
                        value={rule.endMinutes}
                        onChange={(e) =>
                          updateRule(rule.index, { endMinutes: Number(e.target.value) })
                        }
                        className="h-10 w-32"
                      >
                        {TIME_OPTIONS.filter((m) => m > rule.startMinutes).map((minutes) => (
                          <option key={minutes} value={minutes}>
                            {minutesToLabel(minutes)}
                          </option>
                        ))}
                      </Select>

                      <button
                        type="button"
                        onClick={() => removeRule(rule.index)}
                        aria-label={`Remove ${day.label} availability`}
                        className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  ))
                )}

                {day.rules.length > 0 && (
                  <button
                    type="button"
                    onClick={() => addRule(day.value)}
                    className="text-xs font-semibold text-brand-600 hover:underline"
                  >
                    + Add another window
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {rules.length > 0 && (
        <p className="text-sm text-ink-500">
          <span className="font-bold text-ink-900">{totalHours.toFixed(1)} hours</span> available
          each week
        </p>
      )}

      <div className="grid gap-4 border-t border-ink-100 pt-5 sm:grid-cols-3">
        <Field
          label="Lesson slot size"
          htmlFor="avail-increment"
          hint="How start times are offered."
        >
          <Select
            id="avail-increment"
            value={value.slotIncrementMinutes ?? 30}
            onChange={(e) => set("slotIncrementMinutes", Number(e.target.value))}
          >
            <option value={15}>Every 15 minutes</option>
            <option value={30}>Every 30 minutes</option>
            <option value={60}>On the hour</option>
          </Select>
        </Field>

        <Field
          label="Gap between lessons"
          htmlFor="avail-buffer"
          hint="Travel or reset time."
        >
          <Select
            id="avail-buffer"
            value={value.bufferMinutes ?? 0}
            onChange={(e) => set("bufferMinutes", Number(e.target.value))}
          >
            {[0, 15, 30, 45, 60].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes === 0 ? "No gap" : `${minutes} minutes`}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Minimum notice"
          htmlFor="avail-notice"
          hint="How far ahead bookings must be made."
        >
          <Select
            id="avail-notice"
            value={value.minNoticeHours ?? 4}
            onChange={(e) => set("minNoticeHours", Number(e.target.value))}
          >
            {[2, 4, 8, 12, 24, 48].map((hours) => (
              <option key={hours} value={hours}>
                {hours < 24 ? `${hours} hours` : `${hours / 24} day${hours > 24 ? "s" : ""}`}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </div>
  );
}
