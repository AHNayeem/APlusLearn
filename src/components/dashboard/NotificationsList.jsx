"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/client";
import { Badge, Button, Card, CardBody, EmptyState, useToast } from "@/components/ui";
import { formatRelative } from "@/lib/utils/format";
import {
  REALTIME_STATUS, useRealtimeCounts, useRealtimeEvent, useRealtimeStatus,
} from "@/components/realtime/RealtimeProvider";
import { REALTIME_EVENTS } from "@/lib/realtime/events";

/** Hints in a burst become one read. */
const REFRESH_DEBOUNCE_MS = 300;

/**
 * Notification centre (§28).
 *
 * Kept current by the realtime stream (docs/REALTIME.md). A new notification
 * is a hint, not a payload: the list is re-read through the same endpoint the
 * page was rendered from, once per burst and once on every reconnect. Read
 * state changed in another tab or on another device arrives as an id and a
 * time, and is applied in place.
 */
export function NotificationsList({ notifications: initial, unreadCount: initialUnread, pageSize = 40 }) {
  const router = useRouter();
  const toast = useToast();
  const live = useRealtimeStatus() === REALTIME_STATUS.OPEN;
  const liveCounts = useRealtimeCounts();
  const [notifications, setNotifications] = useState(initial);
  const [unreadCount, setUnreadCount] = useState(initialUnread);
  const [marking, setMarking] = useState(false);
  const timer = useRef(null);

  // A fresh server render, or a recount from the stream, is the newer truth.
  const [lastInitial, setLastInitial] = useState(initial);
  if (lastInitial !== initial) {
    setLastInitial(initial);
    setNotifications(initial);
    setUnreadCount(initialUnread);
  }
  const [lastLiveCount, setLastLiveCount] = useState(liveCounts?.notifications);
  if (liveCounts && lastLiveCount !== liveCounts.notifications) {
    setLastLiveCount(liveCounts.notifications);
    setUnreadCount(liveCounts.notifications);
  }

  const reload = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const result = await api.get(`/api/notifications?pageSize=${pageSize}`);
        setNotifications(result.notifications);
        setUnreadCount(result.unreadCount);
      } catch {
        // Kept as it was; the next hint or reconnect reads again.
      }
    }, REFRESH_DEBOUNCE_MS);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  useRealtimeEvent(REALTIME_EVENTS.NOTIFICATION, reload);
  useRealtimeEvent(REALTIME_EVENTS.RESYNC, reload);
  useRealtimeEvent(REALTIME_EVENTS.NOTIFICATION_UPDATED, ({ id, readAt }) => {
    setNotifications((n) => n.map((item) => (item.id === id ? { ...item, readAt } : item)));
  });

  const markAllRead = async () => {
    setMarking(true);
    try {
      const result = await api.post("/api/notifications/read", { all: true });
      setNotifications((n) => n.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
      setUnreadCount(result.unreadCount);
      // With the stream up, the sidebar badge follows on its own.
      if (!live) router.refresh();
    } catch (error) {
      toast.error("Couldn't mark as read", error.message);
    } finally {
      setMarking(false);
    }
  };

  const markOne = async (id) => {
    setNotifications((n) =>
      n.map((item) => (item.id === id ? { ...item, readAt: new Date().toISOString() } : item)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await api.post("/api/notifications/read", { ids: [id] }).catch(() => {});
    if (!live) router.refresh();
  };

  if (notifications.length === 0) {
    return (
      <EmptyState
        icon={<Bell className="size-7" />}
        title="No notifications"
        description="Booking confirmations, messages and reminders will appear here."
      />
    );
  }

  return (
    <>
      {unreadCount > 0 && (
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm text-ink-500">
            <span className="font-bold text-ink-900">{unreadCount}</span> unread
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={markAllRead}
            loading={marking}
            iconLeft={<CheckCheck className="size-4" />}
          >
            Mark all as read
          </Button>
        </div>
      )}

      <Card>
        <CardBody className="p-0">
          <ul className="divide-y divide-ink-100">
            {notifications.map((notification) => {
              const unread = !notification.readAt;
              const Wrapper = notification.href ? Link : "div";

              return (
                <li key={notification.id}>
                  <Wrapper
                    {...(notification.href ? { href: notification.href } : {})}
                    onClick={() => unread && markOne(notification.id)}
                    className={cn(
                      "flex gap-3 p-4 transition-colors sm:p-5",
                      notification.href && "hover:bg-ink-50",
                      unread && "bg-brand-50/40",
                    )}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-2 shrink-0 rounded-full",
                        unread ? "bg-brand-600" : "bg-transparent",
                      )}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p
                          className={cn(
                            "text-sm",
                            unread ? "font-bold text-ink-900" : "font-semibold text-ink-700",
                          )}
                        >
                          {notification.title}
                        </p>
                        <span className="shrink-0 text-xs text-ink-400">
                          {formatRelative(notification.createdAt)}
                        </span>
                      </div>
                      {notification.body && (
                        <p className="mt-1 text-sm leading-relaxed text-ink-500">
                          {notification.body}
                        </p>
                      )}
                      {unread && (
                        <Badge tone="brand" size="sm" className="mt-2">
                          New
                        </Badge>
                      )}
                    </div>
                  </Wrapper>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>
    </>
  );
}
