"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, MoreVertical, Flag, Archive, Ban, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Avatar, Badge, Button, Dropdown, DropdownItem, Field, Modal, Textarea,
  useToast, Rating,
} from "@/components/ui";
import { formatRelative, formatDate, formatTime } from "@/lib/utils/format";
import { BOOKING_STATUS_LABELS } from "@/constants";

/**
 * A single conversation (§21).
 *
 * The thread is server-rendered and appended to optimistically on send, so the
 * message appears instantly and is reconciled when the request returns.
 */
export function ConversationView({ conversation, messages: initialMessages, bookings, viewerId }) {
  const router = useRouter();
  const toast = useToast();
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [reportOpen, setReportOpen] = useState(false);
  const endRef = useRef(null);

  // When the server sends a fresh thread, adopt it. Adjusting during render
  // keeps the optimistic list and the server list from flickering apart.
  const [lastServerMessages, setLastServerMessages] = useState(initialMessages);
  if (lastServerMessages !== initialMessages) {
    setLastServerMessages(initialMessages);
    setMessages(initialMessages);
  }

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Opening a thread clears its unread count.
  useEffect(() => {
    if (conversation.unreadCount > 0) {
      api
        .post(`/api/messages/conversations/${conversation.id}/read`)
        .then(() => router.refresh())
        .catch(() => {});
    }
  }, [conversation.id, conversation.unreadCount, router]);

  const { submit, pending } = useSubmit(async () => {
    const text = body.trim();
    if (!text) return undefined;

    const optimistic = {
      id: `pending-${Date.now()}`,
      senderId: viewerId,
      body: text,
      createdAt: new Date().toISOString(),
      pending: true,
    };
    setMessages((m) => [...m, optimistic]);
    setBody("");

    try {
      const result = await api.post("/api/messages", {
        conversationId: conversation.id,
        body: text,
      });
      setMessages((m) => m.map((msg) => (msg.id === optimistic.id ? result.message : msg)));
      router.refresh();
      return result;
    } catch (error) {
      setMessages((m) => m.filter((msg) => msg.id !== optimistic.id));
      setBody(text);
      throw error;
    }
  });

  const other = conversation.otherParty;
  const tutorProfile = conversation.tutorProfileId;

  return (
    <div className="flex h-[calc(100dvh-8rem)] flex-col rounded-2xl border border-ink-200 bg-white lg:h-[calc(100dvh-10rem)]">
      <header className="flex items-center gap-3 border-b border-ink-200 p-4">
        <Avatar src={other?.avatarUrl} name={other?.name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink-900">{other?.name}</p>
          {tutorProfile?.slug ? (
            <Link
              href={`/tutors/${tutorProfile.slug}`}
              className="truncate text-xs text-brand-600 hover:underline"
            >
              View profile
            </Link>
          ) : (
            <p className="truncate text-xs text-ink-500">
              {conversation.isBlocked ? "You blocked this conversation" : "Active"}
            </p>
          )}
        </div>

        <Dropdown
          trigger={
            <span className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 hover:text-ink-600">
              <MoreVertical className="size-4" />
              <span className="sr-only">Conversation options</span>
            </span>
          }
        >
          <DropdownItem
            icon={<Archive className="size-4" />}
            onClick={async () => {
              await api.post(`/api/messages/conversations/${conversation.id}/actions`, {
                action: "ARCHIVE",
              });
              toast.success("Conversation archived");
              router.push("/messages");
              router.refresh();
            }}
          >
            Archive conversation
          </DropdownItem>
          <DropdownItem
            icon={<Ban className="size-4" />}
            danger
            onClick={async () => {
              await api.post(`/api/messages/conversations/${conversation.id}/actions`, {
                action: conversation.isBlocked ? "UNBLOCK" : "BLOCK",
              });
              toast.success(conversation.isBlocked ? "Unblocked" : "Blocked");
              router.refresh();
            }}
          >
            {conversation.isBlocked ? "Unblock" : "Block this person"}
          </DropdownItem>
          <DropdownItem icon={<Flag className="size-4" />} danger onClick={() => setReportOpen(true)}>
            Report conversation
          </DropdownItem>
        </Dropdown>
      </header>

      {bookings?.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto border-b border-ink-100 bg-ink-50/60 p-3">
          {bookings.slice(0, 5).map((booking) => (
            <Link
              key={booking.id}
              href={`/bookings/${booking.id}`}
              className="flex shrink-0 items-center gap-2 rounded-lg border border-ink-200 bg-white px-3 py-2 text-xs transition-colors hover:border-brand-300"
            >
              <CalendarDays className="size-3.5 text-ink-400" />
              <span className="font-semibold text-ink-800">
                {booking.courseCode ?? booking.courseName}
              </span>
              <span className="text-ink-500">{formatDate(booking.startAt)}</span>
              <Badge tone="neutral" size="sm">
                {BOOKING_STATUS_LABELS[booking.status]}
              </Badge>
            </Link>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="py-10 text-center text-sm text-ink-500">
            No messages yet — say hello.
          </p>
        )}

        {messages.map((message, index) => {
          const mine = String(message.senderId) === String(viewerId);
          const previous = messages[index - 1];
          const showDate =
            !previous ||
            new Date(previous.createdAt).toDateString() !==
              new Date(message.createdAt).toDateString();

          return (
            <div key={message.id}>
              {showDate && (
                <p className="my-4 text-center text-xs font-medium text-ink-400">
                  {formatDate(message.createdAt, { weekday: "long" })}
                </p>
              )}
              <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    mine
                      ? "rounded-br-md bg-brand-600 text-white"
                      : "rounded-bl-md bg-ink-100 text-ink-800",
                    message.pending && "opacity-60",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  <p
                    className={cn(
                      "mt-1 text-[10px]",
                      mine ? "text-brand-100/70" : "text-ink-400",
                    )}
                  >
                    {message.pending ? "Sending…" : formatTime(message.createdAt)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-ink-200 p-4">
        {conversation.isBlocked ? (
          <Alert tone="neutral">
            You&rsquo;ve blocked this conversation. Unblock it to send messages again.
          </Alert>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="flex items-end gap-2"
          >
            <label htmlFor="message-body" className="sr-only">
              Message
            </label>
            <textarea
              id="message-body"
              rows={1}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Write a message…  (Enter to send, Shift+Enter for a new line)"
              maxLength={4000}
              className="max-h-32 min-h-11 flex-1 resize-y rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm ring-1 ring-inset ring-ink-200 placeholder:text-ink-400 focus:ring-2 focus:ring-brand-500 focus:outline-none"
            />
            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              loading={pending}
              disabled={!body.trim()}
            >
              <Send className="size-4" />
            </Button>
          </form>
        )}
      </div>

      <ReportModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        conversationId={conversation.id}
      />
    </div>
  );
}

function ReportModal({ open, onClose, conversationId }) {
  const toast = useToast();
  const [reason, setReason] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    await api.post(`/api/messages/conversations/${conversationId}/actions`, {
      action: "REPORT",
      reason,
    });
    toast.success("Reported", "Our team will review this conversation.");
    onClose();
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report this conversation"
      description="Our safety team reviews every report."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={pending} disabled={reason.length < 10}>
            Submit report
          </Button>
        </>
      }
    >
      <Field label="What happened?" htmlFor="report-reason" error={fieldErrors.reason} required>
        <Textarea
          id="report-reason"
          rows={4}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          error={fieldErrors.reason}
          placeholder="Describe what concerned you…"
        />
      </Field>
    </Modal>
  );
}
