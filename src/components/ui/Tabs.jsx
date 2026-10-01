"use client";

import { useState, useId } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { cn } from "@/lib/utils/cn";
import { Select } from "./Field";

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

/**
 * A vertical section menu beside its panel — for a console with more sections
 * than a horizontal strip can show without scrolling them out of sight.
 *
 * `groups` is `[{ label?, items: [{ value, label, hint? }] }]`; the headings
 * are visual grouping only, so the arrow keys move straight across them. Up
 * and Down move between sections, Home and End jump to either end, as the
 * WAI-ARIA tabs pattern expects for a vertical tablist (§34).
 *
 * Below `md` the column would push every form below a screenful of buttons,
 * so the same choice is offered as a native select instead.
 *
 * `footer` sits under the tablist rather than inside it: a link to another
 * page is not a tab, and putting one in the tablist would lie to a screen
 * reader about what activating it does.
 */
export function SideTabs({ groups, value, onChange, label, footer, className, children }) {
  const groupId = useId();
  const items = groups.flatMap((group) => group.items);
  const active = items.some((item) => item.value === value) ? value : items[0]?.value;

  const select = (next) => {
    if (next !== active) onChange?.(next);
  };

  const onKeyDown = (event) => {
    const index = items.findIndex((item) => item.value === active);
    const target = {
      ArrowDown: items[(index + 1) % items.length],
      ArrowUp: items[(index - 1 + items.length) % items.length],
      Home: items[0],
      End: items[items.length - 1],
    }[event.key];
    if (!target) return;
    event.preventDefault();
    select(target.value);
    document.getElementById(`${groupId}-${target.value}`)?.focus();
  };

  return (
    <div className={cn("flex flex-col gap-5 md:flex-row md:items-start md:gap-8", className)}>
      <div className="md:hidden">
        <label htmlFor={`${groupId}-select`} className="sr-only">
          {label}
        </label>
        <Select
          id={`${groupId}-select`}
          value={active}
          onChange={(event) => select(event.target.value)}
        >
          {groups.map((group, index) =>
            group.label ? (
              <optgroup key={group.label} label={group.label}>
                {group.items.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.hint ? `${item.label} · ${item.hint}` : item.label}
                  </option>
                ))}
              </optgroup>
            ) : (
              group.items.map((item) => (
                <option key={`${index}-${item.value}`} value={item.value}>
                  {item.hint ? `${item.label} · ${item.hint}` : item.label}
                </option>
              ))
            ),
          )}
        </Select>
        {footer && <div className="mt-3">{footer}</div>}
      </div>

      {/* Sticky under whichever top bar is showing: the 4rem mobile bar up to
          `lg`, the dashboard header from there. Capped to the viewport and
          scrolling on its own, so a menu taller than a short screen cannot
          hide its last entries until the panel beside it ends. The negative
          margin gives focus rings room inside the scroll box. */}
      <div
        className={cn(
          "sticky top-20 -mx-1 hidden max-h-[calc(100dvh-6rem)] w-54 shrink-0 overflow-y-auto px-1 pb-1 md:block",
          "lg:top-[calc(var(--header-height)+1.5rem)] lg:max-h-[calc(100dvh-var(--header-height)-3rem)]",
        )}
      >
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label={label}
          onKeyDown={onKeyDown}
          className="space-y-5"
        >
          {groups.map((group, index) => (
            <div key={group.label ?? index} role="presentation">
              {group.label && (
                <p
                  role="presentation"
                  className="mb-1.5 px-3 text-[11px] font-bold uppercase tracking-wider text-ink-400"
                >
                  {group.label}
                </p>
              )}
              <div role="presentation" className="space-y-0.5">
                {group.items.map((item) => {
                  const selected = item.value === active;
                  return (
                    <button
                      key={item.value}
                      id={`${groupId}-${item.value}`}
                      role="tab"
                      type="button"
                      aria-selected={selected}
                      aria-controls={`${groupId}-panel`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => select(item.value)}
                      className={cn(
                        "relative flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors",
                        selected
                          ? "bg-brand-50 text-brand-700"
                          : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                      )}
                    >
                      {selected && (
                        <motion.span
                          layoutId={`${groupId}-indicator`}
                          aria-hidden="true"
                          className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-brand-600"
                          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                        />
                      )}
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.hint && (
                        <span
                          className={cn(
                            "shrink-0 text-[11px] font-medium",
                            selected ? "text-brand-600" : "text-ink-400",
                          )}
                        >
                          {item.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {footer && <div className="mt-5 border-t border-ink-200 pt-4">{footer}</div>}
      </div>

      <div
        role="tabpanel"
        id={`${groupId}-panel`}
        aria-labelledby={`${groupId}-${active}`}
        className="min-w-0 max-w-3xl flex-1"
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
