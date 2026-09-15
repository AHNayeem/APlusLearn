"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api/client";
import { Button, useToast } from "@/components/ui";

/**
 * Google / Apple sign-in (§9, §36).
 *
 * Whether real OAuth is available is decided server-side and reported by
 * `/api/auth/oauth/nonce`, which also mints the single-use nonce this attempt
 * must carry. The provider's client library returns an ID token; the token is
 * posted to our API and verified there against the provider's JWKS. Nothing
 * this component produces is trusted — it cannot be.
 *
 * With no provider configured the buttons fall back to a local identity so
 * the flow stays testable in development, and say so plainly in production
 * rather than failing silently (§38).
 */
const GOOGLE_SDK = "https://accounts.google.com/gsi/client";
const APPLE_SDK = "https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js";

export function OAuthButtons({ role, next, className }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, setPending] = useState(null);

  const finish = async (payload) => {
    const result = await api.post("/api/auth/oauth", { ...payload, role, next });
    router.push(result.redirectTo);
    router.refresh();
  };

  const signIn = async (provider) => {
    setPending(provider);
    try {
      // One round trip tells us what is configured *and* mints the nonce, so
      // the client never has to guess at the server's configuration.
      const session = await api.get("/api/auth/oauth/nonce");
      const available = session.providers.find((p) => p.provider === provider);

      if (available?.configured) {
        const credential =
          provider === "GOOGLE"
            ? await googleCredential(session.googleClientId, session.nonce)
            : await appleCredential(session.appleClientId, session.nonce);

        if (!credential) return; // The member closed the provider's dialog.
        await finish({ provider, ...credential });
        return;
      }

      if (process.env.NODE_ENV === "production") {
        toast.info(
          `${label(provider)} sign-in isn't available yet`,
          "Use your email and password instead.",
        );
        return;
      }

      // Development identity — the real flow above replaces this entirely.
      const email = window.prompt(
        `${label(provider)} sign-in is running in development mode.\n\nEnter the email address to sign in with:`,
      );
      if (!email) return;

      await finish({ provider, credential: devCredential(provider, email) });
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

/** Load a provider script once, and resolve when it is ready. */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "1") resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("Provider script failed to load.")));
      }
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "1";
      resolve();
    };
    script.onerror = () => reject(new Error("Provider script failed to load."));
    document.head.appendChild(script);
  });
}

/**
 * Google Identity Services. The `nonce` travels into the signed ID token,
 * where the server checks it against the httpOnly cookie.
 */
async function googleCredential(clientId, nonce) {
  await loadScript(GOOGLE_SDK);

  return new Promise((resolve, reject) => {
    const client = window.google?.accounts?.id;
    if (!client) {
      reject(new Error("Google sign-in is unavailable right now."));
      return;
    }

    client.initialize({
      client_id: clientId,
      nonce,
      callback: (response) =>
        resolve(response?.credential ? { credential: response.credential } : null),
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
    });

    client.prompt((notification) => {
      // Dismissed without choosing an account: not an error, just a no-op.
      if (notification?.isSkippedMoment?.() || notification?.isDismissedMoment?.()) {
        resolve(null);
      }
    });
  });
}

/**
 * Sign in with Apple, in popup mode so there is no server redirect to guard.
 * Apple sends the member's name only on their very first sign-in, outside the
 * token — it is passed along and used only to fill blanks on a new account.
 */
async function appleCredential(clientId, nonce) {
  await loadScript(APPLE_SDK);

  const appleId = window.AppleID?.auth;
  if (!appleId) throw new Error("Apple sign-in is unavailable right now.");

  appleId.init({
    clientId,
    scope: "name email",
    redirectURI: `${window.location.origin}/login`,
    nonce,
    usePopup: true,
  });

  try {
    const response = await appleId.signIn();
    const token = response?.authorization?.id_token;
    if (!token) return null;

    return {
      credential: token,
      profile: response.user?.name
        ? { firstName: response.user.name.firstName, lastName: response.user.name.lastName }
        : undefined,
    };
  } catch (error) {
    // Apple reports a closed popup as an error; treat it as a cancellation.
    if (error?.error === "popup_closed_by_user" || error?.error === "user_cancelled_authorize") {
      return null;
    }
    throw new Error("Apple sign-in could not be completed.");
  }
}

/** Development-only identity, inert once a real provider is configured. */
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
