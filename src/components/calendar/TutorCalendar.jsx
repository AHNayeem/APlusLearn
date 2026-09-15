"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, ChevronRight, Plus, Trash2, CalendarOff, Plane, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Modal, Select,
  Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { WEEKDAYS, BOOKING_STATUS, CANCELLED_STATUSES } from "@/constants";
import { minutesToLabel, addDays, dayKeyInZone } from "@/lib/utils/time";
import { formatDate, formatTime, formatDuration } from "@/lib/utils/format";
import { useToday } from "@/hooks/useToday";

/**
 * Tutor calendar (§18, §24).
 *
 * Shows the week's real bookings laid over the recurring availability, plus
 * the controls for blocking dates and taking a holiday.
 */
export function TutorCalendar({ availability, bookings, from, timeZone }) {
  const router = useRouter();
  const [weekStart, setWeekStart] = useState(new Date(from));
  const [blockOpen, setBlockOpen] = useState(false);

  const shiftWeek = (delta) => {
    const next = addDays(weekStart, delta * 7);
    setWeekStart(next);
    router.push(`/tutor/calendar?from=${dayKeyInZone(next, timeZone)}`, { scroll: false });
  };

  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart, i);
    const key = dayKeyInZone(date, timeZone);
    const weekday = new Date(`${key}T12:00:00Z`).getUTCDay();

    return {
      key,
      date,
      weekday,
      rules: (availability?.weeklyRules ?? []).filter((r) => r.weekday === weekday),
      bookings: bookings.filter((b) => dayKeyInZone(b.startAt, timeZone) === key),
      blocks: (availability?.exceptions ?? []).filter(
        (e) =>
          new Date(e.start) < addDays(date, 1) &&
          new Date(e.end) > date &&
          e.kind !== "EXTRA",
      ),
    };
  });

  const todayKey = dayKeyInZone(new Date(), timeZone);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => shiftWeek(-1)}
            aria-label="Previous week"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <p className="min-w-44 text-center text-sm font-bold text-ink-900">
            {formatDate(days[0].date, { timeZone: "UTC" })} –{" "}
            {formatDate(days[6].date, { timeZone: "UTC" })}
          </p>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => shiftWeek(1)}
            aria-label="Next week"
          >
            <ChevronRight className="size-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setWeekStart(new Date());
              router.push("/tutor/calendar", { scroll: false });
            }}
          >
            Today
          </Button>
        </div>

        <Button onClick={() => setBlockOpen(true)} iconLeft={<CalendarOff className="size-4" />}>
          Block time off
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {days.map((day) => (
          <Card
            key={day.key}
            className={cn(
              "flex flex-col",
              day.key === todayKey && "border-brand-300 ring-1 ring-brand-300",
            )}
          >
            <div
              className={cn(
                "border-b border-ink-100 px-4 py-3",
                day.key === todayKey && "bg-brand-50/60",
              )}
            >
              <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
                {WEEKDAYS[day.weekday].short}
              </p>
              <p className="text-lg font-extrabold text-ink-900">
                {new Date(`${day.key}T12:00:00Z`).getUTCDate()}
              </p>
            </div>

            <CardBody className="flex-1 space-y-2 p-3">
              {day.blocks.length > 0 && (
                <div className="rounded-lg border border-warning-100 bg-warning-50 p-2.5">
                  <p className="flex items-center gap-1.5 text-xs font-bold text-warning-700">
                    <Plane className="size-3" />
                    {day.blocks[0].kind === "VACATION" ? "On holiday" : "Blocked"}
                  </p>
                  {day.blocks[0].reason && (
                    <p className="mt-0.5 text-xs text-warning-700/80">{day.blocks[0].reason}</p>
                  )}
                </div>
              )}

              {day.rules.length > 0 && day.blocks.length === 0 && (
                <p className="flex items-center gap-1.5 text-xs text-ink-500">
                  <Clock className="size-3" />
                  {day.rules
                    .map((r) => `${minutesToLabel(r.startMinutes)}–${minutesToLabel(r.endMinutes)}`)
                    .join(", ")}
                </p>
              )}

              {day.rules.length === 0 && day.blocks.length === 0 && (
                <p className="text-xs text-ink-400">Not available</p>
              )}

              {day.bookings.map((booking) => {
                const cancelled = CANCELLED_STATUSES.includes(booking.status);
                const student = booking.studentProfileId;
                return (
                  <Link
                    key={booking.id}
                    href={`/tutor/bookings/${booking.id}`}
                    className={cn(
                      "block rounded-lg border p-2.5 transition-colors",
                      cancelled
                        ? "border-ink-200 bg-ink-50 opacity-60"
                        : "border-brand-200 bg-brand-50 hover:border-brand-400",
                    )}
                  >
                    <p
                      className={cn(
                        "text-xs font-bold",
                        cancelled ? "text-ink-500 line-through" : "text-brand-800",
                      )}
                    >
                      {formatTime(booking.startAt, timeZone)}
                    </p>
                    <p className="mt-0.5 truncate text-xs font-semibold text-ink-900">
                      {booking.courseCode ?? booking.courseName}
                    </p>
                    <p className="truncate text-[11px] text-ink-500">
                      {student?.firstName} · {formatDuration(booking.durationMinutes)}
                    </p>
                  </Link>
                );
              })}
            </CardBody>
          </Card>
        ))}
      </div>

      <WeeklyRulesCard availability={availability} />
      <BlocksCard availability={availability} />

      <BlockTimeModal open={blockOpen} onClose={() => setBlockOpen(false)} />
    </div>
  );
}

/** Edit the recurring weekly pattern in place (§18). */
function WeeklyRulesCard({ availability }) {
  const router = useRouter();
  const toast = useToast();
  const [rules, setRules] = useState(availability?.weeklyRules ?? []);
  const [dirty, setDirty] = useState(false);

  const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => i * 30);

  const update = (index, patch) => {
    setRules((r) => r.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
    setDirty(true);
  };

  const add = (weekday) => {
    setRules((r) => [...r, { weekday, startMinutes: 16 * 60, endMinutes: 20 * 60 }]);
    setDirty(true);
  };

  const remove = (index) => {
    setRules((r) => r.filter((_, i) => i !== index));
    setDirty(true);
  };

  const { submit, pending, error } = useSubmit(async () => {
    await api.patch("/api/tutor/availability", {
      weeklyRules: rules.map(({ weekday, startMinutes, endMinutes }) => ({
        weekday,
        startMinutes,
        endMinutes,
      })),
    });
    toast.success("Availability updated");
    setDirty(false);
    router.refresh();
  });

  return (
    <Card>
      <CardHeader
        title="Weekly availability"
        description="The hours you're generally free. Booked lessons are never moved by changing this."
        action={
          dirty && (
            <Button size="sm" onClick={submit} loading={pending}>
              Save changes
            </Button>
          )
        }
      />
      <CardBody className="space-y-3">
        {error && <Alert tone="danger">{error}</Alert>}

        {WEEKDAYS.map((day) => {
          const dayRules = rules
            .map((rule, index) => ({ ...rule, index }))
            .filter((rule) => rule.weekday === day.value);

          return (
            <div
              key={day.value}
              className="grid gap-3 border-b border-ink-100 pb-3 last:border-0 last:pb-0 sm:grid-cols-[6rem_1fr]"
            >
              <p className="text-sm font-semibold text-ink-800">{day.label}</p>
              <div className="space-y-2">
                {dayRules.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => add(day.value)}
                    className="text-xs font-semibold text-brand-600 hover:underline"
                  >
                    + Add hours
                  </button>
                ) : (
                  <>
                    {dayRules.map((rule) => (
                      <div key={rule.index} className="flex flex-wrap items-center gap-2">
                        <Select
                          value={rule.startMinutes}
                          onChange={(e) =>
                            update(rule.index, { startMinutes: Number(e.target.value) })
                          }
                          className="h-9 w-28 text-xs"
                          aria-label={`${day.label} start`}
                        >
                          {TIME_OPTIONS.map((m) => (
                            <option key={m} value={m}>{minutesToLabel(m)}</option>
                          ))}
                        </Select>
                        <span className="text-xs text-ink-400">to</span>
                        <Select
                          value={rule.endMinutes}
                          onChange={(e) =>
                            update(rule.index, { endMinutes: Number(e.target.value) })
                          }
                          className="h-9 w-28 text-xs"
                          aria-label={`${day.label} end`}
                        >
                          {TIME_OPTIONS.filter((m) => m > rule.startMinutes).map((m) => (
                            <option key={m} value={m}>{minutesToLabel(m)}</option>
                          ))}
                        </Select>
                        <button
                          type="button"
                          onClick={() => remove(rule.index)}
                          aria-label={`Remove ${day.label} availability`}
                          className="rounded-lg p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => add(day.value)}
                      className="text-xs font-semibold text-brand-600 hover:underline"
                    >
                      + Add another
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </CardBody>
    </Card>
  );
}

/** Existing blocks and holidays, with the option to remove them. */
function BlocksCard({ availability }) {
  const router = useRouter();
  const toast = useToast();
  const blocks = (availability?.exceptions ?? [])
    .filter((e) => new Date(e.end) >= new Date())
    .sort((a, b) => new Date(a.start) - new Date(b.start));

  if (blocks.length === 0) return null;

  return (
    <Card>
      <CardHeader title="Time off" description="Dates you've blocked out." />
      <CardBody>
        <ul className="space-y-2">
          {blocks.map((block) => (
            <li
              key={block._id ?? block.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-ink-200 p-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold text-ink-900">
                  {block.kind === "VACATION" ? (
                    <Plane className="size-3.5 text-ink-400" />
                  ) : (
                    <CalendarOff className="size-3.5 text-ink-400" />
                  )}
                  {formatDate(block.start)} – {formatDate(block.end)}
                </p>
                {block.reason && <p className="mt-0.5 text-xs text-ink-500">{block.reason}</p>}
              </div>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.delete(`/api/tutor/availability/exceptions/${block._id ?? block.id}`);
                    toast.success("Block removed");
                    router.refresh();
                  } catch (error) {
                    toast.error("Couldn't remove", error.message);
                  }
                }}
                aria-label="Remove block"
                className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-danger-50 hover:text-danger-600"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}

function BlockTimeModal({ open, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const today = useToday();
  const [form, setForm] = useState({ start: "", end: "", reason: "", kind: "BLOCKED" });

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post("/api/tutor/availability/exceptions", {
      start: new Date(`${form.start}T00:00:00`).toISOString(),
      end: new Date(`${form.end}T23:59:59`).toISOString(),
      reason: form.reason || undefined,
      kind: form.kind,
    });
    toast.success("Time blocked", "Families can no longer book those dates.");
    onClose();
    setForm({ start: "", end: "", reason: "", kind: "BLOCKED" });
    router.refresh();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Block time off"
      description="Stop new bookings for a date range. Existing lessons aren't affected."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!form.start || !form.end}>
            Block these dates
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Field label="Type" htmlFor="block-kind">
          <Select id="block-kind" value={form.kind} onChange={set("kind")}>
            <option value="BLOCKED">Blocked time</option>
            <option value="VACATION">Holiday</option>
          </Select>
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="From" htmlFor="block-start" error={fieldErrors.start} required>
            <Input
              id="block-start"
              type="date"
              value={form.start}
              onChange={set("start")}
              min={today}
              error={fieldErrors.start}
            />
          </Field>
          <Field label="To" htmlFor="block-end" error={fieldErrors.end} required>
            <Input
              id="block-end"
              type="date"
              value={form.end}
              onChange={set("end")}
              min={form.start || today}
              error={fieldErrors.end}
            />
          </Field>
        </div>

        <Field label="Reason" htmlFor="block-reason" hint="Optional, only visible to you.">
          <Textarea
            id="block-reason"
            rows={2}
            value={form.reason}
            onChange={set("reason")}
            maxLength={200}
            placeholder="March break"
          />
        </Field>
      </div>
    </Modal>
  );
}
