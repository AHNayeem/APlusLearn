import { cn } from "@/lib/utils/cn";
import { UserMenu } from "./UserMenu";
import { DashboardNav } from "./DashboardNav";

/**
 * Shared dashboard chrome for the parent, tutor and admin areas (§24).
 */
export function DashboardShell({ items, user, badges, branding, children }) {
  return (
    <div className="flex min-h-dvh bg-canvas">
      <DashboardNav items={items} user={user} badges={badges} branding={branding} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 hidden h-[var(--header-height)] items-center justify-end gap-4 border-b border-ink-200 bg-white/90 px-8 backdrop-blur-lg lg:flex">
          <UserMenu user={user} />
        </header>
        <main id="main" className="min-w-0 flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Page heading used inside the dashboard content area. */
export function PageHeader({ title, description, action, breadcrumb, className }) {
  return (
    <div className={cn("mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between", className)}>
      <div className="min-w-0">
        {breadcrumb}
        <h1 className="text-2xl font-extrabold tracking-tight text-ink-900">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-ink-500">{description}</p>}
      </div>
      {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/** Consistent page padding inside the dashboard. */
export function DashboardPage({ className, children }) {
  return <div className={cn("p-5 sm:p-6 lg:p-8", className)}>{children}</div>;
}
