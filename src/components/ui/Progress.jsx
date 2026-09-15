import { cn } from "@/lib/utils/cn";

export function Progress({ value = 0, max = 100, label, showValue = false, tone = "brand", className }) {
  const percent = Math.max(0, Math.min(100, Math.round((value / max) * 100)));
  const tones = {
    brand: "bg-brand-600",
    success: "bg-success-600",
    accent: "bg-accent-500",
    warning: "bg-warning-500",
  };

  return (
    <div className={className}>
      {(label || showValue) && (
        <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
          {label && <span className="font-medium text-ink-600">{label}</span>}
          {showValue && <span className="font-bold text-ink-800 tabular-nums">{percent}%</span>}
        </div>
      )}
      <div
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
        className="h-2 overflow-hidden rounded-full bg-ink-200"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-500 ease-out", tones[tone])}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Multi-step progress indicator used by tutor onboarding and booking (§17, §19).
 */
export function Stepper({ steps, current, onStepClick, className }) {
  const currentIndex = steps.findIndex((s) => s.value === current);

  return (
    <nav aria-label="Progress" className={className}>
      <ol className="flex items-center gap-1">
        {steps.map((step, index) => {
          const state =
            index < currentIndex ? "complete" : index === currentIndex ? "current" : "upcoming";
          const clickable = onStepClick && index <= currentIndex;

          return (
            <li key={step.value} className="flex flex-1 items-center gap-1">
              <button
                type="button"
                onClick={clickable ? () => onStepClick(step.value) : undefined}
                disabled={!clickable}
                aria-current={state === "current" ? "step" : undefined}
                className={cn(
                  "group flex min-w-0 flex-1 flex-col gap-1.5 rounded-lg py-1 text-left",
                  clickable && "cursor-pointer",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-full rounded-full transition-colors duration-300",
                    state === "complete"
                      ? "bg-brand-600"
                      : state === "current"
                        ? "bg-brand-400"
                        : "bg-ink-200",
                  )}
                />
                <span
                  className={cn(
                    "truncate text-[11px] font-semibold",
                    state === "upcoming" ? "text-ink-400" : "text-ink-700",
                  )}
                >
                  {step.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 text-xs text-ink-500">
        Step {currentIndex + 1} of {steps.length}
      </p>
    </nav>
  );
}
