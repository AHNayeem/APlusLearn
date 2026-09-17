import { cn } from "@/lib/utils/cn";
import { RevealGroup, RevealItem } from "@/components/ui";
import { StepArt } from "./StepArt";

/**
 * The illustrated step card used wherever a process is explained (§12, §30).
 *
 * One component, so "how it works" looks identical on the homepage and on the
 * how-it-works page, and a new step is a data entry rather than new markup.
 * The pill colour cycles through the four brand families in a fixed order, so
 * the same step number is always the same colour across the site.
 */
const PILL_TONES = ["bg-accent-500", "bg-plum-500", "bg-success-600", "bg-brand-600"];

const COLUMNS = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
};

export function StepCards({ steps = [], columns = 4, className }) {
  if (!steps.length) return null;

  return (
    <RevealGroup className={cn("grid gap-6", COLUMNS[columns] ?? COLUMNS[4], className)}>
      {steps.map((step, index) => (
        <RevealItem key={step.title} className="h-full">
          <article
            className={cn(
              "group flex h-full flex-col rounded-2xl border border-ink-200/80 bg-white p-6 text-center",
              "shadow-sm transition duration-300 ease-out",
              "hover:-translate-y-1.5 hover:border-brand-200 hover:shadow-xl",
              "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              "sm:p-7",
            )}
          >
            <StepArt
              name={step.art}
              className="mx-auto max-w-[17rem] transition-transform duration-500 ease-out group-hover:-translate-y-1 motion-reduce:group-hover:translate-y-0"
            />

            <span
              className={cn(
                "mx-auto mt-6 inline-flex items-center rounded-md px-3 py-1.5",
                "text-[11px] font-extrabold uppercase tracking-[0.16em] text-white shadow-xs",
                PILL_TONES[index % PILL_TONES.length],
              )}
            >
              Step {String(index + 1).padStart(2, "0")}
            </span>

            <h3 className="mt-5 text-lg font-bold tracking-tight text-ink-900">{step.title}</h3>
            <p className="mt-3 text-sm leading-relaxed text-ink-500">{step.body}</p>

            {step.detail && (
              <p className="mt-auto pt-5 text-xs leading-relaxed text-ink-400">
                <span className="mx-auto block max-w-[22rem] border-t border-ink-100 pt-4">
                  {step.detail}
                </span>
              </p>
            )}
          </article>
        </RevealItem>
      ))}
    </RevealGroup>
  );
}
