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
| Install prompt | [src/components/pwa/InstallPrompt.jsx](../src/components/pwa/InstallPrompt.jsx) + [src/lib/pwa/install.js](../src/lib/pwa/install.js) | A delayed, dismissible "Install App" card where the browser can install, Safari's steps on iOS, nothing elsewhere. See [Install prompt](#install-prompt). |
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
  listings, integration configuration and verification documents — and the
  realtime event stream, `/api/realtime`, which the browser opens directly
  and the worker never sees ([REALTIME.md](REALTIME.md)).
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

The browser's own affordances — Chrome's address-bar icon, "Install app" in
the menu, Safari's Share → Add to Home Screen — always work. On top of them the
application offers an install itself, but only where it can do so honestly; see
[Install prompt](#install-prompt) below.

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
- **iOS caveats, not claimed as working:** no `beforeinstallprompt` (so the
  install prompt shows Safari's steps instead of a button), no Web
  Push except for a copy already added to the home screen (iOS 16.4+), and
  Safari evicts all storage — service-worker caches included — after roughly
  seven days without use. An installed copy will re-download its shell after a
  quiet week. None of this is worked around, because none of it can be.

---

## Install prompt

A small card that tells a visitor the application can be installed, after
they have had time to look around. Two offers, and only two, because there are
only two that do what they say:

| Environment | What is shown | What the button does |
|---|---|---|
| Chrome / Edge / Samsung Internet / Opera, Android or desktop, not installed | **Install {name}** — "Install App" / "Not now" | Calls the saved `beforeinstallprompt` event's `prompt()`: the browser's own dialog |
| Safari on iPhone or iPad, not on the home screen | **Install {name}** — Safari's three steps (Share → Add to Home Screen → Add), labelled "In Safari" — "Not now" | Nothing to install from: there is no Install App button |
| Running installed (any platform) | Nothing | — |
| Firefox (any), macOS Safari, Chrome/Firefox/Edge on iOS, in-app browsers | Nothing | — |
| Within the cooldown after "Not now" or a declined dialog | Nothing | — |
| After an accepted install, for the rest of the session | Nothing | — |

`{name}` is the configured application name, as in the manifest, so a
rebranded deployment never offers to install "APlus Learn".

### Pieces

| Piece | File |
|---|---|
| The decision — installed-state detection, iOS Safari detection, cooldown, quiet routes, states A–F | [src/lib/pwa/install.js](../src/lib/pwa/install.js) (pure; no `window`) |
| The card | [src/components/pwa/InstallPrompt.jsx](../src/components/pwa/InstallPrompt.jsx), mounted in the root layout inside `ToastProvider` |
| Early event capture | `CAPTURE_SCRIPT` in `install.js`, inlined first in `<body>` by [src/app/layout.js](../src/app/layout.js) |
| Timing constants | `PWA_INSTALL_PROMPT` in [src/constants/config.js](../src/constants/config.js) |

It touches nothing in the service worker, the manifest or the caching rules,
and it stores nothing but one timestamp.

### Chromium (Android and desktop)

Chromium fires `beforeinstallprompt` once per page load when the site is
installable *and not already installed*, and it can fire before React has
hydrated. So an inline script at the top of `<body>` catches it, calls
`preventDefault()` — which stops Android's mini-infobar, since our card
replaces it on our schedule, but leaves the address-bar icon and the menu
item alone — and parks the event on `window`. Nothing ever calls `prompt()`
except a click on **Install App**.

After the browser's dialog:

- **accepted** → the card closes, a toast says the app is installing, and
  `sessionStorage` remembers it, so it is not offered again this session
  (`appinstalled` does the same if the visitor installs from the browser menu
  while the card is up);
- **dismissed** → the card closes and the cooldown starts, exactly as for
  "Not now" — the browser's "Cancel" is a no.

An event is good for one `prompt()`; afterwards it is dropped, and a fresh one
arrives on a later page load if the site is still installable.

### iOS Safari

iOS has no install API, and nothing on a page can open the Add to Home Screen
sheet. So the card shows Safari's own steps, with Safari's glyphs, under an "In
Safari" label, and has no install button — only "Not now" and close.

Step 1 names both places Share can be: the toolbar, or behind "•••" in the
compact toolbar iOS 26 made the default. iPadOS presents a Mac user agent, so an
iPad is recognised by a Mac platform with touch points; macOS Safari has none
and is shown nothing. Chrome, Firefox and Edge on iOS, and embedded web views
(Instagram, the Google app, …), are excluded: their share menus are not
Safari's, and the steps would be instructions for a different app.

### Already installed

The card is not shown when the page is running *as* the app:
`display-mode` `standalone`, `fullscreen`, `minimal-ui` or
`window-controls-overlay`; iOS's `navigator.standalone`; or an
`android-app://` referrer (a Trusted Web Activity).

A browser *tab* on a device where the app is installed is a different
question. Chromium answers it for us by not firing `beforeinstallprompt`, so
no card. Safari gives a page no way to ask — and a home-screen app's storage is
separate from Safari's, so the app cannot leave a note for the tab. An iPhone
user who installed the app and then opens the site in Safari again will see the
instructions once more, subject to the cooldown. This cannot be fixed from the
page.

### Timing

- **Delay:** `PWA_INSTALL_PROMPT.delaySeconds` (20) of time the page is
  actually *in view* — a background tab does not count down. Never on first
  paint.
- **Not while typing:** if a field has focus when the delay is up, it waits
  and checks again five seconds later.
- **Quiet routes:** sign-in, sign-up, verification and reset pages, checkout,
  `/offline`, `/dev` and open message threads (whose composer is pinned to the
  bottom of a phone). On these the offer is held, not dropped: it appears on
  the next ordinary page, and nothing is recorded as dismissed. Client-side
  navigation keeps the timer, so moving from a quiet route to an ordinary one
  shows it without waiting again.

### Dismissal

"Not now", the close button, Escape, and declining the browser's dialog all
write one key, `localStorage["aplus:install-prompt-dismissed"]`, holding the
time in milliseconds. The card is not offered again for
`PWA_INSTALL_PROMPT.cooldownDays` (14). It is a pause, not an opt-out — there
is no requirement for a permanent one. A timestamp from the future (a clock
that moved back) counts as "just now", and an unreadable one as no dismissal.
"Not now" in one tab closes the card in the others. If storage is refused
(private browsing, managed browsers), the card still works for the visit; it
just cannot remember.

Nothing about the prompt involves an account: it works the same signed in or
out, and the stored state belongs to the browser.

### Layout and accessibility

- **Phone (< `sm`):** a sheet across the bottom, 12px from each edge (or the
  safe-area inset, if larger), lifted by `env(safe-area-inset-bottom)` and
  by the `--support-launcher-clearance` the support launcher publishes, so it
  never covers the launcher or the home indicator. 44px buttons.
- **`sm` and up:** a compact card, `max-w-sm`, at the bottom centre — clear
  of the launcher and toasts (bottom right) and of the dashboard sidebar's
  account links (bottom left).
- **Non-modal:** `role="dialog"` with `aria-modal="false"`, labelled and
  described. No backdrop, no scroll lock, no focus trap, and focus is *not*
  moved into it on arrival — an unsolicited card that took the caret out of a
  half-typed search would be the intrusive popup this is meant not to be. A
  polite live region announces it once. Keyboard users reach it with Tab;
  closing it from inside returns focus to where they came from.
- **Escape** closes it when focus is on the page or in the card — not while a
  modal is open, and not from inside a text field, where Escape already means
  something else.
- Fixed-position, so no layout shift; `prefers-reduced-motion` reduces the
  slide to a fade; `no-print`. The application has no dark theme, so neither
  does the card; it uses the same tokens, `Button` and `IconButton` as
  everything else.

### Testing it

```bash
bun run test:integrations   # the decision: "PWA install prompt" section
bun run dev                 # in another terminal, then:
bun run e2e:install         # the card in real Chrome
```

[`scripts/e2e-install.mjs`](../scripts/e2e-install.mjs) covers each state in
a fresh browser context: the native flow (accepted and declined), "Not now"
and its cooldown, Escape, standalone and iOS standalone, Safari on iPhone,
Firefox and Chrome on iOS, phones at 360×800, 390×844 and 412×915 (inside the
viewport, no horizontal overflow, 44px targets, clear of the launcher and top
bar, page still scrolls), quiet routes, typing, and every signed-in area plus
the admin console with the card on screen. The install event is *simulated* —
an automated browser cannot be made installable on demand and cannot click
browser chrome — and a real event is stopped before the application sees it,
so a run never opens a real install dialog. The delay is skipped with
Playwright's clock, not a test hook.

Against a production build in real Chrome (154, a fresh profile, started with
`--bypass-app-banner-engagement-checks` because an automated profile has no
engagement with the origin), the real path was verified end to end up to the
browser's own dialog: Chrome fires a *trusted* `beforeinstallprompt`, the
capture script parks it, nothing is shown on first paint, the card appears
after the delay, and Install App calls the real `prompt()`. What could not be
automated is everything after that: accepting the browser's dialog, relaunching
the installed app and uninstalling it. A page cannot click browser chrome, and
the DevTools `PWA` domain (`PWA.install` / `launch` / `uninstall`) is not
present in that build. Those steps are covered by simulation in
`e2e:install` and need a person at a real browser to confirm.

To try the real thing on desktop Chrome, use a production build (above), visit
`http://localhost:3210`, interact with the page, and wait 20 seconds. To see
the card again, clear `aplus:install-prompt-dismissed` from Local Storage, or
uninstall the app (`chrome://apps`, or the app window's menu). On a phone, the
production build has to be served over HTTPS (a tunnel such as `cloudflared`
or `ngrok` will do) — `localhost` is only a secure context on the device that
is serving it.

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
