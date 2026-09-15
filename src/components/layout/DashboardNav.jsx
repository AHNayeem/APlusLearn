"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import * as Icons from "lucide-react";
import { Menu, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { CountBadge } from "@/components/ui";
import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";

/**
 * Dashboard shell navigation (§24).
 *
 * One component drives the parent, tutor and admin sidebars — the items come
 * from `navForRole`, so adding a role means adding a nav array, not a layout.
 */
export function DashboardNav({ items, user, badges = {}, branding }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Close the drawer on navigation, adjusted during render so the new page
  // never paints with the drawer still open.
  const [lastPathname, setLastPathname] = useState(pathname);
  if (lastPathname !== pathname) {
    setLastPathname(pathname);
    setOpen(false);
  }

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  const isActive = (href) =>
    pathname === href || (href !== "/dashboard" && pathname.startsWith(`${href}/`));

  const links = (
    <nav aria-label="Dashboard" className="space-y-1">
      {items.map((item) => {
        const Icon = Icons[item.icon] ?? Icons.Circle;
        const active = isActive(item.href);
        const count = item.badge ? badges[item.badge] : 0;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors",
              active
                ? "bg-brand-50 text-brand-700"
                : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
            )}
          >
            <Icon
              className={cn(
                "size-4.5 shrink-0",
                active ? "text-brand-600" : "text-ink-400 group-hover:text-ink-600",
              )}
            />
            <span className="flex-1 truncate">{item.label}</span>
            {count > 0 && <CountBadge count={count} />}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex h-16 items-center justify-between gap-3 border-b border-ink-200 bg-white/90 px-4 backdrop-blur-lg lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open navigation"
          aria-expanded={open}
          className="inline-flex size-10 items-center justify-center rounded-xl text-ink-700 hover:bg-ink-100"
        >
          <Menu className="size-5" />
        </button>
        <Logo mark branding={branding} />
        <UserMenu user={user} />
      </header>

      <AnimatePresence>
        {open && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 bg-ink-900/40"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="relative flex h-full w-[17rem] max-w-[85vw] flex-col bg-white shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-ink-200 p-4">
                <Logo branding={branding} />
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close navigation"
                  className="rounded-lg p-2 text-ink-500 hover:bg-ink-100"
                >
                  <X className="size-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-3">{links}</div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-ink-200 bg-white lg:flex">
        <div className="flex h-[var(--header-height)] items-center px-5">
          <Logo branding={branding} />
        </div>
        <div className="flex-1 overflow-y-auto px-3 pb-4">{links}</div>
        <div className="border-t border-ink-200 p-3">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-ink-500 transition-colors hover:bg-ink-100 hover:text-ink-800"
          >
            <Icons.ArrowLeft className="size-4" />
            Back to site
          </Link>
        </div>
      </aside>
    </>
  );
}
