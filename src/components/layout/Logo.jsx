import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * Wordmark. The "A+" glyph is drawn rather than set in type so it renders
 * identically before fonts load.
 */
export function Logo({ href = "/", className, mark = false, tone = "default" }) {
  const content = (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "relative flex size-9 shrink-0 items-center justify-center rounded-xl font-black",
          tone === "inverse" ? "bg-white text-brand-700" : "bg-brand-600 text-white",
        )}
        aria-hidden="true"
      >
        <span className="text-[15px] leading-none tracking-tight">A</span>
        <span className="absolute right-1.5 top-1.5 text-[10px] leading-none text-accent-300">+</span>
      </span>
      {!mark && (
        <span
          className={cn(
            "text-[17px] font-extrabold tracking-tight",
            tone === "inverse" ? "text-white" : "text-ink-900",
          )}
        >
          APlus<span className={tone === "inverse" ? "text-brand-200" : "text-brand-600"}>Learn</span>
        </span>
      )}
      <span className="sr-only">APlus Learn — home</span>
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="inline-flex rounded-xl focus-visible:outline-offset-4">
      {content}
    </Link>
  );
}
