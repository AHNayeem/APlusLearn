"use client";

import { useEffect } from "react";
import { RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui";
import { Logo } from "@/components/layout/Logo";

/**
 * Global error boundary (§32).
 *
 * Shows a recovery action rather than a stack trace. The digest is surfaced
 * so a user can quote it to support without exposing internals.
 */
export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error("[app] unhandled error:", error);
  }, [error]);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="container-page py-6">
        <Logo />
      </header>

      <main className="container-page flex flex-1 items-center py-16">
        <div className="mx-auto max-w-lg text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-danger-50 text-2xl font-bold text-danger-600">
            !
          </span>
          <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
            Something went wrong
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            This is usually temporary. Try again — if it keeps happening, let us know and
            we&rsquo;ll look into it.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button onClick={reset} size="lg" iconLeft={<RotateCcw className="size-4" />}>
              Try again
            </Button>
            <Button href="/" variant="secondary" size="lg" iconLeft={<Home className="size-4" />}>
              Go home
            </Button>
          </div>

          {error?.digest && (
            <p className="mt-8 border-t border-ink-200 pt-6 text-xs text-ink-400">
              Reference <code className="font-mono text-ink-500">{error.digest}</code> — quote this
              if you contact support.
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
