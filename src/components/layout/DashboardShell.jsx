import { cn } from "@/lib/utils/cn";
import { UserMenu } from "./UserMenu";
import { DashboardNav } from "./DashboardNav";
import { RealtimeProvider } from "@/components/realtime/RealtimeProvider";

/**
 * Shared dashboard chrome for the parent, tutor and admin areas (§24).
 *
 * `realtime` opens the signed-in user's event stream for everything inside
 * the shell, and makes the message and notification badges live
 * (docs/REALTIME.md). The parent and tutor areas turn it on; the admin area
 * has neither an inbox nor a notification centre to keep current.
 */
export function DashboardShell({ items, user, badges, branding, realtime = false, children }) {
  const shell = (
    /* Column on small screens so the mobile top bar spans the full width; the
       sidebar only becomes a flex *row* sibling once it is actually visible at
       `lg`. Laying these out as a row below `lg` is what left a dead gutter on
       the left and squeezed the content column. */
    <div className="flex min-h-dvh w-full flex-col bg-canvas lg:flex-row">
      <DashboardNav items={items} user={user} badges={badges} branding={branding} />
      <div className="flex w-full min-w-0 max-w-full flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 hidden h-[var(--header-height)] w-full items-center justify-end gap-4 border-b border-ink-200 bg-white/90 px-4 backdrop-blur-lg sm:px-6 lg:flex lg:px-8">
          <UserMenu user={user} />
        </header>
        <main id="main" className="w-full min-w-0 max-w-full flex-1">
          {children}
        </main>
      </div>
    </div>
  );

  if (!realtime) return shell;
  return (
    <RealtimeProvider
      initialCounts={{
        messages: badges?.unreadMessages ?? 0,
        notifications: badges?.unreadNotifications ?? 0,
      }}
    >
      {shell}
    </RealtimeProvider>
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
  return (
    <div className={cn("w-full min-w-0 max-w-full px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8", className)}>
      {children}
    </div>
  );
}
