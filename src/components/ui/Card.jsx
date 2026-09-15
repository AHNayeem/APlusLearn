import Link from "next/link";
import { cn } from "@/lib/utils/cn";

export function Card({ as: Tag = "div", className, interactive = false, children, ...props }) {
  return (
    <Tag
      className={cn(
        "rounded-2xl border border-ink-200 bg-white shadow-sm",
        interactive &&
          "transition-[box-shadow,transform,border-color] duration-200 ease-out hover:-translate-y-0.5 hover:border-ink-300 hover:shadow-lg motion-reduce:hover:translate-y-0",
        className,
      )}
      {...props}
    >
      {children}
    </Tag>
  );
}

export function CardHeader({ className, title, description, action, children }) {
  return (
    <div className={cn("flex items-start justify-between gap-4 border-b border-ink-100 p-5", className)}>
      <div className="min-w-0">
        {title && <h3 className="text-base font-bold text-ink-900">{title}</h3>}
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
        {children}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={cn("p-5", className)}>{children}</div>;
}

export function CardFooter({ className, children }) {
  return (
    <div className={cn("flex items-center gap-3 border-t border-ink-100 bg-ink-50/50 p-5", className)}>
      {children}
    </div>
  );
}

/** A dashboard statistic. `trend` is a signed percentage. */
export function StatCard({ label, value, hint, trend, icon, href, className }) {
  const Wrapper = href ? Link : "div";
  const trendUp = trend > 0;

  return (
    <Wrapper
      {...(href ? { href } : {})}
      className={cn(
        "block rounded-2xl border border-ink-200 bg-white p-5 shadow-sm",
        href &&
          "transition-[box-shadow,border-color] duration-200 hover:border-brand-200 hover:shadow-md",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-ink-500">{label}</p>
        {icon && <span className="text-ink-300">{icon}</span>}
      </div>
      <p className="mt-2 text-3xl font-bold tracking-tight text-ink-900 tabular-nums">{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        {trend !== undefined && trend !== null && (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold",
              trendUp ? "bg-success-50 text-success-700" : trend < 0 ? "bg-danger-50 text-danger-700" : "bg-ink-100 text-ink-600",
            )}
          >
            <span aria-hidden="true">{trendUp ? "↑" : trend < 0 ? "↓" : "→"}</span>
            {Math.abs(trend)}%
          </span>
        )}
        {hint && <span className="text-xs text-ink-500">{hint}</span>}
      </div>
    </Wrapper>
  );
}
