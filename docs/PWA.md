# APlus Learn — Progressive Web App

How the application installs, what it caches, and — mostly — what it refuses to
cache and why.

Nothing here is operator-configurable. The caching rules are a property of the
application, in the same way `robots.js`'s disallow list is: an administrator
cannot make a booking safe to keep in a shared browser cache by editing a form.

---

## The shape of it

| Piece | File | What it is |
|---|---|---|
| Manifest | [src/app/manifest.js](../src/app/manifest.js) | Served at `/manifest.webmanifest`. Reads `getAppConfig()`, so the configured name, description and theme colour reach an installed copy. Revalidates hourly. |
| Icons | `public/icons/*` | Generated from `public/icon.svg` by [scripts/pwa-icons.mjs](../scripts/pwa-icons.mjs). Committed, so no build step and no dependency. |
| Service worker | [public/sw.js](../public/sw.js) | Hand-written allowlist. No package, no generated precache manifest. |
| Registration | [src/components/pwa/ServiceWorkerManager.jsx](../src/components/pwa/ServiceWorkerManager.jsx) | Mounted in the root layout. Registers in production; actively unregisters in development. |
| Offline page | [src/app/offline/page.js](../src/app/offline/page.js) | Pre-cached at install, anonymously. Works with no JavaScript. |
| Headers | [next.config.mjs](../next.config.mjs) | `/sw.js` is never cached by a proxy; `/icons/*` is cached for a day. |
| API envelope | [src/lib/api/response.js](../src/lib/api/response.js) | Every `ok`/`fail`/`noContent` response now carries `Cache-Control: no-store`. |

### Why no package

`next-pwa` and `@serwist/next` both hook the bundler and both build a precache
manifest from the build output. That is the wrong default for this application.
Almost everything worth caching here is already immutable and content-hashed,
and almost everything else is somebody's booking, payment, message or
verification document — so the interesting work is *exclusion*, which a
generator does not do for you. A ~250-line allowlist is auditable in one sitting,
adds no dependency, and does not have to be re-verified against Turbopack on
every Next.js minor.

---

## Caching strategy

The worker is an **allowlist**. A request that matches no rule is never passed
to `respondWith` at all — the browser makes it exactly as it would with no
service worker installed, and nothing about it can reach a cache.

| Resource | Strategy | Cache |
|---|---|---|
| `/_next/static/**` (JS, CSS, and the `next/font` woff2 files) | Cache-first | `aplus-static-v1` |
| `/_next/image?url=/…` — the optimiser, **local files only** | Cache-first | `aplus-static-v1` |
| `public/` files matched by extension | Cache-first | `aplus-static-v1` |
| `/manifest.webmanifest` | Cache-first | `aplus-static-v1` |
| Navigations (`mode === "navigate"`) | **Network-only**, offline page on network failure | never stored |
| `/api/**` | **Not intercepted** | never stored |
| RSC payloads, server actions, any non-GET | **Not intercepted** | never stored |
| The offline document | Pre-cached at install, fetched with `credentials: "omit"` | `aplus-shell-v1` |

Cache-first is only ever applied to content-hashed or genuinely immutable
files, so there is no staleness window to reason about: a new deployment mints
new filenames, and the old ones are simply never requested again.

`aplus-static-v1` is capped at 160 entries, trimmed oldest-first, because every
deployment adds a build's worth of new hashed filenames.

### Two gates, not one

The allowlist decides whether a *URL* looks static. Before anything is written,
`isStorable()` asks the *response* whether it agrees, and refuses it if it
carries `Cache-Control: no-store` or `private`, varies on `Cookie` or
`Authorization`, is not a 200, or is opaque. So a path that starts serving
personalised content stops being cached the moment it does — nobody has to
remember to update a rule.

---

## What is deliberately never cached

- **Everything under `/api/**`.** Stated first and unconditionally in
  `isStaticAsset()`, so no rule added below it can ever reach an endpoint.
  There is no allowlist of "safe" API routes, because a route that is safe
  today is one refactor away from not being. This covers sessions, bookings,
  payments and payouts, messages, notifications, calendar data, admin
  listings, integration configuration and verification documents.
- **Page documents.** A dashboard is rendered for one signed-in person.
  `/offline` is the single HTML document in any cache, and it was fetched
  anonymously.
- **RSC payloads.** Client-side navigation fetches a page's data as a GET to
  the page's own URL. These have no file extension and fall through untouched.
- **Remote images.** `/_next/image` is cached only when its `url=` parameter is
  a local path. A remote one is a tutor's own photograph on a third-party host.
- **Branding assets.** `/api/branding/[asset]` is public and immutable and would
  be harmless to keep, but it is under `/api/`, and "no `/api/` entry, ever" is
  a stronger invariant to hold than "no `/api/` entry except these". It is
  cached by the *HTTP* cache instead, which is what its `immutable` header is
  for.
- **Anything with a query string**, unless it is the image optimiser — a
  versioned asset or a signed URL is not the plain static file it resembles.

### The API envelope change

`ok()`, `fail()` and `noContent()` now set `Cache-Control: no-store`.

Route handlers are dynamic, so nothing on our side was caching them. What this
closes is everything downstream: a response with *no* `Cache-Control` at all is
eligible for heuristic caching by a browser, a corporate proxy, or a CDN
pointed at the origin. Callers can still override by passing `headers`.

The binary routes — `/api/branding/[asset]`, `/api/avatars/[key]`,
`/api/admin/verification/documents/[id]` — build a `Response` directly rather
than going through the envelope, and keep the `public, immutable` /
`private, immutable` / `private, no-store` headers they each reason about
individually (§16, §18). `bun run qa` asserts all three.

---

## Offline behaviour

A navigation that cannot reach the network is answered with the offline page.
Three things make that safe and useful:

1. **It is anonymous.** The worker fetches `/offline` with
   `credentials: "omit"` at install, so the copy in the cache was rendered for
   nobody and can be shown to anybody using that browser.
2. **It needs no JavaScript.** Both actions are real links, and the inline
   script that upgrades "Try again" into a reload travels inside the cached
   HTML rather than in a chunk the browser cannot fetch. The worker also
   pre-caches the stylesheet the page names, by reading it out of the document
   it just fetched — so the page is branded on a visitor's very first
   disconnection, not just after they have browsed enough to warm the cache.
3. **It does not pretend.** The address bar still shows the route that was
   asked for, because the worker answered *that* navigation with this document.
   Which is why "Try again" can simply reload: the reload retries the route the
   visitor actually wanted.

Only a genuine network failure triggers it. A 404 or a 500 is the application
speaking, and is shown.

**No authenticated page is made to look like it works offline.** There is no
offline database, no read-through cache of application data, and no queue of
offline mutations — a booking or a payment that a person believes succeeded
because it was queued locally is worse than one that plainly failed.

---

## Install behaviour

Installability criteria, all verified served:

- `/manifest.webmanifest` — `application/manifest+json`, with `name`,
  `short_name`, `description`, `id`, `start_url`, `scope`, `display:
  standalone`, `orientation`, `background_color`, `theme_color`.
- Icons at 192 and 512, each in `any` and `maskable`, all resolving 200.
- A service worker with a `fetch` handler, controlling scope `/`.
- HTTPS in production (`env.js` already refuses to boot a production
  deployment whose `NEXT_PUBLIC_APP_URL` is not `https://`); `localhost` is a
  secure context for development.

No custom install button. `beforeinstallprompt` does not exist on Safari, so a
hand-rolled prompt would be a control that works on one platform and lies on
another; the browser's own affordance is used on all of them.

### iOS

- `apple-touch-icon` → `/icons/apple-touch-icon.png`, 180×180, **opaque**. iOS
  composites on black and applies its own squircle, so a transparent corner
  would read as a black notch.
- Next renders `appleWebApp.capable` as the standardised
  `mobile-web-app-capable`; the root layout also emits the legacy
  `apple-mobile-web-app-capable` for older Safari, which is the difference
  between a tabbed window and a standalone one on an older iPhone.
- `apple-mobile-web-app-status-bar-style` is **`default`**, not
  `black-translucent`. The translucent bar draws the page under the clock and
  battery, which would push every sticky header on the site up behind them.
- **iOS caveats, not claimed as working:** no `beforeinstallprompt`, no Web
  Push except for a copy already added to the home screen (iOS 16.4+), and
  Safari evicts all storage — service-worker caches included — after roughly
  seven days without use. An installed copy will re-download its shell after a
  quiet week. None of this is worked around, because none of it can be.

---

## Update strategy

Deliberately unaggressive. Nothing calls `skipWaiting()` and nothing reloads
the page.

- A new worker installs and sits in `waiting`. The browser promotes it once
  every tab of the application has closed.
- `activate` deletes every `aplus-`-prefixed cache that is not in the current
  version set, then calls `clients.claim()`. Claim only affects pages running
  with no controller at all — a first visit — so it gives those offline support
  without a second page load, and never swaps the rules out from under a page
  mid-session.
- The registrar calls `registration.update()` hourly and when a hidden tab is
  brought back to the foreground. A browser only re-checks `/sw.js` on
  navigation, and an installed copy left open on a dashboard for a week may not
  navigate at all.

This is affordable because of what the worker does *not* do. Navigations are
always network-first, so an older worker still serves the current deployment's
HTML and, through it, the current deployment's content-hashed assets. **A stale
worker means a stale caching policy, never stale application code.** Nobody
loses a half-filled booking form to a reload they did not ask for.

To invalidate everything, bump `CACHE_VERSION` in `public/sw.js`.

`/sw.js` is served `no-cache, no-store, must-revalidate` and registered with
`updateViaCache: "none"`, so neither the browser's HTTP cache nor a CDN can
pin an old worker in place.

### Development

The registrar **unregisters** any worker and deletes every `aplus-` cache when
`NODE_ENV !== "production"`. A worker left over from a production build served
on the same origin — `localhost:3000` is the usual way this happens — would
serve cached chunks over the dev server's and quietly break hot reloading.

---

## Rebranding the icons

`public/icons/*` is generated, not hand-drawn. Edit `public/icon.svg`, then:

```bash
node scripts/pwa-icons.mjs
```

The script measures the mark's ink and centres it inside the maskable safe
zone, so the crop follows the artwork rather than needing to be re-tuned. It
reaches for `sharp`, which arrives with Next rather than being a dependency of
this application — the outputs are committed, so a build, a deploy and
`bun install --production` never run it.

The tab favicon and the Apple touch icon remain overridable from
Admin → Settings → Branding (§26); the manifest icons are not, because
installability depends on an icon of a declared size actually being that size,
and an upload's exact dimensions vary per deployment.

---

## Testing locally

A service worker needs a production build — the registrar declines to install
one in development, by design.

```bash
bun run build
APP_ENV=development PORT=3210 bun run start
```

`APP_ENV=development` is needed because `next start` forces
`NODE_ENV=production`, which makes `lib/config/env.js` demand real provider
credentials. It relaxes the boot gate only; `NODE_ENV` is still `production`,
so the worker registers exactly as it will in a real deployment.

Then, at `http://localhost:3210` (a secure context, so service workers are
permitted):

1. **Application → Service Workers** — one worker, `activated`, scope `/`.
2. **Application → Cache Storage** — `aplus-static-v1` and `aplus-shell-v1`,
   and nothing else. `aplus-shell-v1` should contain `/offline` and nothing
   else.
3. Sign in, visit `/dashboard`, `/bookings`, `/messages`, `/payments`.
   Re-inspect Cache Storage: **there must be no `/api/` entry, and no document
   other than `/offline`.**
4. **Network → Offline**, then reload a private route. The offline page should
   appear, branded and styled, with the original URL still in the address bar.
5. Uncheck Offline and reload. The application returns to normal.
6. **Lighthouse → Installable** (Chromium), or the install affordance in the
   address bar.

### What was verified, and how

Steps 1–6 are automated end to end against real Chrome. The harness lives in
this session's scratchpad rather than the repository — it is a one-off, not a
third test suite to maintain — but it signs in with a seeded account, browses
every private area, reads **every cached response body** looking for that
account's identifiers, goes offline, and comes back. See the change's report
for the run.

The two standing suites cover the API-envelope change:

```bash
bun run test:integrations    # 1222 passed, 0 failed, 1 skipped
bun run dev                  # in another terminal, then:
bun run qa                   # 813 passed, 0 failed
```

`qa` asserts the `Cache-Control` on the three binary routes the envelope change
does *not* touch, which is what proves it did not touch them.
