import { WifiOff, RotateCcw, Home } from "lucide-react";
import { Button } from "@/components/ui";
import { Logo } from "@/components/layout/Logo";
import { getAppConfig } from "@/services/settings.service";

/**
 * The page the service worker serves when a navigation cannot reach the
 * network.
 *
 * Three constraints shape it, and they are all about what it must *not* do.
 *
 * It shows no application data. Not a cached dashboard, not a booking, not a
 * message — the service worker fetches this page anonymously at install time,
 * so the copy sitting in the cache was rendered for nobody and can be shown to
 * anybody using this browser.
 *
 * It works with no JavaScript. The worker stores this document and the
 * stylesheet it names, but a first-time visitor who loses connectivity may not
 * have the page's chunks cached yet, so nothing here may depend on hydration.
 * Both actions are real links. The inline script below is an enhancement on
 * top of them and is inline precisely so that it travels with the cached HTML.
 *
 * It does not pretend. The URL in the address bar is still the page that was
 * asked for, because the worker answered that navigation with this document —
 * which is also why "Try again" can simply reload: the reload retries the
 * route the visitor actually wanted, not this one.
 */

/**
 * Rebuilt hourly, like the manifest and `robots.txt`: this page names the
 * platform, and renaming it from the admin panel must reach the copy the
 * service worker will go on to store.
 */
export const revalidate = 3600;

export const metadata = {
  title: "You're offline",
  // Nothing to index, and a crawler that found it would be reading an error
  // state as if it were a page of the marketplace.
  robots: { index: false, follow: false },
};

export default async function OfflinePage() {
  const { branding } = await getAppConfig();

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="container-page py-6">
        {/*
          The name, but not the uploaded logo. An operator's logo is served
          from `/api/branding/...`, which the worker never caches — passing it
          here would draw a broken image on the one page guaranteed to be
          looked at with no network.
        */}
        <Logo branding={{ appName: branding.appName }} />
      </header>

      <main id="main" className="container-page flex flex-1 items-center py-16">
        <div className="mx-auto max-w-lg text-center">
          <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-ink-100 text-ink-500">
            <WifiOff className="size-7" aria-hidden="true" />
          </span>

          <h1 className="mt-5 text-2xl font-extrabold tracking-tight text-ink-900 sm:text-3xl">
            You&rsquo;re offline
          </h1>

          <p className="mt-3 text-sm leading-relaxed text-ink-500">
            We couldn&rsquo;t reach {branding.appName}. Check your connection and try again —
            nothing you were doing has been lost, and your lessons, messages and payments are
            all safe on our end.
          </p>

          <p
            id="offline-restored"
            hidden
            className="mx-auto mt-5 w-fit rounded-xl bg-success-50 px-4 py-2 text-sm font-semibold text-success-700"
          >
            You&rsquo;re back online — try again.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button
              id="offline-retry"
              href="/"
              size="lg"
              iconLeft={<RotateCcw className="size-4" />}
            >
              Try again
            </Button>
            <Button href="/" variant="secondary" size="lg" iconLeft={<Home className="size-4" />}>
              Go to the home page
            </Button>
          </div>

          <p className="mt-8 border-t border-ink-200 pt-6 text-xs text-ink-400">
            Booking, payment and messaging all need a connection. They&rsquo;ll work again as
            soon as you&rsquo;re back online.
          </p>
        </div>
      </main>

      {/*
        Inline, and not a Client Component, so it is part of the cached
        document rather than something that arrives in a chunk the browser
        cannot fetch while offline.

        `location.reload()` retries the route the visitor originally asked for:
        the service worker answered *that* navigation with this document, so
        the document's URL is still theirs.
      */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){
  var retry = document.getElementById("offline-retry");
  if (retry) retry.addEventListener("click", function (event) {
    event.preventDefault();
    location.reload();
  });
  window.addEventListener("online", function () {
    var note = document.getElementById("offline-restored");
    if (note) note.hidden = false;
  });
})();`,
        }}
      />
    </div>
  );
}
