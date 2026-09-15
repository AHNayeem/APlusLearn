"use client";

import { useState, useId } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { cn } from "@/lib/utils/cn";

/**
 * Tabs with a sliding indicator. Arrow keys move between tabs, as the WAI-ARIA
 * tabs pattern expects (§34).
 */
export function Tabs({ tabs, defaultTab, value, onChange, className, children }) {
  const [internal, setInternal] = useState(defaultTab ?? tabs[0]?.value);
  const active = value ?? internal;
  const groupId = useId();

  const select = (next) => {
    setInternal(next);
    onChange?.(next);
  };

  const onKeyDown = (event) => {
    const index = tabs.findIndex((t) => t.value === active);
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      const delta = event.key === "ArrowRight" ? 1 : -1;
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      select(next.value);
      document.getElementById(`${groupId}-${next.value}`)?.focus();
    }
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        onKeyDown={onKeyDown}
        className="no-scrollbar -mb-px flex gap-1 overflow-x-auto border-b border-ink-200"
      >
        {tabs.map((tab) => {
          const selected = tab.value === active;
          return (
            <button
              key={tab.value}
              id={`${groupId}-${tab.value}`}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={`${groupId}-${tab.value}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(tab.value)}
              className={cn(
                "relative shrink-0 px-4 py-3 text-sm font-semibold transition-colors",
                selected ? "text-brand-700" : "text-ink-500 hover:text-ink-800",
              )}
            >
              <span className="flex items-center gap-2">
                {tab.label}
                {tab.count !== undefined && (
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                      selected ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500",
                    )}
                  >
                    {tab.count}
                  </span>
                )}
              </span>
              {selected && (
                <motion.span
                  layoutId={`${groupId}-indicator`}
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-brand-600"
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                />
              )}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`${groupId}-${active}-panel`}
        aria-labelledby={`${groupId}-${active}`}
        className="pt-6"
      >
        {typeof children === "function" ? children(active) : children}
      </div>
    </div>
  );
}

/** Tabs that are really links — used where each tab is its own URL (§29). */
export function LinkTabs({ tabs, activeValue, className }) {
  return (
    <nav
      aria-label="Sections"
      className={cn("no-scrollbar flex gap-1 overflow-x-auto border-b border-ink-200", className)}
    >
      {tabs.map((tab) => {
        const selected = tab.value === activeValue;
        return (
          <Link
            key={tab.value}
            href={tab.href}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "relative shrink-0 px-4 py-3 text-sm font-semibold transition-colors",
              selected
                ? "text-brand-700 after:absolute after:inset-x-2 after:-bottom-px after:h-0.5 after:rounded-full after:bg-brand-600"
                : "text-ink-500 hover:text-ink-800",
            )}
          >
            <span className="flex items-center gap-2">
              {tab.label}
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    selected ? "bg-brand-100 text-brand-700" : "bg-ink-100 text-ink-500",
                  )}
                >
                  {tab.count}
                </span>
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
