"use client";

import { createContext, useContext, useEffect, useEffectEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { REALTIME_EVENTS, REALTIME_BYE_REASONS } from "@/lib/realtime/events";

/**
 * The browser end of realtime delivery (docs/REALTIME.md).
 *
 * One `EventSource` per tab that is in view, opened here — once, for the whole
 * dashboard — and never by an individual component. Components listen through
 * `useRealtimeEvent`, and answer an event by reading through the API they
 * already use: the stream says *what* changed, never what it now says.
 *
 * What makes it safe to lose events is `RESYNC`. It is emitted on every
 * `ready` — the first event of every connection, including reconnects after a
 * network drop, a sleeping laptop or a server restart — and whenever the
 * server says it may have missed something. Every listener treats it as
 * "reconcile from the database", so a missed event costs a fetch, never a
 * message.
 *
 * A tab that has been hidden for a while closes its stream rather than holding
 * a connection nobody is looking at; it reconciles the moment it is back in
 * view. That keeps the connection count to the tabs actually on screen without
 * electing a leader across tabs, which a frozen background tab would break.
 */

export const REALTIME_STATUS = Object.freeze({
  CONNECTING: "connecting",
  OPEN: "open",
  RECONNECTING: "reconnecting",
  OFFLINE: "offline",
  /** Hidden long enough to let the connection go; resumes when in view. */
  PAUSED: "paused",
  /** Signed out. Pages work as they did before realtime. */
  CLOSED: "closed",
});

const STREAM_URL = "/api/realtime";
/** Longest silence tolerated; the server pings every 20 s. */
const WATCHDOG_MS = 50_000;
const HIDDEN_GRACE_MS = 30_000;
const BACKOFF_MAX_MS = 30_000;

const EmitterContext = createContext(null);
const StateContext = createContext(null);

function createEmitter() {
  const listeners = new Map();
  return {
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type)?.delete(fn);
    },
    emit(type, data) {
      for (const fn of listeners.get(type) ?? []) {
        try {
          fn(data);
        } catch (error) {
          console.error(`[realtime] a ${type} listener failed:`, error);
        }
      }
    },
  };
}

function parse(event) {
  try {
    return JSON.parse(event.data);
  } catch {
    return {};
  }
}

export function RealtimeProvider({ initialCounts, children }) {
  const router = useRouter();
  const [emitter] = useState(createEmitter);
  const [counts, setCounts] = useState(initialCounts);
  const [status, setStatus] = useState(REALTIME_STATUS.CONNECTING);

  // A server render (a refresh, a navigation that re-renders the layout)
  // brings counts read from the database; adopt them, as the stream's are.
  const [lastInitial, setLastInitial] = useState(initialCounts);
  if (lastInitial !== initialCounts) {
    setLastInitial(initialCounts);
    setCounts(initialCounts);
  }

  const signedOut = useEffectEvent(() => router.refresh());

  useEffect(() => {
    // No `EventSource`: the status never reaches OPEN, so every page keeps
    // refreshing after its own actions exactly as it did before realtime.
    if (typeof window.EventSource === "undefined") return undefined;

    let source = null;
    let attempt = 0;
    let stopped = false;
    let retryTimer = null;
    let hiddenTimer = null;
    let watchdog = null;

    const touch = () => {
      clearTimeout(watchdog);
      // A stream that has gone quiet — a proxy buffering it, a socket the OS
      // dropped without telling anyone — is treated as broken.
      watchdog = setTimeout(() => {
        disconnect();
        scheduleReconnect();
      }, WATCHDOG_MS);
    };

    const disconnect = () => {
      clearTimeout(watchdog);
      clearTimeout(retryTimer);
      retryTimer = null;
      if (source) {
        source.close();
        source = null;
      }
    };

    const scheduleReconnect = () => {
      if (stopped || retryTimer) return;
      setStatus(navigator.onLine === false ? REALTIME_STATUS.OFFLINE : REALTIME_STATUS.RECONNECTING);
      const base = Math.min(BACKOFF_MAX_MS, 1000 * 2 ** attempt);
      attempt += 1;
      retryTimer = setTimeout(() => {
        retryTimer = null;
        connect();
      }, base / 2 + Math.random() * (base / 2));
    };

    const listen = (type, handler) =>
      source.addEventListener(type, (event) => {
        touch();
        handler(parse(event));
      });

    function connect() {
      if (stopped || source) return;
      if (document.visibilityState === "hidden") {
        setStatus(REALTIME_STATUS.PAUSED);
        return;
      }
      if (navigator.onLine === false) {
        setStatus(REALTIME_STATUS.OFFLINE);
        return;
      }

      source = new EventSource(STREAM_URL);
      touch();

      listen(REALTIME_EVENTS.READY, (data) => {
        attempt = 0;
        setStatus(REALTIME_STATUS.OPEN);
        if (data.counts) setCounts(data.counts);
        emitter.emit(REALTIME_EVENTS.RESYNC, data);
      });
      listen(REALTIME_EVENTS.COUNTS, (data) => setCounts(data));
      listen(REALTIME_EVENTS.PING, () => {});
      for (const type of [
        REALTIME_EVENTS.NOTIFICATION,
        REALTIME_EVENTS.NOTIFICATION_UPDATED,
        REALTIME_EVENTS.CONVERSATION,
        REALTIME_EVENTS.RESYNC,
      ]) {
        listen(type, (data) => emitter.emit(type, data));
      }
      listen(REALTIME_EVENTS.BYE, ({ reason }) => {
        disconnect();
        if (reason === REALTIME_BYE_REASONS.UNAUTHORIZED) {
          stopped = true;
          setStatus(REALTIME_STATUS.CLOSED);
          // The layout's own guard decides where a signed-out visitor goes.
          signedOut();
        } else if (reason === REALTIME_BYE_REASONS.LIFETIME) {
          attempt = 0;
          connect();
        } else if (reason === REALTIME_BYE_REASONS.REPLACED) {
          setStatus(REALTIME_STATUS.PAUSED);
        } else {
          scheduleReconnect();
        }
      });

      // The browser's own retry cannot tell a 401 from a blip and gives up on
      // either, so every error is handled here, with backoff.
      source.onerror = () => {
        disconnect();
        scheduleReconnect();
      };
    }

    const resume = () => {
      clearTimeout(hiddenTimer);
      hiddenTimer = null;
      if (stopped || source) return;
      attempt = 0;
      clearTimeout(retryTimer);
      retryTimer = null;
      connect();
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        resume();
      } else if (!hiddenTimer) {
        hiddenTimer = setTimeout(() => {
          hiddenTimer = null;
          disconnect();
          setStatus(REALTIME_STATUS.PAUSED);
        }, HIDDEN_GRACE_MS);
      }
    };

    const onOffline = () => {
      disconnect();
      setStatus(REALTIME_STATUS.OFFLINE);
    };

    // Leaving for the back/forward cache closes the stream (an open one would
    // keep the page out of it); coming back is a reconnect like any other.
    const onPageHide = () => disconnect();
    const onPageShow = (event) => {
      if (event.persisted) resume();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", resume);
    window.addEventListener("offline", onOffline);
    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("pageshow", onPageShow);
    connect();

    return () => {
      stopped = true;
      clearTimeout(hiddenTimer);
      disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", resume);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [emitter]);

  return (
    <EmitterContext.Provider value={emitter}>
      <StateContext.Provider value={{ counts, status }}>{children}</StateContext.Provider>
    </EmitterContext.Provider>
  );
}

/**
 * Call `handler(data)` for every `type` event while mounted. Outside a
 * provider it does nothing, so a component can be used anywhere.
 */
export function useRealtimeEvent(type, handler) {
  const emitter = useContext(EmitterContext);
  const onEvent = useEffectEvent(handler);
  useEffect(() => {
    if (!emitter) return undefined;
    return emitter.on(type, (data) => onEvent(data));
  }, [emitter, type]);
}

/** `{ messages, notifications }` as last reported, or null outside a provider. */
export function useRealtimeCounts() {
  return useContext(StateContext)?.counts ?? null;
}

/** The connection's state, or null outside a provider. */
export function useRealtimeStatus() {
  return useContext(StateContext)?.status ?? null;
}
