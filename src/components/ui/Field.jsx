"use client";

import { useId } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * Form primitives.
 *
 * Every control is wired to its label, description and error through real
 * ids and aria-describedby, so screen readers announce the same thing a
 * sighted user sees (§34).
 */

export function Field({ label, htmlFor, hint, error, required, className, children, id }) {
  const generated = useId();
  const fieldId = htmlFor ?? id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={fieldId} className="block text-sm font-semibold text-ink-800">
          {label}
          {required && (
            <span className="ml-1 text-danger-600" aria-hidden="true">
              *
            </span>
          )}
          {required && <span className="sr-only"> (required)</span>}
        </label>
      )}

      {typeof children === "function"
        ? children({
            id: fieldId,
            "aria-describedby": cn(hintId, errorId) || undefined,
            "aria-invalid": error ? true : undefined,
          })
        : children}

      {hint && !error && (
        <p id={hintId} className="text-xs text-ink-500">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="flex items-start gap-1 text-xs font-medium text-danger-600">
          <span aria-hidden="true">⚠</span>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

const CONTROL_BASE =
  "block w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm text-ink-800 shadow-xs " +
  "ring-1 ring-inset ring-ink-200 placeholder:text-ink-400 " +
  "transition-shadow duration-150 " +
  "focus:ring-2 focus:ring-inset focus:ring-brand-500 focus:outline-none " +
  "disabled:cursor-not-allowed disabled:bg-ink-50 disabled:text-ink-400";

const CONTROL_ERROR = "ring-danger-400 focus:ring-danger-500";

export function Input({ className, error, iconLeft, ...props }) {
  const control = (
    <input
      className={cn(
        CONTROL_BASE,
        error && CONTROL_ERROR,
        iconLeft && "pl-10",
        className,
      )}
      {...props}
    />
  );

  if (!iconLeft) return control;

  return (
    <div className="relative">
      <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-ink-400">
        {iconLeft}
      </span>
      {control}
    </div>
  );
}

export function Textarea({ className, error, rows = 4, ...props }) {
  return (
    <textarea
      rows={rows}
      className={cn(CONTROL_BASE, "resize-y leading-relaxed", error && CONTROL_ERROR, className)}
      {...props}
    />
  );
}

export function Select({ className, error, children, ...props }) {
  return (
    <div className="relative">
      <select
        className={cn(
          CONTROL_BASE,
          "appearance-none pr-10",
          error && CONTROL_ERROR,
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-400"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M5.2 7.3a1 1 0 0 1 1.4 0L10 10.6l3.4-3.3a1 1 0 1 1 1.4 1.4l-4.1 4a1 1 0 0 1-1.4 0l-4.1-4a1 1 0 0 1 0-1.4Z"
          clipRule="evenodd"
        />
      </svg>
    </div>
  );
}

export function Checkbox({ label, description, className, id, ...props }) {
  const generated = useId();
  const checkboxId = id ?? generated;

  return (
    <div className={cn("flex gap-3", className)}>
      <input
        id={checkboxId}
        type="checkbox"
        className={cn(
          "mt-0.5 size-4.5 shrink-0 cursor-pointer rounded-md border-ink-300 text-brand-600",
          "focus:ring-2 focus:ring-brand-500 focus:ring-offset-0",
          "disabled:cursor-not-allowed disabled:opacity-50",
        )}
        {...props}
      />
      {(label || description) && (
        <div className="min-w-0 text-sm">
          {label && (
            <label htmlFor={checkboxId} className="cursor-pointer font-medium text-ink-800">
              {label}
            </label>
          )}
          {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
        </div>
      )}
    </div>
  );
}

export function Radio({ label, description, className, id, ...props }) {
  const generated = useId();
  const radioId = id ?? generated;

  return (
    <div className={cn("flex gap-3", className)}>
      <input
        id={radioId}
        type="radio"
        className={cn(
          "mt-0.5 size-4.5 shrink-0 cursor-pointer border-ink-300 text-brand-600",
          "focus:ring-2 focus:ring-brand-500 focus:ring-offset-0",
        )}
        {...props}
      />
      {(label || description) && (
        <div className="min-w-0 text-sm">
          {label && (
            <label htmlFor={radioId} className="cursor-pointer font-medium text-ink-800">
              {label}
            </label>
          )}
          {description && <p className="mt-0.5 text-xs text-ink-500">{description}</p>}
        </div>
      )}
    </div>
  );
}

/** Accessible toggle built on a real checkbox so forms and keyboards work. */
export function Switch({ label, description, className, id, checked, ...props }) {
  const generated = useId();
  const switchId = id ?? generated;

  return (
    <label
      htmlFor={switchId}
      className={cn("flex cursor-pointer items-start justify-between gap-4", className)}
    >
      <span className="min-w-0 text-sm">
        <span className="font-medium text-ink-800">{label}</span>
        {description && <span className="mt-0.5 block text-xs text-ink-500">{description}</span>}
      </span>
      <span className="relative inline-flex shrink-0">
        <input
          id={switchId}
          type="checkbox"
          role="switch"
          checked={checked}
          className="peer sr-only"
          {...props}
        />
        <span
          aria-hidden="true"
          className={cn(
            "block h-6 w-11 rounded-full bg-ink-300 transition-colors duration-200",
            "peer-checked:bg-brand-600",
            "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-500",
          )}
        />
        <span
          aria-hidden="true"
          className={cn(
            "absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow-sm",
            "transition-transform duration-200 ease-out peer-checked:translate-x-5",
          )}
        />
      </span>
    </label>
  );
}

/** A group of radio/checkbox options presented as selectable cards. */
export function OptionCard({ label, description, icon, selected, className, ...props }) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer gap-3 rounded-xl border p-4 transition-all duration-150",
        selected
          ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500"
          : "border-ink-200 bg-white hover:border-ink-300 hover:bg-ink-50/60",
        className,
      )}
    >
      <input className="sr-only" {...props} />
      {icon && (
        <span className={cn("shrink-0", selected ? "text-brand-600" : "text-ink-400")}>{icon}</span>
      )}
      <span className="min-w-0">
        <span className={cn("block text-sm font-semibold", selected ? "text-brand-800" : "text-ink-800")}>
          {label}
        </span>
        {description && <span className="mt-0.5 block text-xs text-ink-500">{description}</span>}
      </span>
    </label>
  );
}

/** Summary of server-side field errors, rendered above a form. */
export function FormErrorSummary({ error, fieldErrors }) {
  const fields = Object.entries(fieldErrors ?? {});
  if (!error && !fields.length) return null;

  return (
    <div
      role="alert"
      className="rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-800"
    >
      <p className="font-semibold">{error ?? "Please check the details below."}</p>
      {fields.length > 0 && (
        <ul className="mt-2 list-inside list-disc space-y-1 text-danger-700">
          {fields.map(([field, messages]) => (
            <li key={field}>{Array.isArray(messages) ? messages[0] : messages}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
