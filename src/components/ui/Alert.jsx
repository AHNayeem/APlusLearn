import { cn } from "@/lib/utils/cn";

const TONES = {
  info: { wrap: "border-info-100 bg-info-50 text-info-600", title: "text-ink-900", glyph: "i" },
  success: { wrap: "border-success-100 bg-success-50 text-success-700", title: "text-ink-900", glyph: "✓" },
  warning: { wrap: "border-warning-100 bg-warning-50 text-warning-700", title: "text-ink-900", glyph: "!" },
  danger: { wrap: "border-danger-200 bg-danger-50 text-danger-700", title: "text-ink-900", glyph: "!" },
  neutral: { wrap: "border-ink-200 bg-ink-50 text-ink-600", title: "text-ink-900", glyph: "i" },
};

export function Alert({ tone = "info", title, children, action, icon, className }) {
  const style = TONES[tone];
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border p-4", style.wrap, className)}
    >
      <span
        aria-hidden="true"
        className="flex size-5 shrink-0 items-center justify-center rounded-full bg-current/15 text-xs font-bold"
      >
        {icon ?? style.glyph}
      </span>
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className={cn("font-semibold", style.title)}>{title}</p>}
        {children && <div className={cn("leading-relaxed", title && "mt-1")}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/** A compact inline note, e.g. under a form control. */
export function InlineNote({ tone = "neutral", children, className }) {
  return (
    <p
      className={cn(
        "flex items-start gap-1.5 text-xs",
        tone === "danger" ? "text-danger-600" : tone === "success" ? "text-success-700" : "text-ink-500",
        className,
      )}
    >
      {children}
    </p>
  );
}
