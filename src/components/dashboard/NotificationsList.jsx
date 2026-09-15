"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/client";
import { Badge, Button, Card, CardBody, EmptyState, useToast } from "@/components/ui";
import { formatRelative } from "@/lib/utils/format";

/** Notification centre (§28). */
export function NotificationsList({ notifications: initial, unreadCount: initialUnread }) {
  const router = useRouter();
  const toast = useToast();
  const [notifications, setNotifications] = useState(initial);
  const [unreadCount, setUnreadCount] = useState(initialUnread);
  const [marking, setMarking] = useState(false);

  const markAllRead = async () => {
    setMarking(true);
    try {
      const result = await api.post("/api/notifications/read", { all: true });
      setNotifications((n) => n.map((item) => ({ ...item, readAt: new Date().toISOString() })));
      setUnreadCount(result.unreadCount);
      router.refresh();
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
    router.refresh();
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
