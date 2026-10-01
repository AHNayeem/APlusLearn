"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api/client";
import { useRealtimeEvent } from "@/components/realtime/RealtimeProvider";
import { REALTIME_EVENTS } from "@/lib/realtime/events";
import { ConversationList } from "./ConversationList";

/** Hints in a burst — a reply and its read receipt — become one read. */
const REFRESH_DEBOUNCE_MS = 300;

/**
 * The inbox, kept current by the realtime stream (§21, docs/REALTIME.md).
 *
 * The stream says a thread changed, never what it now says, so the list is
 * re-read through the same endpoint and checks as any other inbox read —
 * once per burst of hints, and once on every reconnect. Rendering is
 * `ConversationList`'s, unchanged.
 */
export function LiveConversationList({ conversations: initial, pageSize = 50, ...props }) {
  const [conversations, setConversations] = useState(initial);
  const timer = useRef(null);

  // A fresh server render is the newer truth; adopt it.
  const [lastInitial, setLastInitial] = useState(initial);
  if (lastInitial !== initial) {
    setLastInitial(initial);
    setConversations(initial);
  }

  const refresh = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const result = await api.get(`/api/messages/conversations?pageSize=${pageSize}`);
        setConversations(result.conversations);
      } catch {
        // Kept as it was; the next hint or reconnect reads again.
      }
    }, REFRESH_DEBOUNCE_MS);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  useRealtimeEvent(REALTIME_EVENTS.CONVERSATION, refresh);
  useRealtimeEvent(REALTIME_EVENTS.RESYNC, refresh);

  return <ConversationList conversations={conversations} {...props} />;
}
