"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Send, MoreVertical, Flag, Archive, Ban, CalendarDays, RotateCw, AlertCircle, ShieldCheck, X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { api, ApiError } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Avatar, Badge, Button, Dropdown, DropdownItem, Field, Modal, Textarea,
  useToast, Rating,
} from "@/components/ui";
import { formatRelative, formatDate, formatTime } from "@/lib/utils/format";
import { BOOKING_STATUS_LABELS, UPLOAD } from "@/constants";
import { AttachmentList, AttachmentPicker } from "@/components/attachments/Attachments";
import {
  REALTIME_STATUS, useRealtimeEvent, useRealtimeStatus,
} from "@/components/realtime/RealtimeProvider";
import { REALTIME_EVENTS } from "@/lib/realtime/events";
import { mergeMessages, newClientId, newestStoredAt } from "./thread";

/**
 * A single conversation (§21).
 *
 * The thread is server-rendered, then kept current by the realtime stream
 * (docs/REALTIME.md): a `conversation` hint for this thread — or a reconnect,
 * after which any number of hints may have been missed — triggers a catch-up
 * read of what is new, through the same authorised endpoint as everything
 * else. The stream itself never carries a message.
 *
 * Sending is optimistic. Each send gets a `clientId` before it leaves, and the
 * server stores it beside the message, so:
 *   - whichever comes back first — the response, or the catch-up read the
 *     hint triggers — replaces the optimistic row, and the other changes
 *     nothing (`mergeMessages`);
 *   - a send that fails stays in the thread as *not sent*, with its text and
 *     files, and Retry re-sends under the same `clientId`. If the first
 *     attempt had in fact landed, the server answers with that message
 *     instead of storing a second.
 *
 * Two things in a thread are not a person's speech bubble. A SYSTEM message
 * (a lesson confirmed, cancelled or moved) is a centred event row. And a send
 * whose contact details the server removed (R17.7) comes back with a
 * `warning`, shown above the composer until it is dismissed — the sender
 * should know why their message reads differently from what they typed.
 */
export function ConversationView({ conversation, messages: initialMessages, bookings, viewerId }) {
  const router = useRouter();
  const toast = useToast();
  const status = useRealtimeStatus();
  const live = status === REALTIME_STATUS.OPEN;
  const [messages, setMessages] = useState(initialMessages);
  const [unread, setUnread] = useState(conversation.unreadCount);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [warning, setWarning] = useState(null);
  const endRef = useRef(null);
  // Sends go out one after another, so the thread's order is the order typed.
  const sendQueue = useRef(Promise.resolve());
  // Catch-up reads never overlap; a hint that lands mid-read asks for one more.
  const catchUpState = useRef({ running: false, again: false });
  const newestRef = useRef(newestStoredAt(initialMessages));

  // When the server sends a fresh thread, adopt it — keeping anything still
  // being sent, or that failed, which the server has never heard of.
  // Adjusting during render keeps the two lists from flickering apart.
  const [lastServerMessages, setLastServerMessages] = useState(initialMessages);
  if (lastServerMessages !== initialMessages) {
    setLastServerMessages(initialMessages);
    setMessages((current) => mergeMessages(current.filter((m) => m.local), initialMessages));
  }
  const [lastServerUnread, setLastServerUnread] = useState(conversation.unreadCount);
  if (lastServerUnread !== conversation.unreadCount) {
    setLastServerUnread(conversation.unreadCount);
    setUnread(conversation.unreadCount);
  }

  useEffect(() => {
    newestRef.current = newestStoredAt(messages);
  }, [messages]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length]);

  // Reading a thread clears its unread count — while it is actually on
  // screen. A message that arrives in a background tab stays unread until
  // the tab is looked at, which is also what the badge should say.
  const markRead = useEffectEvent(() => {
    if (unread <= 0 || document.visibilityState !== "visible") return;
    setUnread(0);
    api
      .post(`/api/messages/conversations/${conversation.id}/read`)
      // With the stream up, the badges follow on their own; without it, the
      // layout has to be asked again.
      .then(() => !live && router.refresh())
      .catch(() => {});
  });

  useEffect(() => {
    markRead();
  }, [unread, conversation.id]);

  useEffect(() => {
    const onVisible = () => markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  /** Fetch what is new since the newest stored message, and fold it in. */
  const catchUp = async () => {
    const state = catchUpState.current;
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    try {
      do {
        state.again = false;
        const since = new Date(
          newestRef.current ?? conversation.createdAt ?? Date.now() - 86_400_000,
        ).toISOString();
        const result = await api.get(
          `/api/messages/conversations/${conversation.id}?since=${encodeURIComponent(since)}`,
        );
        setMessages((current) => mergeMessages(current, result.messages));
        newestRef.current = Math.max(newestRef.current ?? 0, newestStoredAt(result.messages) ?? 0);
        setUnread(result.unreadCount);
        // More than one read's worth arrived while away: reload the thread.
        if (!result.complete) router.refresh();
      } while (state.again);
    } catch {
      // The next hint or reconnect tries again; nothing is lost by waiting.
    } finally {
      state.running = false;
    }
  };

  useRealtimeEvent(REALTIME_EVENTS.CONVERSATION, (event) => {
    if (event.id !== String(conversation.id)) return;
    setUnread(event.unreadCount);
    // A read receipt moves `updatedAt` but not `lastMessageAt`; only a newer
    // message is worth a read.
    const at = event.lastMessageAt ? new Date(event.lastMessageAt).getTime() : 0;
    if (at > (newestRef.current ?? 0)) catchUp();
  });
  useRealtimeEvent(REALTIME_EVENTS.RESYNC, () => catchUp());

  /** Send one local message; on failure it stays, marked, for Retry. */
  const deliver = async (draft) => {
    try {
      let result;
      if (draft.files.length) {
        const form = new FormData();
        form.set("conversationId", conversation.id);
        form.set("body", draft.body);
        form.set("clientId", draft.clientId);
        for (const file of draft.files) form.append("file", file);
        result = await api.post("/api/messages/attachments", form);
      } else {
        result = await api.post("/api/messages", {
          conversationId: conversation.id,
          body: draft.body,
          clientId: draft.clientId,
        });
      }
      setMessages((current) => mergeMessages(current, [result.message]));
      if (result.warning) setWarning(result.warning);
      // The stream brings the inbox and badges up to date by itself.
      if (!live) router.refresh();
    } catch (error) {
      setMessages((current) =>
        current.map((m) =>
          m.local && m.clientId === draft.clientId
            ? {
                ...m,
                status: "failed",
                // The server's reason when it gave one; otherwise it was never reached.
                error: error instanceof ApiError
                  ? error.message
                  : "Couldn't reach the server. Check your connection.",
              }
            : m,
        ),
      );
    }
  };

  const enqueue = (draft) => {
    sendQueue.current = sendQueue.current.then(() => deliver(draft));
  };

  /**
   * Put the composer's contents in the thread and send them. The optimistic
   * row shows the chosen filenames so the thread does not appear to swallow
   * them while a 10 MB scan uploads.
   */
  const submit = () => {
    const text = body.trim();
    const attached = files;
    if (!text && !attached.length) return;

    const clientId = newClientId();
    const draft = {
      id: `local-${clientId}`,
      clientId,
      local: true,
      status: "sending",
      senderId: viewerId,
      body: text,
      files: attached,
      attachments: attached.map((file, index) => ({
        id: `local-file-${clientId}-${index}`,
        fileName: file.name,
        contentType: file.type,
        sizeBytes: file.size,
        href: null,
      })),
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, draft]);
    setBody("");
    setFiles([]);
    enqueue(draft);
  };

  const retry = (draft) => {
    setMessages((current) =>
      current.map((m) =>
        m.local && m.clientId === draft.clientId ? { ...m, status: "sending", error: null } : m,
      ),
    );
    enqueue(draft);
  };

  /**
   * Take a failed message back into the composer. Re-picking a file is worse
   * than re-typing a sentence, so the files come back too; anything already
   * typed is kept ahead of it.
   */
  const edit = (draft) => {
    setMessages((current) => current.filter((m) => !(m.local && m.clientId === draft.clientId)));
    setBody((typed) => (typed.trim() ? `${typed}\n${draft.body}` : draft.body));
    setFiles((picked) => [...picked, ...draft.files].slice(0, UPLOAD.maxAttachmentsPerMessage));
  };

  const sending = messages.some((m) => m.local && m.status === "sending");
  const connection =
    status === REALTIME_STATUS.OFFLINE
      ? "Offline"
      : status === REALTIME_STATUS.RECONNECTING
        ? "Reconnecting…"
        : null;

  const other = conversation.otherParty;
  const tutorProfile = conversation.tutorProfileId;

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-w-0 flex-col rounded-2xl border border-ink-200 bg-white lg:h-[calc(100dvh-10rem)]">
      <header className="flex items-center gap-3 border-b border-ink-200 p-4">
        <Avatar src={other?.avatarUrl} name={other?.name} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink-900">
            {other?.name}
            {connection && (
              <span className="ml-2 text-xs font-medium text-ink-400" role="status">
                {connection}
              </span>
            )}
          </p>
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
          const dateRow = showDate && (
            <p className="my-4 text-center text-xs font-medium text-ink-400">
              {formatDate(message.createdAt, { weekday: "long" })}
            </p>
          );

          if (message.kind === "SYSTEM") {
            return (
              <div key={message.id}>
                {dateRow}
                <div className="flex justify-center">
                  <p className="inline-flex max-w-[90%] items-start gap-2 rounded-full border border-ink-200 bg-ink-50 px-3 py-1.5 text-center text-xs text-ink-600">
                    <CalendarDays className="mt-px size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
                    <span className="whitespace-pre-wrap break-words">{message.body}</span>
                    <span className="shrink-0 text-ink-400">{formatTime(message.createdAt)}</span>
                  </p>
                </div>
              </div>
            );
          }

          return (
            <div key={message.id}>
              {dateRow}
              <div className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
                    mine
                      ? "rounded-br-md bg-brand-600 text-white"
                      : "rounded-bl-md bg-ink-100 text-ink-800",
                    message.local && message.status === "sending" && "opacity-60",
                    message.local && message.status === "failed" && "opacity-80",
                  )}
                >
                  {message.body && (
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  )}
                  {message.attachments?.length > 0 && (
                    <AttachmentList
                      attachments={message.attachments}
                      tone={mine ? "dark" : "light"}
                      className={message.body ? undefined : "mt-0"}
                    />
                  )}
                  <p
                    className={cn(
                      "mt-1 text-[10px]",
                      mine ? "text-brand-100/70" : "text-ink-400",
                    )}
                  >
                    {message.local
                      ? message.status === "failed" ? "Not sent" : "Sending…"
                      : formatTime(message.createdAt)}
                  </p>
                </div>
              </div>
              {message.local && message.status === "failed" && (
                <div
                  role="alert"
                  className="mt-1 flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-xs"
                >
                  <span className="inline-flex items-center gap-1 text-danger-600">
                    <AlertCircle className="size-3.5" aria-hidden="true" />
                    {message.error ?? "Couldn't send this message."}
                  </span>
                  <button
                    type="button"
                    onClick={() => retry(message)}
                    className="inline-flex items-center gap-1 font-semibold text-brand-600 hover:underline"
                  >
                    <RotateCw className="size-3.5" aria-hidden="true" />
                    Retry
                  </button>
                  <button
                    type="button"
                    onClick={() => edit(message)}
                    className="font-semibold text-ink-500 hover:text-ink-700 hover:underline"
                  >
                    Edit
                  </button>
                </div>
              )}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-ink-200 p-4">
        {warning && !conversation.isBlocked && (
          <Alert
            tone="warning"
            className="mb-3"
            title={warning.masked ? "We removed contact details from your message" : "Keep it on APlus Learn"}
            action={
              <button
                type="button"
                onClick={() => setWarning(null)}
                className="rounded-lg p-1 text-warning-700 hover:bg-warning-100"
              >
                <X className="size-4" aria-hidden="true" />
                <span className="sr-only">Dismiss</span>
              </button>
            }
          >
            {warning.message}{" "}
            <Link href={warning.href} className="font-semibold underline">
              Community standards
            </Link>
          </Alert>
        )}
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
            className="flex flex-col gap-2"
          >
            <AttachmentPicker
              files={files}
              onChange={setFiles}
              max={UPLOAD.maxAttachmentsPerMessage}
            />
            <div className="flex items-end gap-2">
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
              loading={sending}
              disabled={!body.trim() && !files.length}
            >
              <Send className="size-4" />
            </Button>
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-ink-400">
              <ShieldCheck className="size-3.5 shrink-0" aria-hidden="true" />
              <span>
                Keep messages, bookings and payments on APlus Learn — phone numbers, emails and
                social handles are removed.{" "}
                <Link href="/legal/community-standards" className="underline hover:text-ink-600">
                  Why
                </Link>
              </span>
            </p>
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
