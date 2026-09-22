"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Mail, MessageCircle, MessageSquareText, X } from "lucide-react";
import { Modal } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { SupportEnquiryForm } from "./SupportEnquiryForm";

/**
 * The floating help launcher.
 *
 * Collapsed it is one button. Expanded it is the two ways to reach a person —
 * WhatsApp, and a message to the support inbox — stacked above the toggle,
 * which becomes the close control.
 *
 * What it offers depends on who is looking, and the decision is made on the
 * server: a signed-in family is shown their own conversations first, because
 * "where is my tutor's reply" is the question they actually have, and the
 * support form sits underneath it for everything else. A visitor who is not
 * signed in gets the form and a way back to the sign-in page.
 *
 * WhatsApp is offered to both, and to neither when no number is configured —
 * the button is absent rather than disabled, because a support channel that
 * looks available and is not is worse than one that was never advertised.
 */

const LAUNCHER_CLEARANCE = "5.75rem";

export function FloatingChatWidget({
  whatsappUrl = null,
  whatsappLabel,
  supportEmail,
  messagesPath = null,
  account = null,
}) {
  const pathname = usePathname();
  const [expanded, setExpanded] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  /**
   * Toasts are anchored to the same corner (`z-[60]`, above this). Publishing
   * the launcher's height as a custom property lets the toast viewport lift
   * itself clear wherever the launcher is actually rendered, instead of every
   * screen guessing at a hard-coded offset.
   */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--support-launcher-clearance", LAUNCHER_CLEARANCE);
    return () => root.style.removeProperty("--support-launcher-clearance");
  }, []);

  // Escape collapses the stack. The modal handles its own.
  useEffect(() => {
    if (!expanded) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [expanded]);

  if (isSuppressed(pathname, messagesPath)) return null;

  const openPanel = () => {
    setExpanded(false);
    setPanelOpen(true);
  };

  return (
    <>
      {/*
        The launcher steps aside while its own panel is open. It sits below the
        dialog either way, so this is not about stacking — a bright button
        showing through the dimmed backdrop, next to the close control of the
        thing it just opened, reads as a second way out that is not one.
      */}
      <div
        hidden={panelOpen}
        className="no-print fixed z-40 flex flex-col items-end gap-3"
        /*
          Inset rather than Tailwind's `bottom-5 right-5`: the layout renders
          with `viewportFit: "cover"`, so on a phone with a home indicator the
          bottom 20px of the viewport is under the system gesture area and a
          button placed there is hard to press and easy to dismiss by accident.
        */
        style={{
          bottom: "calc(1.25rem + env(safe-area-inset-bottom, 0px))",
          right: "calc(1.25rem + env(safe-area-inset-right, 0px))",
        }}
      >
        <AnimatePresence>
          {expanded && (
            <motion.div
              key="channels"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="flex flex-col items-end gap-3"
            >
              {whatsappUrl && (
                <LauncherButton
                  as="a"
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  label={whatsappLabel ?? "Chat on WhatsApp"}
                  className="bg-[#25d366] text-white hover:bg-[#1fb757] focus-visible:outline-[#1fb757]"
                  onClick={() => setExpanded(false)}
                >
                  <WhatsAppIcon className="size-6" />
                </LauncherButton>
              )}

              <LauncherButton
                label={account ? "Messages and support" : "Message our team"}
                className="bg-accent-500 text-white hover:bg-accent-600 focus-visible:outline-accent-500"
                onClick={openPanel}
              >
                <MessageSquareText className="size-6" />
              </LauncherButton>
            </motion.div>
          )}
        </AnimatePresence>

        <button
          type="button"
          aria-expanded={expanded}
          aria-label={expanded ? "Close the help menu" : "Get help"}
          onClick={() => setExpanded((open) => !open)}
          className={cn(
            "flex size-14 items-center justify-center rounded-full shadow-lg ring-1 transition",
            "focus-visible:outline-2 focus-visible:outline-offset-2",
            "active:scale-95 motion-reduce:active:scale-100",
            expanded
              ? "bg-white text-ink-500 ring-ink-200 hover:bg-ink-50 hover:text-ink-700 focus-visible:outline-ink-400"
              : "bg-accent-500 text-white ring-transparent hover:bg-accent-600 focus-visible:outline-accent-500",
          )}
        >
          {expanded ? <X className="size-6" /> : <MessageCircle className="size-6" />}
        </button>
      </div>

      <Modal
        open={panelOpen}
        onClose={() => setPanelOpen(false)}
        title={account ? "How can we help?" : "Message our team"}
        description={
          account
            ? "Talk to your tutor, or send the support team a note."
            : "A person reads every message. We reply within one business day."
        }
        size="md"
      >
        <div className="space-y-5">
          {account && messagesPath && (
            <>
              <Link
                href={messagesPath}
                onClick={() => setPanelOpen(false)}
                className="flex items-center gap-4 rounded-2xl border border-brand-200 bg-brand-50/60 p-4 transition hover:border-brand-300 hover:bg-brand-50"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                  <MessageSquareText className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink-900">Your messages</span>
                  <span className="block text-sm text-ink-500">
                    Lesson questions belong here — your tutor sees them.
                  </span>
                </span>
                <ArrowRight className="size-4 shrink-0 text-brand-600" />
              </Link>

              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-ink-100" />
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-400">
                  Or write to support
                </span>
                <span className="h-px flex-1 bg-ink-100" />
              </div>
            </>
          )}

          <SupportEnquiryForm account={account} path={pathname} />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-ink-100 pt-4 text-sm">
            <a
              href={`mailto:${supportEmail}`}
              className="inline-flex items-center gap-1.5 font-semibold text-brand-600 hover:underline"
            >
              <Mail className="size-4" />
              {supportEmail}
            </a>
            {!account && (
              <Link
                href={`/login?next=${encodeURIComponent(pathname)}`}
                onClick={() => setPanelOpen(false)}
                className="font-semibold text-brand-600 hover:underline"
              >
                Already have an account? Sign in
              </Link>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

/**
 * Where the launcher stays out of the way.
 *
 * The admin console is an operations tool, not a support surface — an
 * administrator does not raise a ticket with themselves. `/offline` is served
 * from the service worker's cache with no network behind it, so every channel
 * it could offer is dead. And a launcher whose headline action is "open your
 * messages" is noise on the messages page itself.
 */
function isSuppressed(pathname, messagesPath) {
  if (!pathname) return true;
  if (pathname.startsWith("/admin") || pathname.startsWith("/offline")) return true;
  if (messagesPath && pathname.startsWith(messagesPath)) return true;
  return false;
}

/** A round channel button with the label that names it on wider screens. */
function LauncherButton({ as, label, className, children, ...props }) {
  const Element = as === "a" ? "a" : "button";

  return (
    <div className="group flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          "hidden rounded-lg bg-ink-900/90 px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm",
          "opacity-0 transition-opacity duration-150 sm:block",
          "group-hover:opacity-100 group-focus-within:opacity-100",
        )}
      >
        {label}
      </span>
      <Element
        {...(Element === "button" ? { type: "button" } : {})}
        aria-label={label}
        className={cn(
          "flex size-13 items-center justify-center rounded-full shadow-lg transition",
          "focus-visible:outline-2 focus-visible:outline-offset-2",
          "active:scale-95 motion-reduce:active:scale-100",
          className,
        )}
        {...props}
      >
        {children}
      </Element>
    </div>
  );
}

/**
 * WhatsApp's glyph is a trademark and is not in the icon set, so it is drawn
 * here rather than approximated with a generic speech bubble — the whole value
 * of the button is that it is recognised before it is read.
 */
function WhatsAppIcon({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 1.67c2.2 0 4.27.86 5.83 2.42a8.2 8.2 0 0 1 2.41 5.82c0 4.54-3.7 8.24-8.25 8.24a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.2 8.2 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24Zm-4.5 4.43c-.21 0-.55.08-.84.39-.29.31-1.1 1.08-1.1 2.63s1.13 3.05 1.29 3.26c.16.21 2.19 3.34 5.3 4.55.74.32 1.32.51 1.77.65.74.24 1.42.2 1.96.12.6-.09 1.84-.75 2.1-1.48.26-.73.26-1.35.18-1.48-.08-.13-.29-.21-.6-.36-.31-.16-1.84-.91-2.13-1.01-.29-.11-.5-.16-.71.15-.21.31-.81 1.01-.99 1.22-.18.21-.37.24-.68.08-.31-.16-1.31-.48-2.5-1.54-.92-.82-1.55-1.84-1.73-2.15-.18-.31-.02-.48.14-.63.14-.14.31-.37.47-.55.15-.19.2-.32.31-.53.1-.21.05-.39-.03-.55-.08-.16-.7-1.69-.96-2.31-.25-.61-.51-.53-.7-.54h-.6Z" />
    </svg>
  );
}
