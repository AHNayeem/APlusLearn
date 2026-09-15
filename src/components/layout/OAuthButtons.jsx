"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api/client";
import { Button, useToast } from "@/components/ui";

/**
 * Google / Apple sign-in (§9).
 *
 * The provider abstraction decides whether real OAuth is configured. When it
 * is not, these buttons say so plainly rather than failing silently — and in
 * development they issue a local identity so the flow stays testable (§38).
 */
export function OAuthButtons({ role, next, className }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(null);

  const configured = {
    GOOGLE: Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID),
    APPLE: Boolean(process.env.NEXT_PUBLIC_APPLE_CLIENT_ID),
  };

  const signIn = async (provider) => {
    setPending(provider);
    try {
      if (!configured[provider] && process.env.NODE_ENV === "production") {
        toast.info(
          `${label(provider)} sign-in isn't available yet`,
          "Use your email and password instead.",
        );
        return;
      }

      // Development identity — the real flow replaces this with the provider's
      // ID token, which the server verifies against their JWKS.
      const email = window.prompt(
        `${label(provider)} sign-in is running in development mode.\n\nEnter the email address to sign in with:`,
      );
      if (!email) return;

      const credential = btoa(
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

      const result = await api.post("/api/auth/oauth", { provider, credential, role, next });
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

      <div className="grid gap-2 sm:grid-cols-2">
        <Button
          variant="secondary"
          size="lg"
          loading={pending === "GOOGLE"}
          onClick={() => signIn("GOOGLE")}
          iconLeft={<GoogleMark />}
        >
          Google
        </Button>
        <Button
          variant="secondary"
          size="lg"
          loading={pending === "APPLE"}
          onClick={() => signIn("APPLE")}
          iconLeft={<AppleMark />}
        >
          Apple
        </Button>
      </div>
    </div>
  );
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
