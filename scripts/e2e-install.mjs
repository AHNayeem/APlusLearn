/**
 * Browser end-to-end: the "install this app" prompt (docs/PWA.md).
 *
 * `bun run test:integrations` proves the decision; this proves what a person
 * sees in a real browser, in each environment the decision distinguishes:
 *
 *   1. Installable (Chromium): nothing on first paint; the card after the
 *      delay; Install App calls the browser's own prompt exactly once.
 *      Accepted → gone for the session. Declined → gone, and not back on the
 *      next page.
 *   2. "Not now" → gone, remembered, not back on reload — and back once the
 *      cooldown has passed. Escape closes it too.
 *   3. Already installed (display-mode: standalone, iOS navigator.standalone)
 *      → nothing, even when an install event arrives.
 *   4. Safari on iPhone → Safari's Add to Home Screen steps, no Install App
 *      button, and nothing that calls an install API.
 *   5. Firefox, and Chrome on iOS → nothing at all.
 *   6. Phones at 360×800, 390×844 and 412×915: a bottom sheet inside the
 *      viewport, no horizontal overflow, 44px touch targets, clear of the
 *      support launcher and the header, and the page behind it still scrolls.
 *   7. Quiet routes (sign-in, sign-up) hold it back without dismissing it, and
 *      it waits while someone is typing.
 *   8. With the card on screen, every signed-in area still renders and works:
 *      dashboard, bookings, payments, messages, notifications, settings and
 *      the admin console — and no page logs an error.
 *
 *   bun run dev                 # in one terminal
 *   bun run e2e:install         # in another
 *
 * The browser's install event is *simulated*: an automated browser cannot be
 * made to consider a development server installable on demand, and the native
 * dialog it would open is browser chrome a page cannot click. A real event
 * that does arrive is stopped before the application sees it, so a run never
 * opens a real install dialog.
 *
 * The delay is skipped by firing the one timer the page registered with the
 * configured delay, early — not with a test hook in the application, and not
 * with Playwright's clock: jumping the page's clock ahead of the compositor's
 * leaves every `motion` animation scheduled into the future, so a card that
 * has closed would never finish leaving.
 *
 * Playwright is found the way `e2e-realtime.mjs` finds it, and drives system
 * Chrome by default (`E2E_BROWSER_CHANNEL`, empty for Playwright's own
 * Chromium). `E2E_SCREENSHOTS=<dir>` saves a picture of each layout checked.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { PWA_INSTALL_PROMPT } from "../src/constants/config.js";

const BASE = process.env.QA_BASE_URL || "http://localhost:3000";
const PASSWORD = "AplusLearn2024!";
// Not the account `qa` and `e2e:realtime` use: each sign-in from a new browser
// spends one of the account's hourly sign-in codes, and sharing them would let
// back-to-back runs of different suites lock each other out.
const PARENT_EMAIL = "david.thompson@example.com";
const ADMIN_EMAIL = "admin@apluslearn.ca";
const SHOTS = process.env.E2E_SCREENSHOTS;
const CHANNEL = process.env.E2E_BROWSER_CHANNEL ?? "chrome";
const DELAY_MS = PWA_INSTALL_PROMPT.delaySeconds * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DISMISSED_KEY = "aplus:install-prompt-dismissed";
const ACCEPTED_KEY = "aplus:install-prompt-accepted";

const RUN_IP = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;

const UA = {
  desktopChrome:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iphoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.7339.122 Mobile/15E148 Safari/604.1",
  desktopFirefox: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:143.0) Gecko/20100101 Firefox/143.0",
};

let passed = 0;
let failed = 0;

function section(title) {
  console.log(`\n▸ ${title}`);
}

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
  return condition;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // Not installed in the project; look further.
  }

  const candidates = [];
  if (process.env.PLAYWRIGHT_MODULE_DIR) candidates.push(process.env.PLAYWRIGHT_MODULE_DIR);
  const npxCache = path.join(homedir(), ".npm", "_npx");
  if (existsSync(npxCache)) {
    for (const entry of readdirSync(npxCache)) {
      candidates.push(path.join(npxCache, entry, "node_modules"));
    }
  }

  for (const dir of candidates) {
    if (!existsSync(path.join(dir, "playwright", "package.json"))) continue;
    return createRequire(path.join(dir, "noop.js"))("playwright");
  }

  console.error(
    "\nPlaywright was not found. Run `npx -y playwright@latest --version` once to cache it,\n" +
      "or point PLAYWRIGHT_MODULE_DIR at a node_modules directory that contains it.\n",
  );
  process.exit(1);
}

/** A cookie-jar API client, so a browser context can be handed a real session. */
function apiClient() {
  const jar = new Map();
  const call = async (route, { method = "GET", body } = {}) => {
    const response = await fetch(`${BASE}${route}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": RUN_IP, "x-real-ip": RUN_IP,
        ...(jar.size ? { Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      redirect: "manual",
    });
    for (const header of response.headers.getSetCookie?.() ?? []) {
      const [pair] = header.split(";");
      const at = pair.indexOf("=");
      if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    const payload = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, payload };
  };
  call.cookies = () => [...jar].filter(([, v]) => v).map(([name, value]) => ({ name, value, url: BASE }));
  return call;
}

/** Password, then the new-device code a development server shows. */
async function signIn(email) {
  const client = apiClient();
  let res = await client("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  if (res.payload?.error?.code === "RATE_LIMITED") {
    const wait = 1000 * ((res.payload.error.message.match(/(\d+) seconds/)?.[1] ?? 60) * 1 + 2);
    console.log(`    (rate limited — waiting ${Math.round(wait / 1000)}s)`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    res = await client("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  }
  if (res.ok && res.payload?.data?.verificationRequired) {
    const code = res.payload.data.devCode;
    if (!code) throw new Error("sign-in needs a device code and this server did not show one");
    res = await client("/api/auth/login/verify", { method: "POST", body: { code } });
  }
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(res.payload?.error)}`);
  return client;
}

/**
 * Runs before any of the page's own scripts. Stands in for the browser:
 * optionally reports an installed display mode, and optionally fires a
 * `beforeinstallprompt` whose `prompt()` is counted and whose `userChoice`
 * resolves to `outcome`. A *real* install event is stopped here, so the
 * application only ever sees the simulated one.
 */
function browserStandIn({
  native = false, outcome = "accepted", standalone = false, iosStandalone = false, delayMs,
}) {
  window.__installPromptCalls = 0;

  // Timers registered with exactly the prompt's delay can be fired early.
  const realSet = window.setTimeout.bind(window);
  const realClear = window.clearTimeout.bind(window);
  const pending = new Map();
  window.setTimeout = (fn, ms, ...args) => {
    const id = realSet(() => {
      pending.delete(id);
      if (typeof fn === "function") fn(...args);
    }, ms);
    if (ms === delayMs && typeof fn === "function") {
      pending.set(id, () => {
        realClear(id);
        pending.delete(id);
        fn(...args);
      });
    }
    return id;
  };
  window.clearTimeout = (id) => {
    pending.delete(id);
    realClear(id);
  };
  window.__installDelayPending = () => pending.size;
  window.__skipInstallDelay = () => {
    const runs = [...pending.values()];
    for (const run of runs) run();
    return runs.length;
  };
  window.addEventListener(
    "beforeinstallprompt",
    (event) => {
      if (event.isTrusted) event.stopImmediatePropagation();
    },
    true,
  );

  if (standalone) {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query.replace(/\s/g, "") === "(display-mode:standalone)"
        ? {
            matches: true, media: query, onchange: null,
            addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
            dispatchEvent: () => false,
          }
        : original(query);
  }
  if (iosStandalone) {
    Object.defineProperty(Navigator.prototype, "standalone", { get: () => true, configurable: true });
  }

  if (native) {
    document.addEventListener("DOMContentLoaded", () => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      let choose;
      event.platforms = ["web"];
      event.userChoice = new Promise((resolve) => {
        choose = resolve;
      });
      event.prompt = () => {
        window.__installPromptCalls += 1;
        choose({ outcome, platform: "web" });
        return Promise.resolve({ outcome, platform: "web" });
      };
      window.dispatchEvent(event);
    });
  }
}

const card = (page) => page.locator('[role="dialog"][aria-modal="false"]');
const installButton = (page) => card(page).getByRole("button", { name: "Install App" });
const notNowButton = (page) => card(page).getByRole("button", { name: "Not now" });

async function main() {
  console.log(`\nAPlus Learn — PWA install prompt in a real browser → ${BASE}\n${"─".repeat(60)}`);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  // Once per role per run, reused by every context that needs it.
  const parent = await signIn(PARENT_EMAIL);
  const admin = await signIn(ADMIN_EMAIL);

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  const errors = [];

  /**
   * One context per scenario, so nothing stored by one leaks into the next.
   */
  const open = async ({
    route = "/",
    userAgent = UA.desktopChrome,
    viewport = { width: 1280, height: 800 },
    mobile = false,
    standIn = {},
    cookies = [],
    context: reuse,
  } = {}) => {
    const context =
      reuse ??
      (await browser.newContext({
        userAgent,
        viewport,
        isMobile: mobile,
        hasTouch: mobile,
        deviceScaleFactor: mobile ? 2 : 1,
        extraHTTPHeaders: { "x-forwarded-for": RUN_IP, "x-real-ip": RUN_IP },
      }));
    if (cookies.length) await context.addCookies(cookies);
    const page = await context.newPage();
    // A development server compiles each route on its first request, which on
    // a loaded machine can take a minute.
    page.setDefaultNavigationTimeout(180_000);
    await page.addInitScript(browserStandIn, { ...standIn, delayMs: DELAY_MS });
    page.on("pageerror", (error) => errors.push(`${route}: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`${route}: ${message.text()}`);
    });
    await page.goto(`${BASE}${route}`, { waitUntil: "load" });
    return { context, page };
  };

  /**
   * Wait until React has hydrated the root layout. The delay's timer starts in
   * an effect, and on a development server hydration can land well after
   * `load` — skipping time before then would skip nothing, and every "shows
   * nothing" check after it would pass for the wrong reason. Hydration is
   * when React attaches itself to the server-rendered elements.
   */
  const hydrated = async (page) => {
    await page.waitForFunction(
      () => [...document.body.children].some((el) => Object.keys(el).some((k) => k.startsWith("__reactFiber"))),
      null,
      { timeout: 120_000 },
    );
    // Passive effects run just after the hydration commit.
    await page.waitForTimeout(300);
  };

  /**
   * Skip the in-view delay, then give React and the entry animation a moment.
   * The delay's timer must exist first — otherwise there is nothing to skip,
   * and a "shows nothing" check would be passing for the wrong reason.
   */
  const pastDelay = async (page) => {
    await hydrated(page);
    await page.waitForFunction(() => window.__installDelayPending() > 0, null, { timeout: 10_000 });
    await page.evaluate(() => window.__skipInstallDelay());
    await page.waitForTimeout(600);
  };

  const shot = async (page, name) => {
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
  };

  try {
    // ── 1. Installable ─────────────────────────────────────────────────────
    section("Installable browser — native install flow");
    {
      const { context, page } = await open({ standIn: { native: true, outcome: "accepted" } });
      await hydrated(page);
      await page.waitForTimeout(800);
      check("nothing is shown on first paint", (await card(page).count()) === 0);
      check(`the ${PWA_INSTALL_PROMPT.delaySeconds}s delay is counting`,
        (await page.evaluate(() => window.__installDelayPending())) === 1);
      check("and nothing is shown before it is up", (await card(page).count()) === 0);
      check("the install event was captured, not left to the browser",
        await page.evaluate(() => Boolean(window.__aplusInstallPrompt)));
      await pastDelay(page);
      check("after the delay the card appears", await card(page).isVisible());
      check("titled with the application's name", /^Install\s.+/.test(await card(page).locator("h2").innerText()));
      check("with the promised description",
        (await card(page).innerText()).includes("on your device for a faster, app-like experience."));
      check("offering Install App and Not now",
        (await installButton(page).isVisible()) && (await notNowButton(page).isVisible()));
      check("as real buttons", (await card(page).locator("button").count()) >= 3
        && (await card(page).locator("div[onclick], span[onclick]").count()) === 0);
      check("without taking focus from the page",
        await page.evaluate(() => !document.querySelector('[role="dialog"]').contains(document.activeElement)));
      check("without locking the page's scroll", await page.evaluate(() => document.body.style.overflow !== "hidden"));
      check("and nothing called the native prompt on its own",
        (await page.evaluate(() => window.__installPromptCalls)) === 0);
      await shot(page, "desktop-native");

      await installButton(page).click();
      await card(page).waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
      check("Install App opens the browser's own prompt, once",
        (await page.evaluate(() => window.__installPromptCalls)) === 1);
      check("accepting closes the card", (await card(page).count()) === 0);
      check("and says so", await page.getByText(/^Installing /).first().isVisible().catch(() => false));
      check("and is remembered for the session",
        (await page.evaluate((k) => sessionStorage.getItem(k), ACCEPTED_KEY)) === "1");
      check("but nothing is put in localStorage for an acceptance",
        (await page.evaluate((k) => localStorage.getItem(k), DISMISSED_KEY)) === null);

      await page.reload({ waitUntil: "load" });
      await pastDelay(page);
      check("F — after an acceptance it is not offered again this session", (await card(page).count()) === 0);
      await context.close();
    }

    {
      const { context, page } = await open({ standIn: { native: true, outcome: "dismissed" } });
      await pastDelay(page);
      await installButton(page).click();
      await card(page).waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
      check("declining the browser's dialog closes the card", (await card(page).count()) === 0);
      check("and starts the cooldown",
        Number(await page.evaluate((k) => localStorage.getItem(k), DISMISSED_KEY)) > 0);
      await page.reload({ waitUntil: "load" });
      await pastDelay(page);
      check("so it does not come straight back on the next page", (await card(page).count()) === 0);
      await context.close();
    }

    // ── 2. Not now, cooldown, Escape ───────────────────────────────────────
    section("Dismissal — Not now, cooldown and Escape");
    {
      const { context, page } = await open({ standIn: { native: true } });
      await pastDelay(page);
      const before = await page.evaluate(() => Date.now());
      await notNowButton(page).click();
      await card(page).waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
      check("Not now closes the card", (await card(page).count()) === 0);
      const stored = Number(await page.evaluate((k) => localStorage.getItem(k), DISMISSED_KEY));
      check("and stores only when", stored >= before && stored - before < 5_000,
        `stored ${stored}, clicked at ${before}`);
      check("one key, nothing else of ours",
        (await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("aplus:install")))).length === 1);
      check("without calling the native prompt", (await page.evaluate(() => window.__installPromptCalls)) === 0);

      await page.reload({ waitUntil: "load" });
      await pastDelay(page);
      check("E — it does not return on reload", (await card(page).count()) === 0);
      await page.goto(`${BASE}/find-a-tutor`, { waitUntil: "load" });
      await pastDelay(page);
      check("or on another page", (await card(page).count()) === 0);

      // Age the stored dismissal rather than the clock.
      await page.evaluate(([k, at]) => localStorage.setItem(k, String(at)),
        [DISMISSED_KEY, stored - (PWA_INSTALL_PROMPT.cooldownDays * DAY_MS + 60_000)]);
      await page.reload({ waitUntil: "load" });
      await pastDelay(page);
      check(`once ${PWA_INSTALL_PROMPT.cooldownDays} days have passed it may be offered again`,
        await card(page).isVisible());
      await context.close();
    }
    {
      const { context, page } = await open({ standIn: { native: true } });
      await pastDelay(page);
      await page.keyboard.press("Escape");
      await card(page).waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
      check("Escape closes it", (await card(page).count()) === 0);
      check("as a Not now", Number(await page.evaluate((k) => localStorage.getItem(k), DISMISSED_KEY)) > 0);
      await context.close();
    }
    {
      const { context, page } = await open({ standIn: { native: true } });
      await pastDelay(page);
      // Keyboard users reach it by Tab; closing from inside hands focus back.
      await notNowButton(page).focus();
      await page.keyboard.press("Enter");
      await card(page).waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
      check("closing from the keyboard leaves focus on the page, not lost",
        await page.evaluate(() => document.activeElement !== null && !document.activeElement.closest('[role="dialog"]')));
      await context.close();
    }

    // ── 3. Already installed ───────────────────────────────────────────────
    section("Already installed");
    {
      const { context, page } = await open({ standIn: { native: true, standalone: true } });
      await pastDelay(page);
      check("C — display-mode: standalone shows nothing, even with an install event",
        (await card(page).count()) === 0);
      await context.close();
    }
    {
      const { context, page } = await open({
        userAgent: UA.iphoneSafari, viewport: { width: 390, height: 844 }, mobile: true,
        standIn: { iosStandalone: true },
      });
      await pastDelay(page);
      check("C — a home-screen copy on iPhone shows nothing", (await card(page).count()) === 0);
      await context.close();
    }

    // ── 4. iOS Safari ──────────────────────────────────────────────────────
    section("iOS Safari — Add to Home Screen instructions");
    {
      const { context, page } = await open({
        userAgent: UA.iphoneSafari, viewport: { width: 390, height: 844 }, mobile: true,
      });
      await pastDelay(page);
      check("B — Safari on iPhone is shown the card", await card(page).isVisible());
      const text = await card(page).innerText();
      check("with Safari's three steps",
        /Share/.test(text) && /Add to Home Screen/.test(text) && /Tap\s+Add\b/.test(text), text);
      check("labelled as Safari's", /In Safari/i.test(text));
      check("and no Install App button", (await installButton(page).count()) === 0);
      check("as an ordered list", (await card(page).locator("ol > li").count()) === 3);
      check("no install API was called", (await page.evaluate(() => window.__installPromptCalls)) === 0);
      check("dismissable with Not now", await notNowButton(page).isVisible());
      await shot(page, "ios-390x844");
      await notNowButton(page).click();
      await card(page).waitFor({ state: "detached", timeout: 5_000 }).catch(() => {});
      check("which closes it and starts the same cooldown",
        (await card(page).count()) === 0 && Number(await page.evaluate((k) => localStorage.getItem(k), DISMISSED_KEY)) > 0);
      await context.close();
    }

    // ── 5. Unsupported ─────────────────────────────────────────────────────
    section("Unsupported browsers — no misleading UI");
    for (const [name, userAgent, viewport, mobile] of [
      ["Firefox (no beforeinstallprompt)", UA.desktopFirefox, { width: 1280, height: 800 }, false],
      ["Chrome on iOS (not Safari's share sheet)", UA.iphoneChrome, { width: 390, height: 844 }, true],
      ["a Chromium that never fires the event", UA.desktopChrome, { width: 1280, height: 800 }, false],
    ]) {
      const { context, page } = await open({ userAgent, viewport, mobile });
      await pastDelay(page);
      check(`D — ${name} shows nothing`, (await card(page).count()) === 0);
      await context.close();
    }

    // ── 6. Mobile layout ───────────────────────────────────────────────────
    section("Mobile — bottom sheet layout");
    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }, { width: 412, height: 915 }]) {
      const label = `${viewport.width}×${viewport.height}`;
      // The dashboard has the support launcher and the mobile top bar, the
      // two things the sheet must keep clear of.
      const { context, page } = await open({
        route: "/dashboard", userAgent: UA.androidChrome, viewport, mobile: true,
        standIn: { native: true }, cookies: parent.cookies(),
      });
      check(`${label}: signed in, on the dashboard`, new URL(page.url()).pathname === "/dashboard", page.url());
      await pastDelay(page);
      const box = await card(page).boundingBox();
      check(`${label}: the sheet is shown`, Boolean(box));
      if (!box) {
        await context.close();
        continue;
      }
      check(`${label}: inside the viewport with side margins`,
        box.x >= 12 - 0.5 && box.x + box.width <= viewport.width - 12 + 0.5 && box.y >= 0
          && box.y + box.height <= viewport.height, JSON.stringify(box));
      check(`${label}: full width within those margins`, Math.abs(box.width - (viewport.width - 24)) <= 1,
        `${box.width}px`);
      check(`${label}: no horizontal overflow`,
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
      const buttons = await card(page).getByRole("button").evaluateAll((els) =>
        els.map((el) => {
          const r = el.getBoundingClientRect();
          return { name: el.getAttribute("aria-label") || el.textContent.trim(), h: r.height, w: r.width,
            left: r.left, right: r.right, top: r.top, bottom: r.bottom };
        }));
      check(`${label}: Not now and Install App are 44px touch targets`,
        buttons.filter((b) => /Not now|Install App/.test(b.name)).every((b) => b.h >= 44),
        JSON.stringify(buttons.map((b) => [b.name, b.h])));
      check(`${label}: the close button is at least 40px`,
        buttons.filter((b) => b.name === "Close").every((b) => b.h >= 40 && b.w >= 40));
      check(`${label}: no button is clipped by the sheet`,
        buttons.every((b) => b.left >= box.x - 0.5 && b.right <= box.x + box.width + 0.5
          && b.top >= box.y - 0.5 && b.bottom <= box.y + box.height + 0.5));
      check(`${label}: and none is oversized`, buttons.every((b) => b.h <= 48));

      const launcher = await page.getByRole("button", { name: "Get help" }).boundingBox();
      check(`${label}: clear of the support launcher`,
        launcher && box.y + box.height <= launcher.y, JSON.stringify({ sheetBottom: box.y + box.height, launcher }));
      const header = await page.evaluate(() => {
        const bars = [...document.querySelectorAll("header, [data-mobile-topbar]")]
          .map((el) => el.getBoundingClientRect()).filter((r) => r.height > 0 && r.top <= 0 + 1);
        return bars.length ? Math.max(...bars.map((r) => r.bottom)) : 0;
      });
      check(`${label}: clear of the top bar`, box.y >= header, `sheet top ${box.y}, header bottom ${header}`);
      check(`${label}: offsets from the bottom safe-area inset`,
        await card(page).evaluate((el) => el.parentElement.className.includes("safe-area-inset-bottom")));
      check(`${label}: the page behind it still scrolls`,
        await page.evaluate(async () => {
          // `instant`: the stylesheet asks for smooth scrolling, which would
          // still be on its first frame when this reads the position.
          const start = window.scrollY;
          window.scrollTo({ top: start + 200, behavior: "instant" });
          await new Promise((r) => requestAnimationFrame(r));
          const moved = window.scrollY !== start || document.documentElement.scrollHeight <= window.innerHeight;
          window.scrollTo({ top: start, behavior: "instant" });
          return moved && document.body.style.overflow !== "hidden";
        }));
      await shot(page, `android-${label}`);
      await context.close();
    }

    // ── 7. Quiet routes and typing ─────────────────────────────────────────
    section("Timing — quiet routes and typing");
    {
      const { context, page } = await open({ route: "/login", standIn: { native: true } });
      await pastDelay(page);
      check("not on the sign-in page", (await card(page).count()) === 0);
      const email = page.locator('input[type="email"]').first();
      await email.fill("someone@example.com");
      check("which stays fully usable", (await email.inputValue()) === "someone@example.com");
      check("and nothing was dismissed on the visitor's behalf",
        (await page.evaluate((k) => localStorage.getItem(k), DISMISSED_KEY)) === null);
      await context.close();
    }
    {
      const { context, page } = await open({ route: "/register", standIn: { native: true } });
      await pastDelay(page);
      check("not on the sign-up page", (await card(page).count()) === 0);
      await context.close();
    }
    {
      const { context, page } = await open({ route: "/", standIn: { native: true } });
      await pastDelay(page);
      check("shown on the home page", await card(page).isVisible());
      await page.locator('header a[href="/login"]:visible').first().click();
      await page.waitForURL("**/login", { timeout: 10_000 });
      await page.waitForTimeout(600);
      check("held back after a client-side move to sign in", (await card(page).count()) === 0);
      await page.goBack({ waitUntil: "commit" });
      await page.waitForTimeout(600);
      check("and back on the next ordinary page, without waiting again", await card(page).isVisible());
      await context.close();
    }
    {
      const { context, page } = await open({ route: "/find-a-tutor", standIn: { native: true } });
      const field = page.locator("main input:not([type=hidden])").first();
      if (await field.count()) {
        await field.focus();
        await pastDelay(page);
        check("not while someone is typing in a field", (await card(page).count()) === 0);
        await field.blur();
        // The typing retry is a real five-second timer.
        await page.waitForTimeout(6_500);
        check("and shortly after they stop", await card(page).isVisible());
      } else {
        check("a search field to type in exists on /find-a-tutor", false);
      }
      await context.close();
    }

    // ── 8. The rest of the application, with the card on screen ─────────────
    section("Existing application — still works with the card shown");
    {
      const { context, page } = await open({ route: "/dashboard", standIn: { native: true }, cookies: parent.cookies() });
      for (const route of ["/dashboard", "/bookings", "/payments", "/messages", "/notifications", "/settings"]) {
        if (new URL(page.url()).pathname !== route) await page.goto(`${BASE}${route}`, { waitUntil: "load" });
        await pastDelay(page);
        const landed = new URL(page.url()).pathname;
        const heading = await page.locator("main h1").first().innerText().catch(() => "");
        check(`${route} renders for a signed-in parent with the card shown`,
          landed === route && heading.length > 0 && (await card(page).isVisible()), `${landed} "${heading}"`);
      }
      // Navigation through the sidebar still works under the card.
      await page.goto(`${BASE}/dashboard`, { waitUntil: "load" });
      await pastDelay(page);
      const bookingsLink = page.locator('a[href="/bookings"]:visible').first();
      await bookingsLink.click();
      await page.waitForURL("**/bookings", { timeout: 10_000 });
      check("sidebar navigation works with the card shown", new URL(page.url()).pathname === "/bookings");
      await context.close();
    }
    {
      const { context, page } = await open({ route: "/admin/dashboard", standIn: { native: true }, cookies: admin.cookies() });
      await pastDelay(page);
      const heading = await page.locator("main h1").first().innerText().catch(() => "");
      check("the admin console renders with the card shown",
        new URL(page.url()).pathname === "/admin/dashboard" && heading.length > 0 && (await card(page).isVisible()),
        `${page.url()} "${heading}"`);
      await page.goto(`${BASE}/admin/settings`, { waitUntil: "load" });
      check("admin settings still renders", (await page.locator("main h1").count()) > 0);
      await context.close();
    }

    const relevant = errors.filter((e) => !/Failed to load resource|favicon|net::ERR_ABORTED|\[HMR\]|\[Fast Refresh\]/i.test(e));
    check("no page logged an error", relevant.length === 0, relevant.slice(0, 5).join(" | "));
  } finally {
    await browser.close();
  }

  console.log(`\n${"─".repeat(60)}\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
