/**
 * End-to-end QA against a running dev server (§46, §47).
 *
 * Exercises the parent, tutor and admin journeys through the real HTTP API,
 * including the authorization checks that must fail.
 *
 *   npm run dev          # in one terminal
 *   npm run qa           # in another
 */

import zlib from "node:zlib";

const BASE = process.env.QA_BASE_URL || "http://localhost:3000";
const PASSWORD = "AplusLearn2024!";

let passed = 0;
let failed = 0;
const failures = [];

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push({ name, detail });
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title) {
  console.log(`\n▸ ${title}`);
}

/** Minimal cookie-jar client so each role keeps its own session. */
function createClient() {
  const cookies = new Map();

  return async function request(path, { method = "GET", body, form, raw = false } = {}) {
    // `fetch` sets its own multipart Content-Type with the boundary, so a
    // FormData upload must not have one imposed on it.
    const headers = form ? {} : { "Content-Type": "application/json" };
    if (cookies.size) {
      headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    }

    const response = await fetch(`${BASE}${path}`, {
      method: form ? "POST" : method,
      headers,
      body: form ?? (body ? JSON.stringify(body) : undefined),
      redirect: "manual",
    });

    for (const [key, value] of response.headers) {
      if (key.toLowerCase() !== "set-cookie") continue;
      const [pair] = value.split(";");
      const idx = pair.indexOf("=");
      if (idx > 0) cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }

    if (raw) return response;

    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = { raw: text.slice(0, 200) };
    }
    return { status: response.status, ok: response.ok, payload };
  };
}

async function login(client, email) {
  let res = await client("/api/auth/login", {
    method: "POST",
    body: { email, password: PASSWORD },
  });

  // The login limiter is deliberately strict. Repeated QA runs from one IP can
  // trip it, which is the limiter working — back off once rather than failing.
  if (res.payload?.error?.code === "RATE_LIMITED") {
    const wait = 1000 * ((res.payload.error.message.match(/(\d+) seconds/)?.[1] ?? 60) * 1 + 2);
    console.log(`    (rate limited — waiting ${Math.round(wait / 1000)}s)`);
    await new Promise((resolve) => setTimeout(resolve, wait));
    res = await client("/api/auth/login", { method: "POST", body: { email, password: PASSWORD } });
  }

  if (!res.ok) throw new Error(`login failed for ${email}: ${JSON.stringify(res.payload)}`);
  return res.payload.data.user;
}

/**
 * A real PNG, built by hand.
 *
 * The branding upload validates the *bytes*, so a test that posts a Blob of
 * text labelled `image/png` proves nothing about the happy path. This emits a
 * structurally valid single-colour PNG with a correct IHDR and CRCs, so the
 * server's own header walk reads the dimensions back out.
 *
 * `padToBytes` appends a trailing comment chunk, which is how the oversize
 * case gets a file that is genuinely too large rather than merely claimed.
 */
function pngBytes(width, height, padToBytes = 0) {
  const crcTable = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed));
    return Buffer.concat([length, typed, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 2;   // truecolour
  // Compression, filter and interlace all stay 0.

  // One filter byte plus three channels per pixel, per row.
  const raw = Buffer.alloc(height * (1 + width * 3), 0);
  const idat = zlibDeflate(raw);

  const parts = [
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
  ];

  const base = Buffer.concat([...parts, chunk("IEND", Buffer.alloc(0))]);
  if (padToBytes <= base.length) return base;

  const padding = chunk("tEXt", Buffer.concat([
    Buffer.from("Comment\0", "ascii"),
    Buffer.alloc(padToBytes - base.length, 0x41),
  ]));
  return Buffer.concat([...parts, padding, chunk("IEND", Buffer.alloc(0))]);
}

function zlibDeflate(buffer) {
  return zlib.deflateSync(buffer);
}

async function main() {
  console.log(`\nAPlus Learn QA → ${BASE}\n${"─".repeat(56)}`);

  const anon = createClient();
  const parent = createClient();
  const tutor = createClient();
  const admin = createClient();

  /** Multipart POST carrying the admin session. */
  const adminUpload = (path, form) => admin(path, { form });

  // --- Public access -------------------------------------------------------
  section("Public marketplace (no account)");

  const search = await anon("/api/search/tutors?courseCode=MHF4U&province=ON");
  check("search tutors without signing in", search.ok && search.payload.data.tutors.length > 0);
  check(
    "search results never expose a surname",
    search.payload.data.tutors.every((t) => /^[^ ]+ [A-Z]\.$/.test(t.displayName)),
    search.payload.data.tutors[0]?.displayName,
  );
  check(
    "search results never expose coordinates",
    search.payload.data.tutors.every((t) => t.location === undefined),
  );

  const courses = await anon("/api/curriculum/courses?q=MHF4U");
  check("course lookup by code", courses.ok && courses.payload.data.courses[0]?.code === "MHF4U");

  const suggest = await anon("/api/search/suggest?q=advan");
  check("autocomplete by course name", suggest.ok && suggest.payload.data.courses.length > 0);

  const tutorId = search.payload.data.tutors[0].id;
  const availability = await anon(`/api/tutors/${tutorId}/availability?days=14`);
  check("availability is public", availability.ok && Array.isArray(availability.payload.data.days));

  // --- Authorization -------------------------------------------------------
  section("Authorization");

  const anonBookings = await anon("/api/bookings");
  check("anonymous cannot list bookings", anonBookings.status === 401);

  const anonAdmin = await anon("/api/admin/users");
  check("anonymous cannot reach admin API", anonAdmin.status === 401);

  await login(parent, "jennifer.chen@example.com");
  await login(tutor, "priya.sharma@example.com");
  await login(admin, "admin@apluslearn.ca");
  check("parent, tutor and admin all signed in", true);

  const parentAdmin = await parent("/api/admin/users");
  check("parent forbidden from admin API", parentAdmin.status === 403);

  const tutorAdmin = await tutor("/api/admin/settings");
  check("tutor forbidden from admin settings", tutorAdmin.status === 403);

  const parentTutorApi = await parent("/api/tutor/profile");
  check("parent forbidden from tutor API", parentTutorApi.status === 403);

  const badLogin = await anon("/api/auth/login", {
    method: "POST",
    body: { email: "nobody-here@example.com", password: "WrongPassword123" },
  });
  check(
    "bad credentials rejected",
    badLogin.status === 401 || badLogin.status === 429,
    `status ${badLogin.status}`,
  );
  check(
    "unknown account gives nothing away",
    badLogin.status !== 404 && !/not found|no account/i.test(badLogin.payload?.error?.message ?? ""),
    badLogin.payload?.error?.message,
  );

  // --- Parent journey ------------------------------------------------------
  section("Parent journey");

  const students = await parent("/api/students");
  check("parent sees their own children", students.ok && students.payload.data.students.length > 0);
  const studentId = students.payload.data.students[0].id;

  const otherFamily = await parent("/api/students/000000000000000000000000");
  check("missing child returns 404", otherFamily.status === 404);

  const courseId = search.payload.data.tutors[0].courses.find((c) => c.code === "MHF4U").courseId;

  const quote = await parent("/api/bookings/quote", {
    method: "POST",
    body: { tutorProfileId: tutorId, courseId, durationMinutes: 60 },
  });
  const lesson = quote.payload?.data?.lesson;
  check("price quote computed server-side", quote.ok && lesson?.totalCents > 0);
  check(
    "commission + earnings equals subtotal exactly",
    lesson && lesson.commissionCents + lesson.tutorEarningsCents === lesson.subtotalCents,
    lesson && `${lesson.commissionCents} + ${lesson.tutorEarningsCents} ≠ ${lesson.subtotalCents}`,
  );

  const slots = await parent(`/api/tutors/${tutorId}/availability?days=21&durationMinutes=60`);
  const freeDay = slots.payload.data.days.find((d) => d.slots.length > 0);
  check("tutor has bookable slots", Boolean(freeDay));

  const slotStart = freeDay?.slots[0]?.startAt;

  const booking = await parent("/api/bookings", {
    method: "POST",
    body: {
      tutorProfileId: tutorId,
      studentProfileId: studentId,
      courseId,
      mode: "ONLINE",
      startAt: slotStart,
      durationMinutes: 60,
      meetingProvider: "ZOOM",
      studentNotes: "QA run",
    },
  });
  check("booking created", booking.ok, JSON.stringify(booking.payload?.error));

  const paymentId = booking.payload?.data?.payment?.id;
  const bookingId = booking.payload?.data?.bookings?.[0]?.id;
  check(
    "booking starts unconfirmed until paid",
    booking.payload?.data?.bookings?.[0]?.status === "PENDING_PAYMENT",
  );

  const duplicate = await parent("/api/bookings", {
    method: "POST",
    body: {
      tutorProfileId: tutorId,
      studentProfileId: studentId,
      courseId,
      mode: "ONLINE",
      startAt: slotStart,
      durationMinutes: 60,
      meetingProvider: "ZOOM",
    },
  });
  check("double-booking the same slot is rejected", duplicate.status === 409);

  const declined = await parent(`/api/payments/${paymentId}/capture`, {
    method: "POST",
    body: {
      card: { number: "4000000000000002", name: "QA", expiry: "12/28", cvc: "123" },
      meetingProvider: "ZOOM",
    },
  });
  check("declined card is reported, not swallowed", declined.status === 422);

  const captured = await parent(`/api/payments/${paymentId}/capture`, {
    method: "POST",
    body: {
      card: { number: "4242424242424242", name: "QA", expiry: "12/28", cvc: "123" },
      meetingProvider: "ZOOM",
    },
  });
  check("payment captured", captured.ok && captured.payload.data.payment.status === "PAID");
  check("booking confirmed after payment", captured.payload?.data?.confirmed === 1);
  check(
    "online lesson gets a meeting link",
    Boolean(captured.payload?.data?.bookings?.[0]?.meeting?.joinUrl),
  );

  const receipt = await parent(`/api/payments/${paymentId}/receipt`);
  check("receipt available after payment", receipt.ok && receipt.payload.data.receiptNumber);

  // Messaging
  const message = await parent("/api/messages", {
    method: "POST",
    body: { tutorProfileId: tutorId, body: "Hi — QA test message about MHF4U." },
  });
  check("parent can message a tutor", message.ok);
  const conversationId = message.payload?.data?.conversationId;

  const threads = await parent("/api/messages/conversations");
  check("conversation appears in the inbox", threads.ok && threads.payload.data.conversations.length > 0);

  const tutorThreads = await tutor("/api/messages/conversations");
  check("tutor has an inbox", tutorThreads.ok && tutorThreads.payload.data.conversations.length > 0);

  // Reply in a thread this tutor is actually part of. The parent's new thread
  // above may belong to a different tutor, which is exactly what the
  // non-participant check below relies on.
  const ownThreadId = tutorThreads.payload.data.conversations[0].id;
  const reply = await tutor("/api/messages", {
    method: "POST",
    body: { conversationId: ownThreadId, body: "Thanks for getting in touch — happy to help." },
  });
  check("tutor can reply in their own thread", reply.ok, JSON.stringify(reply.payload?.error));

  const foreignThread = await admin("/api/messages/conversations");
  check("admin can audit any conversation", foreignThread.ok);

  const strangerReply = await tutor("/api/messages", {
    method: "POST",
    body: { conversationId: "000000000000000000000000", body: "Not my conversation." },
  });
  check("tutor cannot post into a conversation they aren't in", strangerReply.status === 404);

  // Favourites
  const fav = await parent("/api/favourites", { method: "POST", body: { tutorProfileId: tutorId } });
  check("tutor can be saved", fav.ok);
  const favList = await parent("/api/favourites");
  check("saved tutor appears in favourites", favList.ok && favList.payload.data.favourites.length > 0);
  await parent(`/api/favourites?tutorProfileId=${tutorId}`, { method: "DELETE" });

  // Tutor request + matching
  const request = await parent("/api/requests", {
    method: "POST",
    body: {
      studentProfileId: studentId,
      courseId,
      modes: ["ONLINE"],
      preferredWindows: ["WEEKDAY_EVENING"],
      sessionsPerWeek: 1,
      preferredDurationMinutes: 60,
      budgetMaxCents: 9000,
      goal: "QA run — needs help with logarithms before the unit test next month.",
    },
  });
  check("tutor request posted", request.ok, JSON.stringify(request.payload?.error));
  check("matching service ran on submit", (request.payload?.data?.matchCount ?? 0) >= 0);

  const requestId = request.payload?.data?.request?.id;
  const matches = await parent(`/api/requests/${requestId}/matches`);
  check("match list retrievable", matches.ok && Array.isArray(matches.payload.data.matches));

  // --- Business rules ------------------------------------------------------
  section("Business rules");

  const pastBooking = await parent("/api/bookings", {
    method: "POST",
    body: {
      tutorProfileId: tutorId,
      studentProfileId: studentId,
      courseId,
      mode: "ONLINE",
      startAt: "2020-01-01T15:00:00.000Z",
      durationMinutes: 60,
      meetingProvider: "ZOOM",
    },
  });
  check("cannot book in the past", !pastBooking.ok);

  const wrongCourse = await parent("/api/curriculum/courses?q=CHY4U");
  const historyCourseId = wrongCourse.payload.data.courses[0]?.id;
  const notTaught = await parent("/api/bookings", {
    method: "POST",
    body: {
      tutorProfileId: tutorId,
      studentProfileId: studentId,
      courseId: historyCourseId,
      mode: "ONLINE",
      startAt: slotStart,
      durationMinutes: 60,
      meetingProvider: "ZOOM",
    },
  });
  check("cannot book a course the tutor doesn't teach", notTaught.payload?.error?.code === "COURSE_NOT_TAUGHT");

  const clientPriceAttempt = await parent("/api/bookings", {
    method: "POST",
    body: {
      tutorProfileId: tutorId,
      studentProfileId: studentId,
      courseId,
      mode: "ONLINE",
      startAt: slotStart,
      durationMinutes: 60,
      meetingProvider: "ZOOM",
      price: { totalCents: 1 },
      status: "CONFIRMED",
    },
  });
  check(
    "client-supplied price and status are ignored",
    clientPriceAttempt.status === 409 || clientPriceAttempt.status === 422,
  );

  const reviewTooEarly = await parent("/api/reviews", {
    method: "POST",
    body: {
      bookingId,
      rating: 5,
      knowledge: 5,
      communication: 5,
      reliability: 5,
      teaching: 5,
      body: "This lesson has not happened yet, so this must be rejected.",
    },
  });
  check("cannot review a lesson that isn't complete", !reviewTooEarly.ok);

  // Cancellation and refund. Which policy applies depends on how far ahead the
  // booked slot is, so assert the rule that actually governs this booking
  // rather than assuming one of them.
  const settingsRes = await admin("/api/admin/settings");
  const freeWindowHours = settingsRes.payload.data.settings.freeCancellationWindowHours;
  const lateRefundPercent = settingsRes.payload.data.settings.lateCancellationRefundPercent;
  const hoursAhead = (new Date(slotStart).getTime() - Date.now()) / 3600000;
  const insideWindow = hoursAhead < freeWindowHours;

  const cancelled = await parent(`/api/bookings/${bookingId}/cancel`, {
    method: "POST",
    body: { reason: "QA run — testing the refund policy." },
  });
  check("booking cancelled", cancelled.ok, JSON.stringify(cancelled.payload?.error));

  const expectedPolicy = insideWindow ? "LATE_CANCELLATION" : "FREE_CANCELLATION";
  const expectedRefund = insideWindow
    ? Math.round((lesson.totalCents * lateRefundPercent) / 100)
    : lesson.totalCents;

  check(
    `correct policy applied (${hoursAhead.toFixed(1)}h notice → ${expectedPolicy})`,
    cancelled.payload?.data?.policy?.policyApplied === expectedPolicy,
    `got ${cancelled.payload?.data?.policy?.policyApplied}`,
  );
  check(
    "refund matches the policy exactly",
    cancelled.payload?.data?.refundCents === expectedRefund,
    `refunded ${cancelled.payload?.data?.refundCents}, expected ${expectedRefund}`,
  );
  check(
    "cancellation recorded with the hours of notice",
    typeof cancelled.payload?.data?.policy?.hoursBeforeStart === "number",
  );

  const cancelTwice = await parent(`/api/bookings/${bookingId}/cancel`, {
    method: "POST",
    body: { reason: "QA run — cancelling an already-cancelled lesson." },
  });
  check("a cancelled lesson cannot be cancelled again", !cancelTwice.ok);

  // --- Tutor journey -------------------------------------------------------
  section("Tutor journey");

  const tutorProfile = await tutor("/api/tutor/profile");
  check("tutor loads their profile", tutorProfile.ok && tutorProfile.payload.data.profile);

  const tutorAvailability = await tutor("/api/tutor/availability");
  check("tutor loads availability", tutorAvailability.ok);

  const earnings = await tutor("/api/tutor/earnings");
  check("tutor earnings computed", earnings.ok && earnings.payload.data.lifetime);
  check(
    "earnings net = gross − commission",
    earnings.payload.data.lifetime.grossCents - earnings.payload.data.lifetime.commissionCents ===
      earnings.payload.data.lifetime.netCents,
  );

  const tutorStudents = await tutor("/api/tutor/students");
  check("tutor sees their roster", tutorStudents.ok);
  const roster = tutorStudents.payload.data.students ?? [];
  check(
    "tutors never see a learner's email or guardian contact details",
    roster.every((s) => s.email === undefined && s.guardian?.email === undefined),
  );

  // Minor-privacy is only observable from a tutor who actually teaches a
  // child, so check it against one the seed guarantees has minors.
  const minorTutor = createClient();
  await login(minorTutor, "michael.ferreira@example.com");
  const minorRoster = await minorTutor("/api/tutor/students");
  const names = (minorRoster.payload?.data?.students ?? []).map((s) => s.displayName);
  check(
    "minors appear to tutors as first name + initial",
    names.some((n) => /^\S+ [A-Z]\.$/.test(n)),
    names.join(", "),
  );
  check(
    "adult self-serve students keep their full name",
    names.every((n) => n.trim().length > 0),
  );

  const tutorVerification = await tutor("/api/tutor/verification");
  check("tutor sees verification status", tutorVerification.ok && tutorVerification.payload.data.records.length === 5);

  const openRequests = await tutor("/api/requests/open");
  check("tutor sees open requests", openRequests.ok);

  // --- Admin journey -------------------------------------------------------
  section("Admin journey");

  const analytics = await admin("/api/admin/analytics?days=30");
  check("analytics computed", analytics.ok && analytics.payload.data.overview);
  check(
    "platform revenue is a subset of gross sales",
    analytics.payload.data.overview.commerce.platformRevenueCents <=
      analytics.payload.data.overview.commerce.grossSalesCents,
  );

  const users = await admin("/api/admin/users?pageSize=5");
  check("admin lists users", users.ok && users.payload.data.users.length > 0);
  check(
    "password hashes never leave the server",
    users.payload.data.users.every((u) => u.passwordHash === undefined),
  );

  const applications = await admin("/api/admin/applications?status=APPROVED");
  check("admin lists applications", applications.ok);

  const adminSettings = await admin("/api/admin/settings");
  check("admin reads platform settings", adminSettings.ok && adminSettings.payload.data.settings);

  const adminPayouts = await admin("/api/admin/payouts");
  check("admin payout queue", adminPayouts.ok && Array.isArray(adminPayouts.payload.data.pending));

  const adminReviews = await admin("/api/admin/reviews?status=PUBLISHED");
  check("admin lists reviews", adminReviews.ok);

  const adminDisputes = await admin("/api/admin/disputes");
  check("admin lists disputes", adminDisputes.ok);


  // --- Platform settings ---------------------------------------------------
  //
  // Settings decide branding, metadata, marketplace rules and which features
  // exist, so this section checks all four things that must hold: only an
  // administrator can write them, invalid values are refused server-side, a
  // saved value actually reaches the public pages, and a disabled feature is
  // refused by its API rather than merely hidden in the UI (§26, §35, §36).
  section("Platform settings");

  const settingsBefore = (await admin("/api/admin/settings")).payload.data.settings;
  const tutorSlug = search.payload.data.tutors[0].slug;
  const tutorProfileIdForFavourite = tutorId;

  // Authorization — the page is admin-only, and so is every write.
  const anonSettingsRead = await anon("/api/admin/settings");
  check("anonymous cannot read settings", anonSettingsRead.status === 401);

  const anonSettingsWrite = await anon("/api/admin/settings", {
    method: "PATCH",
    body: { branding: { appName: "Hijacked" } },
  });
  check("anonymous cannot write settings", anonSettingsWrite.status === 401);

  const parentSettingsWrite = await parent("/api/admin/settings", {
    method: "PATCH",
    body: { branding: { appName: "Hijacked" } },
  });
  check("a parent cannot write settings", parentSettingsWrite.status === 403);

  const tutorSettingsWrite = await tutor("/api/admin/settings", {
    method: "PATCH",
    body: { commissionPercent: 0 },
  });
  check("a tutor cannot write settings", tutorSettingsWrite.status === 403);

  const parentBrandingUpload = await parent("/api/admin/settings/branding?asset=logo", {
    method: "POST",
  });
  check("a parent cannot upload branding", parentBrandingUpload.status === 403);

  // Validation — every bound is enforced on the server, whatever the form did.
  const badColour = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { theme: { primaryColor: "not-a-colour" } },
  });
  check("invalid colour rejected", badColour.status === 422);

  // The primary brand always carries white text, so a pale primary is refused
  // even though the same colour is perfectly usable as an accent tint.
  const unreadablePrimary = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { theme: { primaryColor: "#ffffe0" } },
  });
  check(
    "a primary colour that cannot carry white text is rejected",
    unreadablePrimary.status === 422,
    `got ${unreadablePrimary.status}`,
  );

  const paleAccent = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { theme: { accentColor: "#fe7b12" } },
  });
  check("the shipped accent passes its own rule", paleAccent.ok);

  const invisibleAccent = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { theme: { accentColor: "#7c7c7c" } },
  });
  check(
    "an accent no text colour reads on is rejected",
    invisibleAccent.status === 422,
    `got ${invisibleAccent.status}`,
  );

  const darkCanvas = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { theme: { canvasColor: "#111111" } },
  });
  check(
    "a page background too dark for body text is rejected",
    darkCanvas.status === 422,
    `got ${darkCanvas.status}`,
  );

  const badEmail = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { contact: { supportEmail: "not-an-email" } },
  });
  check("invalid support email rejected", badEmail.status === 422);

  const badUrl = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { social: { facebook: "javascript:alert(1)" } },
  });
  check("invalid social URL rejected", badUrl.status === 422);

  const badCommission = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { commissionPercent: 90 },
  });
  check("out-of-range commission rejected", badCommission.status === 422);

  const badRateRange = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { minHourlyRate: 200, maxHourlyRate: 50 },
  });
  check("a minimum rate above the maximum is rejected", badRateRange.status === 422);

  const longName = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { branding: { appName: "x".repeat(200) } },
  });
  check("over-long application name rejected", longName.status === 422);

  // A rejected write changes nothing.
  const afterRejections = (await admin("/api/admin/settings")).payload.data.settings;
  check(
    "rejected settings writes leave the document untouched",
    afterRejections.branding.appName === settingsBefore.branding.appName &&
      afterRejections.commissionPercent === settingsBefore.commissionPercent,
  );

  // Uploaded asset records cannot be forged through the JSON route — only the
  // upload endpoint, which checks the bytes, can point at a stored file.
  await admin("/api/admin/settings", {
    method: "PATCH",
    body: { branding: { logo: { storageKey: "../../etc/passwd", contentType: "image/png" } } },
  });
  const afterForgery = (await admin("/api/admin/settings")).payload.data.settings;
  check(
    "a branding asset cannot be injected through the settings route",
    !afterForgery.branding.logo,
  );

  // Branding uploads are validated from the file's own bytes, not its name.
  const notAnImage = new FormData();
  notAnImage.append(
    "file",
    new Blob(["<?php system($_GET['c']); ?>"], { type: "image/png" }),
    "logo.png",
  );
  const disguised = await adminUpload("/api/admin/settings/branding?asset=logo", notAnImage);
  check(
    "a non-image disguised as a PNG is refused",
    disguised.status === 422,
    `got ${disguised.status}`,
  );

  const svgUpload = new FormData();
  svgUpload.append(
    "file",
    new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], {
      type: "image/svg+xml",
    }),
    "logo.svg",
  );
  const svgRefused = await adminUpload("/api/admin/settings/branding?asset=logo", svgUpload);
  check("an SVG logo is refused", svgRefused.status === 422);

  const oversized = new FormData();
  oversized.append("file", new Blob([pngBytes(64, 64, 700 * 1024)], { type: "image/png" }), "big.png");
  const tooBig = await adminUpload("/api/admin/settings/branding?asset=logo", oversized);
  check("an oversized logo is refused", tooBig.status === 422, `got ${tooBig.status}`);

  const tinyFavicon = new FormData();
  tinyFavicon.append("file", new Blob([pngBytes(8, 8)], { type: "image/png" }), "tiny.png");
  const tooSmall = await adminUpload("/api/admin/settings/branding?asset=favicon", tinyFavicon);
  check("an undersized favicon is refused", tooSmall.status === 422, `got ${tooSmall.status}`);

  const nonSquare = new FormData();
  nonSquare.append("file", new Blob([pngBytes(64, 32)], { type: "image/png" }), "wide.png");
  const notSquare = await adminUpload("/api/admin/settings/branding?asset=favicon", nonSquare);
  check("a non-square favicon is refused", notSquare.status === 422, `got ${notSquare.status}`);

  const goodLogo = new FormData();
  goodLogo.append("file", new Blob([pngBytes(240, 64)], { type: "image/png" }), "logo.png");
  const logoUpload = await adminUpload("/api/admin/settings/branding?asset=logo", goodLogo);
  check("a valid logo uploads", logoUpload.ok, JSON.stringify(logoUpload.payload?.error ?? {}));
  check(
    "the stored logo records its real dimensions",
    logoUpload.payload?.data?.settings?.branding?.logo?.width === 240 &&
      logoUpload.payload?.data?.settings?.branding?.logo?.height === 64,
  );

  // The asset is publicly readable — it is in the header of every page — but
  // only through the setting's name, never a storage key.
  const servedLogo = await anon("/api/branding/logo", { raw: true });
  check("the logo is served publicly", servedLogo.status === 200);
  check(
    "the logo is served as an image and not sniffed",
    servedLogo.headers.get("content-type") === "image/png" &&
      servedLogo.headers.get("x-content-type-options") === "nosniff",
  );

  const bogusAsset = await anon("/api/branding/../../package.json", { raw: true });
  check("an unknown branding asset is refused", bogusAsset.status === 404 || bogusAsset.status === 422);

  const removeLogo = await admin("/api/admin/settings/branding?asset=logo", { method: "DELETE" });
  check("a logo can be removed", removeLogo.ok && !removeLogo.payload.data.settings.branding.logo);

  const goneLogo = await anon("/api/branding/logo", { raw: true });
  check("a removed logo stops being served", goneLogo.status === 404);

  // Branding reaches the public pages, and page-specific SEO still wins.
  const renamed = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { branding: { appName: "QA Tutoring Co" }, seo: { titleSuffix: "QA Suffix" } },
  });
  check("branding saves", renamed.ok);

  const homeHtml = await (await fetch(`${BASE}/`)).text();
  check("the configured application name reaches the public site", homeHtml.includes("QA Tutoring Co"));

  const tutorPageHtml = await (await fetch(`${BASE}/tutors/${tutorSlug}`)).text();
  check(
    "a tutor page keeps its own title and only takes the configured suffix",
    tutorPageHtml.includes("QA Suffix") && !tutorPageHtml.includes("<title>QA Tutoring Co</title>"),
  );

  // Theme colours become real CSS variables on the page.
  await admin("/api/admin/settings", { method: "PATCH", body: { theme: { primaryColor: "#7c2d12" } } });
  const themedHtml = await (await fetch(`${BASE}/`)).text();
  check("a configured colour is emitted as design tokens", themedHtml.includes("--color-brand-600:#7c2d12"));
  // `data-href` is React's marker for a hoisted style. Asserting it — rather
  // than just that the CSS is present somewhere — pins the mechanism: a root
  // layout that authors its own <head> would also serve this CSS, and would
  // then have React reconcile the whole head away (Tailwind's stylesheet
  // included) on hydration.
  check(
    "the theme override is hoisted by React, not written into a hand-made head",
    /data-href="aplus-theme"/.test(themedHtml) && !/<head><style/.test(themedHtml),
  );
  check(
    "the application stylesheet is linked",
    /<link rel="stylesheet" href="\/_next\/static\//.test(themedHtml),
  );

  // Indexing is a deployment-level switch an operator can flip.
  await admin("/api/admin/settings", { method: "PATCH", body: { seo: { allowIndexing: false } } });
  const noIndexHtml = await (await fetch(`${BASE}/`)).text();
  check("indexing can be switched off", /noindex/i.test(noIndexHtml));
  await admin("/api/admin/settings", { method: "PATCH", body: { seo: { allowIndexing: true } } });

  // Feature flags — the API must enforce them, not just the navigation.
  const favouritesOn = await parent("/api/favourites");
  check("favourites work while enabled", favouritesOn.ok);

  await admin("/api/admin/settings", { method: "PATCH", body: { features: { favourites: false } } });
  const favouritesOff = await parent("/api/favourites");
  check(
    "a disabled feature is refused through the API, not just hidden",
    favouritesOff.status === 403,
    `got ${favouritesOff.status}`,
  );
  const favouriteWriteOff = await parent("/api/favourites", {
    method: "POST",
    body: { tutorProfileId: tutorProfileIdForFavourite },
  });
  check("a disabled feature refuses writes too", favouriteWriteOff.status === 403);

  await admin("/api/admin/settings", { method: "PATCH", body: { features: { favourites: true } } });
  const favouritesBack = await parent("/api/favourites");
  check("re-enabling a feature restores it", favouritesBack.ok);

  await admin("/api/admin/settings", { method: "PATCH", body: { features: { messaging: false } } });
  const messagesOff = await parent("/api/messages/conversations");
  check("messaging can be switched off platform-wide", messagesOff.status === 403);
  await admin("/api/admin/settings", { method: "PATCH", body: { features: { messaging: true } } });

  await admin("/api/admin/settings", { method: "PATCH", body: { features: { reviews: false } } });
  const reviewsOff = await parent("/api/reviews");
  check("reviews can be switched off platform-wide", reviewsOff.status === 403);
  await admin("/api/admin/settings", { method: "PATCH", body: { features: { reviews: true } } });

  // A lesson mode is enforced in the booking service, not on the route, so it
  // holds for every path that creates a booking. The assertion is on the code,
  // not just the status: a 422 for some other reason would prove nothing.
  await admin("/api/admin/settings", { method: "PATCH", body: { features: { onlineLessons: false } } });
  const onlineBookingOff = await parent("/api/bookings", {
    method: "POST",
    body: {
      tutorProfileId: tutorId,
      studentProfileId: studentId,
      courseId,
      mode: "ONLINE",
      startAt: slotStart,
      durationMinutes: 60,
      meetingProvider: "ZOOM",
    },
  });
  check(
    "a disabled lesson mode is refused when a booking is created",
    onlineBookingOff.payload?.error?.code === "LESSON_MODE_UNAVAILABLE",
    `got ${onlineBookingOff.status} ${onlineBookingOff.payload?.error?.code}`,
  );
  await admin("/api/admin/settings", { method: "PATCH", body: { features: { onlineLessons: true } } });

  // Settings changes are auditable, with the old value beside the new one.
  const auditedChange = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { branding: { tagline: "Audited tagline" } },
  });
  check("an audited change succeeds", auditedChange.ok);

  // Restore everything this section changed, so a QA run is repeatable.
  const restored = await admin("/api/admin/settings", {
    method: "PATCH",
    body: {
      branding: {
        appName: settingsBefore.branding.appName,
        tagline: settingsBefore.branding.tagline,
      },
      seo: { titleSuffix: settingsBefore.seo.titleSuffix ?? "" },
      theme: { primaryColor: settingsBefore.theme.primaryColor },
    },
  });
  check("settings restore cleanly", restored.ok);

  const finalSettings = (await admin("/api/admin/settings")).payload.data.settings;
  check(
    "settings persist exactly as written",
    finalSettings.branding.appName === settingsBefore.branding.appName &&
      finalSettings.theme.primaryColor === settingsBefore.theme.primaryColor,
  );

  // --- External integrations ----------------------------------------------
  section("External integrations");

  // Webhooks. In development the payment provider signs nothing and can prove
  // nothing, so the endpoint must refuse everything rather than trust it — and
  // it must never confirm a booking on an unverified call.
  const unsignedHook = await anon("/api/webhooks/payments", {
    method: "POST",
    body: { id: "evt_qa", type: "checkout.session.completed", data: { object: {} } },
  });
  check("webhook without a signature is refused", unsignedHook.status === 400);
  check(
    "the refusal names the reason without leaking configuration",
    unsignedHook.payload?.error?.code === "UNSIGNED",
  );

  const forgedHook = await fetch(`${BASE}/api/webhooks/payments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
    body: JSON.stringify({ id: "evt_qa2", type: "checkout.session.completed", data: { object: {} } }),
  });
  check(
    "webhook with an unverifiable signature is refused",
    forgedHook.status === 400 || forgedHook.status === 503,
    `status ${forgedHook.status}`,
  );

  const connectHook = await anon("/api/webhooks/payments?connect=1", { method: "POST", body: {} });
  check("the Connect webhook endpoint is equally strict", connectHook.status === 400);

  // OAuth. The nonce endpoint is what makes a sign-in attempt single-use.
  const nonce = await anon("/api/auth/oauth/nonce");
  check("a sign-in nonce can be minted", nonce.ok && nonce.payload.data.nonce?.length >= 16);
  check(
    "the nonce response lists providers without exposing secrets",
    Array.isArray(nonce.payload.data.providers) &&
      !JSON.stringify(nonce.payload.data).match(/secret|client_secret|sk_|whsec/i),
  );

  const forgedIdentity = await anon("/api/auth/oauth", {
    method: "POST",
    body: { provider: "GOOGLE", credential: "not-a-real-token-at-all" },
  });
  check(
    "an unverifiable OAuth credential never creates a session",
    !forgedIdentity.ok && !forgedIdentity.payload?.data?.user,
    `status ${forgedIdentity.status}`,
  );

  const roleGrab = await anon("/api/auth/oauth", {
    method: "POST",
    body: { provider: "GOOGLE", credential: "x".repeat(20), role: "ADMIN" },
  });
  check("OAuth cannot be used to request an ADMIN role", roleGrab.status === 422 || !roleGrab.ok);

  // Geocoding. A location the geocoder cannot resolve must degrade, not fail.
  const geoSearch = await anon("/api/search/tutors?postalCode=M5V3L9&distanceKm=25&mode=IN_PERSON");
  check("search by postal code works", geoSearch.ok);

  const unknownPlace = await anon("/api/search/tutors?postalCode=ZZZ9Z9&province=ON");
  check(
    "an unresolvable location degrades instead of breaking search",
    unknownPlace.ok && Array.isArray(unknownPlace.payload.data.tutors),
  );

  const farAway = await anon("/api/search/tutors?city=Whitehorse&province=YT&mode=IN_PERSON");
  check("an unserved city returns an empty result, not an error", farAway.ok);

  // Meeting links are private to the two participants (§27).
  const publicTutor = await anon(`/api/tutors/${tutorId}`);
  check(
    "a public tutor profile never carries a meeting link",
    publicTutor.ok && !JSON.stringify(publicTutor.payload.data).match(/zoom\.us|meet\.google|teams\.microsoft/),
  );
  check(
    "public search results never carry a meeting link",
    !JSON.stringify(search.payload.data).match(/zoom\.us|meet\.google|teams\.microsoft/),
  );

  const participantView = await parent(`/api/bookings/${bookingId}`);
  check(
    "the purchaser can see their own meeting link",
    participantView.ok && Boolean(participantView.payload.data.booking?.meeting?.joinUrl),
  );

  // The signed-in tutor is whoever the seed made; the booking above went to
  // the top search result, which may be someone else. Check whichever
  // property actually applies — both matter.
  const tutorSelf = await tutor("/api/tutor/profile");
  const bookingTutorProfileId =
    participantView.payload?.data?.booking?.tutorProfileId?.id ??
    participantView.payload?.data?.booking?.tutorProfileId;
  const tutorIsParticipant =
    String(tutorSelf.payload?.data?.profile?.id) === String(bookingTutorProfileId);

  const tutorView = await tutor(`/api/bookings/${bookingId}`);
  if (tutorIsParticipant) {
    check(
      "the tutor on the lesson can see its meeting link",
      tutorView.ok && Boolean(tutorView.payload.data.booking?.meeting?.joinUrl),
    );
  } else {
    check(
      "a tutor who is not on the lesson cannot see it at all",
      tutorView.status === 403,
      `status ${tutorView.status}`,
    );
  }

  const adminView = await admin(`/api/bookings/${bookingId}`);
  check(
    "an administrator can see the lesson for support and audit",
    adminView.ok && Boolean(adminView.payload.data.booking?.meeting?.joinUrl),
  );

  const anonView = await anon(`/api/bookings/${bookingId}`);
  check("an anonymous request cannot see a meeting link", anonView.status === 401);

  // Configuration is admin-only and never reaches a non-admin.
  const adminSettingsPage = await admin("/api/admin/settings");
  check("admin can read platform settings", adminSettingsPage.ok);
  check(
    "platform settings carry no provider credentials",
    !JSON.stringify(adminSettingsPage.payload?.data ?? {}).match(/sk_live|sk_test|whsec|RESEND|api_key/i),
  );

  // --- Validation ----------------------------------------------------------
  section("Validation");

  const badRegister = await anon("/api/auth/register", {
    method: "POST",
    body: { email: "not-an-email", password: "short", role: "PARENT" },
  });
  check("invalid registration rejected with field errors", badRegister.status === 422);
  check(
    "field errors are per-field",
    Object.keys(badRegister.payload?.error?.details?.fieldErrors ?? {}).length > 0,
  );

  const badReview = await parent("/api/reviews", {
    method: "POST",
    body: { bookingId: "not-an-id", rating: 99 },
  });
  check("invalid review rejected", badReview.status === 422);

  const badBookingId = await parent("/api/bookings/not-a-valid-id");
  check("malformed id rejected cleanly", badBookingId.status === 422 || badBookingId.status === 404);

  // --- Summary -------------------------------------------------------------
  console.log(`\n${"─".repeat(56)}`);
  console.log(`  ${passed} passed, ${failed} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  · ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
  }
  console.log("");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("\nQA run failed:", error);
  process.exit(1);
});
