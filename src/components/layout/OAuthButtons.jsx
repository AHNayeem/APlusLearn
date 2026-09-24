"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api/client";
import { Button, useToast } from "@/components/ui";

/**
 * Continue with Google / Continue with Apple (§9, §36).
 *
 * `providers` is decided on the server, from the Social sign-in module, and
 * lists only the methods that are switched on and fully configured — so a
 * method that is off is simply not here. Hiding it is presentation, not
 * protection: the start and callback endpoints refuse it too (§26).
 *
 * A live method is a plain navigation to `/api/auth/oauth/<provider>`, which
 * redirects to the provider and back. No provider script runs on this page and
 * nothing here holds a credential, so there is nothing for it to leak. A
 * navigation rather than a Next `<Link>`, because a link would be prefetched
 * — and prefetching an endpoint that starts a sign-in would start one.
 *
 * `development` mode is the local test identity the server offers only when
 * nothing is configured on a non-production deployment, and it says so.
 */
export function OAuthButtons({ role, next, from = "login", className, providers = [] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(null);

  // Coming back with the browser's Back button restores this page from the
  // back-forward cache with the spinner still going; clear it.
  useEffect(() => {
    const reset = (event) => {
      if (event.persisted) setPending(null);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const start = (provider) => {
    setPending(provider);
    const params = new URLSearchParams({ from });
    if (role) params.set("role", role);
    if (next) params.set("next", next);
    // A full navigation to an endpoint that redirects off-site, not a page:
    // `router.push` would fetch it as a React Server Component instead.
    const url = new URL(`/api/auth/oauth/${provider.toLowerCase()}?${params}`, window.location.origin);
    window.location.assign(url.href);
  };

  const developmentSignIn = async (provider) => {
    setPending(provider);
    try {
      const email = window.prompt(
        `${label(provider)} sign-in is running in development mode.\n\nEnter the email address to sign in with:`,
      );
      if (!email) return;

      const result = await api.post("/api/auth/oauth", {
        provider,
        credential: devCredential(provider, email),
        role,
        next,
      });
      router.push(result.redirectTo);
      router.refresh();
    } catch (error) {
      toast.error(
        "Sign-in failed",
        error instanceof ApiError ? error.message : "Please try again.",
      );
    } finally {
      setPending(null);
    }
  };

  // Nothing offered: no divider, no empty row — the form simply ends.
  if (!providers.length) return null;

  const simulated = providers.some((p) => p.mode === "development");

  return (
    <div className={className}>
      <div className="relative py-5">
        <div aria-hidden="true" className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-ink-200" />
        </div>
        <div className="relative flex justify-center">
          <span className="bg-canvas px-3 text-xs font-medium text-ink-400">or continue with</span>
        </div>
      </div>

      <div className={`grid gap-2 ${providers.length > 1 ? "sm:grid-cols-2" : ""}`}>
        {providers.map(({ provider, mode }) => (
          <Button
            key={provider}
            variant="secondary"
            size="lg"
            loading={pending === provider}
            disabled={Boolean(pending) && pending !== provider}
            onClick={() => (mode === "live" ? start(provider) : developmentSignIn(provider))}
            iconLeft={provider === "APPLE" ? <AppleMark /> : <GoogleMark />}
            aria-label={`Continue with ${label(provider)}`}
          >
            {label(provider)}
          </Button>
        ))}
      </div>

      {simulated && (
        <p className="mt-2 text-center text-xs text-ink-400">
          Development mode — these buttons sign in with a local test identity, not a real account.
        </p>
      )}
    </div>
  );
}

/** Development-only identity. The server refuses it once a provider is configured. */
function devCredential(provider, email) {
  return btoa(
    JSON.stringify({
      sub: `${provider.toLowerCase()}-${email}`,
      email,
      email_verified: true,
      given_name: email.split("@")[0],
      family_name: "User",
    }),
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function label(provider) {
  return provider === "APPLE" ? "Apple" : "Google";
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M23 12.27c0-.85-.08-1.67-.22-2.45H12v4.64h6.17a5.27 5.27 0 0 1-2.29 3.46v2.87h3.7C21.74 18.8 23 15.8 23 12.27Z" />
      <path fill="#34A853" d="M12 23.5c3.1 0 5.7-1.03 7.6-2.79l-3.7-2.87c-1.03.69-2.35 1.1-3.9 1.1-3 0-5.53-2.02-6.44-4.73H1.73v2.96A11.5 11.5 0 0 0 12 23.5Z" />
      <path fill="#FBBC05" d="M5.56 14.21a6.9 6.9 0 0 1 0-4.42V6.83H1.73a11.5 11.5 0 0 0 0 10.34l3.83-2.96Z" />
      <path fill="#EA4335" d="M12 5.05c1.69 0 3.2.58 4.4 1.72l3.28-3.28C17.7 1.6 15.1.5 12 .5A11.5 11.5 0 0 0 1.73 6.83l3.83 2.96C6.47 7.07 9 5.05 12 5.05Z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="currentColor" aria-hidden="true">
      <path d="M17.05 12.53c-.02-2.4 1.96-3.55 2.05-3.61-1.12-1.63-2.86-1.86-3.48-1.89-1.48-.15-2.89.87-3.64.87-.75 0-1.91-.85-3.14-.83-1.61.02-3.1.94-3.93 2.38-1.68 2.9-.43 7.19 1.2 9.54.8 1.15 1.75 2.44 3 2.39 1.21-.05 1.66-.78 3.12-.78 1.46 0 1.87.78 3.14.75 1.3-.02 2.12-1.17 2.91-2.33.92-1.33 1.3-2.62 1.32-2.69-.03-.01-2.53-.97-2.55-3.8ZM14.65 4.9c.66-.8 1.11-1.92.99-3.03-.95.04-2.11.63-2.79 1.43-.61.7-1.15 1.84-1.01 2.92 1.07.08 2.15-.54 2.81-1.32Z" />
    </svg>
  );
}
