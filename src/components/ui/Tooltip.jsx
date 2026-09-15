"use client";

import { useId, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils/cn";

/**
 * Tooltip that responds to hover *and* keyboard focus, so the content is not
 * mouse-only (§34).
 */
export function Tooltip({ content, children, side = "top", className }) {
  const [open, setOpen] = useState(false);
  const id = useId();

  const position = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[side];

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined} className="inline-flex">
        {children}
      </span>
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className={cn(
              "pointer-events-none absolute z-50 w-max max-w-64 rounded-lg bg-ink-900 px-2.5 py-1.5",
              "text-xs font-medium leading-snug text-white shadow-lg",
              position,
            )}
          >
            {content}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/** A small "?" affordance that reveals an explanation. */
export function InfoHint({ children, className }) {
  return (
    <Tooltip content={children} className={className}>
      <button
        type="button"
        aria-label="More information"
        className="flex size-4 items-center justify-center rounded-full bg-ink-200 text-[10px] font-bold text-ink-600 transition-colors hover:bg-ink-300"
      >
        ?
      </button>
    </Tooltip>
  );
}
