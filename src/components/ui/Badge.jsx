import { cn } from "@/lib/utils/cn";

const TONES = {
  neutral: "bg-ink-100 text-ink-700 ring-ink-200",
  brand: "bg-brand-50 text-brand-700 ring-brand-200",
  accent: "bg-accent-50 text-accent-700 ring-accent-200",
  success: "bg-success-50 text-success-700 ring-success-100",
  warning: "bg-warning-50 text-warning-700 ring-warning-100",
  danger: "bg-danger-50 text-danger-700 ring-danger-100",
  info: "bg-info-50 text-info-600 ring-info-100",
  solid: "bg-ink-900 text-white ring-ink-900",
};

const SIZES = {
  sm: "px-2 py-0.5 text-[11px] gap-1",
  md: "px-2.5 py-1 text-xs gap-1.5",
};

export function Badge({ tone = "neutral", size = "md", icon, className, children, ...props }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full font-semibold ring-1 ring-inset whitespace-nowrap",
        TONES[tone],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

/** Small count bubble used on nav items. */
export function CountBadge({ count, max = 99, className }) {
  if (!count) return null;
  return (
    <span
      className={cn(
        "inline-flex min-w-5 items-center justify-center rounded-full bg-brand-600 px-1.5 py-0.5",
        "text-[10px] font-bold leading-none text-white tabular-nums",
        className,
      )}
    >
      {count > max ? `${max}+` : count}
    </span>
  );
}
