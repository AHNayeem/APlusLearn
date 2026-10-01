"use client";

import { useEffect, useId, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Download, Ellipsis, Share, SquarePlus, X } from "lucide-react";
import { Button, IconButton, useToast } from "@/components/ui";
import { PWA_INSTALL_PROMPT } from "@/constants/config";
import {
  ACCEPTED_KEY,
  DEFERRED_PROMPT_EVENT,
  DEFERRED_PROMPT_GLOBAL,
  DISMISSED_KEY,
  INSTALL_OFFER,
  isIosSafari,
  isRunningInstalled,
  resolveInstallPrompt,
} from "@/lib/pwa/install";

/**
 * "Install this app", offered once the visitor has had time to look around
 * (docs/PWA.md).
 *
 * Every decision is made by `resolveInstallPrompt()`; this component gathers
 * the browser facts it needs and renders what it says. Two offers, and only
 * two: a real "Install App" button when the browser handed over a
 * `beforeinstallprompt` event, and Safari's own Add to Home Screen steps on
 * iOS, which has no such event and no button that could stand in for one.
 *
 * It is a *non-modal* card. Nothing behind it is dimmed or locked, focus is
 * not moved into it on arrival — an unsolicited card that took the caret out
 * of a half-typed search would be the intrusive popup this is meant not to be
 * — and Escape closes it. On a phone it is a sheet across the bottom, lifted
 * clear of the support launcher by the clearance the launcher publishes; from
 * `sm` up it is a compact card at the bottom centre, clear of both the
 * launcher and toasts in the bottom-right and the dashboard sidebar's account
 * links in the bottom-left.
 *
 * Nothing here knows who is signed in. Installing the application is a fact
 * about this browser, not about an account.
 */

/** Wait this long before offering while the visitor is typing in a field. */
const TYPING_RETRY_MS = 5_000;

export function InstallPrompt({ appName }) {
  const pathname = usePathname();
  const toast = useToast();
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const descriptionId = useId();
  const cardRef = useRef(null);
  const returnFocusRef = useRef(null);

  // `null` until the delay has elapsed: nothing is read, and nothing can be
  // shown, before the visitor has had the page to themselves for a while.
  const [environment, setEnvironment] = useState(null);
  const [deferred, setDeferred] = useState(null);
  const [closed, setClosed] = useState(false);
  const [busy, setBusy] = useState(false);

  // The delay counts time *in view*, and holds off while someone is typing.
  useEffect(() => {
    let remaining = PWA_INSTALL_PROMPT.delaySeconds * 1000;
    let startedAt = 0;
    let timer = null;

    const elapse = () => {
      timer = null;
      if (isTyping()) {
        remaining = TYPING_RETRY_MS;
        resume();
        return;
      }
      setDeferred(window[DEFERRED_PROMPT_GLOBAL] ?? null);
      setEnvironment(readEnvironment());
    };
    const resume = () => {
      if (timer || document.visibilityState !== "visible") return;
      startedAt = performance.now();
      timer = window.setTimeout(elapse, Math.max(0, remaining));
    };
    const pause = () => {
      if (!timer) return;
      window.clearTimeout(timer);
      timer = null;
      remaining -= performance.now() - startedAt;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? resume() : pause());

    resume();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  // The event can arrive after the delay too, and the app can be installed
  // from the browser's own menu while this card is on screen.
  useEffect(() => {
    const onDeferred = () => setDeferred(window[DEFERRED_PROMPT_GLOBAL] ?? null);
    const onInstalled = () => {
      writeSession(ACCEPTED_KEY, "1");
      setDeferred(null);
      setClosed(true);
    };
    // "Not now" in another tab applies to this one as well.
    const onStorage = (event) => {
      if (event.key === DISMISSED_KEY && event.newValue) setClosed(true);
    };
    window.addEventListener(DEFERRED_PROMPT_EVENT, onDeferred);
    window.addEventListener("appinstalled", onInstalled);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEFERRED_PROMPT_EVENT, onDeferred);
      window.removeEventListener("appinstalled", onInstalled);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const decision = environment
    ? resolveInstallPrompt({ ...environment, nativeAvailable: Boolean(deferred), pathname })
    : null;
  const visible = Boolean(decision?.visible) && !closed;
  const offer = decision?.offer;

  /** Hand focus back before the card leaves, so it is never dropped on <body>. */
  const restoreFocus = () => {
    if (!cardRef.current?.contains(document.activeElement)) return;
    const target = returnFocusRef.current;
    if (target?.isConnected && typeof target.focus === "function") {
      target.focus({ preventScroll: true });
    } else {
      document.getElementById("main")?.focus?.({ preventScroll: true });
    }
  };

  const dismiss = () => {
    writeLocal(DISMISSED_KEY, String(Date.now()));
    restoreFocus();
    setClosed(true);
  };

  useEffect(() => {
    if (!visible) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // A modal dialog owns Escape while it is open.
      if (document.querySelector('[aria-modal="true"]')) return;
      const active = document.activeElement;
      const inCard = cardRef.current?.contains(active);
      // Escape in somebody's search box means "clear this", not "close that".
      if (!inCard && active && active !== document.body) return;
      dismiss();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const install = async () => {
    const event = deferred;
    if (!event) return;
    setBusy(true);
    let outcome = "unavailable";
    try {
      // Called first and synchronously inside the click, while the browser
      // still counts this as the visitor's own gesture.
      await event.prompt();
      outcome = (await event.userChoice)?.outcome ?? "unavailable";
    } catch {
      // The event was already used, or the browser withdrew it. Either way it
      // cannot be used again; another one arrives with the next page load.
    }
    // An install event is good for exactly one prompt.
    window[DEFERRED_PROMPT_GLOBAL] = null;
    setBusy(false);
    restoreFocus();

    if (outcome === "accepted") {
      writeSession(ACCEPTED_KEY, "1");
      toast.success(`Installing ${appName}`, "You'll find it with your other apps.");
    } else if (outcome === "dismissed") {
      // Turning the browser's dialog down is a "not now" too — don't ask again
      // on the next page.
      writeLocal(DISMISSED_KEY, String(Date.now()));
    }
    setDeferred(null);
    setClosed(true);
  };

  const rememberReturnFocus = (event) => {
    if (!cardRef.current?.contains(event.relatedTarget)) returnFocusRef.current = event.relatedTarget;
  };

  return (
    <>
      <p className="sr-only" aria-live="polite">
        {visible ? `You can install ${appName} as an app. The offer is at the end of the page.` : ""}
      </p>
      <AnimatePresence>
        {visible && (
          <div
            key="install-prompt"
            className={[
              "no-print pointer-events-none fixed z-40 flex justify-center",
              "left-[max(0.75rem,env(safe-area-inset-left,0px))] right-[max(0.75rem,env(safe-area-inset-right,0px))]",
              "bottom-[calc(0.75rem+env(safe-area-inset-bottom,0px)+var(--support-launcher-clearance,0px))]",
              "sm:bottom-[calc(1.25rem+env(safe-area-inset-bottom,0px))]",
            ].join(" ")}
          >
            <motion.div
              ref={cardRef}
              role="dialog"
              aria-modal="false"
              aria-labelledby={titleId}
              aria-describedby={descriptionId}
              data-install-prompt={offer}
              onFocus={rememberReturnFocus}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 16 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
              className="pointer-events-auto w-full max-w-full rounded-2xl bg-white p-4 shadow-xl ring-1 ring-ink-200 sm:max-w-sm"
            >
              <div className="flex items-start gap-3">
                <Image
                  src="/icons/icon-192.png"
                  alt=""
                  width={44}
                  height={44}
                  className="size-11 shrink-0 rounded-xl ring-1 ring-ink-100"
                />
                <div className="min-w-0 flex-1">
                  <h2 id={titleId} className="text-base font-bold text-ink-900">
                    Install {appName}
                  </h2>
                  <p id={descriptionId} className="mt-0.5 text-sm text-ink-500">
                    {offer === INSTALL_OFFER.IOS
                      ? `Add ${appName} to your Home Screen for a faster, app-like experience.`
                      : `Install ${appName} on your device for a faster, app-like experience.`}
                  </p>
                </div>
                <IconButton
                  label="Close"
                  variant="ghost"
                  onClick={dismiss}
                  className="-mr-2 -mt-2 size-10 text-ink-500"
                >
                  <X className="size-5" aria-hidden="true" />
                </IconButton>
              </div>

              {offer === INSTALL_OFFER.IOS && <SafariSteps />}

              <div className="mt-4 flex gap-2 sm:justify-end">
                <Button
                  variant={offer === INSTALL_OFFER.IOS ? "secondary" : "ghost"}
                  size="sm"
                  onClick={dismiss}
                  className="h-11 flex-1 sm:h-9 sm:flex-none"
                >
                  Not now
                </Button>
                {offer === INSTALL_OFFER.NATIVE && (
                  <Button
                    size="sm"
                    onClick={install}
                    loading={busy}
                    iconLeft={<Download className="size-4" aria-hidden="true" />}
                    className="h-11 flex-1 sm:h-9 sm:flex-none"
                  >
                    Install App
                  </Button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
}

/**
 * Safari's own Add to Home Screen steps. Worded as Safari's, with Safari's
 * glyphs, because nothing on this page can open that sheet — the visitor is
 * being told where to tap in the browser, not given a control.
 *
 * Where Share lives moved in iOS 26: the default compact toolbar tucks it
 * under "•••", and an iPad keeps it in the top toolbar. The step names both
 * the button and the fallback rather than a position, so it is right on each.
 */
function SafariSteps() {
  return (
    <div className="mt-3 rounded-xl bg-ink-50 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">In Safari</p>
      <ol className="mt-2 space-y-2 text-sm text-ink-700">
        <Step n={1}>
          Tap <strong className="font-semibold text-ink-900">Share</strong>
          <Glyph><Share className="size-3.5" aria-hidden="true" /></Glyph>
          <span className="text-ink-500">
            {" "}— not there? Tap
            <Glyph><Ellipsis className="size-3.5" aria-hidden="true" /></Glyph>
            first
          </span>
        </Step>
        <Step n={2}>
          Choose <strong className="font-semibold text-ink-900">Add to Home Screen</strong>
          <Glyph><SquarePlus className="size-3.5" aria-hidden="true" /></Glyph>
        </Step>
        <Step n={3}>
          Tap <strong className="font-semibold text-ink-900">Add</strong>.
        </Step>
      </ol>
    </div>
  );
}

function Step({ n, children }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-brand-700 ring-1 ring-ink-200"
      >
        {n}
      </span>
      <span className="min-w-0">
        <span className="sr-only">Step {n}: </span>
        {children}
      </span>
    </li>
  );
}

function Glyph({ children }) {
  return (
    <span className="mx-1 inline-flex size-5 translate-y-[3px] items-center justify-center rounded-md bg-white text-brand-700 ring-1 ring-ink-200">
      {children}
    </span>
  );
}

/** Everything the decision needs from the browser, read once the delay is up. */
function readEnvironment() {
  return {
    installed: isRunningInstalled({
      matchMedia: window.matchMedia?.bind(window),
      navigator: window.navigator,
      referrer: document.referrer,
    }),
    accepted: readSession(ACCEPTED_KEY) === "1",
    dismissedAt: readLocal(DISMISSED_KEY),
    now: Date.now(),
    iosSafari: isIosSafari({
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      maxTouchPoints: navigator.maxTouchPoints,
    }),
  };
}

function isTyping() {
  const active = document.activeElement;
  if (!active || active === document.body) return false;
  return active.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(active.tagName);
}

// Storage can be refused outright (private browsing, managed browsers). The
// prompt still works for the visit; it just cannot remember a "Not now".
function readLocal(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // See above.
  }
}
function readSession(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeSession(key, value) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // See above.
  }
}
