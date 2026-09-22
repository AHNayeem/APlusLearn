"use client";

import { useEffect } from "react";

/**
 * Registers the service worker in production, and makes sure there isn't one
 * in development (§18).
 *
 * The update policy is the conservative one. A newly installed worker is left
 * in `waiting` — the browser promotes it once every tab of the application has
 * closed — and nothing here calls `skipWaiting()` or reloads the page. That is
 * affordable because of what the worker does *not* do: navigations are always
 * network-first, so an older worker still serves the current deployment's HTML
 * and, through it, the current deployment's content-hashed assets. A stale
 * worker means a stale caching *policy*, never stale application code. Nobody
 * loses a half-filled booking form to a reload they did not ask for.
 *
 * What the timer is for is the opposite problem: a browser only re-checks
 * `/sw.js` on navigation, and an installed copy left open on a dashboard for a
 * week may not navigate at all. The hourly check, plus one when the tab is
 * brought back to the foreground, is what makes "eventually" mean hours rather
 * than whenever the person happens to reopen the application.
 */

const SW_URL = "/sw.js";
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

/** Every cache the worker owns shares this prefix — see `public/sw.js`. */
const CACHE_PREFIX = "aplus-";

export function ServiceWorkerManager() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    // A worker left over from a production build served on the same origin —
    // `localhost:3000` is the usual way this happens — would serve cached
    // chunks over the dev server's and quietly break hot reloading. Development
    // actively clears it rather than merely declining to register one.
    if (process.env.NODE_ENV !== "production") {
      void unregisterEverything();
      return;
    }

    let cancelled = false;
    let registration = null;
    let timer = null;

    const checkForUpdate = () => {
      if (document.visibilityState !== "visible") return;
      registration?.update().catch(() => {
        // Offline, or the worker script is momentarily unreachable mid-deploy.
        // The next check picks it up; there is nothing to tell the user.
      });
    };

    const start = async () => {
      try {
        const result = await navigator.serviceWorker.register(SW_URL, {
          scope: "/",
          // The worker script itself is never read from the HTTP cache, so a
          // deployment cannot be masked by a stale copy of `/sw.js`.
          updateViaCache: "none",
        });

        if (cancelled) return;
        registration = result;

        timer = setInterval(checkForUpdate, UPDATE_INTERVAL_MS);
        document.addEventListener("visibilitychange", checkForUpdate);
      } catch (error) {
        // Registration failing is not a broken application — it is an
        // application without offline support, which is how it behaved before
        // any of this existed. Private browsing and some managed browsers
        // refuse outright.
        console.warn("[pwa] service worker registration failed:", error?.message ?? error);
      }
    };

    // Registration competes with hydration and with the first data fetches for
    // bandwidth, and it is the least urgent of the three.
    if (document.readyState === "complete") {
      void start();
    } else {
      window.addEventListener("load", start, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", start);
      document.removeEventListener("visibilitychange", checkForUpdate);
      if (timer) clearInterval(timer);
    };
  }, []);

  return null;
}

async function unregisterEverything() {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if (typeof caches === "undefined") return;
    const names = await caches.keys();
    await Promise.all(
      names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => caches.delete(name)),
    );
  } catch {
    // Storage access can be refused outright; there is nothing to recover.
  }
}
