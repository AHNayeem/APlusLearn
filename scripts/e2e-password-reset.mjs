/**
 * Browser end-to-end: forgot password, the whole way through (§9, §46).
 *
 * `bun run qa` proves the endpoints; this proves the journey a person takes —
 * that the link on the sign-in page leads somewhere, that each screen hands
 * over to the next, that the code box accepts a code and refuses a wrong one,
 * that a refresh does not throw the request away, and that the password
 * chosen at the end is the one that signs in.
 *
 *   bun run dev                 # in one terminal, no mail server configured
 *   bun run e2e                 # in another
 *
 * The code is read from the development mailbox (`/api/dev/mail`), which is
 * where a dev server with no mail server delivers. That is the real code the
 * service generated — nothing about the flow is simulated.
 *
 * Playwright is deliberately not a project dependency: this is the only
 * browser test, and a CI image that runs it can install it. The script uses
 * the project's copy if there is one, then `PLAYWRIGHT_MODULE_DIR`, then any
 * copy `npx playwright` has cached. It drives system Chrome by default
 * (`E2E_BROWSER_CHANNEL`, empty for Playwright's own Chromium).
 * `E2E_SCREENSHOTS=<dir>` saves a picture of every step.
 */

import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const BASE = process.env.QA_BASE_URL || "http://localhost:3000";
const OLD_PASSWORD = "AplusLearn2024!";
const NEW_PASSWORD = "E2eResetPass2024";
const SHOTS = process.env.E2E_SCREENSHOTS;
const CHANNEL = process.env.E2E_BROWSER_CHANNEL ?? "chrome";

// Each run is its own client, so registration and reset limits from an
// earlier run (or from `bun run qa`) are not what this ends up measuring.
const RUN_IP = `192.0.2.${Math.floor(Math.random() * 200) + 10}`;

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

async function api(route, body) {
  const response = await fetch(`${BASE}${route}`, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", "x-forwarded-for": RUN_IP },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, payload: await response.json().catch(() => null) };
}

/** The newest reset code the development mailbox holds for an address. */
async function readResetCode(email, { after = 0 } = {}) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { status, payload } = await api(`/api/dev/mail?to=${encodeURIComponent(email)}`);
    if (status === 404) {
      throw new Error(
        "The development mailbox is closed — this needs a dev server with no mail provider configured.",
      );
    }
    const message = payload?.data?.messages?.find(
      (m) => /password reset code/i.test(m.subject) && Date.parse(m.sentAt) >= after,
    );
    const code = message?.text.match(/^\s+(\d{6})\s*$/m)?.[1];
    if (code) return code;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

async function main() {
  console.log(`\nAPlus Learn — forgot password in a real browser\n${"─".repeat(56)}`);
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  // A fresh account, so no seeded password ever changes.
  const email = `e2e-reset-${Date.now()}@example.com`;
  const registered = await api("/api/auth/register", {
    email,
    password: OLD_PASSWORD,
    confirmPassword: OLD_PASSWORD,
    firstName: "Robin",
    lastName: "Reset",
    role: "PARENT",
    provinceCode: "ON",
    city: "Toronto",
    acceptTerms: true,
  });
  if (!check("a fresh account to reset is registered", registered.status === 201,
    JSON.stringify(registered.payload?.error))) {
    process.exitCode = 1;
    return;
  }

  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  const context = await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": RUN_IP } });
  const page = await context.newPage();
  let step = 0;
  const shot = async (name) => {
    if (!SHOTS) return;
    step += 1;
    await page.screenshot({ path: path.join(SHOTS, `${String(step).padStart(2, "0")}-${name}.png`), fullPage: true });
  };

  try {
    // 1. Sign-in page → "Forgot password?"
    await page.goto(`${BASE}/login`);
    await page.getByRole("link", { name: "Forgot password?" }).click();
    await page.waitForURL("**/forgot-password");
    check("the sign-in page links to forgot password", new URL(page.url()).pathname === "/forgot-password");
    await page.getByRole("heading", { name: "Forgot your password?" }).waitFor();
    await shot("request");

    // 2. Email → code screen
    await page.getByLabel("Email address").fill(email);
    const requestedAt = Date.now() - 1000;
    await page.getByRole("button", { name: "Send code" }).click();
    await page.getByRole("heading", { name: "Check your email" }).waitFor();
    check("sending the code moves on to the code screen", true);
    check("the address is shown masked",
      await page.getByText("e***@example.com").isVisible());
    check("the development notice says where the code went",
      await page.getByText("Development mode").isVisible());
    check("resending is on a visible countdown",
      await page.getByRole("button", { name: /Resend code in \d+s/ }).isDisabled());
    await shot("code");

    // 3. A refresh keeps the request — the server read the cookie.
    await page.reload();
    const resumed = await page.getByRole("heading", { name: "Check your email" })
      .waitFor({ timeout: 10_000 }).then(() => true, () => false);
    check("a refresh resumes at the code screen rather than starting over", resumed);

    const code = await readResetCode(email, { after: requestedAt });
    check("the real code is in the development mailbox", /^\d{6}$/.test(code ?? ""));

    // 4. A wrong code is refused and cleared.
    const codeBox = page.getByLabel("Verification code");
    await codeBox.fill(code === "000000" ? "111111" : "000000");
    const invalid = page.getByText("The verification code is invalid.").first();
    await invalid.waitFor();
    check("a wrong code is refused on screen", await invalid.isVisible());
    check("and the box is emptied for the next try", (await codeBox.inputValue()) === "");
    await shot("wrong-code");

    // 5. The right code — pasted with a space, as mail clients copy it.
    await codeBox.fill(`${code.slice(0, 3)} ${code.slice(3)}`);
    await page.getByRole("heading", { name: "Create a new password" }).waitFor();
    check("the right code opens the new-password screen", true);
    await shot("new-password");

    // 6. Mismatch, then the real thing.
    await page.locator("#new-password").fill(NEW_PASSWORD);
    await page.locator("#confirm-new-password").fill(`${NEW_PASSWORD}x`);
    check("a mismatch is pointed out before submitting",
      await page.getByText("Passwords do not match.").first().isVisible());
    await page.locator("#confirm-new-password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Reset password" }).click();
    await page.getByRole("heading", { name: "Password updated" }).waitFor();
    check("the password is reset and says so", true);
    await shot("done");

    // 7. Back to sign in, with the new password.
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/login?reset=1");
    // The notice renders on the client from `?reset=1`, so wait for it.
    const notice = await page.getByText("Sign in with your new password.", { exact: true })
      .waitFor({ timeout: 10_000 }).then(() => true, () => false);
    check("the success screen leads back to sign in, which says the password changed", notice);

    await page.locator("#email").fill(email);
    await page.locator("#password").fill(OLD_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    const oldRefused = page.getByText("That email or password is incorrect.").first();
    await oldRefused.waitFor();
    check("the old password is refused", await oldRefused.isVisible());

    await page.locator("#password").fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    // Wait on the address leaving /login, not on a selector: the auth layout
    // has landmarks that would match on the sign-in page itself.
    await page.waitForURL((url) => url.pathname !== "/login", { timeout: 20_000 });
    const session = await page.request.get(`${BASE}/api/auth/session`);
    const user = (await session.json())?.data?.user;
    check("the new password signs in, and the session is real", user?.email === email,
      JSON.stringify(user));
    await shot("signed-in");
  } catch (error) {
    await shot("failure").catch(() => {});
    check("the journey completes", false, error.message.split("\n")[0]);
  } finally {
    await browser.close();
  }

  console.log(`\n${"─".repeat(56)}\n${passed} passed, ${failed} failed\n`);
  if (failed) process.exitCode = 1;
}

main().catch((error) => {
  console.error("\nE2E run crashed:", error);
  process.exitCode = 1;
});
