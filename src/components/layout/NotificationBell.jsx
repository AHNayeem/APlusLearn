"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Bell, BellOff, CheckCheck, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/client";
import { CountBadge, Spinner, useToast } from "@/components/ui";
import { formatRelative } from "@/lib/utils/format";
import {
  REALTIME_STATUS, useRealtimeCounts, useRealtimeEvent, useRealtimeStatus,
} from "@/components/realtime/RealtimeProvider";
import { REALTIME_EVENTS } from "@/lib/realtime/events";

/** Unread items shown in the popup; the rest are one click away. */
const PREVIEW_SIZE = 8;
/** Hints in a burst become one read. */
const REFRESH_DEBOUNCE_MS = 300;

/**
 * Top-bar notification bell (§28).
 *
 * The badge is the realtime unread count (docs/REALTIME.md), so it moves
 * without a reload. The popup lists *unread* notifications only, read through
 * the same endpoint the notification centre uses, on every open and again on
 * every stream hint while it is open. `href` is the full centre.
 */
export function NotificationBell({ href, initialCount = 0 }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const live = useRealtimeStatus() === REALTIME_STATUS.OPEN;
  const count = useRealtimeCounts()?.notifications ?? initialCount;

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState(false);
  const [marking, setMarking] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const timer = useRef(null);
  const request = useRef(0);
  const panelId = useId();

  // Navigating away (including through an item) closes the popup, adjusted
  // during render so the next page never paints with it still open.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  const load = async () => {
    const seq = ++request.current;
    try {
      const result = await api.get(`/api/notifications?unreadOnly=true&pageSize=${PREVIEW_SIZE}`);
      if (seq !== request.current) return;
      setItems(result.notifications);
      setFailed(false);
    } catch {
      if (seq === request.current) setFailed(true);
    }
  };

  const reload = () => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(load, REFRESH_DEBOUNCE_MS);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  useRealtimeEvent(REALTIME_EVENTS.NOTIFICATION, reload);
  useRealtimeEvent(REALTIME_EVENTS.RESYNC, reload);
  // Read elsewhere — another tab, the centre, another device — leaves the list.
  useRealtimeEvent(REALTIME_EVENTS.NOTIFICATION_UPDATED, ({ id, readAt }) => {
    if (readAt) setItems((list) => list?.filter((item) => item.id !== id) ?? list);
  });

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setFailed(false);
    load();
  };

  // With the stream up the badge follows on its own; without it, the layout's
  // count is re-read.
  const afterRead = () => {
    if (!live) router.refresh();
  };

  const markOne = async (notification) => {
    setItems((list) => list?.filter((item) => item.id !== notification.id) ?? list);
    if (notification.href) setOpen(false);
    await api.post("/api/notifications/read", { ids: [notification.id] }).catch(() => {});
    afterRead();
  };

  const markAllRead = async () => {
    setMarking(true);
    try {
      await api.post("/api/notifications/read", { all: true });
      setItems([]);
      afterRead();
    } catch (error) {
      toast.error("Couldn't mark as read", error.message);
    } finally {
      setMarking(false);
    }
  };

  const label = count > 0 ? `Notifications, ${count} unread` : "Notifications";
  const hidden = items ? Math.max(0, count - items.length) : 0;

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={cn(
          "relative inline-flex size-10 items-center justify-center rounded-xl text-ink-600 transition-colors",
          "hover:bg-ink-100 hover:text-ink-900",
          open && "bg-ink-100 text-ink-900",
        )}
      >
        <Bell className="size-5" />
        <CountBadge
          count={count}
          className="pointer-events-none absolute -right-0.5 -top-0.5 ring-2 ring-white"
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={panelId}
            role="dialog"
            aria-label="Unread notifications"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              // Pinned to the viewport gutters on phones, where the bell sits
              // too far right for a dropdown-width panel to fit beneath it.
              "fixed inset-x-4 top-[4.5rem] z-50 flex origin-top flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-xl",
              "sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-96 sm:origin-top-right",
            )}
          >
            <div className="flex items-center justify-between gap-3 border-b border-ink-100 px-4 py-3">
              <p className="text-sm font-bold text-ink-900">
                Notifications
                {count > 0 && <span className="ml-1.5 font-semibold text-ink-400">{count} unread</span>}
              </p>
              {items?.length > 0 && (
                <button
                  type="button"
                  onClick={markAllRead}
                  disabled={marking}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-50"
                >
                  {marking ? <Spinner className="size-3.5" label="Marking as read" /> : <CheckCheck className="size-3.5" />}
                  Mark all as read
                </button>
              )}
            </div>

            <div className="max-h-[min(26rem,calc(100dvh-12rem))] overflow-y-auto overscroll-contain">
              {items === null && !failed ? (
                <div className="flex justify-center py-10 text-ink-400">
                  <Spinner label="Loading notifications" />
                </div>
              ) : failed && !items?.length ? (
                <div className="px-4 py-8 text-center">
                  <p className="text-sm text-ink-500">Couldn&apos;t load notifications.</p>
                  <button
                    type="button"
                    onClick={load}
                    className="mt-2 text-sm font-semibold text-brand-700 hover:underline"
                  >
                    Try again
                  </button>
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center px-4 py-10 text-center">
                  <span className="mb-3 inline-flex size-11 items-center justify-center rounded-full bg-ink-100 text-ink-400">
                    <BellOff className="size-5" />
                  </span>
                  <p className="text-sm font-semibold text-ink-800">You&apos;re all caught up</p>
                  <p className="mt-1 text-xs text-ink-500">New notifications will appear here.</p>
                </div>
              ) : (
                <ul className="divide-y divide-ink-100">
                  {items.map((notification) => {
                    const Row = notification.href ? Link : "button";
                    return (
                      <li key={notification.id}>
                        <Row
                          {...(notification.href
                            ? { href: notification.href }
                            : { type: "button", title: "Mark as read" })}
                          onClick={() => markOne(notification)}
                          className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-ink-50"
                        >
                          <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand-600" aria-hidden="true" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="line-clamp-1 text-sm font-bold text-ink-900">
                                {notification.title}
                              </span>
                              <span className="shrink-0 text-[11px] text-ink-400">
                                {formatRelative(notification.createdAt)}
                              </span>
                            </span>
                            {notification.body && (
                              <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-ink-500">
                                {notification.body}
                              </span>
                            )}
                          </span>
                        </Row>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <Link
              href={href}
              onClick={() => setOpen(false)}
              className="flex items-center justify-center gap-1 border-t border-ink-100 bg-ink-50/60 px-4 py-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-ink-100"
            >
              View all notifications
              {hidden > 0 && <span className="font-medium text-ink-500">({hidden} more unread)</span>}
              <ChevronRight className="size-4" />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
