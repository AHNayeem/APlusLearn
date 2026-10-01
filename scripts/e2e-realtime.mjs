/**
 * Browser end-to-end: realtime messages and notifications (docs/REALTIME.md).
 *
 * `bun run qa` proves the stream's contract over HTTP; this proves what two
 * people at two screens actually see. A parent and a tutor, each in their own
 * browser context, and not one page reload between them:
 *
 *   1. The parent sends; the parent's message is in the thread at once.
 *   2. The tutor, sitting on their inbox, sees the thread and the unread badge
 *      change.
 *   3. The tutor opens the thread; the badge clears.
 *   4. While the tutor has it open, the next message appears in it — and is
 *      read on arrival, so no badge comes back.
 *   5. The tutor replies; the parent sees the reply.
 *   6. On the notification centre, a new message's notification appears at the
 *      top, with the notification badge counting it — and "mark all as read"
 *      in one tab clears the badge in the tutor's other tab.
 *   7. The tutor's network drops, a message is sent, the network returns: the
 *      message is there, recovered from the database.
 *   8. The parent's network drops mid-send: the message is marked not sent;
 *      Retry delivers it once — to both screens, exactly once.
 *
 *   bun run dev                 # in one terminal
 *   bun run e2e:realtime        # in another
 *
 * Playwright is found the way `e2e-password-reset.mjs` finds it, and drives
 * system Chrome by default (`E2E_BROWSER_CHANNEL`, empty for Playwright's own
 * Chromium). `E2E_SCREENSHOTS=<dir>` saves a picture of each step.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const BASE = process.env.QA_BASE_URL || "http://localhost:3000";
const PASSWORD = "AplusLearn2024!";
const PARENT_EMAIL = "jennifer.chen@example.com";
const TUTOR_EMAIL = "priya.sharma@example.com";
const SHOTS = process.env.E2E_SCREENSHOTS;
const CHANNEL = process.env.E2E_BROWSER_CHANNEL ?? "chrome";
/** How long "instant" is allowed to take before the check fails. */
const LIVE_TIMEOUT = 8_000;

// Its own client address, so sign-in limits from other runs are not measured.
const RUN_IP = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;

let passed = 0;
let failed = 0;

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
        "x-forwarded-for": RUN_IP,
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

/** The number on a sidebar link's badge, or 0 when there is none. */
async function badge(page, href) {
  const pill = page.locator(`aside nav a[href="${href}"] span.rounded-full`);
  if (!(await pill.count())) return 0;
  return Number((await pill.first().innerText()).replace(/\D/g, "")) || 0;
}

/** Poll until `read()` satisfies `predicate`; returns the last value read. */
async function eventually(read, predicate, timeout = LIVE_TIMEOUT) {
  const until = Date.now() + timeout;
  let value = await read();
  while (!predicate(value) && Date.now() < until) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
}

/** Message bubbles in a thread with exactly this text. */
const bubbles = (page, text) => page.locator("p.whitespace-pre-wrap", { hasText: text });

async function main() {
  console.log(`\nAPlus Learn — realtime in two real browsers → ${BASE}\n${"─".repeat(56)}`);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  const parentApi = await signIn(PARENT_EMAIL);
  const tutorApi = await signIn(TUTOR_EMAIL);
  const tutorProfileId = (await tutorApi("/api/tutor/profile")).payload?.data?.profile?.id;
  if (!check("both accounts are signed in", Boolean(tutorProfileId))) {
    process.exitCode = 1;
    return;
  }

  // Make sure the thread exists, and start from a tutor who has read it.
  const opener = await parentApi("/api/messages", {
    method: "POST",
    body: { tutorProfileId, body: `E2E realtime run ${Date.now()} — opening the thread.` },
  });
  const conversationId = opener.payload?.data?.conversationId;
  if (!check("a thread between them exists", Boolean(conversationId), JSON.stringify(opener.payload?.error))) {
    process.exitCode = 1;
    return;
  }
  await tutorApi(`/api/messages/conversations/${conversationId}/read`, { method: "POST" });
  await tutorApi("/api/notifications/read", { method: "POST", body: { all: true } });

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  const newContext = async (api) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { "x-forwarded-for": RUN_IP },
    });
    await context.addCookies(api.cookies());
    return context;
  };
  const parentContext = await newContext(parentApi);
  const tutorContext = await newContext(tutorApi);
  const parentPage = await parentContext.newPage();
  const tutorPage = await tutorContext.newPage();

  // Any full document load after the first one is a refresh, which is
  // exactly what this test says nobody needs.
  const loads = { parent: 0, tutor: 0 };
  parentPage.on("load", () => { loads.parent += 1; });
  tutorPage.on("load", () => { loads.tutor += 1; });

  let step = 0;
  const shot = async (page, name) => {
    if (!SHOTS) return;
    step += 1;
    await page.screenshot({ path: path.join(SHOTS, `${String(step).padStart(2, "0")}-${name}.png`) });
  };
  const streamReady = (page) =>
    page.waitForResponse((r) => r.url().endsWith("/api/realtime") && r.status() === 200, {
      timeout: 15_000,
    });

  try {
    const tutorReady = streamReady(tutorPage);
    await tutorPage.goto(`${BASE}/tutor/messages`);
    await tutorReady;
    const parentReady = streamReady(parentPage);
    await parentPage.goto(`${BASE}/messages/${conversationId}`);
    await parentReady;
    check("both screens open their event stream", true);
    const tutorBadgeBefore = await badge(tutorPage, "/tutor/messages");
    await shot(tutorPage, "tutor-inbox");

    // 1–2. Parent sends; tutor's inbox and badge change by themselves.
    const first = `Live message one ${Date.now()}`;
    await parentPage.locator("#message-body").fill(first);
    await parentPage.locator("#message-body").press("Enter");
    check("the parent's message is in their thread at once",
      await bubbles(parentPage, first).first().isVisible());
    const sentAt = Date.now();
    await eventually(() => parentPage.getByText("Sending…").count(), (n) => n === 0);

    const inboxText = await eventually(
      () => tutorPage.locator("main").innerText(),
      (text) => text.includes(first),
    );
    check("the tutor's inbox shows it without a refresh", inboxText.includes(first),
      "the preview never appeared");
    console.log(`    (arrived in ${Date.now() - sentAt} ms)`);
    const tutorBadgeAfter = await eventually(
      () => badge(tutorPage, "/tutor/messages"),
      (n) => n > tutorBadgeBefore,
    );
    check("and the tutor's message badge counts it", tutorBadgeAfter === tutorBadgeBefore + 1,
      `${tutorBadgeBefore} → ${tutorBadgeAfter}`);
    await shot(tutorPage, "tutor-inbox-live");

    // 3. Opening the thread reads it.
    await tutorPage.locator(`a[href="/tutor/messages/${conversationId}"]`).first().click();
    await tutorPage.waitForURL(`**/tutor/messages/${conversationId}`);
    check("the tutor opens the thread and sees the message",
      await bubbles(tutorPage, first).first().isVisible());
    const clearedBadge = await eventually(
      () => badge(tutorPage, "/tutor/messages"),
      (n) => n === tutorBadgeBefore,
    );
    check("and the unread badge clears", clearedBadge === tutorBadgeBefore,
      `${clearedBadge} (expected ${tutorBadgeBefore})`);

    // 4. With the thread open, the next message just appears, already read.
    const second = `Live message two ${Date.now()}`;
    await parentPage.locator("#message-body").fill(second);
    await parentPage.locator("#message-body").press("Enter");
    const arrived = await eventually(() => bubbles(tutorPage, second).count(), (n) => n > 0);
    check("a message sent while the tutor has the thread open appears in it", arrived === 1,
      `${arrived} copies`);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    check("and is read on arrival, so the badge stays clear",
      (await badge(tutorPage, "/tutor/messages")) === tutorBadgeBefore);
    await shot(tutorPage, "tutor-thread-live");

    // 5. The reply goes the other way.
    const reply = `Live reply ${Date.now()}`;
    await tutorPage.locator("#message-body").fill(reply);
    await tutorPage.locator("#message-body").press("Enter");
    const replyCount = await eventually(() => bubbles(parentPage, reply).count(), (n) => n > 0);
    check("the parent sees the tutor's reply without a refresh", replyCount === 1,
      `${replyCount} copies`);
    check("and their own message appears exactly once",
      (await bubbles(parentPage, first).count()) === 1 && (await bubbles(parentPage, second).count()) === 1);
    await shot(parentPage, "parent-thread-live");

    // 6. Notifications — in one tab, with a second tab watching the badge.
    const tutorSecondTab = await tutorContext.newPage();
    const secondReady = streamReady(tutorSecondTab);
    await tutorSecondTab.goto(`${BASE}/tutor/dashboard`);
    await secondReady;
    const notificationsReady = streamReady(tutorPage);
    await tutorPage.locator('aside nav a[href="/tutor/notifications"]').click();
    await tutorPage.waitForURL("**/tutor/notifications");
    await notificationsReady.catch(() => {});
    const notesBefore = await badge(tutorPage, "/tutor/notifications");

    const third = `Live message three ${Date.now()}`;
    await parentPage.locator("#message-body").fill(third);
    await parentPage.locator("#message-body").press("Enter");
    const listText = await eventually(
      () => tutorPage.locator("main").innerText(),
      (text) => text.includes(third),
    );
    check("the new notification appears in the notification centre without a refresh",
      listText.includes(third));
    const notesAfter = await eventually(
      () => badge(tutorPage, "/tutor/notifications"),
      (n) => n > notesBefore,
    );
    check("and the notification badge counts it", notesAfter === notesBefore + 1,
      `${notesBefore} → ${notesAfter}`);
    const otherTabNotes = await eventually(
      () => badge(tutorSecondTab, "/tutor/notifications"),
      (n) => n === notesAfter,
    );
    check("in the tutor's other tab too", otherTabNotes === notesAfter, String(otherTabNotes));
    await shot(tutorPage, "tutor-notifications-live");

    await tutorPage.bringToFront();
    await tutorPage.getByRole("button", { name: "Mark all as read" }).click();
    const otherTabCleared = await eventually(
      () => badge(tutorSecondTab, "/tutor/notifications"),
      (n) => n === 0,
    );
    check("marking all read in one tab clears the badge in the other", otherTabCleared === 0,
      String(otherTabCleared));
    await tutorSecondTab.close();

    // 7. The tutor's network drops; a message lands; the network returns.
    await tutorPage.locator('aside nav a[href="/tutor/messages"]').click();
    await tutorPage.waitForURL("**/tutor/messages");
    await tutorContext.setOffline(true);
    await eventually(
      () => tutorPage.evaluate(() => navigator.onLine),
      (online) => online === false,
    );
    const whileAway = `Sent while the tutor was offline ${Date.now()}`;
    await parentApi("/api/messages", {
      method: "POST",
      body: { conversationId, body: whileAway, clientId: crypto.randomUUID() },
    });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    check("while offline, nothing arrives (the stream is down)",
      !(await tutorPage.locator("main").innerText()).includes(whileAway));
    await tutorContext.setOffline(false);
    const recovered = await eventually(
      () => tutorPage.locator("main").innerText(),
      (text) => text.includes(whileAway),
      15_000,
    );
    check("back online, the missed message is recovered without a refresh",
      recovered.includes(whileAway));
    await shot(tutorPage, "tutor-recovered");

    // 8. The parent's send fails; Retry delivers it once.
    await tutorPage.locator(`a[href="/tutor/messages/${conversationId}"]`).first().click();
    await tutorPage.waitForURL(`**/tutor/messages/${conversationId}`);
    await parentContext.setOffline(true);
    const flaky = `Sent through a dropped connection ${Date.now()}`;
    await parentPage.locator("#message-body").fill(flaky);
    await parentPage.locator("#message-body").press("Enter");
    const notSent = await eventually(
      () => parentPage.getByText("Not sent").count(),
      (n) => n > 0,
    );
    check("a send that cannot reach the server is marked not sent", notSent > 0);
    check("and keeps its text in the thread", (await bubbles(parentPage, flaky).count()) === 1);
    await shot(parentPage, "parent-not-sent");
    await parentContext.setOffline(false);
    await parentPage.getByRole("button", { name: "Retry" }).click();
    await eventually(() => parentPage.getByText("Not sent").count(), (n) => n === 0);
    const onParent = await eventually(() => bubbles(parentPage, flaky).count(), (n) => n === 1);
    const onTutor = await eventually(() => bubbles(tutorPage, flaky).count(), (n) => n > 0);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    check("Retry delivers it once to the sender's screen",
      onParent === 1 && (await bubbles(parentPage, flaky).count()) === 1);
    check("and once to the recipient's", onTutor === 1 && (await bubbles(tutorPage, flaky).count()) === 1,
      `${await bubbles(tutorPage, flaky).count()} copies`);
    const stored = await tutorApi(`/api/messages/conversations/${conversationId}?since=${
      encodeURIComponent(new Date(Date.now() - 120_000).toISOString())}`);
    check("and the database holds it once",
      (stored.payload?.data?.messages ?? []).filter((m) => m.body === flaky).length === 1);

    check("no page was reloaded at any point", loads.parent === 1 && loads.tutor === 1,
      JSON.stringify(loads));
  } catch (error) {
    check("the journey completes", false, error.message);
    await shot(tutorPage, "failure-tutor").catch(() => {});
    await shot(parentPage, "failure-parent").catch(() => {});
  } finally {
    await browser.close();
  }

  console.log(`\n${"─".repeat(56)}\n  ${passed} passed, ${failed} failed\n`);
  process.exitCode = failed ? 1 : 0;
}

main().catch((error) => {
  console.error("\nE2E run failed:", error);
  process.exit(1);
});
