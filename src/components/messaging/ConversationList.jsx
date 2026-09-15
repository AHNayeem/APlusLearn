import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Avatar, Badge, EmptyState, Button } from "@/components/ui";
import { formatRelative } from "@/lib/utils/format";

/** Inbox list, shared by the parent and tutor message screens (§21). */
export function ConversationList({ conversations, activeId, basePath = "/messages", className }) {
  if (conversations.length === 0) {
    return (
      <EmptyState
        className={className}
        icon={<MessageSquare className="size-6" />}
        title="No conversations yet"
        description="Messaging a tutor is free and doesn't commit you to booking."
        action={
          basePath === "/messages" ? <Button href="/find-a-tutor">Find a tutor</Button> : undefined
        }
      />
    );
  }

  return (
    <ul className={cn("divide-y divide-ink-100", className)}>
      {conversations.map((conversation) => {
        const active = conversation.id === activeId;
        return (
          <li key={conversation.id}>
            <Link
              href={`${basePath}/${conversation.id}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex gap-3 p-4 transition-colors",
                active ? "bg-brand-50" : "hover:bg-ink-50",
              )}
            >
              <Avatar
                src={conversation.otherParty?.avatarUrl}
                name={conversation.otherParty?.name}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p
                    className={cn(
                      "truncate text-sm",
                      conversation.unreadCount > 0
                        ? "font-bold text-ink-900"
                        : "font-semibold text-ink-800",
                    )}
                  >
                    {conversation.otherParty?.name}
                  </p>
                  <span className="shrink-0 text-[11px] text-ink-400">
                    {formatRelative(conversation.lastMessageAt)}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-2">
                  <p
                    className={cn(
                      "min-w-0 flex-1 truncate text-xs",
                      conversation.unreadCount > 0 ? "font-medium text-ink-700" : "text-ink-500",
                    )}
                  >
                    {conversation.lastMessagePreview ?? "No messages yet"}
                  </p>
                  {conversation.unreadCount > 0 && (
                    <Badge tone="brand" size="sm">
                      {conversation.unreadCount}
                    </Badge>
                  )}
                </div>
                {conversation.bookingId && (
                  <p className="mt-1 truncate text-[11px] text-ink-400">
                    About {conversation.bookingId.courseCode ?? conversation.bookingId.courseName}
                  </p>
                )}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
