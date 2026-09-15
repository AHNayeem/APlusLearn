"use client";

import { useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils/cn";
import { IconButton } from "./Button";

/**
 * Accessible dialog (§34).
 *
 * Uses the native <dialog> focus semantics manually: focus moves in on open,
 * is trapped while open, Escape closes, and focus returns to the trigger.
 */

const SIZES = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({
  open,
  onClose,
  title,
  description,
  size = "md",
  children,
  footer,
  closeOnBackdrop = true,
}) {
  const panelRef = useRef(null);
  const previouslyFocused = useRef(null);

  const handleKeyDown = useCallback(
    (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose?.();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = panelRef.current.querySelectorAll(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable.length) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    // Focus the first control rather than the panel itself where possible.
    const timer = window.setTimeout(() => {
      const target =
        panelRef.current?.querySelector(
          'input, textarea, select, button:not([data-modal-close])',
        ) ?? panelRef.current;
      target?.focus();
    }, 50);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = overflow;
      previouslyFocused.current?.focus?.();
    };
  }, [open]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
          onKeyDown={handleKeyDown}
        >
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-0 bg-ink-900/40 backdrop-blur-[2px]"
            onClick={closeOnBackdrop ? onClose : undefined}
            aria-hidden="true"
          />

          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            initial={{ opacity: 0, y: 24, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "relative flex max-h-[92dvh] w-full flex-col overflow-hidden bg-white shadow-xl",
              "rounded-t-3xl sm:rounded-2xl",
              SIZES[size],
            )}
          >
            {(title || description) && (
              <div className="flex items-start justify-between gap-4 border-b border-ink-100 p-5 pr-4">
                <div className="min-w-0">
                  {title && <h2 className="text-lg font-bold text-ink-900">{title}</h2>}
                  {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
                </div>
                <IconButton
                  label="Close"
                  variant="ghost"
                  size="icon"
                  data-modal-close
                  onClick={onClose}
                  className="-mr-1 -mt-1"
                >
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
                  </svg>
                </IconButton>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto p-5">{children}</div>

            {footer && (
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ink-100 bg-ink-50/60 p-5">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Destructive-action confirmation. */
export function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  children,
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold text-ink-600 hover:bg-ink-100"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={cn(
              "inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold text-white shadow-sm disabled:opacity-50",
              tone === "danger" ? "bg-danger-600 hover:bg-danger-700" : "bg-brand-600 hover:bg-brand-700",
            )}
          >
            {loading ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
