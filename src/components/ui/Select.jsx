"use client";

import { Children, Fragment, isValidElement, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils/cn";
import { CONTROL_BASE, CONTROL_ERROR } from "./control-styles";

/**
 * A searchable select.
 *
 * Takes exactly what a native <select> takes — <option> / <optgroup>
 * children, `value` + `onChange(event)` or `name` + `defaultValue` — so every
 * call site stays a plain select. What the user sees is a combobox: a button
 * showing the current choice, and a popup with a search box over the
 * options (§34: arrow keys, Enter, Escape, Home/End, type-to-search).
 *
 * A real <select>, hidden, stays the source of truth. Picking an option sets
 * its value and dispatches a genuine `change` event, so `onChange` receives
 * the same event (and `event.target.value`) it always did, forms submit and
 * reset it, and a controlled value the parent refuses snaps back as before.
 *
 * `unstyled` drops the control chrome (and the chevron) for call sites that
 * draw their own cell around it.
 */
export function Select({
  id,
  className,
  error,
  children,
  value,
  defaultValue,
  onChange,
  name,
  form,
  required,
  autoComplete,
  disabled,
  unstyled = false,
  searchPlaceholder = "Search…",
  onKeyDown,
  ...triggerProps
}) {
  const generated = useId();
  const baseId = id ?? generated;
  const listboxId = `${baseId}-listbox`;
  const optionId = (index) => `${baseId}-option-${index}`;

  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);
  const nativeRef = useRef(null);
  const popupRef = useRef(null);
  const searchRef = useRef(null);
  const listRef = useRef(null);

  const controlled = value !== undefined;
  const options = collectOptions(children);
  const [uncontrolled, setUncontrolled] = useState(() =>
    defaultValue !== undefined ? String(defaultValue) : (firstEnabled(options)?.value ?? ""),
  );
  const current = controlled ? String(value ?? "") : uncontrolled;
  // A value no option carries shows what the native control would: the
  // first option that can be chosen.
  const selected = options.find((o) => o.value === current) ?? firstEnabled(options);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [position, setPosition] = useState(null);
  const [focusSearch, setFocusSearch] = useState(true);
  const lastPointer = useRef("mouse");

  const matches = filterOptions(options, query);

  const openWith = (initialQuery = "") => {
    if (disabled) return;
    const filtered = filterOptions(options, initialQuery);
    const selectedIndex = initialQuery ? -1 : filtered.findIndex((o) => o.value === selected?.value);
    setQuery(initialQuery);
    setActive(selectedIndex >= 0 ? selectedIndex : nextEnabled(filtered, -1, 1));
    // A touch opens the list without summoning the on-screen keyboard over
    // it; the search box is one tap away.
    setFocusSearch(lastPointer.current !== "touch");
    setPosition(placePopup(triggerRef.current));
    setOpen(true);
  };

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus({ preventScroll: true });
  };

  const choose = (option) => {
    if (!option || option.disabled) return;
    const select = nativeRef.current;
    if (select && select.value !== option.value) {
      select.value = option.value;
      select.dispatchEvent(new Event("input", { bubbles: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    close();
  };

  // Uncontrolled: follow a form reset back to the default.
  useEffect(() => {
    const owner = nativeRef.current?.form;
    if (controlled || !owner) return undefined;
    const onReset = () => {
      window.setTimeout(() => setUncontrolled(nativeRef.current?.value ?? ""), 0);
    };
    owner.addEventListener("reset", onReset);
    return () => owner.removeEventListener("reset", onReset);
  }, [controlled]);

  // While open: dismiss on outside press, follow the trigger on scroll/resize.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (wrapperRef.current?.contains(event.target)) return;
      if (popupRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const reposition = (event) => {
      if (event?.type === "scroll" && popupRef.current?.contains(event.target)) return;
      setPosition(placePopup(triggerRef.current));
    };

    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !focusSearch) return;
    const input = searchRef.current;
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(input.value.length, input.value.length);
  }, [open, focusSearch]);

  // Keep the keyboard's option in view.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onTriggerKeyDown = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    const { key } = event;

    if (open) {
      if (key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else {
        onListKeyDown(event);
      }
      return;
    }

    if (["ArrowDown", "ArrowUp", "Enter", " "].includes(key)) {
      event.preventDefault();
      lastPointer.current = "keyboard";
      openWith();
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // Type-to-search straight from the closed control.
      event.preventDefault();
      lastPointer.current = "keyboard";
      openWith(key);
    }
  };

  const onListKeyDown = (event) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((index) => nextEnabled(matches, index, 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActive((index) => nextEnabled(matches, index < 0 ? matches.length : index, -1));
        break;
      case "PageDown":
        event.preventDefault();
        setActive((index) => nextEnabled(matches, Math.min(index + 9, matches.length - 2), 1));
        break;
      case "PageUp":
        event.preventDefault();
        setActive((index) => nextEnabled(matches, Math.max(index - 9, 1), -1));
        break;
      case "Home":
        if (event.target === searchRef.current && !event.ctrlKey) break;
        event.preventDefault();
        setActive(nextEnabled(matches, -1, 1));
        break;
      case "End":
        if (event.target === searchRef.current && !event.ctrlKey) break;
        event.preventDefault();
        setActive(nextEnabled(matches, matches.length, -1));
        break;
      case "Enter":
        event.preventDefault();
        choose(matches[active]);
        break;
      case "Escape":
        // Closes the list, not a dialog the select sits in.
        event.preventDefault();
        event.stopPropagation();
        close();
        break;
      case "Tab":
        // Hand focus back to the trigger and let the browser move on from it.
        setOpen(false);
        triggerRef.current?.focus({ preventScroll: true });
        break;
      default:
    }
  };

  return (
    <div ref={wrapperRef} className={unstyled ? "relative min-w-0" : "relative"}>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        {...triggerProps}
        onPointerDown={(event) => {
          lastPointer.current = event.pointerType || "mouse";
          triggerProps.onPointerDown?.(event);
        }}
        onClick={(event) => {
          triggerProps.onClick?.(event);
          if (event.defaultPrevented) return;
          if (open) close(false);
          else openWith();
        }}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          unstyled
            ? "block w-full text-left"
            : cn(CONTROL_BASE, "flex items-center gap-2 text-left", error && CONTROL_ERROR),
          "cursor-pointer disabled:cursor-not-allowed",
          className,
        )}
      >
        <span className="block min-w-0 flex-1 truncate">{selected?.label || " "}</span>
        {!unstyled && (
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className={cn(
              "-mr-1 size-4 shrink-0 text-ink-400 transition-transform duration-150",
              open && "rotate-180",
            )}
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.2 7.3a1 1 0 0 1 1.4 0L10 10.6l3.4-3.3a1 1 0 1 1 1.4 1.4l-4.1 4a1 1 0 0 1-1.4 0l-4.1-4a1 1 0 0 1 0-1.4Z"
              clipRule="evenodd"
            />
          </svg>
        )}
      </button>

      <select
        ref={nativeRef}
        value={controlled ? current : undefined}
        defaultValue={controlled ? undefined : defaultValue}
        onChange={(event) => {
          if (!controlled) setUncontrolled(event.target.value);
          onChange?.(event);
        }}
        name={name}
        form={form}
        required={required}
        autoComplete={autoComplete}
        disabled={disabled}
        tabIndex={-1}
        aria-hidden="true"
        // Something that focuses "the first select" (a dialog, the browser's
        // own validation) lands on the control people can see. It sits after
        // the button so a wrapping <label> names the button, not this.
        onFocus={() => triggerRef.current?.focus({ preventScroll: true })}
        className="sr-only"
      >
        {children}
      </select>

      {typeof document !== "undefined" &&
        createPortal(
          <AnimatePresence>
            {open && position && (
              <motion.div
                ref={popupRef}
                initial={{ opacity: 0, y: position.above ? 4 : -4, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.12, ease: [0.22, 1, 0.36, 1] }}
                // Portalled out of the DOM but not out of React: this keeps
                // Escape from bubbling on to a dialog around the trigger.
                onKeyDown={onListKeyDown}
                style={{
                  position: "fixed",
                  left: position.left,
                  width: position.width,
                  top: position.above ? undefined : position.top,
                  bottom: position.above ? position.bottom : undefined,
                }}
                className={cn(
                  "z-[70] flex flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-lg",
                  position.above ? "origin-bottom" : "origin-top",
                )}
              >
                <div className="relative border-b border-ink-100 p-1.5">
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-ink-400"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" />
                  </svg>
                  <input
                    ref={searchRef}
                    type="text"
                    role="combobox"
                    aria-label="Search options"
                    aria-expanded="true"
                    aria-controls={listboxId}
                    aria-autocomplete="list"
                    aria-activedescendant={active >= 0 ? optionId(active) : undefined}
                    autoComplete="off"
                    spellCheck={false}
                    value={query}
                    onChange={(event) => {
                      const next = event.target.value;
                      setQuery(next);
                      setActive(nextEnabled(filterOptions(options, next), -1, 1));
                    }}
                    placeholder={searchPlaceholder}
                    className={cn(
                      "block w-full rounded-lg border-0 bg-ink-50 py-2 pl-9 pr-3 text-sm text-ink-800",
                      "placeholder:text-ink-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-inset focus:ring-brand-500",
                    )}
                  />
                </div>

                <ul
                  ref={listRef}
                  id={listboxId}
                  role="listbox"
                  aria-labelledby={id}
                  tabIndex={-1}
                  style={{ maxHeight: position.listHeight }}
                  className="overflow-y-auto overscroll-contain p-1.5"
                >
                  {matches.length === 0 && (
                    <li role="presentation" className="px-3 py-6 text-center text-sm text-ink-500">
                      No matches for “{query.trim()}”
                    </li>
                  )}
                  {matches.map((option, index) => {
                    const heading =
                      option.group && option.group !== matches[index - 1]?.group ? option.group : null;
                    const isSelected = option.value === selected?.value;
                    return (
                      <Fragment key={`${option.group ?? ""}:${option.value}:${index}`}>
                        {heading && (
                          <li
                            role="presentation"
                            className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-ink-400"
                          >
                            {heading}
                          </li>
                        )}
                        <li
                          id={optionId(index)}
                          data-index={index}
                          role="option"
                          aria-selected={isSelected}
                          aria-disabled={option.disabled || undefined}
                          onMouseMove={() => {
                            if (!option.disabled && active !== index) setActive(index);
                          }}
                          // Keep focus in the search box while clicking.
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => choose(option)}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm",
                            option.group && "pl-5",
                            index === active && "bg-ink-100",
                            isSelected ? "font-semibold text-brand-700" : "text-ink-700",
                            option.disabled && "cursor-not-allowed text-ink-400 opacity-60",
                          )}
                        >
                          <span className="min-w-0 flex-1">{option.label || " "}</span>
                          {isSelected && (
                            <svg
                              aria-hidden="true"
                              viewBox="0 0 20 20"
                              className="size-4 shrink-0 text-brand-600"
                              fill="currentColor"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </li>
                      </Fragment>
                    );
                  })}
                </ul>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

/** Flattens <option>/<optgroup> children (through arrays and fragments). */
function collectOptions(children, group, groupDisabled = false, out = []) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    const { props } = child;
    if (child.type === Fragment) {
      collectOptions(props.children, group, groupDisabled, out);
    } else if (child.type === "optgroup") {
      collectOptions(props.children, props.label, groupDisabled || Boolean(props.disabled), out);
    } else if (child.type === "option") {
      const label = textOf(props.children).trim();
      out.push({
        value: props.value !== undefined ? String(props.value) : label,
        label,
        group,
        disabled: groupDisabled || Boolean(props.disabled),
      });
    }
  });
  return out;
}

function textOf(node) {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement(node)) return textOf(node.props.children);
  return "";
}

const normalise = (text) =>
  text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Every word of the query must appear in the option (or its group) label. */
function filterOptions(options, query) {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (!words.length) return options;
  return options.filter((option) => {
    const haystack = normalise(`${option.label} ${option.group ?? ""}`);
    return words.every((word) => haystack.includes(word));
  });
}

function firstEnabled(options) {
  return options.find((o) => !o.disabled) ?? options[0];
}

/** The next choosable index from `from` in `step` direction, or `from` if none. */
function nextEnabled(options, from, step) {
  for (let i = from + step; i >= 0 && i < options.length; i += step) {
    if (!options[i].disabled) return i;
  }
  return from >= 0 && from < options.length ? from : -1;
}

const GAP = 6;
const EDGE = 8;
const SEARCH_HEIGHT = 56;
const MAX_LIST = 288;
const MIN_WIDTH = 224;

/** Fixed-position placement under the trigger, or above it when that fits better. */
function placePopup(trigger) {
  if (!trigger) return null;
  const rect = trigger.getBoundingClientRect();
  const viewportWidth = document.documentElement.clientWidth;
  const viewportHeight = window.innerHeight;

  const width = Math.min(Math.max(rect.width, MIN_WIDTH), viewportWidth - EDGE * 2);
  const left = Math.min(Math.max(rect.left, EDGE), viewportWidth - width - EDGE);

  const below = viewportHeight - rect.bottom - GAP - EDGE;
  const above = rect.top - GAP - EDGE;
  const wanted = SEARCH_HEIGHT + MAX_LIST;
  const flip = below < Math.min(wanted, 240) && above > below;
  const room = flip ? above : below;

  return {
    left,
    width,
    above: flip,
    top: rect.bottom + GAP,
    bottom: viewportHeight - rect.top + GAP,
    listHeight: Math.max(Math.min(MAX_LIST, room - SEARCH_HEIGHT), 120),
  };
}
