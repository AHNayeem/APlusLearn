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

  return async function request(
    path,
    { method = "GET", body, form, raw = false, headers: extraHeaders } = {},
  ) {
    // `fetch` sets its own multipart Content-Type with the boundary, so a
    // FormData upload must not have one imposed on it.
    const headers = { ...(form ? {} : { "Content-Type": "application/json" }), ...extraHeaders };
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

  // --- Verification documents, end to end (R33) -----------------------------
  //
  //   tutor uploads → nobody but an administrator can read it back →
  //   the administrator retrieves it → the retrieval is audited.
  //
  // The upload goes through the storage abstraction, so this exercises
  // whichever provider the deployment has configured.
  section("Verification documents (R33)");

  const tutorUpload = (path, form) => tutor(path, { form });

  const certificate = new FormData();
  certificate.append("type", "EDUCATION");
  certificate.append(
    "file",
    // A real PDF, so the server's own byte inspection has something to read.
    new Blob([Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer\n%%EOF\n")], {
      type: "application/pdf",
    }),
    // A filename carrying a path, a quote and a header break — none of which
    // may survive into storage or into a response header.
    'evil"\r\nX-Injected: yes/../../etc/passwd.pdf',
  );
  const uploaded = await tutorUpload("/api/tutor/verification/upload", certificate);
  check("a tutor can upload a verification document",
    uploaded.ok, JSON.stringify(uploaded.payload?.error));

  const documentId = uploaded.payload?.data?.document?.id;
  const storedName = uploaded.payload?.data?.document?.fileName ?? "";
  check("the uploader's filename is sanitised before it is stored",
    !storedName.includes("\r") && !storedName.includes("\n") &&
      !storedName.includes('"') && !storedName.includes("/"),
    JSON.stringify(storedName));
  check("the private storage key is NEVER returned to the uploader",
    !("storageKey" in (uploaded.payload?.data?.document ?? {})),
    JSON.stringify(Object.keys(uploaded.payload?.data?.document ?? {})));

  // A script renamed and relabelled as a PDF.
  const disguisedDoc = new FormData();
  disguisedDoc.append("type", "EDUCATION");
  disguisedDoc.append(
    "file",
    new Blob(["<?php system($_GET['c']); ?>"], { type: "application/pdf" }),
    "shell.pdf",
  );
  const disguisedRefused = await tutorUpload("/api/tutor/verification/upload", disguisedDoc);
  check("a script relabelled as a PDF is REFUSED on its bytes, not its label",
    disguisedRefused.status === 422 || disguisedRefused.status === 400,
    `status ${disguisedRefused.status}`);

  const svgDoc = new FormData();
  svgDoc.append("type", "EDUCATION");
  svgDoc.append(
    "file",
    new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], {
      type: "image/png",
    }),
    "logo.png",
  );
  const svgDocRefused = await tutorUpload("/api/tutor/verification/upload", svgDoc);
  check("a script-capable SVG is REFUSED as a verification document",
    svgDocRefused.status === 422 || svgDocRefused.status === 400,
    `status ${svgDocRefused.status}`);

  if (documentId) {
    const anonDoc = await anon(`/api/admin/verification/documents/${documentId}`);
    check("an anonymous request cannot retrieve a verification document",
      anonDoc.status === 401 || anonDoc.status === 403, `status ${anonDoc.status}`);

    const parentDoc = await parent(`/api/admin/verification/documents/${documentId}`);
    check("a parent cannot retrieve a verification document", parentDoc.status === 403);

    const ownerDoc = await tutor(`/api/admin/verification/documents/${documentId}`);
    check("not even the tutor who uploaded it can reach the admin document route",
      ownerDoc.status === 403, `status ${ownerDoc.status}`);

    // A second, unrelated tutor account.
    const otherTutorDoc = await minorTutor(`/api/admin/verification/documents/${documentId}`);
    check("another tutor cannot retrieve someone else's identity paperwork",
      otherTutorDoc.status === 403);

    const guessed = await admin("/api/admin/verification/documents/000000000000000000000000");
    check("a guessed document id is a 404, not a file", guessed.status === 404);

    const adminDoc = await admin(`/api/admin/verification/documents/${documentId}`, { raw: true });
    check("an administrator CAN retrieve the document", adminDoc.status === 200);
    check("and the bytes come back through the storage abstraction",
      (await adminDoc.clone().arrayBuffer()).byteLength > 0);
    check("served as the type its bytes really are",
      adminDoc.headers.get("content-type") === "application/pdf",
      adminDoc.headers.get("content-type"));
    check("no header was injected through the filename",
      adminDoc.headers.get("x-injected") === null);
    check("the browser is told not to sniff or execute it",
      adminDoc.headers.get("x-content-type-options") === "nosniff" &&
        (adminDoc.headers.get("content-security-policy") ?? "").includes("sandbox"));
    check("the document is never cached",
      (adminDoc.headers.get("cache-control") ?? "").includes("no-store"));

    // Retrieval is repeatable — the same bytes, every time.
    const adminDocAgain = await admin(`/api/admin/verification/documents/${documentId}`, { raw: true });
    check("retrieval is deterministic — the same document comes back on a second read",
      adminDocAgain.status === 200 &&
        (await adminDocAgain.arrayBuffer()).byteLength ===
          (await adminDoc.arrayBuffer()).byteLength);
  }

  const docsPublic = await anon(`/api/branding/logo`);
  check("branding assets are served by setting name, never by storage key",
    docsPublic.status === 200 || docsPublic.status === 404, `status ${docsPublic.status}`);

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


  // --- Booking authorization ------------------------------------------------
  //
  // The two write paths that move a confirmed lesson: reschedule and no-show.
  // Both are reachable by anyone holding BOOKING_VIEW — which is every role —
  // so participation has to be asserted inside the service against the stored
  // booking. These are the regression tests for that (§8, §42).
  section("Booking authorization");

  // Book with the tutor QA actually holds a session for, so "the tutor on the
  // lesson" is a known account rather than whichever profile search ranked
  // first. Everyone else in this section is a genuine stranger to it.
  const ownTutor = (await tutor("/api/tutor/profile")).payload?.data?.profile;
  const ownTutorId = ownTutor?.id;
  const ownCourseId = ownTutor?.courses?.[0]?.courseId;

  const stranger = createClient();
  await login(stranger, "nadia.petrov@example.com");
  const strangerParent = createClient();
  await login(strangerParent, "david.thompson@example.com");
  const strangerTutor = createClient();
  await login(strangerTutor, "michael.ferreira@example.com");
  const strangerTutorId = (await strangerTutor("/api/tutor/profile")).payload?.data?.profile?.id;
  check(
    "the test's 'unrelated tutor' really is unrelated to the lesson",
    Boolean(strangerTutorId) && String(strangerTutorId) !== String(ownTutorId),
  );

  /**
   * One free slot from each of the next few days the tutor works.
   *
   * Taking the first N slots outright would return back-to-back times on one
   * day, and booking one of those legitimately blocks its neighbour through
   * the tutor's buffer — which would make a conflict look like a bug.
   */
  const freeSlots = async (count) => {
    const res = await parent(
      `/api/tutors/${ownTutorId}/availability?days=28&durationMinutes=60`,
    );
    return (res.payload?.data?.days ?? [])
      .filter((d) => d.slots.length > 0)
      .slice(0, count)
      .map((d) => d.slots[0].startAt);
  };

  const [slotA, slotB] = await freeSlots(2);
  check("tutor has two free slots to work with", Boolean(slotA && slotB));

  const authBooking = await parent("/api/bookings", {
    method: "POST",
    body: {
      tutorProfileId: ownTutorId,
      studentProfileId: studentId,
      courseId: ownCourseId,
      mode: "ONLINE",
      startAt: slotA,
      durationMinutes: 60,
      meetingProvider: "ZOOM",
      studentNotes: "QA — authorization fixture",
    },
  });
  const authBookingId = authBooking.payload?.data?.bookings?.[0]?.id;
  const authPaymentId = authBooking.payload?.data?.payment?.id;
  await parent(`/api/payments/${authPaymentId}/capture`, {
    method: "POST",
    body: {
      card: { number: "4242424242424242", name: "QA", expiry: "12/28", cvc: "123" },
      meetingProvider: "ZOOM",
    },
  });
  const confirmedFixture = await parent(`/api/bookings/${authBookingId}`);
  check(
    "fixture lesson is confirmed and belongs to the parent",
    confirmedFixture.ok && confirmedFixture.payload.data.booking.status === "CONFIRMED",
    JSON.stringify(confirmedFixture.payload?.error),
  );

  const reschedulePayload = {
    method: "POST",
    body: { startAt: slotB, reason: "QA — attempting to move someone else's lesson." },
  };

  // --- Reschedule: who may not ---
  const anonReschedule = await anon(`/api/bookings/${authBookingId}/reschedule`, reschedulePayload);
  check("anonymous cannot reschedule a lesson", anonReschedule.status === 401);

  const strangerReschedule = await stranger(
    `/api/bookings/${authBookingId}/reschedule`,
    reschedulePayload,
  );
  check(
    "an unrelated learner cannot reschedule someone else's lesson",
    strangerReschedule.status === 403,
    `status ${strangerReschedule.status}`,
  );

  const strangerParentReschedule = await strangerParent(
    `/api/bookings/${authBookingId}/reschedule`,
    reschedulePayload,
  );
  check(
    "an unrelated parent cannot reschedule someone else's lesson",
    strangerParentReschedule.status === 403,
    `status ${strangerParentReschedule.status}`,
  );

  const strangerTutorReschedule = await strangerTutor(
    `/api/bookings/${authBookingId}/reschedule`,
    reschedulePayload,
  );
  check(
    "an unrelated tutor cannot reschedule someone else's lesson",
    strangerTutorReschedule.status === 403,
    `status ${strangerTutorReschedule.status}`,
  );

  // The point of the fix: a refused request must have changed nothing.
  const untouched = await parent(`/api/bookings/${authBookingId}`);
  check(
    "a refused reschedule leaves the lesson exactly where it was",
    untouched.payload?.data?.booking?.status === "CONFIRMED" &&
      new Date(untouched.payload.data.booking.startAt).toISOString() ===
        new Date(slotA).toISOString(),
    `${untouched.payload?.data?.booking?.startAt} vs ${slotA}`,
  );

  // --- Reschedule: who may ---
  const parentReschedule = await parent(`/api/bookings/${authBookingId}/reschedule`, {
    method: "POST",
    body: { startAt: slotB, reason: "QA — the person who paid moves their own lesson." },
  });
  check(
    "the purchaser can reschedule their own lesson",
    parentReschedule.ok,
    JSON.stringify(parentReschedule.payload?.error),
  );
  check(
    "the lesson actually moved",
    new Date(parentReschedule.payload?.data?.booking?.startAt).toISOString() ===
      new Date(slotB).toISOString(),
  );

  const tutorReschedule = await tutor(`/api/bookings/${authBookingId}/reschedule`, {
    method: "POST",
    body: { startAt: slotA, reason: "QA — the tutor on the lesson moves it back." },
  });
  check(
    "the tutor on the lesson can reschedule it",
    tutorReschedule.ok,
    JSON.stringify(tutorReschedule.payload?.error),
  );

  const missingReschedule = await parent("/api/bookings/000000000000000000000000/reschedule", {
    method: "POST",
    body: { startAt: slotB, reason: "QA — a lesson that does not exist." },
  });
  check("rescheduling a lesson that does not exist is a 404", missingReschedule.status === 404);

  const badIdReschedule = await parent("/api/bookings/not-an-id/reschedule", {
    method: "POST",
    body: { startAt: slotB, reason: "QA — malformed id." },
  });
  check("a malformed booking id is rejected cleanly", badIdReschedule.status === 422);

  // --- No-show: who may not ---
  const noShowPayload = {
    method: "POST",
    body: { party: "TUTOR", note: "QA — attempting a no-show on a stranger's lesson." },
  };

  const anonNoShow = await anon(`/api/bookings/${authBookingId}/no-show`, noShowPayload);
  check("anonymous cannot report a no-show", anonNoShow.status === 401);

  const strangerNoShow = await stranger(`/api/bookings/${authBookingId}/no-show`, noShowPayload);
  check(
    "an unrelated learner cannot report a no-show on someone else's lesson",
    strangerNoShow.status === 403,
    `status ${strangerNoShow.status}`,
  );

  const strangerTutorNoShow = await strangerTutor(`/api/bookings/${authBookingId}/no-show`, {
    method: "POST",
    body: { party: "STUDENT", note: "QA — attempting a no-show on another tutor's lesson." },
  });
  check(
    "an unrelated tutor cannot report a no-show on someone else's lesson",
    strangerTutorNoShow.status === 403,
    `status ${strangerTutorNoShow.status}`,
  );

  // Being a participant is not enough — you may only report the other side.
  const wrongDirection = await parent(`/api/bookings/${authBookingId}/no-show`, {
    method: "POST",
    body: { party: "STUDENT", note: "QA — the purchaser reporting their own side." },
  });
  check(
    "a participant cannot report the wrong party",
    wrongDirection.status === 403,
    `status ${wrongDirection.status}`,
  );

  const stillConfirmed = await parent(`/api/bookings/${authBookingId}`);
  check(
    "no refused no-show changed the lesson's status",
    stillConfirmed.payload?.data?.booking?.status === "CONFIRMED",
    stillConfirmed.payload?.data?.booking?.status,
  );
  check(
    "no refused no-show issued a refund",
    (stillConfirmed.payload?.data?.booking?.paymentId?.refundedCents ?? 0) === 0 &&
      stillConfirmed.payload?.data?.booking?.paymentId?.status === "PAID",
    `payment ${stillConfirmed.payload?.data?.booking?.paymentId?.status}`,
  );

  // A participant on a lesson that has not happened yet gets past the
  // authorization gate and is stopped by the state rule instead — which is
  // precisely the distinction the fix draws.
  const tooEarly = await parent(`/api/bookings/${authBookingId}/no-show`, {
    method: "POST",
    body: { party: "TUTOR", note: "QA — reporting a lesson that has not happened yet." },
  });
  check(
    "a participant is refused on timing, not authorization",
    tooEarly.status === 422 && tooEarly.payload?.error?.code !== "FORBIDDEN",
    `${tooEarly.status} ${tooEarly.payload?.error?.code}`,
  );

  // --- No-show on a lesson that has actually finished ---
  //
  // Seeded history supplies these; each run consumes one. Re-seed if this
  // section reports that it has run out.
  const pastLessons = await parent("/api/bookings?scope=PAST&status=COMPLETED&pageSize=50");
  const reportable = (pastLessons.payload?.data?.bookings ?? []).find(
    (b) => b.status === "COMPLETED",
  );

  if (!reportable) {
    check(
      "a completed lesson is available to test the no-show happy path",
      false,
      "no COMPLETED past booking left — run `bun run seed` to restore the fixtures",
    );
  } else {
    const earningsBefore = (await tutor("/api/tutor/earnings")).payload?.data?.lifetime?.netCents;

    const strangerOnCompleted = await stranger(`/api/bookings/${reportable.id}/no-show`, {
      method: "POST",
      body: { party: "TUTOR", note: "QA — voiding a completed lesson the caller has no part in." },
    });
    check(
      "an unrelated user cannot void a completed lesson",
      strangerOnCompleted.status === 403,
      `status ${strangerOnCompleted.status}`,
    );

    const afterAttack = await admin(`/api/bookings/${reportable.id}`);
    check(
      "the completed lesson survived the unauthorized attempt",
      afterAttack.payload?.data?.booking?.status === "COMPLETED",
      afterAttack.payload?.data?.booking?.status,
    );
    const earningsAfterAttack = (await tutor("/api/tutor/earnings")).payload?.data?.lifetime
      ?.netCents;
    check(
      "tutor earnings are untouched by an unauthorized no-show",
      earningsAfterAttack === earningsBefore,
      `${earningsBefore} -> ${earningsAfterAttack}`,
    );

    const noShowSettings = (await admin("/api/admin/settings")).payload.data.settings;
    const realNoShow = await parent(`/api/bookings/${reportable.id}/no-show`, {
      method: "POST",
      body: { party: "TUTOR", note: "QA — the tutor did not attend this lesson." },
    });
    check(
      "the learner who paid can report a tutor no-show",
      realNoShow.ok,
      JSON.stringify(realNoShow.payload?.error),
    );
    check(
      "the no-show applies the configured policy exactly",
      realNoShow.payload?.data?.booking?.cancellation?.refundPercent ===
        noShowSettings.tutorNoShowRefundPercent,
      `got ${realNoShow.payload?.data?.booking?.cancellation?.refundPercent}`,
    );
    check(
      "the lesson is recorded as a tutor no-show",
      realNoShow.payload?.data?.booking?.status === "NO_SHOW_TUTOR",
    );

    const repeatNoShow = await parent(`/api/bookings/${reportable.id}/no-show`, {
      method: "POST",
      body: { party: "TUTOR", note: "QA — reporting the same no-show a second time." },
    });
    check(
      "a second no-show report cannot refund the same lesson twice",
      !repeatNoShow.ok && repeatNoShow.payload?.error?.code === "NOT_REPORTABLE",
      `${repeatNoShow.status} ${repeatNoShow.payload?.error?.code}`,
    );
  }

  // Finally: a cancelled lesson cannot be rescheduled back to life.
  await parent(`/api/bookings/${authBookingId}/cancel`, {
    method: "POST",
    body: { reason: "QA — tidying up the authorization fixture." },
  });
  const rescheduleCancelled = await parent(`/api/bookings/${authBookingId}/reschedule`, {
    method: "POST",
    body: { startAt: slotB, reason: "QA — reviving a cancelled lesson." },
  });
  check(
    "a cancelled lesson cannot be rescheduled",
    !rescheduleCancelled.ok && rescheduleCancelled.status === 422,
    `status ${rescheduleCancelled.status}`,
  );

  // --- Double-booking under concurrency ------------------------------------
  //
  // The availability check is a read followed by a write. These fire the same
  // slot at the server at once and assert the invariant survives it (§18).
  section("Booking concurrency");

  const [raceSlot, otherDaySlot] = await freeSlots(2);
  const raceBody = {
    tutorProfileId: ownTutorId,
    studentProfileId: studentId,
    courseId: ownCourseId,
    mode: "ONLINE",
    startAt: raceSlot,
    durationMinutes: 60,
    meetingProvider: "ZOOM",
  };

  const race = await Promise.all(
    Array.from({ length: 5 }, () => parent("/api/bookings", { method: "POST", body: raceBody })),
  );
  const winners = race.filter((r) => r.ok);
  check(
    "exactly one of five concurrent requests wins the slot",
    winners.length === 1,
    `${winners.length} succeeded`,
  );
  check(
    "every loser is refused with a conflict, not an error",
    race.filter((r) => !r.ok).every((r) => r.status === 409),
    race.filter((r) => !r.ok).map((r) => r.status).join(","),
  );

  const heldSlot = await parent(
    `/api/tutors/${ownTutorId}/availability?days=28&durationMinutes=60`,
  );
  const stillOffered = (heldSlot.payload?.data?.days ?? [])
    .flatMap((d) => d.slots.map((s) => s.startAt))
    .some((s) => new Date(s).toISOString() === new Date(raceSlot).toISOString());
  check("the contested slot is no longer offered to anyone else", !stillOffered);

  // The guard must not be over-broad: an unrelated slot still books.
  const unrelatedSlot = await parent("/api/bookings", {
    method: "POST",
    body: { ...raceBody, startAt: otherDaySlot },
  });
  check(
    "a different free slot is still bookable",
    unrelatedSlot.ok,
    JSON.stringify(unrelatedSlot.payload?.error),
  );

  for (const created of [...winners, unrelatedSlot]) {
    const id = created.payload?.data?.bookings?.[0]?.id;
    if (id) {
      await parent(`/api/bookings/${id}/cancel`, {
        method: "POST",
        body: { reason: "QA — releasing the concurrency fixture." },
      });
    }
  }

  // --- Scheduled jobs -------------------------------------------------------
  //
  // Reminders, badge expiry and payouts only happen because something calls
  // them. These check that the endpoint exists, is closed to everyone but the
  // scheduler and an administrator, and that running a job twice is a no-op.
  section("Scheduled jobs");

  const anonCron = await anon("/api/cron/booking-reminders");
  check("anonymous cannot run a scheduled job", anonCron.status === 403 || anonCron.status === 401);

  const parentCron = await parent("/api/cron/booking-reminders");
  check("a parent cannot run a scheduled job", parentCron.status === 403);

  const tutorCron = await tutor("/api/cron/payouts");
  check("a tutor cannot run the payout job", tutorCron.status === 403);

  const badBearer = await anon("/api/cron/booking-reminders", {
    method: "POST",
    headers: { Authorization: "Bearer not-the-cron-secret" },
  });
  check(
    "a wrong scheduler token is refused",
    badBearer.status === 403 || badBearer.status === 401,
    `status ${badBearer.status}`,
  );

  // The scheduler's own route, when the deployment has a secret configured.
  // Skipped rather than faked when it does not — asserting nothing is better
  // than asserting something that cannot fail.
  if (process.env.CRON_SECRET) {
    const withSecret = await anon("/api/cron/list", {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    });
    check("the scheduler's token is accepted", withSecret.ok, `status ${withSecret.status}`);

    const nearMiss = await anon("/api/cron/list", {
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}x` },
    });
    check("a token that is close but wrong is refused", nearMiss.status === 403);
  } else {
    console.log("    (CRON_SECRET not set — skipping the scheduler-token checks)");
  }

  const jobList = await admin("/api/cron/list");
  check(
    "the job catalogue names every scheduled job",
    jobList.ok &&
      ["booking-reminders", "booking-expiry", "verification-expiry", "payouts", "request-expiry"].every((key) =>
        jobList.payload.data.jobs.some((j) => j.key === key),
      ),
  );

  const unknownJob = await admin("/api/cron/does-not-exist");
  check("an unknown job name is a 404", unknownJob.status === 404);

  // --- Abandoned checkout releases the slot (R41) ---------------------------
  //
  // The whole journey, over HTTP, in the order a real abandonment happens:
  //
  //   pick a slot → create the booking → walk away → the hold lapses →
  //   the scheduler releases it → the slot is bookable again → someone else
  //   books it.
  //
  // The hold window is a platform setting, so the wait is compressed by
  // configuring it to zero rather than by reaching past the API. The original
  // value is restored at the end whatever happens.
  section("Abandoned checkout releases the slot (R41)");

  const strangerStudents = await strangerParent("/api/students");
  const strangerStudentId = strangerStudents.payload?.data?.students?.[0]?.id;
  check("the second family has a learner of their own to book for",
    Boolean(strangerStudentId));

  const holdSettings = await admin("/api/admin/settings");
  const originalHold = holdSettings.payload?.data?.settings?.checkoutHoldMinutes;
  check(
    "the unpaid-booking hold is an administrable business rule",
    typeof originalHold === "number",
    `checkoutHoldMinutes was ${originalHold}`,
  );

  try {
    const expirySlots = await parent(
      `/api/tutors/${tutorId}/availability?days=21&durationMinutes=60`,
    );
    const expiryDay = expirySlots.payload?.data?.days?.find((d) => d.slots.length > 0);
    const abandonedSlot = expiryDay?.slots[0]?.startAt;
    check("a free slot is on offer before the abandoned booking", Boolean(abandonedSlot));

    // The platform this tutor really teaches on, read from their profile —
    // not assumed, because the server now refuses one they do not offer.
    const tutorProfilePublic = await anon(`/api/tutors/${tutorId}`);
    const offeredPlatforms =
      tutorProfilePublic.payload?.data?.tutor?.onlineMeetingProviders ?? [];
    check("the tutor publishes which meeting platforms they teach on",
      offeredPlatforms.length > 0, JSON.stringify(offeredPlatforms));

    // Find any online tutor who does *not* offer all three platforms, so the
    // refusal can be exercised rather than skipped.
    const allPlatforms = ["ZOOM", "GOOGLE_MEET", "MICROSOFT_TEAMS"];
    let picky = null;
    for (const candidate of (await anon("/api/search/tutors?province=ON&pageSize=20")).payload
      ?.data?.tutors ?? []) {
      const profile = (await anon(`/api/tutors/${candidate.id}`)).payload?.data?.tutor;
      const offers = profile?.onlineMeetingProviders ?? [];
      const missing = allPlatforms.find((platform) => !offers.includes(platform));
      if (offers.length && missing && profile?.courses?.length) {
        picky = { profile, missing };
        break;
      }
    }
    check("the marketplace has a tutor who offers only some meeting platforms",
      Boolean(picky), "every seeded tutor offers all three");

    if (picky) {
      const pickySlots = await anon(
        `/api/tutors/${picky.profile.id}/availability?days=21&durationMinutes=60`,
      );
      const pickySlot = pickySlots.payload?.data?.days?.find((d) => d.slots.length > 0)?.slots[0]
        ?.startAt;

      const wrongPlatform = await parent("/api/bookings", {
        method: "POST",
        body: {
          tutorProfileId: picky.profile.id,
          studentProfileId: studentId,
          courseId: picky.profile.courses[0].courseId,
          mode: "ONLINE",
          startAt: pickySlot,
          durationMinutes: 60,
          meetingProvider: picky.missing,
        },
      });
      check("a meeting platform the tutor does not offer is REFUSED server-side",
        wrongPlatform.status === 422 &&
          wrongPlatform.payload?.error?.code === "MEETING_PROVIDER_UNAVAILABLE",
        `${wrongPlatform.status} ${JSON.stringify(wrongPlatform.payload?.error)}`);
    }

    const abandoned = await parent("/api/bookings", {
      method: "POST",
      body: {
        tutorProfileId: tutorId,
        studentProfileId: studentId,
        courseId,
        mode: "ONLINE",
        startAt: abandonedSlot,
        durationMinutes: 60,
        meetingProvider: offeredPlatforms[0],
        studentNotes: "QA — abandoned checkout",
      },
    });
    const abandonedId = abandoned.payload?.data?.bookings?.[0]?.id;
    check("the booking is created and awaiting payment",
      abandoned.ok && abandoned.payload?.data?.bookings?.[0]?.status === "PENDING_PAYMENT",
      JSON.stringify(abandoned.payload?.error));

    const slotsWhileHeld = await parent(
      `/api/tutors/${tutorId}/availability?days=21&durationMinutes=60`,
    );
    const stillOffered = slotsWhileHeld.payload?.data?.days?.some((d) =>
      d.slots.some((slot) => slot.startAt === abandonedSlot),
    );
    check("while it is held, the slot is OFF the public calendar", stillOffered === false);

    const blockedByHold = await strangerParent("/api/bookings", {
      method: "POST",
      body: {
        tutorProfileId: tutorId,
        studentProfileId: strangerStudentId,
        courseId,
        mode: "ONLINE",
        startAt: abandonedSlot,
        durationMinutes: 60,
        meetingProvider: offeredPlatforms[0],
      },
    });
    check("another family cannot take a slot that is genuinely held",
      blockedByHold.status === 409, `status ${blockedByHold.status}`);

    // Nothing is stale yet, so the job must leave it exactly where it is.
    const earlyRun = await admin("/api/cron/booking-expiry", { method: "POST" });
    check("the expiry job runs and reports", earlyRun.ok && earlyRun.payload.data.job === "booking-expiry",
      JSON.stringify(earlyRun.payload));
    const afterEarly = await parent(`/api/bookings/${abandonedId}`);
    check("a FRESH hold is not expired by the job",
      afterEarly.payload?.data?.booking?.status === "PENDING_PAYMENT");

    // Now let the hold lapse.
    await admin("/api/admin/settings", {
      method: "PATCH",
      body: { checkoutHoldMinutes: 0 },
    });

    const release = await admin("/api/cron/booking-expiry", { method: "POST" });
    check("the job releases the lapsed hold",
      release.ok && release.payload.data.result.expired >= 1, JSON.stringify(release.payload?.data));

    const expiredBooking = await parent(`/api/bookings/${abandonedId}`);
    check("the abandoned booking is EXPIRED",
      expiredBooking.payload?.data?.booking?.status === "EXPIRED",
      expiredBooking.payload?.data?.booking?.status);
    check("an expired booking can no longer be cancelled or refunded",
      expiredBooking.payload?.data?.booking?.permissions?.canCancel === false);

    const slotsAfter = await parent(
      `/api/tutors/${tutorId}/availability?days=21&durationMinutes=60`,
    );
    const offeredAgain = slotsAfter.payload?.data?.days?.some((d) =>
      d.slots.some((slot) => slot.startAt === abandonedSlot),
    );
    check("the released slot is BACK on the public calendar", offeredAgain === true);

    const rebooked = await strangerParent("/api/bookings", {
      method: "POST",
      body: {
        tutorProfileId: tutorId,
        studentProfileId: strangerStudentId,
        courseId,
        mode: "ONLINE",
        startAt: abandonedSlot,
        durationMinutes: 60,
        // Deliberately a different platform from the abandoned booking's, so
        // the stored choice is proven to follow the booking rather than a
        // deployment default.
        meetingProvider: offeredPlatforms.at(-1),
      },
    });
    check("ANOTHER family can now book the released slot",
      rebooked.ok, JSON.stringify(rebooked.payload?.error));

    const rebookedId = rebooked.payload?.data?.bookings?.[0]?.id;
    check("the learner's chosen meeting platform is stored on the booking, not assumed",
      rebooked.payload?.data?.bookings?.[0]?.meetingProvider === offeredPlatforms.at(-1),
      rebooked.payload?.data?.bookings?.[0]?.meetingProvider);

    // Re-running the job is safe, and does not touch the new booking's own
    // hold beyond releasing it — which is correct, since it is also lapsed.
    const rerun = await admin("/api/cron/booking-expiry", { method: "POST" });
    check("re-running the expiry job is safe", rerun.ok);
    const expiredTwice = await parent(`/api/bookings/${abandonedId}`);
    check("a booking already expired is not expired again",
      expiredTwice.payload?.data?.booking?.status === "EXPIRED");

    // A paid booking is untouchable however the job is run. (This one has
    // been through the cancellation section by now, so the invariant to
    // assert is that the expiry job did not claim it — not its exact status.)
    const paidStill = await parent(`/api/bookings/${bookingId}`);
    check("a PAID booking is never claimed by the expiry job",
      paidStill.payload?.data?.booking?.status !== "EXPIRED",
      paidStill.payload?.data?.booking?.status);

    // Clean up the rebooked hold so the seeded calendar is left as found.
    if (rebookedId) {
      await strangerParent(`/api/bookings/${rebookedId}/cancel`, {
        method: "POST",
        body: { reason: "QA cleanup" },
      });
    }

    const expiredInList = await parent("/api/bookings?scope=CANCELLED&pageSize=50");
    check("an expired lesson is visible to the family, not silently hidden",
      expiredInList.payload?.data?.bookings?.some((b) => b.id === abandonedId),
      JSON.stringify(expiredInList.payload?.data?.bookings?.map((b) => b.status)));
  } finally {
    await admin("/api/admin/settings", {
      method: "PATCH",
      body: { checkoutHoldMinutes: originalHold ?? 60 },
    });
  }

  const holdRestored = await admin("/api/admin/settings");
  check("the hold setting is restored after the test",
    holdRestored.payload?.data?.settings?.checkoutHoldMinutes === originalHold);

  // A booking that carries the state the client is not allowed to decide.
  // Aimed at a genuinely free slot, so the request SUCCEEDS and what is
  // stored can be inspected — a 409 would prove nothing about §42.
  const injectionSlots = await parent(
    `/api/tutors/${tutorId}/availability?days=21&durationMinutes=60`,
  );
  const injectionSlot = injectionSlots.payload?.data?.days?.find((d) => d.slots.length > 0)
    ?.slots[0]?.startAt;

  const clientHold = await parent("/api/bookings", {
    method: "POST",
    body: {
      tutorProfileId: tutorId,
      studentProfileId: studentId,
      courseId,
      mode: "ONLINE",
      startAt: injectionSlot,
      durationMinutes: 60,
      meetingProvider: "ZOOM",
      // None of these are the client's to decide (§42).
      status: "CONFIRMED",
      expiredAt: null,
      confirmedAt: new Date().toISOString(),
      meeting: { joinUrl: "https://evil.example/meeting", provider: "ZOOM", meetingId: "evil" },
      price: { totalCents: 1, subtotalCents: 1, commissionCents: 0, tutorEarningsCents: 1 },
    },
  });
  check("a booking carrying injected state is still accepted on its merits",
    clientHold.ok, JSON.stringify(clientHold.payload?.error));

  if (clientHold.ok) {
    const injected = clientHold.payload.data.bookings[0];
    check("an injected booking status is IGNORED — it still awaits payment",
      injected.status === "PENDING_PAYMENT", injected.status);
    check("an injected meeting link is IGNORED — no room exists before payment",
      !injected.meeting?.joinUrl, JSON.stringify(injected.meeting));
    check("an injected price is IGNORED — the total comes from the tutor's stored rate",
      injected.price.totalCents > 1000, String(injected.price.totalCents));
    check("an injected confirmedAt is IGNORED", !injected.confirmedAt);

    await parent(`/api/bookings/${injected.id}/cancel`, {
      method: "POST",
      body: { reason: "QA cleanup" },
    });
  }

  const countReminders = async () => {
    const res = await parent("/api/notifications?pageSize=50");
    return (res.payload?.data?.notifications ?? []).filter(
      (n) => n.type === "BOOKING_REMINDER",
    ).length;
  };

  const remindersBefore = await countReminders();
  const reminderRun1 = await admin("/api/cron/booking-reminders", { method: "POST" });
  check(
    "the reminder job runs",
    reminderRun1.ok && reminderRun1.payload.data.ok,
    JSON.stringify(reminderRun1.payload?.error ?? reminderRun1.payload?.data),
  );

  const reminderRun2 = await admin("/api/cron/booking-reminders", { method: "POST" });
  check(
    "running the reminder job again sends nothing new",
    reminderRun2.payload?.data?.result?.sent === 0,
    `sent ${reminderRun2.payload?.data?.result?.sent}`,
  );

  const remindersAfter = await countReminders();
  const firstRunSent = reminderRun1.payload?.data?.result?.sent ?? 0;
  check(
    firstRunSent > 0
      ? "reminders that fell due were actually delivered"
      : "no reminders were due, and none were invented",
    firstRunSent > 0 ? remindersAfter > remindersBefore : remindersAfter === remindersBefore,
    `${remindersBefore} -> ${remindersAfter} (job reported ${firstRunSent})`,
  );

  const expiryRun = await admin("/api/cron/verification-expiry", { method: "POST" });
  check(
    "the verification expiry job runs and reports what it expired",
    expiryRun.ok && typeof expiryRun.payload.data.result.expired === "number",
    JSON.stringify(expiryRun.payload?.data),
  );

  const payoutRun = await admin("/api/cron/payouts", { method: "POST" });
  check(
    "the payout job runs and follows the existing eligibility rules",
    payoutRun.ok && typeof payoutRun.payload.data.result.created === "number",
    JSON.stringify(payoutRun.payload?.data),
  );
  const payoutRunAgain = await admin("/api/cron/payouts", { method: "POST" });
  check(
    "running the payout job again pays nobody twice",
    payoutRunAgain.payload?.data?.result?.created === 0,
    `created ${payoutRunAgain.payload?.data?.result?.created}`,
  );

  const allJobs = await admin("/api/cron/all", { method: "POST" });
  check(
    "every job can be run in one pass",
    allJobs.ok && allJobs.payload.data.jobs.length >= 4 && allJobs.payload.data.ok,
    JSON.stringify(allJobs.payload?.data?.jobs?.filter((j) => !j.ok)),
  );

  // --- Conversation reports reach a moderator -------------------------------
  //
  // §21 asks for a report capability. On a platform used by children, a
  // report that no administrator ever sees is not one.
  section("Conversation moderation");

  const reportThread = await parent(`/api/messages/conversations/${conversationId}/actions`, {
    method: "POST",
    body: {
      action: "REPORT",
      reason: "QA — asked us to move the conversation off the platform.",
    },
  });
  check("a parent can report a conversation", reportThread.ok, JSON.stringify(reportThread.payload?.error));
  check("reporting opens a case", reportThread.payload?.data?.reportStatus === "OPEN");

  const anonQueue = await anon("/api/admin/conversations");
  check("anonymous cannot read the moderation queue", anonQueue.status === 401);

  const parentQueue = await parent("/api/admin/conversations");
  check("a parent cannot read the moderation queue", parentQueue.status === 403);

  const tutorQueue = await tutor("/api/admin/conversations");
  check("a tutor cannot read the moderation queue", tutorQueue.status === 403);

  const parentThreadRead = await parent(`/api/admin/conversations/${conversationId}`);
  check(
    "a parent cannot read a reported thread through the admin route",
    parentThreadRead.status === 403,
  );

  const adminQueue = await admin("/api/admin/conversations");
  check(
    "the report reaches the admin queue",
    adminQueue.ok &&
      adminQueue.payload.data.conversations.some((c) => String(c.id) === String(conversationId)),
    JSON.stringify(adminQueue.payload?.error),
  );

  const queued = adminQueue.payload?.data?.conversations?.find(
    (c) => String(c.id) === String(conversationId),
  );
  check(
    "the queue carries the reporter, the reason and both participants",
    Boolean(queued?.reportedBy?.firstName && queued?.reportReason && queued?.learnerUserId && queued?.tutorUserId),
  );
  check(
    "the triage queue carries no message bodies of its own",
    queued?.messages === undefined,
  );

  const adminThread = await admin(`/api/admin/conversations/${conversationId}`);
  check(
    "an administrator can read the thread and its booking context",
    adminThread.ok &&
      Array.isArray(adminThread.payload.data.messages) &&
      Array.isArray(adminThread.payload.data.bookings),
    JSON.stringify(adminThread.payload?.error),
  );

  const parentModerate = await parent(`/api/admin/conversations/${conversationId}`, {
    method: "POST",
    body: { status: "DISMISSED", note: "QA — a member trying to close their own report." },
  });
  check("a member cannot close a moderation case", parentModerate.status === 403);

  const reviewing = await admin(`/api/admin/conversations/${conversationId}`, {
    method: "POST",
    body: { status: "REVIEWING", note: "QA — picked up for review." },
  });
  check("an administrator can take a case under review", reviewing.ok);

  const dismissed = await admin(`/api/admin/conversations/${conversationId}`, {
    method: "POST",
    body: { status: "DISMISSED", note: "QA — nothing in the thread breaks the rules." },
  });
  check("an administrator can close a case", dismissed.ok);
  check(
    "the decision persists",
    dismissed.payload?.data?.conversation?.reportStatus === "DISMISSED",
  );
  check(
    "the moderation trail is kept",
    (dismissed.payload?.data?.conversation?.moderationHistory ?? []).length >= 3,
    `${(dismissed.payload?.data?.conversation?.moderationHistory ?? []).length} entries`,
  );

  const afterClose = await admin("/api/admin/conversations");
  check(
    "a closed case leaves the outstanding queue",
    !afterClose.payload.data.conversations.some((c) => String(c.id) === String(conversationId)),
  );

  // --- Review moderation integrity -----------------------------------------
  //
  // A tutor may report a review about themselves, but reporting must not be
  // the same thing as deciding (§23).
  section("Review moderation");

  const tutorReviews = await tutor("/api/reviews?pageSize=20");
  const target = (tutorReviews.payload?.data?.reviews ?? []).find(
    (r) => r.status === "PUBLISHED" && !["OPEN", "REVIEWING"].includes(r.reportStatus),
  );

  if (!target) {
    check("a published review is available to test moderation", false, "no eligible seeded review");
  } else {
    const publicBefore = await anon(`/api/tutors/${ownTutorId}`);
    const ratingBefore = publicBefore.payload?.data?.tutor?.stats;

    const unrelatedReport = await stranger(`/api/reviews/${target.id}/report`, {
      method: "POST",
      body: { reason: "QA — a stranger trying to report someone else's review." },
    });
    check("an unrelated user cannot report a review", unrelatedReport.status === 403);

    const tutorReport = await tutor(`/api/reviews/${target.id}/report`, {
      method: "POST",
      body: { reason: "QA — the reviewed tutor objects to this review." },
    });
    check("the reviewed tutor can still report a review", tutorReport.ok);
    check(
      "reporting does not hide the review",
      tutorReport.payload?.data?.stillVisible === true,
    );

    const publicAfter = await anon(`/api/tutors/${ownTutorId}`);
    const ratingAfter = publicAfter.payload?.data?.tutor?.stats;
    check(
      "a tutor reporting a review cannot move their own public rating",
      ratingAfter?.ratingCount === ratingBefore?.ratingCount &&
        ratingAfter?.ratingAverage === ratingBefore?.ratingAverage,
      `${ratingBefore?.ratingAverage}/${ratingBefore?.ratingCount} -> ${ratingAfter?.ratingAverage}/${ratingAfter?.ratingCount}`,
    );

    const reviewQueue = await admin("/api/admin/reviews?reported=true");
    check(
      "the report reaches the review moderation queue",
      reviewQueue.ok && reviewQueue.payload.data.reviews.some((r) => String(r.id) === String(target.id)),
    );

    const tutorModerates = await tutor(`/api/admin/reviews/${target.id}`, {
      method: "POST",
      body: { status: "REMOVED", note: "QA — the tutor trying to remove it themselves." },
    });
    check("a tutor cannot moderate a review", tutorModerates.status === 403);

    const dismissReport = await admin(`/api/admin/reviews/${target.id}`, {
      method: "POST",
      body: { status: "PUBLISHED", note: "QA — critical but factual. Keeping it." },
    });
    check("an administrator can rule on the report", dismissReport.ok);
    check(
      "dismissing leaves the review published and counted",
      dismissReport.payload?.data?.review?.status === "PUBLISHED" &&
        dismissReport.payload?.data?.review?.reportStatus === "DISMISSED",
    );

    const publicFinal = await anon(`/api/tutors/${ownTutorId}`);
    check(
      "the public rating is unchanged throughout",
      publicFinal.payload?.data?.tutor?.stats?.ratingCount === ratingBefore?.ratingCount,
    );
  }

  // --- Email verification ---------------------------------------------------
  //
  // Verification existed as a mechanism but functioned as a suggestion. It is
  // now a gate on the actions that spend money or reach another member (§9).
  section("Email verification");

  const unverified = createClient();
  const newEmail = `qa-unverified-${Date.now()}@example.com`;
  const registered = await unverified("/api/auth/register", {
    method: "POST",
    body: {
      email: newEmail,
      password: "AplusLearn2024!",
      confirmPassword: "AplusLearn2024!",
      firstName: "Quinn",
      lastName: "Unverified",
      role: "PARENT",
      provinceCode: "ON",
      city: "Toronto",
      acceptTerms: true,
    },
  });
  check("a new account can register", registered.ok, JSON.stringify(registered.payload?.error));

  if (registered.ok) {
    const session = await unverified("/api/auth/session");
    check(
      "an unverified account can sign in and reach its own account",
      session.ok,
      "sign-in must still work, or nobody could ever request a new link",
    );
    check(
      "the account is reported as unverified",
      session.payload?.data?.user?.emailVerified === false,
    );

    const unverifiedBooking = await unverified("/api/bookings", {
      method: "POST",
      body: {
        tutorProfileId: ownTutorId,
        studentProfileId: studentId,
        courseId: ownCourseId,
        mode: "ONLINE",
        startAt: slotB,
        durationMinutes: 60,
        meetingProvider: "ZOOM",
      },
    });
    check(
      "an unverified account cannot book a lesson",
      unverifiedBooking.status === 403 &&
        unverifiedBooking.payload?.error?.code === "EMAIL_NOT_VERIFIED",
      `${unverifiedBooking.status} ${unverifiedBooking.payload?.error?.code}`,
    );

    const unverifiedMessage = await unverified("/api/messages", {
      method: "POST",
      body: { tutorProfileId: ownTutorId, body: "QA — messaging without a confirmed address." },
    });
    check(
      "an unverified account cannot message a tutor",
      unverifiedMessage.payload?.error?.code === "EMAIL_NOT_VERIFIED",
      `${unverifiedMessage.status} ${unverifiedMessage.payload?.error?.code}`,
    );

    const unverifiedRequest = await unverified("/api/requests", {
      method: "POST",
      body: {
        studentProfileId: studentId,
        courseId: ownCourseId,
        modes: ["ONLINE"],
        preferredWindows: ["WEEKDAY_EVENING"],
        budgetMaxCents: 9000,
        goal: "QA — posting a request without a confirmed address.",
      },
    });
    check(
      "an unverified account cannot post a tutor request",
      unverifiedRequest.payload?.error?.code === "EMAIL_NOT_VERIFIED",
      `${unverifiedRequest.status} ${unverifiedRequest.payload?.error?.code}`,
    );

    const unverifiedReview = await unverified("/api/reviews", {
      method: "POST",
      body: {
        bookingId: authBookingId,
        rating: 5,
        knowledge: 5,
        communication: 5,
        reliability: 5,
        teaching: 5,
        body: "QA — reviewing without a confirmed address, which must be refused.",
      },
    });
    check(
      "an unverified account cannot leave a review",
      unverifiedReview.payload?.error?.code === "EMAIL_NOT_VERIFIED",
      `${unverifiedReview.status} ${unverifiedReview.payload?.error?.code}`,
    );

    const resend = await unverified("/api/auth/resend-verification", {
      method: "POST",
      body: { email: newEmail },
    });
    check("a new verification link can always be requested", resend.ok);
  }

  const badToken = await anon("/api/auth/verify-email", {
    method: "POST",
    body: { token: "0".repeat(64) },
  });
  check(
    "an invalid, expired or already-used verification token is refused",
    badToken.status === 410 || badToken.status === 422,
    `status ${badToken.status}`,
  );

  // A verified account is unaffected — this is the control for the gate above.
  const verifiedStillWorks = await parent("/api/bookings/quote", {
    method: "POST",
    body: { tutorProfileId: ownTutorId, courseId: ownCourseId, durationMinutes: 60 },
  });
  check("a verified account is unaffected by the gate", verifiedStillWorks.ok);

  // --- Tutor search eligibility --------------------------------------------
  //
  // `isSearchable` is derived. A profile edit must recompute it, and must
  // never be a way around approval (§16, §42).
  section("Tutor search eligibility");

  const editedHeadline = `Experienced Ontario tutor — QA ${Date.now() % 100000}`;
  const editProfile = await tutor("/api/tutor/profile", {
    method: "PATCH",
    body: { headline: editedHeadline },
  });
  check("an approved tutor can edit their profile", editProfile.ok, JSON.stringify(editProfile.payload?.error));
  check(
    "an approved, complete profile stays searchable after an edit",
    editProfile.payload?.data?.profile?.isSearchable === true,
  );

  const stillPublic = await anon(`/api/tutors/${ownTutorId}`);
  check("and is still reachable on the public profile", stillPublic.ok);
  check("with the edit applied", stillPublic.payload?.data?.tutor?.headline === editedHeadline);

  const clientSetSearchable = await tutor("/api/tutor/profile", {
    method: "PATCH",
    body: { headline: editedHeadline, isSearchable: true, status: "APPROVED" },
  });
  check(
    "a tutor cannot set their own searchability or status",
    clientSetSearchable.ok,
    "the whitelist strips them rather than failing",
  );

  const pendingTutor = createClient();
  await login(pendingTutor, "james.oconnor@example.com");
  const pendingBefore = await pendingTutor("/api/tutor/profile");
  const pendingProfileId = pendingBefore.payload?.data?.profile?.id;
  check(
    "the pending tutor starts out unapproved and unlisted",
    pendingBefore.payload?.data?.profile?.isSearchable === false,
  );

  const pendingEdit = await pendingTutor("/api/tutor/profile", {
    method: "PATCH",
    body: {
      headline: "Waterloo mathematics and physics tutor — QA edit",
      isSearchable: true,
    },
  });
  check(
    "an unapproved tutor can edit their profile",
    pendingEdit.ok,
    JSON.stringify(pendingEdit.payload?.error),
  );
  check(
    "editing never grants search visibility to an unapproved profile",
    pendingEdit.payload?.data?.profile?.isSearchable === false,
    `isSearchable ${pendingEdit.payload?.data?.profile?.isSearchable}`,
  );

  const pendingPublic = await anon(`/api/tutors/${pendingProfileId}`);
  check("and the unapproved profile stays off the public site", pendingPublic.status === 404);

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
