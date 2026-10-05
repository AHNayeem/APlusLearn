/**
 * Core journeys in a real browser (system Chrome via Playwright), against a
 * running dev server — `bun run dev` with PAYMENT_PROVIDER=development.
 *
 *   A  Parent search: province drives grades, words become curriculum,
 *      location, results, sort, profile.
 *   B  A province an administrator activates appears in the pickers and in
 *      search with no code change.
 *   D  A child profile with curriculum, preferences, marks and goals
 *      persists, and stays the parent's own.
 *   E  Filters write the URL and the URL drives the filters.
 *   F  Booking through the development payment form to a confirmed lesson.
 *   H  Administrator pages render for an administrator.
 *   M  A message carrying a phone number is stored with it removed.
 *
 * Every assertion checks what a person sees, and where it matters the
 * server's answer too (through the same API the pages use). Fixture data the
 * run creates is removed at the end.
 *
 *   bun run e2e:journeys      (QA_BASE_URL to point elsewhere)
 */
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const BASE = process.env.QA_BASE_URL || "http://localhost:3000";
const PASSWORD = "AplusLearn2024!";
const CHANNEL = process.env.E2E_BROWSER_CHANNEL ?? "chrome";
const RUN_IP = `198.51.100.${Math.floor(Math.random() * 200) + 10}`;
// The first visit to a route compiles it on a dev server; be patient once.
const NAV = { waitUntil: "domcontentloaded", timeout: 300_000 };

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
const section = (title) => console.log(`\n▸ ${title}`);

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // not a project dependency
  }
  const npxCache = path.join(homedir(), ".npm", "_npx");
  const dirs = [process.env.PLAYWRIGHT_MODULE_DIR, ...(existsSync(npxCache) ? readdirSync(npxCache).map((d) => path.join(npxCache, d, "node_modules")) : [])].filter(Boolean);
  for (const dir of dirs) {
    if (existsSync(path.join(dir, "playwright", "package.json"))) return createRequire(path.join(dir, "noop.js"))("playwright");
  }
  console.error("Playwright was not found. Run `npx -y playwright@latest --version` once to cache it.");
  process.exit(1);
}

function apiClient() {
  const jar = new Map();
  const call = async (route, { method = "GET", body } = {}) => {
    const response = await fetch(`${BASE}${route}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "x-forwarded-for": RUN_IP,
        "x-real-ip": RUN_IP,
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
    return { status: response.status, ok: response.ok, data: payload?.data, error: payload?.error };
  };
  call.cookies = () => [...jar].filter(([, v]) => v).map(([name, value]) => ({ name, value, url: BASE }));
  call.get = (name) => jar.get(name);
  call.set = (name, value) => jar.set(name, value);
  return call;
}

/**
 * The trusted-device cookie per account, kept between runs as a browser
 * would keep it — otherwise every run is a new device, emails a new code, and
 * repeated runs trip the per-account code limit (which is the limit working).
 */
const DEVICE_FILE = path.join(tmpdir(), "aplus-e2e-devices.json");
const devices = (() => {
  try {
    return JSON.parse(readFileSync(DEVICE_FILE, "utf8"));
  } catch {
    return {};
  }
})();

async function signIn(email) {
  const client = apiClient();
  if (devices[email]) client.set("aplus_device", devices[email]);
  let res = await client("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  if (res.error?.code === "RATE_LIMITED") {
    const [, amount, unit] = res.error.message.match(/(\d+) (second|minute)/) ?? [null, "60", "second"];
    const seconds = Number(amount) * (unit === "minute" ? 60 : 1);
    console.log(`    (sign-in rate limited — waiting ${seconds + 2}s)`);
    await new Promise((r) => setTimeout(r, (seconds + 2) * 1000));
    res = await client("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  }
  if (res.ok && res.data?.verificationRequired) {
    res = await client("/api/auth/login/verify", { method: "POST", body: { code: res.data.devCode } });
  }
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${JSON.stringify(res.error)}`);
  const device = client.get("aplus_device");
  if (device) {
    devices[email] = device;
    writeFileSync(DEVICE_FILE, JSON.stringify(devices));
  }
  return client;
}

/**
 * Server HTML arrives before React attaches its handlers; interacting earlier
 * changes the DOM with nothing listening. Wait for the element's fiber.
 */
async function hydrated(page, selector) {
  await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel);
      return Boolean(el && Object.keys(el).some((key) => key.startsWith("__reactFiber")));
    },
    selector,
    { timeout: 300_000 },
  );
}

const optionTexts = (page, selector) =>
  page.locator(selector).locator("option").evaluateAll((options) => options.map((o) => o.textContent.trim()));

async function main() {
  console.log(`\nAPlus Learn journeys → ${BASE}`);
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch(CHANNEL ? { channel: CHANNEL } : {});
  const contextFor = async (api) => {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: { "x-forwarded-for": RUN_IP, "x-real-ip": RUN_IP },
    });
    if (api) await context.addCookies(api.cookies());
    return context;
  };
  const cleanup = [];

  try {
    // --- A ------------------------------------------------------------------
    section("A — parent search: province drives grades, words become curriculum");
    const anon = await (await contextFor()).newPage();
    await anon.goto(`${BASE}/`, NAV);
    const heroProvince = anon.getByLabel("Province").first();
    await heroProvince.waitFor({ timeout: 120_000 });
    await hydrated(anon, 'form[role="search"]');
    const tree = anon.waitForResponse((r) => r.url().includes("/api/curriculum/tree") && r.url().includes("province=BC"), { timeout: 120_000 });
    await heroProvince.selectOption("BC");
    const treeResponse = await (await tree).json();
    check("choosing British Columbia loads BC's own grades from the curriculum API",
      treeResponse.data?.province?.code === "BC" && treeResponse.data.grades.length > 0);
    const gradeOptions = await optionTexts(anon, "select:near(:text('Grade'))").catch(() => []);
    check("the grade picker lists that province's grades", gradeOptions.some((t) => /Grade 12/.test(t)), gradeOptions.join("|"));

    await anon.getByRole("combobox", { name: /Course, course code or subject/i }).fill("Math");
    await anon.getByLabel("Where").fill("Vancouver");
    await anon.locator('form[role="search"] button[type="submit"]').first().click();
    await anon.waitForURL(/\/find-a-tutor\?/, NAV);
    const url = new URL(anon.url());
    check("the search URL carries the province, the words and the place",
      url.searchParams.get("province") === "BC" && url.searchParams.get("q") === "Math" && url.searchParams.get("city") === "Vancouver", anon.url());
    // Results stream in behind a Suspense boundary; wait for the cards.
    await anon.getByRole("link", { name: "View Profile" }).first().waitFor({ timeout: 120_000 });
    const body = await anon.locator("body").innerText();
    check("'Math' is shown as the Mathematics subject, not a quoted course code", /Mathematics/.test(body));
    check("the BC tutor in Vancouver is in the results", /Olivia B\./.test(body));
    check("no result claims a distance from a guessed city", !/Toronto — [\d.]+ km away/.test(body));
    await anon.getByLabel("Sort by").selectOption("DISTANCE");
    await anon.waitForURL(/sort=DISTANCE/, NAV);
    check("sorting writes the URL", new URL(anon.url()).searchParams.get("sort") === "DISTANCE");
    await anon.getByRole("link", { name: "View Profile" }).first().click();
    await anon.waitForURL(/\/tutors\/[^/?]+$/, NAV);
    await anon.locator("#availability").waitFor({ timeout: 120_000 });
    check("the tutor profile opens with its availability section", await anon.locator("#availability").count() > 0);

    // --- E ------------------------------------------------------------------
    section("E — filters and the URL stay in step");
    await anon.goto(`${BASE}/find-a-tutor?province=ON`, NAV);
    await hydrated(anon, 'aside[aria-label="Search filters"]');
    // Filters are controlled by the URL, so a click changes nothing until the
    // navigation it starts lands — click, then wait for the URL.
    await anon.getByRole("checkbox", { name: "Tomorrow" }).first().click();
    await anon.waitForURL(/availability=TOMORROW/, NAV);
    check("'Tomorrow' writes availability=TOMORROW", new URL(anon.url()).searchParams.get("availability") === "TOMORROW");
    const chip = anon.getByRole("button", { name: /Free tomorrow/i });
    await chip.first().waitFor({ timeout: 120_000 }).catch(() => {});
    check("…and shows as a removable chip", await chip.count() > 0);
    await anon.getByRole("radio", { name: "Offers both" }).first().click();
    await anon.waitForURL(/mode=BOTH/, NAV);
    await anon.getByRole("link", { name: "View Profile" }).first().waitFor({ timeout: 120_000 }).catch(() => {});
    check("'Offers both' writes mode=BOTH", new URL(anon.url()).searchParams.get("mode") === "BOTH");
    const api = apiClient();
    const both = await api("/api/search/tutors?province=ON&mode=BOTH&availability=TOMORROW&pageSize=48");
    const cards = await anon.getByRole("link", { name: "View Profile" }).count();
    check("the page shows the same tutors the API returns for that URL", cards === both.data?.tutors?.length, `${cards} vs ${both.data?.tutors?.length}`);
    await anon.getByRole("button", { name: /Clear all/i }).first().click();
    await anon.waitForURL((u) => !u.searchParams.get("mode") && !u.searchParams.get("availability"), NAV);
    check("'Clear all' drops the filters and keeps the search", new URL(anon.url()).searchParams.get("province") === "ON");
    await anon.goto(`${BASE}/find-a-tutor?qualifications=DOCTORATE`, NAV);
    await anon.getByRole("link", { name: "View Profile" }).first().waitFor({ timeout: 120_000 });
    check("a URL alone sets the filter: PhD is ticked and narrows the results",
      (await anon.getByRole("checkbox", { name: "PhD" }).first().isChecked()) && (await anon.getByRole("link", { name: "View Profile" }).count()) === 1);

    // --- B ------------------------------------------------------------------
    section("B — a province switched on by an administrator works everywhere");
    const admin = await signIn("admin@apluslearn.ca");
    const provinces = await admin("/api/admin/curriculum/provinces");
    const ns = provinces.data.provinces.find((p) => p.code === "NS");
    const physics = (await api("/api/curriculum/subjects")).data.subjects.find((s) => s.slug === "physics");
    // Idempotent: clear anything an interrupted earlier run left behind.
    const leftoverCourses = (await admin("/api/admin/curriculum/courses?province=NS")).data?.courses ?? [];
    for (const c of leftoverCourses.filter((c) => c.code === "NSPHY11")) await admin(`/api/admin/curriculum/courses/${c.id}`, { method: "DELETE" });
    const leftoverGrades = (await admin("/api/admin/curriculum/grades?province=NS")).data?.grades ?? [];
    for (const g of leftoverGrades) await admin(`/api/admin/curriculum/grades/${g.id}`, { method: "DELETE" });
    await admin(`/api/admin/curriculum/provinces/${ns.id}`, { method: "PATCH", body: { isActive: true, usesCourseCodes: true } });
    cleanup.push(() => admin(`/api/admin/curriculum/provinces/${ns.id}`, { method: "PATCH", body: { isActive: false, usesCourseCodes: false } }));
    const grade = await admin("/api/admin/curriculum/grades", { method: "POST", body: { provinceId: ns.id, name: "Grade 11", level: 11, stage: "SECONDARY" } });
    check("the administrator adds a grade to the new province", grade.ok, JSON.stringify(grade.error));
    const course = await admin("/api/admin/curriculum/courses", {
      method: "POST",
      body: { provinceId: ns.id, gradeId: grade.data?.grade?.id, subjectId: physics.id, name: "Physics 11", code: "NSPHY11" },
    });
    check("…and a course with a code", course.ok, JSON.stringify(course.error));
    // Undone last-in first-out: the course goes before the grade it sits in.
    cleanup.push(() => admin(`/api/admin/curriculum/grades/${grade.data?.grade?.id}`, { method: "DELETE" }));
    cleanup.push(() => admin(`/api/admin/curriculum/courses/${course.data?.course?.id}`, { method: "DELETE" }));

    const nsTree = await api("/api/curriculum/tree?province=NS");
    check("the curriculum API serves the new province's grades and subjects",
      nsTree.data?.grades?.map((g) => g.name).join() === "Grade 11" && nsTree.data.subjects.some((s) => s.slug === "physics"));
    const nsCourses = await api("/api/curriculum/courses?province=NS&grade=grade-11&subject=physics");
    check("the onboarding course picker's query finds the new course", nsCourses.data?.courses?.some((c) => c.code === "NSPHY11"));
    const nsSearch = await api("/api/search/tutors?province=NS&q=NSPHY11");
    check("search recognises the new course code", nsSearch.data?.resolved?.queryKind === "COURSE_CODE" && nsSearch.data.resolved.course?.code === "NSPHY11");

    await anon.goto(`${BASE}/find-a-tutor?province=NS`, NAV);
    const nsGrades = await optionTexts(anon, "#refine-grade");
    check("the search page's grade picker shows only the new province's grade", nsGrades.includes("Grade 11") && !nsGrades.includes("Grade 12"), nsGrades.join("|"));
    const refineProvinces = await anon.locator("#refine-province option").evaluateAll((o) => o.map((x) => ({ v: x.value, d: x.disabled })));
    check("…and offers the province as live, not 'coming soon'", refineProvinces.some((p) => p.v === "NS" && !p.d));

    // --- D ------------------------------------------------------------------
    section("D — a child profile with curriculum, preferences, marks and goals");
    const parentApi = await signIn("hannah.wong@example.com");
    const parentPage = await (await contextFor(parentApi)).newPage();
    await parentPage.goto(`${BASE}/children`, NAV);
    await parentPage.getByRole("button", { name: /Add (a|another) child/i }).first().waitFor({ timeout: 300_000 });
    await hydrated(parentPage, "main button");
    await parentPage.getByRole("button", { name: /Add (a|another) child/i }).first().click();
    // Names are letters only (the validator refuses digits), so the run's
    // unique suffix is spelled in letters.
    const childName = `Mia${[...Date.now().toString(26).slice(-4)].map((c) => String.fromCharCode(97 + parseInt(c, 26))).join("")}`;
    const form = parentPage.getByRole("dialog");
    await parentPage.locator("#child-first:visible").fill(childName);
    await parentPage.locator("#child-province:visible").selectOption("BC");
    await parentPage.waitForFunction(() => {
      const select = [...document.querySelectorAll("#child-grade")].find((el) => el.offsetParent);
      return select && [...select.options].some((o) => o.textContent.trim() === "Grade 12");
    }, null, { timeout: 60_000 });
    await parentPage.locator("#child-grade:visible").selectOption({ label: "Grade 12" });
    await form.getByRole("textbox", { name: "Search courses" }).fill("Pre-calculus 12");
    await form.getByRole("button", { name: /MPREC12/ }).first().click();
    await form.getByRole("radio", { name: "Online", exact: true }).check();
    await parentPage.locator("#child-current-mark:visible").fill("72");
    await parentPage.locator("#child-target-mark:visible").fill("86");
    await form.getByRole("button", { name: /Add a goal/i }).click();
    await form.getByLabel("Goal 1", { exact: true }).fill("Reach 86% in Pre-calculus 12");
    const saveResponse = parentPage.waitForResponse((r) => r.url().endsWith("/api/students") && r.request().method() === "POST", { timeout: 60_000 });
    await parentPage.getByRole("button", { name: /^Add child$/ }).click();
    const saveResult = await saveResponse;
    check("the child form saves", saveResult.status() === 201, `${saveResult.status()} ${(await saveResult.text()).slice(0, 300)}`);
    await parentPage.getByText(childName).first().waitFor({ timeout: 60_000 });
    const students = (await parentApi("/api/students")).data?.students ?? [];
    const saved = students.find((s) => s.firstName === childName);
    if (saved) cleanup.push(() => parentApi(`/api/students/${saved.id}`, { method: "DELETE" }));
    check("the child is saved with BC curriculum, preference, marks and a goal",
      saved && saved.provinceCode === "BC" && saved.currentCourses?.some((c) => (c.code ?? "") === "MPREC12") &&
        saved.lessonModePreference === "ONLINE" && saved.currentMark === 72 && saved.targetMark === 86 &&
        saved.learningGoals?.[0]?.label === "Reach 86% in Pre-calculus 12", JSON.stringify(saved && { p: saved.provinceCode, m: saved.currentMark }));
    await parentPage.reload(NAV);
    check("it is still there after a reload", await parentPage.getByText(childName).count() > 0);
    const otherParent = await signIn("jennifer.chen@example.com");
    const leak = saved ? await otherParent(`/api/students/${saved.id}`) : { status: 0 };
    check("another parent cannot read it", leak.status === 403 || leak.status === 404, String(leak.status));

    // --- F ------------------------------------------------------------------
    section("F — booking through the development checkout");
    const family = await signIn("david.thompson@example.com");
    const familyPage = await (await contextFor(family)).newPage();
    await familyPage.goto(`${BASE}/tutors/priya-s-toro#book`, NAV);
    await familyPage.locator("#book").waitFor({ timeout: 300_000 });
    await hydrated(familyPage, "#book");
    const slot = familyPage.locator("#availability button:not([disabled])").filter({ hasText: /\d{1,2}:\d{2}/ }).first();
    await slot.waitFor({ timeout: 120_000 });
    await slot.click();
    const bookButton = familyPage.getByRole("button", { name: /Continue to payment|Book|Request/i }).last();
    await bookButton.click();
    await familyPage.waitForURL(/checkout|bookings/, NAV);
    check("choosing a time and booking reaches checkout", /checkout/.test(familyPage.url()), familyPage.url());
    if (/checkout/.test(familyPage.url())) {
      await familyPage.getByLabel(/Card number/i).fill("4242 4242 4242 4242");
      await familyPage.getByLabel(/Name on card/i).fill("David Thompson");
      await familyPage.getByLabel(/Expiry/i).fill("12/30");
      await familyPage.getByLabel(/CVC/i).fill("123");
      await familyPage.getByRole("button", { name: /Pay/i }).click();
      await familyPage.waitForURL(/\/bookings\/[a-f\d]{24}/, NAV);
      const bookingId = familyPage.url().match(/bookings\/([a-f\d]{24})/)?.[1];
      const booking = await family(`/api/bookings/${bookingId}`);
      check("payment confirms the lesson", booking.data?.booking?.status === "CONFIRMED", booking.data?.booking?.status);
      const priya = await signIn("priya.sharma@example.com");
      const tutorSide = await priya("/api/bookings?scope=UPCOMING&pageSize=50");
      check("the tutor sees it in their upcoming lessons", tutorSide.data?.bookings?.some((b) => b.id === bookingId));
      if (bookingId) cleanup.push(() => family(`/api/bookings/${bookingId}/cancel`, { method: "POST", body: { reason: "e2e cleanup" } }));
    }

    // --- M ------------------------------------------------------------------
    section("M — contact details are removed from messages (R17.7)");
    const sent = await family("/api/messages", { method: "POST", body: { tutorProfileId: (await api("/api/tutors/priya-s-toro")).data?.tutor?.id, body: "Could you text me on 416 555 0199 instead?" } });
    const stored = sent.data?.message?.body ?? "";
    check("a phone number in a message is removed before it is stored", sent.ok && !/416 555 0199/.test(stored) && /removed/.test(stored), stored || JSON.stringify(sent.error));

    // --- H ------------------------------------------------------------------
    section("H — administrator pages");
    const adminPage = await (await contextFor(admin)).newPage();
    for (const [route, text] of [
      ["/admin/curriculum", /Curriculum/],
      ["/admin/applications?status=PENDING_REVIEW", /applications/i],
      ["/admin/bookings?status=upcoming", /Upcoming/],
      ["/admin/payouts", /Tutor earnings/],
      ["/admin/analytics", /search/i],
      ["/admin/support", /Support/],
      ["/admin/moderation", /Report/i],
    ]) {
      const response = await adminPage.goto(`${BASE}${route}`, NAV);
      // Admin pages stream behind Suspense; read once the expected text lands.
      await adminPage.locator("main").getByText(text).first().waitFor({ timeout: 120_000 }).catch(() => {});
      const content = await adminPage.locator("main").innerText().catch(() => "");
      check(`${route} renders for an administrator`, response?.status() === 200 && !adminPage.url().includes("/login") && text.test(content), `${response?.status()} ${adminPage.url()}`);
    }
  } catch (error) {
    check("the journeys ran to completion", false, error.stack?.split("\n").slice(0, 3).join(" | "));
    if (process.env.E2E_SCREENSHOTS) {
      for (const [i, page] of browser.contexts().flatMap((c) => c.pages()).entries()) {
        await page.screenshot({ path: path.join(process.env.E2E_SCREENSHOTS, `journey-failure-${i}.png`) }).catch(() => {});
      }
    }
  } finally {
    for (const undo of cleanup.reverse()) await undo().catch(() => {});
    await browser.close();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exitCode = failed ? 1 : 0;
}

main();
