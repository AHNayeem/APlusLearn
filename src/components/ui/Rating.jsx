import { cn } from "@/lib/utils/cn";

function Star({ fill = 1, className }) {
  // Derived from the fill itself, so it's stable across renders and identical
  // between the server and client passes. Stars with the same partial fill
  // legitimately share one gradient definition.
  const id = `star-fill-${Math.round(fill * 100)}`;
  return (
    <svg viewBox="0 0 20 20" className={cn("size-4", className)} aria-hidden="true">
      {fill > 0 && fill < 1 && (
        <defs>
          <linearGradient id={id}>
            <stop offset={`${fill * 100}%`} stopColor="currentColor" />
            <stop offset={`${fill * 100}%`} stopColor="transparent" />
          </linearGradient>
        </defs>
      )}
      <path
        d="M10 1.5l2.6 5.3 5.8.85-4.2 4.1 1 5.75L10 14.8l-5.2 2.7 1-5.75-4.2-4.1 5.8-.85L10 1.5Z"
        fill={fill >= 1 ? "currentColor" : fill > 0 ? `url(#${id})` : "none"}
        stroke="currentColor"
        strokeWidth={fill >= 1 ? 0 : 1.25}
        strokeLinejoin="round"
        className={fill > 0 ? "" : "opacity-30"}
      />
    </svg>
  );
}

/** Read-only star rating with an accessible text equivalent. */
export function Rating({ value = 0, count, size = "md", showValue = true, className }) {
  const stars = [1, 2, 3, 4, 5].map((i) => Math.max(0, Math.min(1, value - i + 1)));

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="inline-flex text-accent-400" aria-hidden="true">
        {stars.map((fill, i) => (
          <Star key={i} fill={fill} className={size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4"} />
        ))}
      </span>
      {showValue && (
        <span
          className={cn(
            "font-bold text-ink-800 tabular-nums",
            size === "sm" ? "text-xs" : size === "lg" ? "text-base" : "text-sm",
          )}
        >
          {value ? value.toFixed(1) : "New"}
        </span>
      )}
      {count !== undefined && (
        <span className={cn("text-ink-500", size === "sm" ? "text-xs" : "text-sm")}>
          ({count})
        </span>
      )}
      <span className="sr-only">
        {value ? `Rated ${value.toFixed(1)} out of 5` : "Not yet rated"}
        {count !== undefined ? ` from ${count} reviews` : ""}
      </span>
    </span>
  );
}

/** A labelled sub-score bar (knowledge, communication, …). */
export function RatingBar({ label, value, max = 5, className }) {
  const percent = Math.round((value / max) * 100);
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="w-28 shrink-0 text-xs font-medium text-ink-600">{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-100">
        <span
          className="block h-full rounded-full bg-accent-400 transition-[width] duration-500 ease-out"
          style={{ width: `${percent}%` }}
        />
      </span>
      <span className="w-8 shrink-0 text-right text-xs font-bold text-ink-800 tabular-nums">
        {value ? value.toFixed(1) : "—"}
      </span>
    </div>
  );
}
