/**
 * APlus Learn service worker.
 *
 * Written by hand rather than generated. A precache manifest built from the
 * build output is the wrong default for this application: almost everything
 * worth caching here is already immutable and content-hashed, and almost
 * everything else is somebody's booking, payment, message or verification
 * document. So this file is an *allowlist*. A request that does not match one
 * of the rules below is never passed to `respondWith` at all — the browser
 * makes it exactly as it would with no service worker installed, and nothing
 * about it can end up in a cache.
 *
 * What may be cached:
 *   - `/_next/static/**` — build output, content-hashed, immutable. This is
 *     also where `next/font` self-hosts the Plus Jakarta Sans files, so there
 *     is no third-party font origin to think about.
 *   - `/_next/image?url=/...` — the optimiser, but only when it is resizing a
 *     file that ships in `public/`. A remote `url=` is a tutor's own photo
 *     from a third-party host and is left alone.
 *   - Extension-matched files served from `public/` — icons, the manifest,
 *     the marketing imagery.
 *
 * What may never be cached, and why the rules are shaped to make it
 * structurally impossible rather than merely unlikely:
 *   - Anything under `/api/**`. Every endpoint is one: sessions, bookings,
 *     payments, messages, notifications, admin data, integration settings,
 *     verification documents. There is no allowlist of "safe" API routes,
 *     because a route that is safe today is one refactor from not being.
 *   - Navigations. A dashboard document is rendered for one signed-in person;
 *     it goes to the network and it is never stored. When the network is gone
 *     the offline page is served in its place, from a copy fetched without
 *     credentials at install time.
 *   - RSC payloads. Client-side navigation fetches a page's data as a GET to
 *     the page's own URL. Those have no file extension, so they fall through
 *     the allowlist untouched.
 *
 * Bump CACHE_VERSION to invalidate every cache this worker owns.
 */

const CACHE_VERSION = "v1";

/** Build output and `public/` files. Cache-first; entries are immutable. */
const STATIC_CACHE = `aplus-static-${CACHE_VERSION}`;

/** The offline document, and nothing else. */
const SHELL_CACHE = `aplus-shell-${CACHE_VERSION}`;

const OWNED_CACHES = [STATIC_CACHE, SHELL_CACHE];

/** Every cache this worker has ever owned shares this prefix. */
const CACHE_PREFIX = "aplus-";

const OFFLINE_URL = "/offline";

/**
 * Icons the offline page and the install prompt need while the network is
 * down. Small, and fetched once per version.
 */
const PRECACHE_ASSETS = ["/icons/icon-192.png", "/icons/icon-maskable-192.png"];

/**
 * A ceiling on the static cache, enforced oldest-first.
 *
 * Every deployment mints new hashed filenames, so without a ceiling the cache
 * grows by roughly one build's worth of chunks each release for as long as a
 * cache version lasts. 160 entries is comfortably more than one page load of
 * an admin screen, which is the heaviest thing here.
 */
const STATIC_CACHE_LIMIT = 160;

/** Files under `public/` that are safe to treat as static assets. */
const STATIC_FILE = /\.(?:css|js|mjs|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|avif|ico)$/i;

// ---------------------------------------------------------------------------
// Install — take a copy of the offline page and what it needs to render.
// ---------------------------------------------------------------------------

self.addEventListener("install", (event) => {
  event.waitUntil(precache());
});

async function precache() {
  // `credentials: "omit"` matters. The offline page renders no session data,
  // and fetching it anonymously guarantees that stays true: whatever is
  // cached here was rendered for nobody, so it cannot leak one person's view
  // of the application to the next person using this browser.
  // `cache: "reload"` skips the HTTP cache so a new worker version takes a
  // genuinely current copy.
  const request = new Request(OFFLINE_URL, { credentials: "omit", cache: "reload" });
  const response = await fetch(request);
  if (!response.ok) throw new Error(`offline page unavailable (${response.status})`);

  const shell = await caches.open(SHELL_CACHE);
  await shell.put(OFFLINE_URL, response.clone());

  // The offline page is server-rendered, so its stylesheet and chunk URLs are
  // only knowable by reading the document it just returned. Without this the
  // page renders unstyled the first time a visitor loses connectivity, before
  // ordinary browsing has had a chance to populate the static cache.
  const html = await response.text();
  const referenced = [
    ...html.matchAll(/(?:href|src)="(\/_next\/static\/[^"?]+\.(?:css|js|woff2))"/g),
  ].map((match) => match[1]);

  const statics = await caches.open(STATIC_CACHE);
  await Promise.allSettled(
    [...new Set([...referenced, ...PRECACHE_ASSETS])].map((url) =>
      statics.add(new Request(url, { credentials: "omit" })),
    ),
  );
}

// ---------------------------------------------------------------------------
// Activate — drop caches from older versions, then take over open pages.
// ---------------------------------------------------------------------------

self.addEventListener("activate", (event) => {
  event.waitUntil(cleanUp());
});

async function cleanUp() {
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((name) => name.startsWith(CACHE_PREFIX) && !OWNED_CACHES.includes(name))
      .map((name) => caches.delete(name)),
  );

  // Claim is safe here in a way that `skipWaiting` would not be. It only
  // affects pages that are running with no controller at all — a first visit —
  // and gives them offline support without a second page load. A worker
  // replacing an existing one still waits for every tab to close, so a
  // deployment never swaps the rules out from under a page mid-session.
  await self.clients.claim();
}

// ---------------------------------------------------------------------------
// Fetch
// ---------------------------------------------------------------------------

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // A non-GET request is a mutation: a booking, a payment, a message, a
  // sign-in. It goes to the network, and it is the network's answer that
  // counts. Nothing is queued and nothing is replayed.
  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Another origin's response is not ours to store.
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(networkWithOfflineFallback(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }

  // Everything else — `/api/**`, RSC payloads, server actions, anything with
  // a query string that is not the image optimiser — is deliberately not
  // handled. No `respondWith`, no cache, no service worker involvement.
});

/**
 * Is this URL one of the few things this worker is allowed to keep?
 *
 * @param {URL} url
 * @returns {boolean}
 */
function isStaticAsset(url) {
  const { pathname } = url;

  // Stated first and unconditionally, so no rule added below can ever reach
  // an endpoint.
  if (pathname.startsWith("/api/")) return false;

  if (pathname.startsWith("/_next/static/")) return true;

  if (pathname === "/_next/image") {
    // Only images that ship with the build. A remote `url=` belongs to a
    // third-party host and is somebody's uploaded photograph.
    const target = url.searchParams.get("url") ?? "";
    return target.startsWith("/") && !target.startsWith("//");
  }

  if (pathname === "/manifest.webmanifest") return true;

  // A query string on anything else means it is not the plain static file it
  // looks like — a versioned branding asset, a signed URL, a tracked link.
  if (url.search) return false;

  return STATIC_FILE.test(pathname);
}

/**
 * Navigations always go to the network. On failure — and only on a genuine
 * network failure, never on a 4xx or 5xx, which are the application speaking
 * and must be shown — the offline page stands in.
 *
 * The response is not cached under any circumstances. It is one person's
 * rendered view of their own dashboard.
 */
async function networkWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch {
    const cached = await caches.match(OFFLINE_URL, { cacheName: SHELL_CACHE });
    if (cached) return cached;

    return new Response("You are offline, and no offline page has been stored yet.", {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

/**
 * Cache-first, for immutable assets only. A miss goes to the network and the
 * answer is stored if — and only if — it is storable.
 */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);

  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);

  if (isStorable(response)) {
    // Stored before the ceiling is enforced, so the entry just fetched is
    // never the one evicted.
    await cache.put(request, response.clone());
    await trim(cache, STATIC_CACHE_LIMIT);
  }

  return response;
}

/**
 * The last gate before anything is written.
 *
 * The allowlist above already decided this URL looks static. This asks the
 * *response* whether it agrees — so a path that starts serving personalised
 * content, or that begins varying on the session cookie, stops being cached
 * the moment it does, without anyone having to remember to update a rule.
 *
 * @param {Response} response
 * @returns {boolean}
 */
function isStorable(response) {
  if (!response || response.status !== 200) return false;

  // An opaque cross-origin response cannot be inspected, so it is not kept.
  if (response.type !== "basic" && response.type !== "default") return false;

  const cacheControl = response.headers.get("Cache-Control") ?? "";
  if (/\bno-store\b|\bprivate\b/i.test(cacheControl)) return false;

  const vary = response.headers.get("Vary") ?? "";
  if (/\*|cookie|authorization/i.test(vary)) return false;

  // Belt and braces: the Fetch specification already strips `Set-Cookie` from
  // a response a service worker can see, so this can only ever be false. It
  // costs nothing and it says what the rule is.
  if (response.headers.has("Set-Cookie")) return false;

  return true;
}

/**
 * Enforce the entry ceiling, oldest first. `cache.keys()` returns entries in
 * insertion order, which for immutable build output is a good enough proxy
 * for least-recently-useful.
 */
async function trim(cache, limit) {
  const keys = await cache.keys();
  if (keys.length <= limit) return;

  await Promise.all(keys.slice(0, keys.length - limit).map((key) => cache.delete(key)));
}
