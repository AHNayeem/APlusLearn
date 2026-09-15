"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { Menu, X, Search } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { PUBLIC_NAV, ROLES } from "@/constants";
import { Button } from "@/components/ui";
import { Logo } from "./Logo";
import { UserMenu } from "./UserMenu";

/**
 * Public site header. Becomes opaque on scroll so the hero can sit underneath
 * it, and collapses to a full-screen sheet on mobile (§33).
 */
export function SiteHeader({ user }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile sheet whenever the route changes. Adjusting state during
  // render (rather than in an effect) avoids a second render pass showing the
  // menu still open on the new page.
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

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-[background-color,box-shadow,backdrop-filter] duration-300",
        scrolled || open
          ? "border-b border-ink-200 bg-white/90 backdrop-blur-lg"
          : "bg-transparent",
      )}
    >
      <a href="#main" className="sr-only-focusable z-50 m-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white">
        Skip to main content
      </a>

      <div className="container-page flex h-[var(--header-height)] items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Logo />
          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {PUBLIC_NAV.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-3 py-2 text-sm font-semibold transition-colors",
                    active ? "text-brand-700" : "text-ink-600 hover:bg-ink-100 hover:text-ink-900",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {(!user || user.role !== ROLES.TUTOR) && (
            <Button
              href="/become-a-tutor"
              variant="ghost"
              size="sm"
              className="hidden xl:inline-flex"
            >
              Become a tutor
            </Button>
          )}
          <div className="hidden lg:block">
            <UserMenu user={user} />
          </div>

          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="inline-flex size-10 items-center justify-center rounded-xl text-ink-700 hover:bg-ink-100 lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-nav"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="border-t border-ink-200 bg-white lg:hidden"
          >
            <div className="container-page max-h-[calc(100dvh-var(--header-height))] overflow-y-auto py-5">
              <Button href="/find-a-tutor" fullWidth size="lg" iconLeft={<Search className="size-4" />}>
                Find a tutor
              </Button>

              <nav aria-label="Main" className="mt-5 space-y-1">
                {PUBLIC_NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="block rounded-xl px-3 py-3 text-base font-semibold text-ink-700 hover:bg-ink-100"
                  >
                    {item.label}
                  </Link>
                ))}
                <Link
                  href="/become-a-tutor"
                  className="block rounded-xl px-3 py-3 text-base font-semibold text-ink-700 hover:bg-ink-100"
                >
                  Become a tutor
                </Link>
              </nav>

              <div className="mt-5 border-t border-ink-100 pt-5">
                {user ? (
                  <UserMenu user={user} />
                ) : (
                  <div className="grid gap-2">
                    <Button href="/login" variant="secondary" fullWidth size="lg">
                      Sign in
                    </Button>
                    <Button href="/register" fullWidth size="lg">
                      Create an account
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
