import { cn } from "@/lib/utils/cn";

/**
 * Data table. The wrapper scrolls horizontally on small screens so the page
 * itself never overflows (§33).
 */
export function Table({ className, children, ...props }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className={cn("w-full min-w-[640px] text-left text-sm", className)} {...props}>
          {children}
        </table>
      </div>
    </div>
  );
}

export function THead({ children }) {
  return (
    <thead className="border-b border-ink-200 bg-ink-50/70">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({ className, align = "left", children, ...props }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-3 text-xs font-bold uppercase tracking-wide text-ink-500",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    >
      {children}
    </th>
  );
}

export function TBody({ children }) {
  return <tbody className="divide-y divide-ink-100">{children}</tbody>;
}

export function TR({ className, interactive, children, ...props }) {
  return (
    <tr
      className={cn(interactive && "cursor-pointer transition-colors hover:bg-ink-50", className)}
      {...props}
    >
      {children}
    </tr>
  );
}

export function TD({ className, align = "left", children, ...props }) {
  return (
    <td
      className={cn(
        "px-4 py-3.5 align-middle text-ink-700",
        align === "right" && "text-right",
        align === "center" && "text-center",
        className,
      )}
      {...props}
    >
      {children}
    </td>
  );
}

/** Full-width row used for the table's own empty state. */
export function TableEmpty({ colSpan, title, description }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-14 text-center">
        <p className="text-sm font-semibold text-ink-800">{title}</p>
        {description && <p className="mt-1 text-sm text-ink-500">{description}</p>}
      </td>
    </tr>
  );
}
