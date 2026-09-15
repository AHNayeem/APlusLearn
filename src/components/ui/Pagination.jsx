import Link from "next/link";
import { cn } from "@/lib/utils/cn";

/**
 * Pagination. Renders links (not buttons) so pages are crawlable and the
 * browser's back button behaves (§29, §43).
 */
export function Pagination({ page, totalPages, buildHref, className, total, pageSize, label = "results" }) {
  if (totalPages <= 1) {
    return total ? (
      <p className={cn("text-sm text-ink-500", className)}>
        {total} {label}
      </p>
    ) : null;
  }

  const pages = pageWindow(page, totalPages);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total ?? page * pageSize);

  return (
    <nav
      aria-label="Pagination"
      className={cn("flex flex-wrap items-center justify-between gap-4", className)}
    >
      {total !== undefined && (
        <p className="text-sm text-ink-500">
          Showing <span className="font-semibold text-ink-700">{from}–{to}</span> of{" "}
          <span className="font-semibold text-ink-700">{total}</span> {label}
        </p>
      )}

      <div className="flex items-center gap-1">
        <PageLink href={buildHref(page - 1)} disabled={page <= 1} label="Previous page">
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M12.8 15.3a1 1 0 0 1-1.4 0l-4.5-4.6a1 1 0 0 1 0-1.4l4.5-4.6a1 1 0 1 1 1.4 1.4L9 10l3.8 3.9a1 1 0 0 1 0 1.4Z" clipRule="evenodd" />
          </svg>
        </PageLink>

        {pages.map((p, i) =>
          p === "…" ? (
            <span key={`gap-${i}`} className="px-2 text-sm text-ink-400" aria-hidden="true">
              …
            </span>
          ) : (
            <PageLink
              key={p}
              href={buildHref(p)}
              current={p === page}
              label={`Page ${p}`}
            >
              {p}
            </PageLink>
          ),
        )}

        <PageLink href={buildHref(page + 1)} disabled={page >= totalPages} label="Next page">
          <svg viewBox="0 0 20 20" className="size-4" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M7.2 4.7a1 1 0 0 1 1.4 0l4.5 4.6a1 1 0 0 1 0 1.4l-4.5 4.6a1 1 0 1 1-1.4-1.4L11 10 7.2 6.1a1 1 0 0 1 0-1.4Z" clipRule="evenodd" />
          </svg>
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({ href, current, disabled, label, children }) {
  const classes = cn(
    "inline-flex h-9 min-w-9 items-center justify-center rounded-lg px-3 text-sm font-semibold transition-colors",
    current
      ? "bg-brand-600 text-white"
      : "text-ink-600 hover:bg-ink-100",
    disabled && "pointer-events-none opacity-40",
  );

  if (disabled) {
    return (
      <span className={classes} aria-disabled="true" aria-label={label}>
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={classes}
      aria-label={label}
      aria-current={current ? "page" : undefined}
    >
      {children}
    </Link>
  );
}

/** Condensed page list: 1 … 4 5 6 … 20 */
function pageWindow(page, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const pages = [1];
  if (page > 3) pages.push("…");
  for (let p = Math.max(2, page - 1); p <= Math.min(totalPages - 1, page + 1); p += 1) {
    pages.push(p);
  }
  if (page < totalPages - 2) pages.push("…");
  pages.push(totalPages);
  return pages;
}
