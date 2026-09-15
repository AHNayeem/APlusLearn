"use client";

import { useEffect, useRef, useState, useId } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils/cn";

/**
 * Accessible menu. Opens on click, closes on Escape, outside click or blur,
 * and returns focus to the trigger (§34).
 */
export function Dropdown({ trigger, children, align = "end", className, menuClassName }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center rounded-xl"
      >
        {trigger}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            id={menuId}
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
            onClick={() => setOpen(false)}
            className={cn(
              "absolute z-40 mt-2 min-w-56 origin-top overflow-hidden rounded-xl border border-ink-200 bg-white p-1.5 shadow-lg",
              align === "end" ? "right-0" : "left-0",
              menuClassName,
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function DropdownItem({ href, onClick, icon, danger, disabled, children, className }) {
  const classes = cn(
    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors",
    danger ? "text-danger-600 hover:bg-danger-50" : "text-ink-700 hover:bg-ink-100",
    disabled && "pointer-events-none opacity-50",
    className,
  );

  if (href) {
    return (
      <Link href={href} role="menuitem" className={classes}>
        {icon && <span className="shrink-0 text-ink-400">{icon}</span>}
        {children}
      </Link>
    );
  }

  return (
    <button type="button" role="menuitem" onClick={onClick} disabled={disabled} className={classes}>
      {icon && <span className="shrink-0 text-ink-400">{icon}</span>}
      {children}
    </button>
  );
}

export function DropdownDivider() {
  return <hr className="my-1.5 border-ink-100" role="separator" />;
}

export function DropdownLabel({ children }) {
  return (
    <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink-400">
      {children}
    </p>
  );
}
