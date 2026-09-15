import { cn } from "@/lib/utils/cn";
import { Reveal } from "@/components/ui";

/** Shared hero for the content pages, so they read as one family (§30). */
export function PageHero({ eyebrow, title, description, children, tone = "light", className }) {
  return (
    <section
      className={cn(
        "relative overflow-hidden",
        tone === "dark" ? "bg-ink-900 py-16 lg:py-20" : "border-b border-ink-200 bg-white py-14 lg:py-18",
        className,
      )}
    >
      {tone === "dark" && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(70rem_40rem_at_20%_-10%,var(--color-brand-800),transparent_60%)]" />
        </div>
      )}

      <div className="container-page relative">
        <Reveal className="max-w-3xl">
          {eyebrow && (
            <p
              className={cn(
                "text-xs font-bold uppercase tracking-[0.12em]",
                tone === "dark" ? "text-brand-300" : "text-brand-600",
              )}
            >
              {eyebrow}
            </p>
          )}
          <h1
            className={cn(
              "mt-2 text-3xl font-extrabold tracking-tight sm:text-4xl lg:text-5xl",
              tone === "dark" && "text-white",
            )}
          >
            {title}
          </h1>
          {description && (
            <p
              className={cn(
                "mt-4 text-base leading-relaxed sm:text-lg",
                tone === "dark" ? "text-brand-100/80" : "text-ink-500",
              )}
            >
              {description}
            </p>
          )}
          {children && <div className="mt-8">{children}</div>}
        </Reveal>
      </div>
    </section>
  );
}

/** Long-form prose block with consistent typography for legal/help pages. */
export function Prose({ children, className }) {
  return (
    <div
      className={cn(
        "max-w-3xl space-y-5 text-sm leading-relaxed text-ink-600",
        "[&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-ink-900",
        "[&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-ink-900",
        "[&_ul]:space-y-2 [&_ul]:pl-5 [&_li]:list-disc [&_li]:marker:text-ink-300",
        "[&_ol]:space-y-2 [&_ol]:pl-5 [&_ol>li]:list-decimal",
        "[&_a]:font-semibold [&_a]:text-brand-600 [&_a]:underline-offset-2 hover:[&_a]:underline",
        "[&_strong]:font-semibold [&_strong]:text-ink-800",
        className,
      )}
    >
      {children}
    </div>
  );
}
