import { cn } from "@/lib/utils/cn";
import { Button } from "./Button";

/**
 * Loading, empty and error states (§32).
 *
 * Every list and panel in the product renders one of these rather than
 * nothing, so a screen is never blank without explanation.
 */

export function Skeleton({ className, ...props }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block rounded-lg shimmer", className)}
      {...props}
    />
  );
}

export function SkeletonText({ lines = 3, className }) {
  return (
    <span className={cn("block space-y-2", className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-3.5", i === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </span>
  );
}

export function SkeletonCard({ className }) {
  return (
    <div className={cn("rounded-2xl border border-ink-200 bg-white p-5", className)}>
      <div className="flex gap-4">
        <Skeleton className="size-14 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
      <SkeletonText lines={2} className="mt-4" />
      <div className="mt-4 flex gap-2">
        <Skeleton className="h-9 w-24 rounded-xl" />
        <Skeleton className="h-9 w-24 rounded-xl" />
      </div>
    </div>
  );
}

export function SkeletonList({ count = 3, className }) {
  return (
    <div className={cn("space-y-4", className)} role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export function SkeletonTable({ rows = 5, columns = 4, className }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-ink-200 bg-white", className)} role="status" aria-label="Loading">
      <div className="border-b border-ink-100 bg-ink-50/60 p-4">
        <Skeleton className="h-4 w-32" />
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 border-b border-ink-100 p-4 last:border-0">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} className={cn("h-3.5", c === 0 ? "w-1/4" : "flex-1")} />
          ))}
        </div>
      ))}
      <span className="sr-only">Loading…</span>
    </div>
  );
}

/**
 * Empty state. Always says what is missing *and* what to do next — an empty
 * screen with no action is a dead end.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  className,
  compact = false,
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-300 bg-white/60 text-center",
        compact ? "px-6 py-10" : "px-6 py-16",
        className,
      )}
    >
      {icon && (
        <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-ink-100 text-ink-400">
          {icon}
        </span>
      )}
      <h3 className="text-base font-bold text-ink-900">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

/** Error state with a retry affordance (§32). */
export function ErrorState({
  title = "Something went wrong",
  description = "We couldn't load this. It's usually temporary.",
  onRetry,
  retryHref,
  className,
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-danger-200 bg-danger-50/60 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-danger-100 text-2xl text-danger-600">
        !
      </span>
      <h3 className="text-base font-bold text-ink-900">{title}</h3>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-600">{description}</p>
      {(onRetry || retryHref) && (
        <Button variant="secondary" className="mt-6" onClick={onRetry} href={retryHref}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Confirmation panel shown after a successful action. */
export function SuccessState({ title, description, action, secondaryAction, className }) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border border-success-100 bg-success-50/60 px-6 py-12 text-center",
        className,
      )}
    >
      <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-success-100 text-success-700 animate-[pop_0.35s_var(--ease-out-quint)_both]">
        <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
          <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h3 className="text-lg font-bold text-ink-900">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-ink-600">{description}</p>
      )}
      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}
