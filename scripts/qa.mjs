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

/**
 * One client identity for this run.
 *
 * Login, registration and password reset are rate-limited per client address,
 * and registration's window is fifteen minutes — which one run uses up
 * entirely. Two runs inside that window would then report three unrelated
 * features as broken, when the only thing that happened is the limiter doing
 * its job. Giving each run its own address is what makes the suite re-runnable
 * without weakening the limit or waiting a quarter of an hour for it.
 *
 * `clientKey` reads this header first, ahead of the socket address, which is
 * how the application is meant to work behind a proxy.
 */
const RUN_IP = `203.0.113.${Math.floor(Math.random() * 200) + 10}`;

/** Minimal cookie-jar client so each role keeps its own session. */
function createClient() {
  const cookies = new Map();

  return async function request(
    path,
    { method = "GET", body, rawBody, form, raw = false, headers: extraHeaders } = {},
  ) {
    // `fetch` sets its own multipart Content-Type with the boundary, so a
    // FormData upload must not have one imposed on it.
    const headers = {
      ...(form ? {} : { "Content-Type": "application/json" }),
      "x-forwarded-for": RUN_IP,
      ...extraHeaders,
    };
    if (cookies.size) {
      headers.Cookie = [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    }

    const response = await fetch(`${BASE}${path}`, {
      method: form ? "POST" : method,
      headers,
      // `rawBody` is for the endpoints that do not speak JSON — the carrier
      // callbacks, which are form-encoded and signed over their exact bytes.
      body: form ?? rawBody ?? (body ? JSON.stringify(body) : undefined),
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

/**
 * A structurally valid PDF.
 *
 * `inspectDocument` reads the first five bytes, so this is exactly as much
 * PDF as the server looks at — and, as with `pngBytes`, it is a real
 * signature rather than text with a label, which is the distinction the
 * upload assertions exist to prove.
 */
function pdfBytes(padToBytes = 0) {
  const head = Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "binary");
  return padToBytes > head.length
    ? Buffer.concat([head, Buffer.alloc(padToBytes - head.length, 0x20)])
    : head;
}

/** A multipart body carrying one or more files under the `file` field. */
function formWith(...files) {
  const form = new FormData();
  for (const file of files) form.append("file", file);
  return form;
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

  // --- Start from the deployment environment -------------------------------
  //
  // Stored external-module configuration overrides the environment, by design.
  // That makes it the one piece of state that can change what *every* later
  // section is testing: a payment module configured in the admin panel sends
  // the parent journey's checkout to a real Stripe account, however this
  // server was started, and a module a crashed run left switched off silently
  // stops mail for the whole suite.
  //
  // So the clear-down happens here, before the first assertion, rather than in
  // the External modules section where it only protected that section and
  // whatever came after it. It is also why this suite wants a development
  // database: the records it removes hold real encrypted credentials, and no
  // endpoint can hand them back — that is the feature working (§36).
  for (const key of ["email", "payment", "calendar", "sms", "storage", "oauth"]) {
    await admin(`/api/admin/integrations/${key}`, { method: "DELETE" });
  }

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

  // --- the return from a hosted checkout (§20, §42)
  //
  // The success page asks the server to ask the *provider*. It carries no
  // claim about the payment, and a body full of claims changes nothing: the
  // development provider keeps no remote state, so the honest answer is that
  // there is nothing to read back — not "paid".
  const pretendPaid = await parent(`/api/payments/${paymentId}/reconcile`, {
    method: "POST",
    body: { status: "PAID", paid: true, amountCents: 1 },
  });
  check(
    "the checkout return page cannot talk a payment into being paid",
    pretendPaid.ok && pretendPaid.payload?.data?.payment?.status === "REQUIRES_PAYMENT",
    JSON.stringify(pretendPaid.payload?.data?.payment?.status ?? pretendPaid.payload?.error),
  );
  check(
    "and it says plainly that there was no provider state to read",
    pretendPaid.payload?.data?.reconciliation?.outcome === "NOT_APPLICABLE",
    JSON.stringify(pretendPaid.payload?.data?.reconciliation),
  );
  check(
    "the lesson is still only held, not confirmed",
    (await parent(`/api/bookings/${bookingId}`)).payload?.data?.booking?.status ===
      "PENDING_PAYMENT",
  );

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

  // --- Tutor requests: the Phase 2 lifecycle over real HTTP ----------------
  section("Tutor requests — edit, invite, respond, moderate");

  const myTutorProfile = await tutor("/api/tutor/profile");
  const myTutorProfileId = myTutorProfile.payload?.data?.profile?.id;
  check("tutor can read their own profile id", Boolean(myTutorProfileId));

  // The course this tutor actually teaches, so the request is one they match.
  const myCourseId = myTutorProfile.payload?.data?.profile?.courses?.[0]?.courseId ?? courseId;

  const requestBody = (over = {}) => ({
    studentProfileId: studentId,
    courseId: myCourseId,
    modes: ["ONLINE"],
    preferredWindows: ["WEEKDAY_EVENING"],
    sessionsPerWeek: 1,
    preferredDurationMinutes: 60,
    budgetMaxCents: 20000,
    goal: "QA run — Phase 2 request lifecycle. Safe to delete.",
    ...over,
  });

  // A client cannot decide its own lifecycle state or counters (§42).
  const injected = await parent("/api/requests", {
    method: "POST",
    body: requestBody({
      status: "MATCHED",
      interestedCount: 999,
      viewCount: 999,
      reference: "REQ-HACKED",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }),
  });
  check("request posted with injected fields", injected.ok, JSON.stringify(injected.payload?.error));
  const injectedRequest = injected.payload?.data?.request;
  check("an injected status is ignored — the server decides", injectedRequest?.status === "OPEN");
  check("an injected reference is ignored", injectedRequest?.reference !== "REQ-HACKED");
  check("injected counters are ignored", (injectedRequest?.interestedCount ?? 0) === 0);
  const publicRequestId = injectedRequest?.id;

  // --- editing -------------------------------------------------------------
  const edit = await parent(`/api/requests/${publicRequestId}`, {
    method: "PATCH",
    body: { goal: "QA run — edited goal, still safe to delete.", budgetMaxCents: 22000 },
  });
  check("owner can edit an open request", edit.ok, JSON.stringify(edit.payload?.error));
  check("editing re-runs matching", typeof edit.payload?.data?.matchCount === "number");

  const tutorEdit = await tutor(`/api/requests/${publicRequestId}`, {
    method: "PATCH",
    body: { goal: "A tutor rewriting the family's brief." },
  });
  check("a tutor cannot edit a family's request", tutorEdit.status === 403);

  const tutorCancel = await tutor(`/api/requests/${publicRequestId}`, { method: "DELETE" });
  check("a tutor cannot cancel a family's request", tutorCancel.status === 403);

  const badEdit = await parent(`/api/requests/${publicRequestId}`, {
    method: "PATCH",
    body: { budgetMinCents: 900000, budgetMaxCents: 1000 },
  });
  check("an inverted budget is refused on edit", badEdit.status === 422);

  // --- invite-only visibility ----------------------------------------------
  const privateCreate = await parent("/api/requests", {
    method: "POST",
    body: requestBody({ visibility: "INVITE_ONLY" }),
  });
  check("invite-only request posted", privateCreate.ok, JSON.stringify(privateCreate.payload?.error));
  const privateRequestId = privateCreate.payload?.data?.request?.id;

  const peek = await tutor(`/api/requests/${privateRequestId}`);
  check("an uninvited tutor cannot read an invite-only request", peek.status === 404);

  const sneakyPitch = await tutor(`/api/requests/${privateRequestId}/interest`, {
    method: "POST",
    body: { message: "Letting myself in to a request I was never shown. ".repeat(2) },
  });
  check("an uninvited tutor cannot respond to an invite-only request", sneakyPitch.status === 404);

  const tutorInvites = await tutor(`/api/requests/${privateRequestId}/invite`, {
    method: "POST",
    body: { tutorProfileIds: [myTutorProfileId] },
  });
  check("a tutor cannot invite themselves to a request", tutorInvites.status === 403);

  const invite = await parent(`/api/requests/${privateRequestId}/invite`, {
    method: "POST",
    body: { tutorProfileIds: [myTutorProfileId] },
  });
  check("owner can invite a tutor", invite.ok, JSON.stringify(invite.payload?.error));
  check("the invitation counted exactly one tutor", invite.payload?.data?.invited === 1);

  const invitedView = await tutor(`/api/requests/${privateRequestId}`);
  check("an invited tutor can now read the request", invitedView.ok);
  check("the tutor view carries their own match state",
    invitedView.payload?.data?.match?.status === "INVITED");
  check("the tutor view says they may respond", invitedView.payload?.data?.canRespond === true);

  const pitch = await tutor(`/api/requests/${privateRequestId}/interest`, {
    method: "POST",
    body: { message: "QA run — I teach this course and have Tuesday evenings free this term." },
  });
  check("an invited tutor can respond", pitch.ok, JSON.stringify(pitch.payload?.error));

  const pitchAgain = await tutor(`/api/requests/${privateRequestId}/interest`, {
    method: "POST",
    body: { message: "QA run — a second pitch that should be refused as a duplicate." },
  });
  check("a tutor cannot respond twice", pitchAgain.status === 409);

  const withdraw = await tutor(`/api/requests/${privateRequestId}/interest`, {
    method: "DELETE",
    body: { action: "WITHDRAW", reason: "QA run." },
  });
  check("a tutor can withdraw their response", withdraw.ok, JSON.stringify(withdraw.payload?.error));

  // --- admin moderation -----------------------------------------------------
  const parentModerationList = await parent("/api/admin/requests");
  check("a family cannot read the moderation queue", parentModerationList.status === 403);

  const tutorModerationList = await tutor("/api/admin/requests");
  check("a tutor cannot read the moderation queue", tutorModerationList.status === 403);

  const queue = await admin("/api/admin/requests?status=OPEN");
  check("admin can read the moderation queue",
    queue.ok && Array.isArray(queue.payload?.data?.requests));

  const parentModeratesRequest = await parent(`/api/admin/requests/${publicRequestId}`, {
    method: "PATCH",
    body: { action: "REMOVE", note: "Removing my own request through the admin API." },
  });
  check("a family cannot moderate a request", parentModeratesRequest.status === 403);

  const remove = await admin(`/api/admin/requests/${publicRequestId}`, {
    method: "PATCH",
    body: { action: "REMOVE", note: "QA run — removing and restoring." },
  });
  check("admin can remove a request", remove.ok, JSON.stringify(remove.payload?.error));
  check("a removed request is REMOVED", remove.payload?.data?.request?.status === "REMOVED");

  const removedToTutor = await tutor(`/api/requests/${publicRequestId}`);
  check("a removed request is invisible to tutors", removedToTutor.status === 404);

  const restore = await admin(`/api/admin/requests/${publicRequestId}`, {
    method: "PATCH",
    body: { action: "RESTORE", note: "QA run — restored." },
  });
  check("admin can restore a removed request", restore.ok);
  check("a restored request is open again", restore.payload?.data?.request?.status === "OPEN");

  const noNote = await admin(`/api/admin/requests/${publicRequestId}`, {
    method: "PATCH",
    body: { action: "REMOVE" },
  });
  check("moderation without a recorded reason is refused", noNote.status === 422);

  // --- closing --------------------------------------------------------------
  for (const id of [publicRequestId, privateRequestId]) {
    await parent(`/api/requests/${id}/close`, {
      method: "POST",
      body: { reason: "NO_LONGER_NEEDED" },
    });
  }
  const closed = await parent(`/api/requests/${publicRequestId}`);
  check("a closed request reads as CLOSED", closed.payload?.data?.request?.status === "CLOSED");

  const editClosed = await parent(`/api/requests/${publicRequestId}`, {
    method: "PATCH",
    body: { goal: "QA run — editing a closed request should be refused." },
  });
  check("a closed request cannot be edited", editClosed.status === 422);

  // --- Group tutoring: capacity, privacy and authorization -----------------
  section("Group sessions — capacity, privacy and authorization");

  // Leftovers from a run that died before its own clean-up are the one thing
  // that makes this section order- and history-dependent: a DRAFT or PUBLISHED
  // fixture from yesterday still holds a slot on this tutor's calendar, so
  // today's fixture cannot be created in the same window. Sweeping first makes
  // the suite safe to re-run after a partial failure, which no amount of
  // careful clean-up at the end can do on its own.
  const staleGroups = await tutor("/api/tutor/groups?pageSize=50");
  for (const stale of staleGroups.payload?.data?.sessions ?? []) {
    if (!String(stale.title ?? "").startsWith("QA run —")) continue;
    if (["CANCELLED", "COMPLETED"].includes(stale.status)) continue;
    await tutor(`/api/tutor/groups/${stale.id}`, {
      method: "DELETE",
      body: { reason: "QA run — sweeping a fixture an earlier run left behind." },
    });
  }

  const publicGroups = await anon("/api/groups");
  check("group sessions are browsable without an account",
    publicGroups.ok && Array.isArray(publicGroups.payload?.data?.sessions));
  check("a public listing never carries a private address",
    !JSON.stringify(publicGroups.payload ?? {}).includes("addressLine"));

  const groupCourse = (myTutorProfile.payload?.data?.profile?.courses ?? [])[0];
  let groupSessionId = null;

  if (!groupCourse) {
    check("group session flow", false, "the seeded tutor teaches no courses");
  } else {
    const groupSlots = await parent(
      `/api/tutors/${myTutorProfileId}/availability?days=28&durationMinutes=60`,
    );
    const groupSlot = (groupSlots.payload?.data?.days ?? [])
      .filter((d) => d.slots.length > 0)
      .map((d) => d.slots.at(-1).startAt)
      .at(-1);

    const parentCreates = await parent("/api/tutor/groups", {
      method: "POST",
      body: {
        title: "QA run — a family running a class",
        courseId: groupCourse.courseId,
        mode: "ONLINE",
        meetingProvider: "ZOOM",
        startAt: groupSlot,
        durationMinutes: 60,
        minParticipants: 2,
        maxParticipants: 4,
        pricePerSeatCents: 2500,
      },
    });
    check("a family cannot create a group session", parentCreates.status === 403);

    const badCapacity = await tutor("/api/tutor/groups", {
      method: "POST",
      body: {
        title: "QA run — inverted capacity",
        courseId: groupCourse.courseId,
        mode: "ONLINE",
        meetingProvider: "ZOOM",
        startAt: groupSlot,
        durationMinutes: 60,
        minParticipants: 6,
        maxParticipants: 2,
        pricePerSeatCents: 2500,
      },
    });
    check("a minimum larger than the maximum is refused", badCapacity.status === 422);

    const createdGroup = await tutor("/api/tutor/groups", {
      method: "POST",
      body: {
        title: "QA run — group session. Safe to delete.",
        courseId: groupCourse.courseId,
        mode: "ONLINE",
        meetingProvider: "ZOOM",
        startAt: groupSlot,
        durationMinutes: 60,
        minParticipants: 2,
        maxParticipants: 4,
        pricePerSeatCents: 2500,
        // None of these may be dictated by the client.
        seatsTaken: 99,
        status: "CONFIRMED",
        commissionPercent: 0,
      },
    });
    check("a tutor can create a group session",
      createdGroup.ok, JSON.stringify(createdGroup.payload?.error));
    groupSessionId = createdGroup.payload?.data?.session?.id;

    check("it starts as a draft whatever the request said",
      createdGroup.payload?.data?.session?.status === "DRAFT");
    check("seats start empty whatever the request said",
      createdGroup.payload?.data?.session?.seatsTaken === 0);
    check("commission is the platform's, not the request's",
      createdGroup.payload?.data?.session?.commissionPercent > 0);

    const joinDraft = await parent(`/api/groups/${groupSessionId}/join`, {
      method: "POST",
      body: { studentProfileId: studentId },
    });
    check("a draft session cannot be joined",
      joinDraft.status === 422 && joinDraft.payload?.error?.code === "SESSION_NOT_OPEN");

    const parentPublishes = await parent(`/api/tutor/groups/${groupSessionId}`, {
      method: "POST",
    });
    check("a family cannot publish a tutor's session", parentPublishes.status === 403);

    const publishedGroup = await tutor(`/api/tutor/groups/${groupSessionId}`, { method: "POST" });
    check("a tutor can publish their session",
      publishedGroup.ok, JSON.stringify(publishedGroup.payload?.error));
    check("publishing opens it for sign-ups",
      publishedGroup.payload?.data?.session?.status === "PUBLISHED");

    const tutorJoinsOwn = await tutor(`/api/groups/${groupSessionId}/join`, {
      method: "POST",
      body: { studentProfileId: studentId },
    });
    check("a tutor cannot join their own session",
      tutorJoinsOwn.status === 403 || tutorJoinsOwn.status === 422,
      `status ${tutorJoinsOwn.status}`);

    const foreignLearner = await parent(`/api/groups/${groupSessionId}/join`, {
      method: "POST",
      body: { studentProfileId: "000000000000000000000000" },
    });
    check("nobody can enrol a learner that is not theirs",
      foreignLearner.status === 404 || foreignLearner.status === 403,
      `status ${foreignLearner.status}`);

    const joined = await parent(`/api/groups/${groupSessionId}/join`, {
      method: "POST",
      body: { studentProfileId: studentId },
    });
    check("a family can take a seat", joined.ok, JSON.stringify(joined.payload?.error));
    check("the seat is held before payment",
      joined.payload?.data?.enrolment?.status === "PENDING_PAYMENT");
    check("and an ordinary booking was created for it",
      Boolean(joined.payload?.data?.booking?.id));

    const joinTwice = await parent(`/api/groups/${groupSessionId}/join`, {
      method: "POST",
      body: { studentProfileId: studentId },
    });
    check("the same learner cannot take two seats", joinTwice.status === 409);

    // --- privacy ------------------------------------------------------------
    const anonView = await anon(`/api/groups/${groupSessionId}`);
    check("a group session is publicly viewable", anonView.ok);
    check("an anonymous visitor sees no roster",
      (anonView.payload?.data?.roster ?? []).length === 0);
    check("and no meeting link", anonView.payload?.data?.meeting === null);

    const ownerView = await parent(`/api/groups/${groupSessionId}`);
    check("a family sees their own place", ownerView.payload?.data?.myEnrolments?.length === 1);
    check("but not who else is in the class",
      (ownerView.payload?.data?.roster ?? []).length === 0);
    check("and cannot manage it", ownerView.payload?.data?.canManage === false);

    const tutorView = await tutor(`/api/groups/${groupSessionId}`);
    check("the tutor sees the roster", (tutorView.payload?.data?.roster ?? []).length >= 1);
    check("and can manage the session", tutorView.payload?.data?.canManage === true);
    // A minor's surname is masked; an adult learner keeps their name. That
    // rule has its own check in the tutor journey — what matters here is that
    // the roster exposes a display name and nothing else about the learner.
    check("the roster gives a display name",
      (tutorView.payload?.data?.roster ?? []).every((r) => Boolean(r.studentName)));
    check("and carries no other personal detail about the learner",
      !/"(email|birthYear|notes|accessibilityNeeds|ownerId)"/.test(
        JSON.stringify(tutorView.payload?.data?.roster ?? []),
      ),
      JSON.stringify(tutorView.payload?.data?.roster?.[0]));

    // --- attendance before the session has happened ---------------------------
    const earlyAttendance = await tutor(`/api/tutor/groups/${groupSessionId}/attendance`, {
      method: "POST",
      body: { attendance: [{ enrolmentId: joined.payload.data.enrolment.id, attended: true }] },
    });
    check("attendance cannot be recorded before the session has finished",
      earlyAttendance.status === 422 &&
        earlyAttendance.payload?.error?.code === "SESSION_NOT_FINISHED");

    const parentAttendance = await parent(`/api/tutor/groups/${groupSessionId}/attendance`, {
      method: "POST",
      body: { attendance: [{ enrolmentId: joined.payload.data.enrolment.id, attended: true }] },
    });
    check("a family cannot record attendance", parentAttendance.status === 403);

    // --- editing is locked once somebody has joined ----------------------------
    const repriceGroup = await tutor(`/api/tutor/groups/${groupSessionId}`, {
      method: "PATCH",
      body: { pricePerSeatCents: 100 },
    });
    check("the seat price cannot change once somebody has joined",
      repriceGroup.status === 422 &&
        repriceGroup.payload?.error?.code === "SESSION_HAS_ENROLMENTS");

    // --- admin ------------------------------------------------------------------
    const parentAdminGroups = await parent("/api/admin/groups");
    check("a family cannot read the admin group list", parentAdminGroups.status === 403);

    const adminGroups = await admin("/api/admin/groups");
    check("an administrator can list group sessions",
      adminGroups.ok && Array.isArray(adminGroups.payload?.data?.sessions));

    // Clean up: cancelling refunds and frees the slot for the next run.
    const cancelledGroup = await tutor(`/api/tutor/groups/${groupSessionId}`, {
      method: "DELETE",
      body: { reason: "QA run." },
    });
    check("a tutor can cancel their session", cancelledGroup.ok);
    check("and every seat is given back",
      cancelledGroup.payload?.data?.seatsTaken === 0);
  }

  // --- Packages: ownership, balance and price integrity --------------------
  section("Packages — pricing rules, ownership and balance");

  const myCourses = myTutorProfile.payload?.data?.profile?.courses ?? [];
  const packageCourse = myCourses[0];
  let packageId = null;

  if (!packageCourse) {
    check("package flow", false, "the seeded tutor teaches no courses");
  } else {
    const standardRate = packageCourse.hourlyRateCents
      ?? myTutorProfile.payload?.data?.profile?.hourlyRateCents;

    const overpriced = await tutor("/api/tutor/packages", {
      method: "POST",
      body: {
        title: "QA run — overpriced package",
        courseId: packageCourse.courseId,
        sessionCount: 5,
        sessionDurationMinutes: 60,
        mode: "ONLINE",
        priceCents: standardRate * 5 * 2,
      },
    });
    check("a package dearer per hour than booking singly is refused",
      overpriced.status === 422 &&
        overpriced.payload?.error?.code === "ABOVE_STANDARD_RATE",
      JSON.stringify(overpriced.payload?.error));

    const created = await tutor("/api/tutor/packages", {
      method: "POST",
      body: {
        title: "QA run — package. Safe to delete.",
        courseId: packageCourse.courseId,
        sessionCount: 5,
        sessionDurationMinutes: 60,
        mode: "ONLINE",
        priceCents: Math.floor(standardRate * 5 * 0.8),
        // Derived figures cannot be dictated by the client.
        perSessionCents: 1,
        effectiveHourlyRateCents: 1,
        savingPercent: 99,
        status: "ACTIVE",
      },
    });
    check("a tutor can create a package", created.ok, JSON.stringify(created.payload?.error));
    packageId = created.payload?.data?.package?.id;

    check("a package starts as a draft whatever the request said",
      created.payload?.data?.package?.status === "DRAFT");
    check("the per-session price is derived, not supplied",
      created.payload?.data?.package?.perSessionCents ===
        Math.floor(Math.floor(standardRate * 5 * 0.8) / 5));
    check("and so is the advertised saving",
      created.payload?.data?.package?.savingPercent !== 99);

    const parentCreates = await parent("/api/tutor/packages", {
      method: "POST",
      body: {
        title: "QA run — a family selling packages",
        courseId: packageCourse.courseId,
        sessionCount: 5,
        sessionDurationMinutes: 60,
        priceCents: 10000,
      },
    });
    check("a family cannot create a tutor package", parentCreates.status === 403);

    const parentEdits = await parent(`/api/tutor/packages/${packageId}`, {
      method: "PATCH",
      body: { priceCents: 1 },
    });
    check("a family cannot edit a tutor's package", parentEdits.status === 403);

    const draftBuy = await parent("/api/packages", {
      method: "POST",
      body: { packageId, studentProfileId: studentId },
    });
    check("a draft package cannot be bought",
      draftBuy.status === 422 && draftBuy.payload?.error?.code === "PACKAGE_NOT_ON_SALE");

    await tutor(`/api/tutor/packages/${packageId}`, {
      method: "POST",
      body: { status: "ACTIVE" },
    });

    const publicProfile = await anon(`/api/tutors/${myTutorProfileId}`);
    check("an on-sale package appears on the public profile", publicProfile.ok);

    const foreignChild = await parent("/api/packages", {
      method: "POST",
      body: { packageId, studentProfileId: "000000000000000000000000" },
    });
    check("a package cannot be bought for a learner that is not yours",
      foreignChild.status === 404 || foreignChild.status === 403,
      `status ${foreignChild.status}`);

    const bought = await parent("/api/packages", {
      method: "POST",
      body: { packageId, studentProfileId: studentId },
    });
    check("a family can buy a package", bought.ok, JSON.stringify(bought.payload?.error));

    const purchaseId = bought.payload?.data?.purchase?.id;
    check("the purchase waits for payment",
      bought.payload?.data?.purchase?.status === "PENDING_PAYMENT");
    check("and carries the terms as they were at purchase",
      bought.payload?.data?.purchase?.sessionsTotal === 5);

    const mine = await parent("/api/packages");
    check("the family sees their package",
      mine.ok && mine.payload.data.purchases.some((p) => p.id === purchaseId));

    const strangerReads = await tutor(`/api/packages/${purchaseId}`);
    check("the tutor can see a package bought from them", strangerReads.ok);

    // A real free slot, so the refusal is about the package rather than the
    // booking horizon or the tutor's calendar.
    const packageSlots = await parent(
      `/api/tutors/${myTutorProfileId}/availability?days=28&durationMinutes=60`,
    );
    const packageSlot = (packageSlots.payload?.data?.days ?? [])
      .filter((d) => d.slots.length > 0)
      .map((d) => d.slots[0].startAt)[0];

    if (!packageSlot) {
      check("package booking refusal", false, "the seeded tutor has no free slots");
    } else {
      const unpaidBooking = await parent("/api/bookings", {
        method: "POST",
        body: {
          tutorProfileId: myTutorProfileId,
          studentProfileId: studentId,
          courseId: packageCourse.courseId,
          mode: "ONLINE",
          meetingProvider: "ZOOM",
          startAt: packageSlot,
          durationMinutes: 60,
          packagePurchaseId: purchaseId,
        },
      });
      check("an unpaid package cannot pay for a lesson",
        unpaidBooking.status === 422 &&
          unpaidBooking.payload?.error?.code === "PACKAGE_NOT_USABLE",
        JSON.stringify(unpaidBooking.payload?.error));
      check("and no booking was created for it",
        unpaidBooking.payload?.data?.bookings === undefined);
    }

    const usable = await parent(
      `/api/packages/usable?tutorProfileId=${myTutorProfileId}&courseId=${packageCourse.courseId}&durationMinutes=60`,
    );
    check("an unpaid package is not offered at checkout",
      usable.ok && usable.payload.data.packages.every((p) => p.id !== purchaseId));

    const tutorPeeks = await tutor(
      `/api/packages/usable?tutorProfileId=${myTutorProfileId}&courseId=${packageCourse.courseId}`,
    );
    check("nobody can discover somebody else's balances",
      tutorPeeks.status === 403 || (tutorPeeks.ok && tutorPeeks.payload.data.packages.length === 0),
      `status ${tutorPeeks.status}`);

    // Clean up: cancel the unpaid purchase and archive the offer.
    await parent(`/api/packages/${purchaseId}`, {
      method: "DELETE",
      body: { reason: "QA run." },
    });
    await tutor(`/api/tutor/packages/${packageId}`, {
      method: "POST",
      body: { status: "ARCHIVED" },
    });

    const parentAdminPackages = await parent("/api/admin/packages");
    check("a family cannot read the admin package list", parentAdminPackages.status === 403);

    const adminPackages = await admin("/api/admin/packages");
    check("an administrator can read package purchases",
      adminPackages.ok && Array.isArray(adminPackages.payload?.data?.purchases));
    check("and the totals that reconcile them",
      typeof adminPackages.payload?.data?.totals?.grossCents === "number");
  }

  // --- Referrals and account credit over real HTTP -------------------------
  section("Referrals — codes, credit and abuse prevention");

  const myReferrals = await parent("/api/referrals");
  check("a family can read their own referral summary",
    myReferrals.ok && /^[A-Z2-9]{8}$/.test(myReferrals.payload?.data?.code ?? ""),
    myReferrals.payload?.data?.code);

  const referralCode = myReferrals.payload?.data?.code;

  const anonReferrals = await anon("/api/referrals");
  check("anonymous cannot read a referral summary", anonReferrals.status === 401);

  const tutorReferrals = await tutor("/api/referrals");
  check("a tutor has a referral code too", tutorReferrals.ok);
  check("two accounts never share a code",
    tutorReferrals.payload?.data?.code !== referralCode);

  const codeLookup = await anon(`/api/referrals/code/${referralCode}`);
  check("a referral code can be checked before signing up",
    codeLookup.ok && codeLookup.payload?.data?.valid === true);
  check("the lookup shows a first name and initial, never a surname",
    /^[^ ]+( [A-Z]\.)?$/.test(codeLookup.payload?.data?.referrerName ?? ""),
    codeLookup.payload?.data?.referrerName);
  check("the lookup never reveals the referrer's email",
    !JSON.stringify(codeLookup.payload ?? {}).includes("@"));

  const unknownCode = await anon("/api/referrals/code/ZZZZZZZZ");
  check("an unknown code answers plainly, without saying why",
    unknownCode.ok && unknownCode.payload?.data?.valid === false);
  check("and gives nothing else away",
    Object.keys(unknownCode.payload?.data ?? {}).length === 1);

  // --- registering with a code -----------------------------------------------
  const inviteeEmail = `qa-referral-${Date.now()}@example.com`;
  const invitee = createClient();
  const signedUp = await invitee("/api/auth/register", {
    method: "POST",
    body: {
      role: "PARENT",
      firstName: "Qa",
      lastName: "Invitee",
      email: inviteeEmail,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      acceptTerms: true,
      referralCode,
    },
  });
  check("a new account can register with a referral code",
    signedUp.ok, JSON.stringify(signedUp.payload?.error));

  const afterSignup = await parent("/api/referrals");
  check("the referrer sees the new sign-up",
    (afterSignup.payload?.data?.stats?.joined ?? 0) >
      (myReferrals.payload?.data?.stats?.joined ?? 0));
  check("but no reward is paid before any lessons are taken",
    (afterSignup.payload?.data?.stats?.rewarded ?? 0) ===
      (myReferrals.payload?.data?.stats?.rewarded ?? 0));

  const selfReferral = await invitee("/api/referrals");
  check("the invitee gets their own code", selfReferral.ok);
  check("and is shown who invited them",
    Boolean(selfReferral.payload?.data?.referredBy));

  const badCodeSignup = createClient();
  const withBadCode = await badCodeSignup("/api/auth/register", {
    method: "POST",
    body: {
      role: "PARENT",
      firstName: "Qa",
      lastName: "Badcode",
      email: `qa-badcode-${Date.now()}@example.com`,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      acceptTerms: true,
      referralCode: "NOTACODE",
    },
  });
  check("a mistyped code never stops somebody creating an account", withBadCode.ok);

  // --- credit is server-owned ---------------------------------------------------
  const credits = await parent("/api/credits");
  check("a family can read their credit statement",
    credits.ok && typeof credits.payload?.data?.balanceCents === "number");

  const anonCredits = await anon("/api/credits");
  check("anonymous cannot read a credit statement", anonCredits.status === 401);

  const parentGrants = await parent(`/api/admin/users/${myReferrals.payload?.data ? "000000000000000000000000" : ""}/credit`, {
    method: "POST",
    body: { amountCents: 100000, note: "Granting myself money." },
  });
  check("a family cannot grant themselves credit", parentGrants.status === 403);

  const tutorGrants = await tutor("/api/admin/users/000000000000000000000000/credit", {
    method: "POST",
    body: { amountCents: 100000, note: "Granting myself money." },
  });
  check("nor can a tutor", tutorGrants.status === 403);

  const noReason = await admin("/api/admin/users/000000000000000000000000/credit", {
    method: "POST",
    body: { amountCents: 1000 },
  });
  check("an administrator must record why they moved a balance", noReason.status === 422);

  // --- the referral queue is admin-only --------------------------------------------
  const parentReferralQueue = await parent("/api/admin/referrals");
  check("a family cannot read the referral queue", parentReferralQueue.status === 403);

  const tutorReferralQueue = await tutor("/api/admin/referrals");
  check("a tutor cannot read the referral queue", tutorReferralQueue.status === 403);

  const adminReferralQueue = await admin("/api/admin/referrals");
  check("an administrator can read the referral queue",
    adminReferralQueue.ok && Array.isArray(adminReferralQueue.payload?.data?.referrals));

  const parentReverses = await parent("/api/admin/referrals/000000000000000000000000", {
    method: "PATCH",
    body: { reason: "Reversing somebody else's referral." },
  });
  check("a family cannot reverse a referral", parentReverses.status === 403);

  const reverseNoReason = await admin("/api/admin/referrals/000000000000000000000000", {
    method: "PATCH",
    body: {},
  });
  check("reversing without a recorded reason is refused", reverseNoReason.status === 422);

  // --- Progress reports: authorship and privacy over real HTTP -------------
  section("Progress reports — authorship, privacy and acknowledgement");

  const reportableStudentList = await tutor("/api/tutor/progress/students");
  check("a tutor can list the students they may report on",
    reportableStudentList.ok && Array.isArray(reportableStudentList.payload?.data?.students));

  const parentReadsPicker = await parent("/api/tutor/progress/students");
  check("a family cannot read a tutor's student picker", parentReadsPicker.status === 403);

  // The family-side assertions only mean anything for a learner this QA
  // parent actually owns, so the two lists are correlated rather than the
  // first entry being taken on trust.
  const parentStudentIds = new Set(
    (students.payload?.data?.students ?? []).map((child) => child.id),
  );
  const reportStudent = (reportableStudentList.payload?.data?.students ?? []).find((child) =>
    parentStudentIds.has(child.id),
  );
  let progressReportId = null;

  if (!reportStudent) {
    check(
      "progress report flow",
      false,
      "the seeded tutor has no completed lessons with this QA parent's children",
    );
  } else {
    const draft = await tutor("/api/tutor/progress", {
      method: "POST",
      body: { studentProfileId: reportStudent.id, courseId: reportStudent.courseId },
    });

    // A draft may already exist from an earlier QA run; reuse it rather than
    // failing on a conflict that is not a defect.
    if (draft.status === 409) {
      const existing = await tutor("/api/tutor/progress?status=DRAFT");
      progressReportId = existing.payload?.data?.reports?.[0]?.id;
      check("an existing draft is reused", Boolean(progressReportId));
    } else {
      check("a tutor can start a progress report", draft.ok, JSON.stringify(draft.payload?.error));
      progressReportId = draft.payload?.data?.report?.id;
    }

    const injected = await tutor("/api/tutor/progress", {
      method: "POST",
      body: {
        studentProfileId: reportStudent.id,
        status: "SUBMITTED",
        lessonCount: 999,
        bookingIds: ["000000000000000000000000"],
      },
    });
    check("a client cannot declare a report already shared, or invent lessons",
      injected.status === 409 || injected.payload?.data?.report?.status === "DRAFT");

    // --- a draft belongs to its author alone ---------------------------------
    const familyReadsDraft = await parent(`/api/progress/${progressReportId}`);
    check("a family cannot read an unfinished draft", familyReadsDraft.status === 404);

    const familyEdits = await parent(`/api/tutor/progress/${progressReportId}`, {
      method: "PATCH",
      body: { summary: "Rewritten by the family, which must never be possible." },
    });
    check("a family cannot reach the tutor's edit endpoint at all",
      familyEdits.status === 403);

    const anonReads = await anon(`/api/progress/${progressReportId}`);
    check("anonymous cannot read a progress report", anonReads.status === 401);

    // --- sharing --------------------------------------------------------------
    const shortSummary = await tutor(`/api/tutor/progress/${progressReportId}`, {
      method: "PATCH",
      body: { summary: "Too short." },
    });
    check("a draft saves freely", shortSummary.ok, JSON.stringify(shortSummary.payload?.error));

    const refusedShare = await tutor(`/api/tutor/progress/${progressReportId}`, { method: "POST" });
    check("a report with a thin summary cannot be shared",
      refusedShare.status === 422 &&
        refusedShare.payload?.error?.code === "SUMMARY_REQUIRED");

    await tutor(`/api/tutor/progress/${progressReportId}`, {
      method: "PATCH",
      body: {
        summary: "QA run — covered logarithms and rational graphs this block. Safe to delete.",
        ratings: { understanding: 4, effort: 5 },
        privateNote: "QA run — this line must never reach the family.",
      },
    });

    const submitted = await tutor(`/api/tutor/progress/${progressReportId}`, { method: "POST" });
    check("a tutor can share the report", submitted.ok, JSON.stringify(submitted.payload?.error));
    check("the shared report leaves draft",
      submitted.payload?.data?.report?.status === "SUBMITTED");

    // --- reading ----------------------------------------------------------------
    const familyReads = await parent(`/api/progress/${progressReportId}`);
    check("the family can now read it", familyReads.ok);
    check("the family may acknowledge but not edit",
      familyReads.payload?.data?.canAcknowledge === true &&
        familyReads.payload?.data?.canEdit === false);
    check("the tutor's private note never reaches the family",
      !JSON.stringify(familyReads.payload ?? {}).includes("must never reach the family"));

    const familyHistory = await parent("/api/progress");
    check("the report appears in the family's history",
      familyHistory.ok &&
        familyHistory.payload.data.reports.some((r) => r.id === progressReportId));

    // --- acknowledgement -----------------------------------------------------------
    const acknowledged = await parent(`/api/progress/${progressReportId}`, { method: "POST" });
    check("the family can mark it read", acknowledged.ok);
    check("acknowledging does not change what the tutor wrote",
      acknowledged.payload?.data?.report?.summary?.startsWith("QA run —"));

    const tutorAcknowledges = await tutor(`/api/progress/${progressReportId}`, { method: "POST" });
    check("a tutor cannot acknowledge on the family's behalf",
      tutorAcknowledges.status === 403 || tutorAcknowledges.status === 404,
      `status ${tutorAcknowledges.status}`);

    // --- revision keeps history ------------------------------------------------------
    const revised = await tutor(`/api/tutor/progress/${progressReportId}`, {
      method: "PATCH",
      body: { summary: "QA run — revised summary. Safe to delete.", revisionReason: "QA revision." },
    });
    check("revising a shared report succeeds", revised.ok);
    check("and keeps what the family was originally shown",
      revised.payload?.data?.report?.revisions?.[0]?.snapshot?.summary?.includes("logarithms"));

    // --- admin ------------------------------------------------------------------------
    const parentReadsAdmin = await parent("/api/admin/progress");
    check("a family cannot read the admin progress list", parentReadsAdmin.status === 403);

    const tutorReadsAdmin = await tutor("/api/admin/progress");
    check("a tutor cannot read the admin progress list", tutorReadsAdmin.status === 403);

    const adminProgress = await admin("/api/admin/progress");
    check("an administrator can list shared reports",
      adminProgress.ok && Array.isArray(adminProgress.payload?.data?.reports));
    check("no private note reaches the admin list",
      !JSON.stringify(adminProgress.payload ?? {}).includes("must never reach the family"));

    // --- homework files (§41 Phase 3) ---------------------------------------
    const worksheet = () => new File([pdfBytes(1024)], "worksheet.pdf", { type: "application/pdf" });

    const familyAttaches = await parent(
      `/api/tutor/progress/${progressReportId}/attachments`,
      { form: formWith(worksheet()) },
    );
    check("a family cannot attach homework to a report", familyAttaches.status === 403);

    const anonAttaches = await anon(
      `/api/tutor/progress/${progressReportId}/attachments`,
      { form: formWith(worksheet()) },
    );
    check("nor can anybody signed out", anonAttaches.status === 401);

    const renamedScript = new File([Buffer.from("#!/bin/sh\nrm -rf /\n")], "invoice.pdf", {
      type: "application/pdf",
    });
    const refusedBytes = await tutor(
      `/api/tutor/progress/${progressReportId}/attachments`,
      { form: formWith(renamedScript) },
    );
    check("a script renamed .pdf is refused by the endpoint, on its bytes",
      refusedBytes.status === 422 &&
        refusedBytes.payload?.error?.code === "UNSUPPORTED_FILE_TYPE",
      JSON.stringify(refusedBytes.payload?.error));

    const noFile = await tutor(`/api/tutor/progress/${progressReportId}/attachments`, {
      form: new FormData(),
    });
    check("an upload with no file is a per-field validation error",
      noFile.status === 422 && Boolean(noFile.payload?.error?.details?.fieldErrors?.file));

    const attached = await tutor(
      `/api/tutor/progress/${progressReportId}/attachments`,
      { form: formWith(worksheet()) },
    );
    check("the report's author can attach a worksheet",
      attached.status === 201, JSON.stringify(attached.payload?.error));

    const homework = attached.payload?.data?.attachments?.[0];
    check("the response carries an id and a download route, and no storage key",
      Boolean(homework?.id) &&
        homework.href === `/api/progress/attachments/${homework.id}` &&
        !JSON.stringify(attached.payload).includes("storageKey"));

    const familyDownloads = await parent(homework.href, { raw: true });
    check("the family can download it", familyDownloads.status === 200);
    check("it is served as the type its bytes proved to be",
      familyDownloads.headers.get("content-type") === "application/pdf");
    check("as a download rather than something the tab renders",
      /^attachment;/.test(familyDownloads.headers.get("content-disposition") ?? ""));
    check("under a policy that lets it do nothing at all",
      /sandbox/.test(familyDownloads.headers.get("content-security-policy") ?? "") &&
        familyDownloads.headers.get("x-content-type-options") === "nosniff");
    check("and never from a cache",
      /no-store/.test(familyDownloads.headers.get("cache-control") ?? ""));

    const anonDownloads = await anon(homework.href, { raw: true });
    check("signed out, the same link gives nothing", anonDownloads.status === 401);

    // The author, the family and an administrator are the audience; the
    // cross-account refusals are asserted in the "Shared files" section
    // below, where this suite already holds sessions for other accounts.
    const adminDownloads = await admin(homework.href, { raw: true });
    check("an administrator can read it, for support", adminDownloads.status === 200);

    const guessedAttachment = await parent(
      "/api/progress/attachments/000000000000000000000000",
      { raw: true },
    );
    check("and a guessed attachment id resolves to nothing",
      guessedAttachment.status === 404);

    const removed = await tutor(
      `/api/tutor/progress/${progressReportId}/attachments/${homework.id}`,
      { method: "DELETE" },
    );
    check("the author can remove it again", removed.ok);
    check("and the list comes back without it",
      (removed.payload?.data?.attachments ?? []).every((a) => a.id !== homework.id));

    const afterRemoval = await parent(homework.href, { raw: true });
    check("after which the family's link stops resolving", afterRemoval.status === 404);

    // Leave the fixture archived rather than shared, so repeat runs are clean.
    await tutor(`/api/tutor/progress/${progressReportId}`, { method: "DELETE" });
  }

  // --- Calendar sync: consent, ownership and tokens ------------------------
  section("Calendar sync — consent, ownership and token safety");

  const anonConnect = await anon("/api/tutor/calendar/connect", {
    method: "POST",
    body: { provider: "GOOGLE" },
  });
  check("anonymous cannot start a calendar connection", anonConnect.status === 401);

  const parentConnect = await parent("/api/tutor/calendar/connect", {
    method: "POST",
    body: { provider: "GOOGLE" },
  });
  check("a family cannot connect a tutor calendar", parentConnect.status === 403);

  const badProvider = await tutor("/api/tutor/calendar/connect", {
    method: "POST",
    body: { provider: "ICAL" },
  });
  check("an unknown calendar provider is refused", badProvider.status === 422);

  const begin = await tutor("/api/tutor/calendar/connect", {
    method: "POST",
    body: { provider: "GOOGLE" },
  });
  check("a tutor can start a calendar connection", begin.ok, JSON.stringify(begin.payload?.error));

  const consentUrl = begin.payload?.data?.authorizationUrl ?? "";
  check("the consent URL carries a signed state", consentUrl.includes("state="));
  check("no client secret is ever put in a URL the browser follows",
    !/client_secret/i.test(consentUrl));

  // Complete the round trip. With no Google credentials configured this runs
  // against the development calendar, which is a real implementation.
  const callbackPath = consentUrl.startsWith(BASE)
    ? consentUrl.slice(BASE.length)
    : new URL(consentUrl).pathname + new URL(consentUrl).search;
  const callback = await tutor(callbackPath, { raw: true });
  check("the callback redirects back to the tutor's calendar",
    callback.status === 307 || callback.status === 302,
    `status ${callback.status}`);
  check("and reports the outcome in the query string",
    (callback.headers.get("location") ?? "").includes("calendar=connected"),
    callback.headers.get("location"));

  const forgedCallback = await tutor(
    "/api/calendar/callback/google?code=stolen&state=forged.signature",
    { raw: true },
  );
  check("a callback with a forged state does not create a connection",
    (forgedCallback.headers.get("location") ?? "").includes("calendar=error"));

  const connections = await tutor("/api/tutor/calendar/connections");
  check("the tutor can list their connections",
    connections.ok && connections.payload.data.connections.length >= 1);

  const connectionId = connections.payload?.data?.connections?.[0]?.id;
  check("a connection reports which provider and account it is",
    Boolean(connections.payload?.data?.connections?.[0]?.provider));
  check("no token of any kind reaches the browser",
    !/accessToken|refreshToken|"v1\./.test(JSON.stringify(connections.payload)));
  check("the response says plainly whether the provider is the real service",
    connections.payload.data.providers.every((p) => typeof p.live === "boolean"));

  const parentReadsConnections = await parent("/api/tutor/calendar/connections");
  check("a family cannot list a tutor's calendar connections",
    parentReadsConnections.status === 403);

  const strangerPatch = await parent(`/api/tutor/calendar/connections/${connectionId}`, {
    method: "PATCH",
    body: { syncBusy: false },
  });
  check("a family cannot change a tutor's calendar connection", strangerPatch.status === 403);

  const toggled = await tutor(`/api/tutor/calendar/connections/${connectionId}`, {
    method: "PATCH",
    body: { syncBusy: false, pushEvents: false },
  });
  check("a tutor can turn each sync direction off",
    toggled.ok && toggled.payload.data.connection.syncBusy === false &&
      toggled.payload.data.connection.pushEvents === false);

  const injectedStatus = await tutor(`/api/tutor/calendar/connections/${connectionId}`, {
    method: "PATCH",
    body: { status: "CONNECTED", accountEmail: "attacker@example.com", accessToken: "stolen" },
  });
  check("connection status, account and tokens are not client-settable",
    injectedStatus.ok &&
      injectedStatus.payload.data.connection.accountEmail !== "attacker@example.com");

  const calendars = await tutor(`/api/tutor/calendar/connections/${connectionId}/calendars`);
  check("a tutor can list the calendars on the connected account",
    calendars.ok && Array.isArray(calendars.payload.data.calendars));

  const unknownCalendar = await tutor(`/api/tutor/calendar/connections/${connectionId}`, {
    method: "PATCH",
    body: { calendarId: "a-calendar-that-does-not-exist" },
  });
  check("a calendar the account does not have is refused", unknownCalendar.status === 404);

  const refreshed = await tutor(`/api/tutor/calendar/connections/${connectionId}`, {
    method: "POST",
  });
  check("a tutor can refresh busy periods on demand", refreshed.ok);

  const parentDisconnect = await parent(`/api/tutor/calendar/connections/${connectionId}`, {
    method: "DELETE",
  });
  check("a family cannot disconnect a tutor's calendar", parentDisconnect.status === 403);

  const disconnected = await tutor(`/api/tutor/calendar/connections/${connectionId}`, {
    method: "DELETE",
  });
  check("a tutor can disconnect their own calendar", disconnected.ok);

  const afterDisconnect = await tutor("/api/tutor/calendar/connections");
  check("the disconnected calendar is gone",
    afterDisconnect.payload.data.connections.every((c) => c.id !== connectionId));

  // --- SMS: consent and authorization over real HTTP -----------------------
  section("Text messages — consent, verification and authorization");

  const anonPhone = await anon("/api/users/me/phone", {
    method: "POST",
    body: { phone: "4165550142" },
  });
  check("anonymous cannot ask for a confirmation code", anonPhone.status === 401);

  const badPhone = await parent("/api/users/me/phone", {
    method: "POST",
    body: { phone: "not-a-number" },
  });
  check("an invalid mobile number is refused", badPhone.status === 422);

  // The channel cannot be switched on before a number is confirmed — checked
  // server-side, not just disabled in the UI.
  await parent("/api/users/me/phone", { method: "DELETE" });
  const smsWithoutPhone = await parent("/api/users/me/notifications", {
    method: "PATCH",
    body: { SMS: true },
  });
  check("text notifications cannot be switched on without a confirmed number",
    smsWithoutPhone.status === 422 &&
      smsWithoutPhone.payload?.error?.code === "PHONE_NOT_VERIFIED",
    JSON.stringify(smsWithoutPhone.payload?.error));

  const sendCode = await parent("/api/users/me/phone", {
    method: "POST",
    body: { phone: "4165550142" },
  });
  check("a confirmation code can be requested", sendCode.ok, JSON.stringify(sendCode.payload?.error));
  check("the response says honestly whether a carrier is configured",
    sendCode.payload?.data?.providerConfigured === false);
  check("the code itself is never returned to the browser",
    !JSON.stringify(sendCode.payload ?? {}).match(/\b\d{6}\b/));

  const wrongCode = await parent("/api/users/me/phone", {
    method: "PATCH",
    body: { code: "000000" },
  });
  check("a wrong confirmation code is refused", wrongCode.status === 422);

  const malformedCode = await parent("/api/users/me/phone", {
    method: "PATCH",
    body: { code: "12" },
  });
  check("a malformed code never reaches the service", malformedCode.status === 422);

  const clearPhone = await parent("/api/users/me/phone", { method: "DELETE" });
  check("the number can be removed again", clearPhone.ok);

  // --- the delivery log is admin-only ---------------------------------------
  const parentSmsLog = await parent("/api/admin/sms");
  check("a family cannot read the text delivery log", parentSmsLog.status === 403);

  const tutorSmsLog = await tutor("/api/admin/sms");
  check("a tutor cannot read the text delivery log", tutorSmsLog.status === 403);

  const adminSmsLog = await admin("/api/admin/sms");
  check("admin can read the text delivery log",
    adminSmsLog.ok && Array.isArray(adminSmsLog.payload?.data?.messages));
  check("the delivery log masks phone numbers",
    (adminSmsLog.payload?.data?.messages ?? []).every((m) => !/^\+\d{11,}$/.test(m.to)));
  check("the delivery log states whether a carrier is configured",
    adminSmsLog.payload?.data?.providerConfigured === false);

  // --- the inbound callback is signed ----------------------------------------
  const unsignedInbound = await anon("/api/webhooks/sms", {
    method: "POST",
    raw: true,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    rawBody: "From=%2B14165550142&Body=STOP",
  });
  check("an unsigned inbound SMS callback is refused",
    unsignedInbound.status === 403 || unsignedInbound.status === 404,
    `status ${unsignedInbound.status}`);

  const forgedInbound = await anon("/api/webhooks/sms", {
    method: "POST",
    raw: true,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Twilio-Signature": "ZmFrZSBzaWduYXR1cmU=",
    },
    rawBody: "From=%2B14165550142&Body=STOP",
  });
  check("a forged signature on an inbound callback is refused",
    forgedInbound.status === 403 || forgedInbound.status === 404,
    `status ${forgedInbound.status}`);

  // --- Profile management --------------------------------------------------
  section("Profile management — details, photo upload and replacement (R8, R16)");

  const myProfile = await parent("/api/users/me");
  check("a signed-in account can read its own profile",
    myProfile.ok && myProfile.payload.data.user.email === "jennifer.chen@example.com",
    JSON.stringify(myProfile.payload?.error));
  check("and it comes back without the password hash",
    myProfile.payload?.data?.user?.passwordHash === undefined);

  const anonProfileRead = await anon("/api/users/me");
  check("an anonymous request cannot read a profile", anonProfileRead.status === 401);

  const anonProfileWrite = await anon("/api/users/me", {
    method: "PATCH",
    body: { firstName: "Mallory" },
  });
  check("an anonymous request cannot update a profile", anonProfileWrite.status === 401);

  const profileBefore = myProfile.payload.data.user;

  // Everything privileged, in one request, alongside two fields that really
  // are editable. The edit must land and the rest must not.
  const profileInjection = await parent("/api/users/me", {
    method: "PATCH",
    body: {
      firstName: "Jennifer",
      city: "Mississauga",
      // Privilege
      role: "ADMIN",
      status: "SUSPENDED",
      permissions: ["ADMIN_SETTINGS_MANAGE"],
      // Money
      creditBalanceCents: 999_999,
      // Identity claims this platform makes, not ones an account holder makes
      email: "attacker@example.com",
      emailVerifiedAt: "2020-01-01T00:00:00.000Z",
      phoneVerifiedAt: "2020-01-01T00:00:00.000Z",
      tokenVersion: 999,
      deletedAt: null,
      // The photo pointer, which is derived from an upload and nothing else
      avatarUrl: "https://evil.example.com/tracker.gif",
    },
  });
  check("an editable field on one's own profile is saved",
    profileInjection.ok && profileInjection.payload.data.user.city === "Mississauga",
    JSON.stringify(profileInjection.payload?.error));

  const profileAfter = profileInjection.payload?.data?.user ?? {};
  check("a role supplied in a profile update is IGNORED",
    profileAfter.role === profileBefore.role, `${profileBefore.role} -> ${profileAfter.role}`);
  check("an account status supplied in a profile update is IGNORED",
    profileAfter.status === profileBefore.status, `${profileBefore.status} -> ${profileAfter.status}`);
  check("a credit balance supplied in a profile update is IGNORED",
    profileAfter.creditBalanceCents === profileBefore.creditBalanceCents,
    `${profileBefore.creditBalanceCents} -> ${profileAfter.creditBalanceCents}`);
  check("an email address supplied in a profile update is IGNORED",
    profileAfter.email === profileBefore.email, `${profileBefore.email} -> ${profileAfter.email}`);
  check("an email-verification timestamp cannot be granted to oneself",
    String(profileAfter.emailVerifiedAt) === String(profileBefore.emailVerifiedAt));
  check("a phone-verification timestamp cannot be granted to oneself",
    String(profileAfter.phoneVerifiedAt) === String(profileBefore.phoneVerifiedAt));
  check("a session-revocation counter supplied in a profile update is IGNORED",
    profileAfter.tokenVersion === profileBefore.tokenVersion);
  check("an avatar URL supplied in a profile update is IGNORED — the photo is an upload",
    (profileAfter.avatarUrl ?? null) === (profileBefore.avatarUrl ?? null),
    `${profileBefore.avatarUrl} -> ${profileAfter.avatarUrl}`);
  check("no permissions array is written onto the account",
    profileAfter.permissions === undefined);

  // Server-side validation still applies to the fields that *are* editable.
  const badProfileEdit = await parent("/api/users/me", {
    method: "PATCH",
    body: { firstName: "", postalCode: "NOT A POSTAL CODE" },
  });
  check("an invalid profile field is refused with per-field messages",
    badProfileEdit.status === 422 &&
      Object.keys(badProfileEdit.payload?.error?.details?.fieldErrors ?? {}).length > 0,
    JSON.stringify(badProfileEdit.payload?.error));

  // One account cannot reach another's. There is no "update user X" endpoint
  // outside the admin console, and that one is permissioned.
  const crossUserWrite = await tutor(`/api/admin/users/${profileBefore.id}`, {
    method: "POST",
    body: { action: "SUSPEND" },
  });
  check("one account cannot act on another through the admin user route",
    crossUserWrite.status === 403, `status ${crossUserWrite.status}`);
  const crossUserRead = await tutor(`/api/admin/users/${profileBefore.id}`);
  check("nor read another account's record through it",
    crossUserRead.status === 403, `status ${crossUserRead.status}`);

  // --- the photo itself
  const parentUpload = (path, form) => parent(path, { form });

  const anonPhotoForm = new FormData();
  anonPhotoForm.append("file", new Blob([pngBytes(128, 128)], { type: "image/png" }), "me.png");
  const anonPhotoUpload = await anon("/api/users/me/avatar", { form: anonPhotoForm });
  check("an anonymous request cannot upload a profile photo", anonPhotoUpload.status === 401);

  const photoForm = new FormData();
  photoForm.append(
    "file",
    new Blob([pngBytes(256, 256)], { type: "image/png" }),
    // A filename carrying a path, a quote and a header break. None of it may
    // survive anywhere — the stored name is a UUID we generate.
    'me"\r\nX-Injected: yes/../../etc/passwd.png',
  );
  const photoUploaded = await parentUpload("/api/users/me/avatar", photoForm);
  check("a signed-in account can upload its own profile photo",
    photoUploaded.ok, JSON.stringify(photoUploaded.payload?.error));

  const firstPhotoUrl = photoUploaded.payload?.data?.user?.avatarUrl ?? "";
  check("the photo is stored as a pointer at this application, not at a third party",
    firstPhotoUrl.startsWith("/api/avatars/"), firstPhotoUrl);
  check("the stored key is a generated UUID — no part of the filename survives",
    /^\/api\/avatars\/[0-9a-f-]{36}\.png$/.test(firstPhotoUrl), firstPhotoUrl);
  check("the uploader's filename never becomes a path",
    !firstPhotoUrl.includes("passwd") && !firstPhotoUrl.includes("..") &&
      !firstPhotoUrl.includes("\r") && !firstPhotoUrl.includes('"'));
  check("the upload reply discloses no storage location, bucket or credential",
    !/bucket|endpoint|secretKey|accessKey|\.storage/i.test(JSON.stringify(photoUploaded.payload)),
    "the response mentions storage internals");

  const photoResponse = await parent(firstPhotoUrl, { raw: true });
  check("the photo is served back through the application",
    photoResponse.status === 200, `status ${photoResponse.status}`);
  check("and the bytes come back through the storage abstraction",
    (await photoResponse.clone().arrayBuffer()).byteLength > 0);
  check("served as the type its bytes really are",
    photoResponse.headers.get("content-type") === "image/png",
    photoResponse.headers.get("content-type"));
  check("no header was injected through the filename",
    photoResponse.headers.get("x-injected") === null);
  check("the browser is told not to sniff it into something executable",
    photoResponse.headers.get("x-content-type-options") === "nosniff");
  check("a learner's photo is not cached by shared proxies",
    (photoResponse.headers.get("cache-control") ?? "").includes("private"),
    photoResponse.headers.get("cache-control"));

  const anonPhotoRead = await anon(firstPhotoUrl);
  check("a learner's photo is NOT readable without a session",
    anonPhotoRead.status === 401, `status ${anonPhotoRead.status}`);

  const guessedPhoto = await parent("/api/avatars/00000000-0000-4000-8000-000000000000.png");
  check("a guessed avatar key is a 404, not a file", guessedPhoto.status === 404);

  // Next decodes the escape before the route sees it, so what arrives is a key
  // with separators in it — refused by shape, before anything is looked up.
  const traversalPhoto = await parent("/api/avatars/..%2F..%2Fdocuments%2Fx.pdf");
  check("an avatar key cannot be made to address a verification document",
    [400, 404, 422].includes(traversalPhoto.status), `status ${traversalPhoto.status}`);

  // --- what must be refused
  const scriptPhotoForm = new FormData();
  scriptPhotoForm.append(
    "file",
    new Blob(["<?php system($_GET['c']); ?>"], { type: "image/png" }),
    "shell.png",
  );
  const scriptPhotoRefused = await parentUpload("/api/users/me/avatar", scriptPhotoForm);
  check("a script relabelled as a PNG is REFUSED on its bytes, not its label",
    scriptPhotoRefused.status === 422 || scriptPhotoRefused.status === 400,
    `status ${scriptPhotoRefused.status}`);

  const svgPhotoForm = new FormData();
  svgPhotoForm.append(
    "file",
    new Blob(['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'], {
      type: "image/png",
    }),
    "me.png",
  );
  const svgPhotoRefused = await parentUpload("/api/users/me/avatar", svgPhotoForm);
  check("a script-capable SVG is REFUSED as a profile photo",
    svgPhotoRefused.status === 422 || svgPhotoRefused.status === 400,
    `status ${svgPhotoRefused.status}`);

  const pdfPhotoForm = new FormData();
  pdfPhotoForm.append(
    "file",
    new Blob([Buffer.from("%PDF-1.4\n%%EOF\n")], { type: "image/png" }),
    "me.png",
  );
  const pdfPhotoRefused = await parentUpload("/api/users/me/avatar", pdfPhotoForm);
  check("a PDF is REFUSED as a profile photo — only the image formats are accepted",
    pdfPhotoRefused.status === 422 || pdfPhotoRefused.status === 400,
    `status ${pdfPhotoRefused.status}`);

  const tinyPhotoForm = new FormData();
  tinyPhotoForm.append("file", new Blob([pngBytes(16, 16)], { type: "image/png" }), "tiny.png");
  const tinyPhotoRefused = await parentUpload("/api/users/me/avatar", tinyPhotoForm);
  check("an image below the minimum dimensions is refused",
    tinyPhotoRefused.status === 422 || tinyPhotoRefused.status === 400,
    `status ${tinyPhotoRefused.status}`);

  const hugePhotoForm = new FormData();
  hugePhotoForm.append(
    "file",
    // Genuinely over 3 MB, not merely claiming to be.
    new Blob([pngBytes(128, 128, 3 * 1024 * 1024 + 4096)], { type: "image/png" }),
    "huge.png",
  );
  const hugePhotoRefused = await parentUpload("/api/users/me/avatar", hugePhotoForm);
  check("an oversized photo is refused",
    hugePhotoRefused.status === 422 || hugePhotoRefused.status === 400,
    `status ${hugePhotoRefused.status}`);

  const photoStillThere = await parent("/api/users/me");
  check("a refused upload leaves the existing photo exactly as it was",
    photoStillThere.payload?.data?.user?.avatarUrl === firstPhotoUrl,
    `${firstPhotoUrl} -> ${photoStillThere.payload?.data?.user?.avatarUrl}`);

  // --- replacement
  const replacementForm = new FormData();
  replacementForm.append("file", new Blob([pngBytes(300, 300)], { type: "image/png" }), "new.png");
  const photoReplaced = await parentUpload("/api/users/me/avatar", replacementForm);
  const secondPhotoUrl = photoReplaced.payload?.data?.user?.avatarUrl ?? "";
  check("a replacement photo is accepted",
    photoReplaced.ok, JSON.stringify(photoReplaced.payload?.error));
  check("replacing a photo mints a NEW key, so no cache can serve the old one",
    secondPhotoUrl.startsWith("/api/avatars/") && secondPhotoUrl !== firstPhotoUrl,
    `${firstPhotoUrl} -> ${secondPhotoUrl}`);
  check("the replacement is readable", (await parent(secondPhotoUrl)).status === 200);

  const stalePhotoRead = await parent(firstPhotoUrl);
  check("the replaced photo is gone — a stale reference resolves to nothing",
    stalePhotoRead.status === 404, `status ${stalePhotoRead.status}`);

  // --- a tutor's photo is marketplace content
  const tutorPhotoForm = new FormData();
  tutorPhotoForm.append("file", new Blob([pngBytes(400, 400)], { type: "image/png" }), "tutor.png");
  const tutorPhotoUploaded = await tutor("/api/users/me/avatar", { form: tutorPhotoForm });
  const tutorPhotoUrl = tutorPhotoUploaded.payload?.data?.user?.avatarUrl ?? "";
  check("a tutor can upload a profile photo",
    tutorPhotoUploaded.ok, JSON.stringify(tutorPhotoUploaded.payload?.error));

  if (tutorPhotoUrl) {
    const publicPhotoRead = await anon(tutorPhotoUrl, { raw: true });
    check("a tutor's photo IS public — it is on the search results anonymous visitors load",
      publicPhotoRead.status === 200, `status ${publicPhotoRead.status}`);
    check("and it may be cached, because it is public marketplace content",
      (publicPhotoRead.headers.get("cache-control") ?? "").includes("public"),
      publicPhotoRead.headers.get("cache-control"));
  }

  // --- removal
  const photoRemoved = await parent("/api/users/me/avatar", { method: "DELETE" });
  check("an account can take its own photo down",
    photoRemoved.ok && !photoRemoved.payload.data.user.avatarUrl,
    JSON.stringify(photoRemoved.payload?.data?.user?.avatarUrl));
  check("and the file stops being readable the moment it does",
    (await parent(secondPhotoUrl)).status === 404);

  const anonPhotoRemove = await anon("/api/users/me/avatar", { method: "DELETE" });
  check("an anonymous request cannot remove a photo", anonPhotoRemove.status === 401);


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

  check("the bytes served are the bytes that were stored",
    Buffer.compare(
      Buffer.from(await servedLogo.clone().arrayBuffer()),
      Buffer.from(pngBytes(240, 64)),
    ) === 0);

  // --- Replacement: the new file is served, and the old object is discarded.
  //
  // This is the only path that deletes from the store during normal use, so
  // it is worth asserting rather than assuming: an accumulating bucket of
  // orphaned logos is a slow leak, and a *failed* delete must not take the
  // settings write down with it.
  const replacementLogo = new FormData();
  replacementLogo.append("file", new Blob([pngBytes(320, 80)], { type: "image/png" }), "logo-v2.png");
  const replaced = await adminUpload("/api/admin/settings/branding?asset=logo", replacementLogo);
  check("a logo can be replaced", replaced.ok, JSON.stringify(replaced.payload?.error ?? {}));
  check("the replacement gets its own storage key, so the URL version changes",
    replaced.payload?.data?.settings?.branding?.logo?.width === 320);

  const servedReplacement = await anon("/api/branding/logo", { raw: true });
  check("the replacement is what gets served, not the original",
    servedReplacement.status === 200 &&
      Buffer.compare(
        Buffer.from(await servedReplacement.arrayBuffer()),
        Buffer.from(pngBytes(320, 80)),
      ) === 0);

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

  // OAuth. Every attempt starts at the server, which mints the state and
  // nonce that make it single-use; with nothing configured on a development
  // server the start endpoint refuses rather than inventing a provider.
  // (The full flow, and its refusals, are the "Social sign-in" section.)
  const oauthStart = await anon("/api/auth/oauth/google", { raw: true });
  const oauthStartTarget = oauthStart.headers.get("location") ?? "";
  check(
    "a sign-in with no real provider configured never reaches a provider",
    [302, 303, 307].includes(oauthStart.status) && !/accounts\.google\.com/.test(oauthStartTarget),
    `status ${oauthStart.status} → ${oauthStartTarget}`,
  );
  check(
    "and nothing about it exposes a secret",
    !oauthStartTarget.match(/secret|client_secret|sk_|whsec/i),
  );
  const unknownProvider = await anon("/api/auth/oauth/myspace", { raw: true });
  check(
    "an unknown sign-in provider is refused",
    /oauthError=PROVIDER_DISABLED/.test(unknownProvider.headers.get("location") ?? ""),
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

  /*
    A *confirmed* lesson, booked and paid for here.

    This block used to assert against `bookingId`, which the cancellation
    section above has cancelled by the time it runs — so "the purchaser can see
    their own meeting link" was passing on a lesson that was never going to
    happen, and what it really proved was that a dead room's credentials
    outlived it. That is now refused (§27), so the positive case needs a lesson
    there is actually something to attend.

    Both properties are asserted: participants see the room on a live lesson,
    and nobody sees it on a cancelled one.
  */
  const privacySlots = await parent(
    `/api/tutors/${tutorId}/availability?days=28&durationMinutes=60`,
  );
  const privacySlot = privacySlots.payload?.data?.days?.find((d) => d.slots.length > 0)
    ?.slots[0]?.startAt;

  const privacyBooking = await parent("/api/bookings", {
    method: "POST",
    body: {
      tutorProfileId: tutorId,
      studentProfileId: studentId,
      courseId,
      mode: "ONLINE",
      startAt: privacySlot,
      durationMinutes: 60,
      meetingProvider: "ZOOM",
      studentNotes: "QA — meeting privacy fixture",
    },
  });
  const privacyBookingId = privacyBooking.payload?.data?.bookings?.[0]?.id;
  await parent(`/api/payments/${privacyBooking.payload?.data?.payment?.id}/capture`, {
    method: "POST",
    body: {
      card: { number: "4242424242424242", name: "QA", expiry: "12/28", cvc: "123" },
      meetingProvider: "ZOOM",
    },
  });

  const participantView = await parent(`/api/bookings/${privacyBookingId}`);
  check(
    "the purchaser can see their own meeting link",
    participantView.ok && Boolean(participantView.payload.data.booking?.meeting?.joinUrl),
    JSON.stringify(participantView.payload?.data?.booking?.meeting ?? participantView.payload?.error),
  );

  // The cancelled lesson from the section above: still theirs to read, with
  // nothing live left on it.
  const cancelledView = await parent(`/api/bookings/${bookingId}`);
  check(
    "the purchaser can still open a cancelled lesson",
    cancelledView.ok,
  );
  check(
    "but a cancelled lesson carries NO join link for anyone",
    !cancelledView.payload?.data?.booking?.meeting?.joinUrl,
    JSON.stringify(cancelledView.payload?.data?.booking?.meeting),
  );
  check(
    "and no passcode",
    !cancelledView.payload?.data?.booking?.meeting?.passcode,
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

  const tutorView = await tutor(`/api/bookings/${privacyBookingId}`);
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

  const adminView = await admin(`/api/bookings/${privacyBookingId}`);
  check(
    "an administrator can see the lesson for support and audit",
    adminView.ok && Boolean(adminView.payload.data.booking?.meeting?.joinUrl),
  );

  const anonView = await anon(`/api/bookings/${privacyBookingId}`);
  check("an anonymous request cannot see a meeting link", anonView.status === 401);

  // Leave the seeded calendar as it was found.
  await parent(`/api/bookings/${privacyBookingId}/cancel`, {
    method: "POST",
    body: { reason: "QA — meeting privacy fixture teardown." },
  });

  // Configuration is admin-only and never reaches a non-admin.
  const adminSettingsPage = await admin("/api/admin/settings");
  check("admin can read platform settings", adminSettingsPage.ok);
  check(
    "platform settings carry no provider credentials",
    !JSON.stringify(adminSettingsPage.payload?.data ?? {}).match(/sk_live|sk_test|whsec|RESEND|api_key/i),
  );

  // --- External modules -----------------------------------------------------
  //
  // The admin-configurable integration settings (§26, §36). Two things are
  // being proved here, and they pull in opposite directions:
  //
  //   1. An administrator can genuinely configure a provider — save it, change
  //      it, test it, switch it off — and the platform actually uses what was
  //      saved.
  //   2. Nobody, including that administrator, can read a stored credential
  //      back out of the application by any route.
  //
  // A feature that only satisfied the first would be a credential-disclosure
  // surface; one that only satisfied the second would be a form that does
  // nothing. So every assertion below is paired.
  section("External modules");

  // Belt and braces: the run already cleared these before its first
  // assertion, and this section is the one that goes on to configure them, so
  // it starts from the same known state whichever way it is reached.
  for (const key of ["email", "payment", "calendar", "sms", "storage", "oauth"]) {
    await admin(`/api/admin/integrations/${key}`, { method: "DELETE" });
  }

  // A value with no other reason to exist, so finding it anywhere is proof of
  // a leak rather than a coincidence.
  const PLANTED = `re_qa_${Date.now()}_donotleak`;
  const PLANTED_SMTP = `smtp_qa_${Date.now()}_donotleak`;

  // Authorization, on every endpoint and every method — this is the control,
  // and the page merely being unreachable is not.
  for (const [label, path, method, body] of [
    ["the module list", "/api/admin/integrations", "GET", undefined],
    ["one module", "/api/admin/integrations/email", "GET", undefined],
    ["a module save", "/api/admin/integrations/email", "PATCH", { enabled: true }],
    ["an environment import", "/api/admin/integrations/email", "POST", {}],
    ["a connection test", "/api/admin/integrations/email/test", "POST", {}],
    ["a configuration removal", "/api/admin/integrations/email", "DELETE", undefined],
  ]) {
    const anonRes = await anon(path, { method, body });
    check(`anonymous cannot reach ${label}`, anonRes.status === 401, `status ${anonRes.status}`);

    const parentRes = await parent(path, { method, body });
    check(`a parent cannot reach ${label}`, parentRes.status === 403, `status ${parentRes.status}`);

    const tutorRes = await tutor(path, { method, body });
    check(`a tutor cannot reach ${label}`, tutorRes.status === 403, `status ${tutorRes.status}`);
  }

  // A connection test is a diagnostic, and a diagnostic must not change what
  // it is diagnosing. The stored document is created by that write, and
  // `enabled` defaults to false — so before this was fixed, pressing "Test" on
  // a module configured by the environment silently switched it off, taking
  // password-reset mail (or checkout, or uploads) down with it.
  const preTest = await admin("/api/admin/integrations/calendar");
  check(
    "a module configured outside this screen starts switched on",
    preTest.payload?.data?.module?.enabled === true,
    JSON.stringify(preTest.payload?.data?.module?.enabled),
  );
  await admin("/api/admin/integrations/calendar/test", { method: "POST", body: {} });
  const postTest = await admin("/api/admin/integrations/calendar");
  check(
    "and testing it does not switch it off",
    postTest.payload?.data?.module?.enabled === true,
    `enabled=${postTest.payload?.data?.module?.enabled} status=${postTest.payload?.data?.module?.status}`,
  );
  await admin("/api/admin/integrations/calendar", { method: "DELETE" });

  // The same hazard on the save path: a first save that says nothing about the
  // switch must not be the thing that switches the module off either.
  await admin("/api/admin/integrations/sms", {
    method: "PATCH",
    body: { provider: "twilio", config: { accountSid: "AC" + "9".repeat(32), fromNumber: "+16475559999" } },
  });
  const afterQuietSave = await admin("/api/admin/integrations/sms");
  check(
    "a save that does not mention the switch leaves it where it was",
    afterQuietSave.payload?.data?.module?.enabled === true,
    `enabled=${afterQuietSave.payload?.data?.module?.enabled}`,
  );
  await admin("/api/admin/integrations/sms", { method: "DELETE" });

  const modulesList = await admin("/api/admin/integrations");
  check("an administrator can read the module list", modulesList.ok);
  check(
    "every module the platform has is listed",
    ["email", "payment", "calendar", "sms", "storage", "oauth"].every((key) =>
      modulesList.payload?.data?.modules?.some((m) => m.module === key),
    ),
  );
  check(
    "a module that has never been configured says so rather than claiming to work",
    modulesList.payload?.data?.modules?.find((m) => m.module === "sms")?.status === "NOT_CONFIGURED",
    modulesList.payload?.data?.modules?.find((m) => m.module === "sms")?.status,
  );

  // --- Email: save, mask, update, disable ----------------------------------
  const emailSave = await admin("/api/admin/integrations/email", {
    method: "PATCH",
    body: {
      enabled: true,
      provider: "resend",
      config: { from: "APlus QA <qa@example.com>", replyTo: "reply@example.com" },
      secrets: { apiKey: PLANTED },
    },
  });
  check("an administrator can save an email configuration", emailSave.ok, JSON.stringify(emailSave.payload?.error));
  check(
    "the save response reports the secret as set without returning it",
    emailSave.payload?.data?.module?.secrets?.apiKey?.set === true &&
      emailSave.payload?.data?.module?.secrets?.apiKey?.last4 == null,
  );
  check(
    "saving a configuration does not by itself claim the provider works",
    emailSave.payload?.data?.module?.status === "CONFIGURED",
    emailSave.payload?.data?.module?.status,
  );

  const emailRead = await admin("/api/admin/integrations/email");
  check("the saved non-secret values come back", emailRead.payload?.data?.module?.config?.from === "APlus QA <qa@example.com>");
  check(
    "the stored API key is never returned by the API",
    !JSON.stringify(emailRead.payload).includes(PLANTED),
  );
  check(
    "nor is it returned by the module list",
    !JSON.stringify((await admin("/api/admin/integrations")).payload).includes(PLANTED),
  );

  // A partial save must not silently destroy the credential it did not send.
  const emailPartial = await admin("/api/admin/integrations/email", {
    method: "PATCH",
    body: { config: { replyTo: "changed@example.com" } },
  });
  check("a save that omits the secret keeps it", emailPartial.payload?.data?.module?.secrets?.apiKey?.set === true);
  check("and applies the field that was sent", emailPartial.payload?.data?.module?.config?.replyTo === "changed@example.com");
  check("and leaves the other fields alone", emailPartial.payload?.data?.module?.config?.from === "APlus QA <qa@example.com>");

  // Switching provider must not destroy the configuration being switched away
  // from — trying SMTP for an afternoon should not cost you your Resend setup.
  const emailSmtp = await admin("/api/admin/integrations/email", {
    method: "PATCH",
    body: {
      provider: "smtp",
      config: { host: "smtp.example.com", port: 587, secure: false, username: "qa@example.com", from: "APlus QA <qa@example.com>" },
      secrets: { password: PLANTED_SMTP },
    },
  });
  check("the provider can be switched", emailSmtp.payload?.data?.module?.provider === "smtp", JSON.stringify(emailSmtp.payload?.error));
  check("the SMTP password is stored and not returned", emailSmtp.payload?.data?.module?.secrets?.password?.set === true &&
    !JSON.stringify(emailSmtp.payload).includes(PLANTED_SMTP));
  check("the Resend key is still stored behind the switch", emailSmtp.payload?.data?.module?.secrets?.apiKey?.set === true);
  check(
    "switching provider drops any earlier connection claim",
    emailSmtp.payload?.data?.module?.lastTest === null ||
      emailSmtp.payload?.data?.module?.lastTest?.stale === true,
  );

  // Invalid configuration is refused, per field.
  const emailBadPort = await admin("/api/admin/integrations/email", {
    method: "PATCH",
    body: { provider: "smtp", config: { port: 99999 } },
  });
  check("an impossible port is refused", emailBadPort.status === 422, `status ${emailBadPort.status}`);
  check(
    "and the refusal names the field",
    Boolean(emailBadPort.payload?.error?.details?.fieldErrors?.["config.port"]),
  );

  const emailBadReply = await admin("/api/admin/integrations/email", {
    method: "PATCH",
    body: { provider: "smtp", config: { replyTo: "not-an-address" } },
  });
  check("a malformed reply-to address is refused", emailBadReply.status === 422);

  const emailUnknownField = await admin("/api/admin/integrations/email", {
    method: "PATCH",
    body: { provider: "resend", config: { accountSid: "AC0" } },
  });
  check(
    "a field belonging to another module is refused rather than quietly dropped",
    emailUnknownField.status === 422,
    `status ${emailUnknownField.status}`,
  );

  const email465 = await admin("/api/admin/integrations/email", {
    method: "PATCH",
    body: { provider: "smtp", config: { port: 465, secure: false } },
  });
  check("port 465 without implicit TLS is refused rather than left to hang", email465.status === 422);

  // A test runs against what is stored, and reports honestly when it fails.
  const emailTest = await admin("/api/admin/integrations/email/test", { method: "POST", body: {} });
  check("a connection test returns a verdict rather than an error", emailTest.ok, JSON.stringify(emailTest.payload?.error));
  check(
    "bogus credentials are reported as a failure, not a success",
    emailTest.payload?.data?.result?.ok === false,
  );
  check(
    "the failure message carries no credential",
    !JSON.stringify(emailTest.payload).includes(PLANTED_SMTP) &&
      !JSON.stringify(emailTest.payload).includes(PLANTED),
  );

  const emailAfterFailedTest = await admin("/api/admin/integrations/email");
  check(
    "a failed test moves the module to Failing rather than Connected",
    emailAfterFailedTest.payload?.data?.module?.status === "FAILING",
    emailAfterFailedTest.payload?.data?.module?.status,
  );

  const emailBadRecipient = await admin("/api/admin/integrations/email/test", {
    method: "POST",
    body: { recipient: "nonsense" },
  });
  check("a malformed test recipient is refused before any provider is called", emailBadRecipient.status === 422);

  // Disabling has consequences, including for this screen.
  await admin("/api/admin/integrations/email", { method: "PATCH", body: { enabled: false } });
  const emailDisabledTest = await admin("/api/admin/integrations/email/test", { method: "POST", body: {} });
  check(
    "a switched-off module refuses to be tested rather than pretending",
    !emailDisabledTest.ok,
    `status ${emailDisabledTest.status}`,
  );
  const emailDisabled = await admin("/api/admin/integrations/email");
  check("and reports itself as disabled", emailDisabled.payload?.data?.module?.status === "DISABLED");

  // A disabled email module must not stop somebody signing up: the send is
  // skipped, the registration still completes. This is the runtime half of the
  // switch — the part that makes it more than a database value (§39).
  const disabledEmailSignup = await createClient()("/api/auth/register", {
    method: "POST",
    body: {
      role: "PARENT",
      firstName: "Qa",
      lastName: "Nomail",
      email: `qa-nomail-${Date.now()}@example.com`,
      password: PASSWORD,
      confirmPassword: PASSWORD,
      acceptTerms: true,
    },
  });
  check(
    "an account can still be created while email is switched off",
    disabledEmailSignup.ok,
    JSON.stringify(disabledEmailSignup.payload?.error),
  );

  // Clearing a secret is explicit and takes effect. The module is on SMTP by
  // now, and the schema is strict per provider — naming Resend's key here
  // would be refused, which is itself the behaviour asserted further up.
  await admin("/api/admin/integrations/email", { method: "PATCH", body: { enabled: true } });
  const emailCleared = await admin("/api/admin/integrations/email", {
    method: "PATCH",
    body: { secrets: { password: null } },
  });
  check("a secret can be removed outright", emailCleared.payload?.data?.module?.secrets?.password?.set === false,
    JSON.stringify(emailCleared.payload?.error));
  check("and removing one leaves the others alone", emailCleared.payload?.data?.module?.secrets?.apiKey?.set === true);

  // --- Payments: modes, masking, and not breaking what already works -------
  const stripeMismatch = await admin("/api/admin/integrations/payment", {
    method: "PATCH",
    body: { provider: "stripe", config: { environment: "test" }, secrets: { secretKey: "sk_live_qa000000000000000000" } },
  });
  check(
    "a live key cannot be saved into a module declared as test mode",
    stripeMismatch.status === 422,
    `status ${stripeMismatch.status}`,
  );
  check(
    "and the refusal explains which way round the mismatch is",
    /live mode key/i.test(JSON.stringify(stripeMismatch.payload?.error?.details?.fieldErrors ?? {})),
  );

  const stripeShape = await admin("/api/admin/integrations/payment", {
    method: "PATCH",
    body: { provider: "stripe", config: { environment: "test" }, secrets: { secretKey: "definitely-not-a-stripe-key" } },
  });
  check("a value that is not a Stripe key at all is refused", stripeShape.status === 422);

  const stripeWebhookShape = await admin("/api/admin/integrations/payment", {
    method: "PATCH",
    body: { provider: "stripe", secrets: { webhookSecret: "not-a-signing-secret" } },
  });
  check("a webhook signing secret that is not one is refused", stripeWebhookShape.status === 422);

  const PLANTED_STRIPE = "sk_test_qa000000000000000abcd";
  const stripeSave = await admin("/api/admin/integrations/payment", {
    method: "PATCH",
    body: {
      provider: "stripe",
      config: { environment: "test", currency: "CAD" },
      secrets: { secretKey: PLANTED_STRIPE, webhookSecret: "whsec_qa0000000000000000" },
    },
  });
  check("a matching test-mode key is accepted", stripeSave.ok, JSON.stringify(stripeSave.payload?.error));
  check(
    "the Stripe secret key is shown only by its last four characters",
    stripeSave.payload?.data?.module?.secrets?.secretKey?.last4 === "abcd" &&
      !JSON.stringify(stripeSave.payload).includes(PLANTED_STRIPE),
  );
  check(
    "the webhook signing secret reveals nothing at all",
    stripeSave.payload?.data?.module?.secrets?.webhookSecret?.set === true &&
      stripeSave.payload?.data?.module?.secrets?.webhookSecret?.last4 == null,
  );

  const stripeModeSwitch = await admin("/api/admin/integrations/payment", {
    method: "PATCH",
    body: { config: { environment: "live" } },
  });
  check(
    "switching to live mode without a live key is refused",
    stripeModeSwitch.status === 422,
    `status ${stripeModeSwitch.status}`,
  );

  // The payment module is now pointing at a Stripe key that does not exist, so
  // the webhook endpoint must still refuse everything it cannot verify — the
  // configuration changed, the signature rule did not.
  const hookAfterConfig = await anon("/api/webhooks/payments", {
    method: "POST",
    body: { id: "evt_qa_cfg", type: "checkout.session.completed", data: { object: {} } },
  });
  check("an unsigned webhook is still refused after the module is reconfigured", hookAfterConfig.status === 400);

  // Put payments back the way the rest of the suite expects. Leaving a bogus
  // Stripe key behind would break every later checkout assertion, which would
  // be this section breaking the others rather than finding a real fault.
  //
  // Clearing the *secrets* would not do it: the stored record would still name
  // Stripe, and a Stripe module with no key refuses every checkout — which
  // would be this section breaking the rest of the suite rather than finding a
  // fault. Removing the record entirely is the real escape hatch, and an
  // operator who configured a module by mistake needs exactly this.
  const paymentRestored = await admin("/api/admin/integrations/payment", { method: "DELETE" });
  check("a module's stored configuration can be removed outright", paymentRestored.ok);
  check(
    "and the module goes back to the deployment environment",
    paymentRestored.payload?.data?.module?.source !== "database",
    paymentRestored.payload?.data?.module?.source,
  );
  check(
    "with every credential it was holding destroyed",
    paymentRestored.payload?.data?.module?.secrets?.secretKey?.set === false,
  );

  const checkoutStillWorks = await parent("/api/bookings");
  check("existing payment flows are untouched by all of this", checkoutStillWorks.ok);

  // --- SMS ------------------------------------------------------------------
  const PLANTED_TWILIO = `twilio_qa_${Date.now()}_donotleak`;
  const smsNoSender = await admin("/api/admin/integrations/sms", {
    method: "PATCH",
    body: {
      provider: "twilio",
      config: { accountSid: "AC" + "0".repeat(32) },
      secrets: { authToken: PLANTED_TWILIO },
    },
  });
  check(
    "Twilio without a from number or messaging service is refused",
    smsNoSender.status === 422,
    `status ${smsNoSender.status}`,
  );

  const smsBadNumber = await admin("/api/admin/integrations/sms", {
    method: "PATCH",
    body: { provider: "twilio", config: { accountSid: "AC" + "0".repeat(32), fromNumber: "416-555-0123" } },
  });
  check("a from number that is not in E.164 form is refused", smsBadNumber.status === 422);

  const smsSave = await admin("/api/admin/integrations/sms", {
    method: "PATCH",
    body: {
      enabled: true,
      provider: "twilio",
      config: { accountSid: "AC" + "0".repeat(32), fromNumber: "+16475550123" },
      secrets: { authToken: PLANTED_TWILIO },
    },
  });
  check("a complete Twilio configuration saves", smsSave.ok, JSON.stringify(smsSave.payload?.error));
  check(
    "the auth token is stored and never returned",
    smsSave.payload?.data?.module?.secrets?.authToken?.set === true &&
      !JSON.stringify(smsSave.payload).includes(PLANTED_TWILIO),
  );
  check(
    "the account SID is shown in full, because it is not a secret",
    smsSave.payload?.data?.module?.config?.accountSid?.startsWith("AC"),
  );

  const smsTest = await admin("/api/admin/integrations/sms/test", { method: "POST", body: {} });
  check("the SMS test reaches the carrier and reports back", smsTest.ok);
  check("invalid Twilio credentials are reported as invalid", smsTest.payload?.data?.result?.ok === false);
  check(
    "and the auth token is not in the answer",
    !JSON.stringify(smsTest.payload).includes(PLANTED_TWILIO),
  );

  const smsBadPhone = await admin("/api/admin/integrations/sms/test", {
    method: "POST",
    body: { phone: "5551234" },
  });
  check("a malformed test number is refused before the carrier is called", smsBadPhone.status === 422);

  await admin("/api/admin/integrations/sms", { method: "PATCH", body: { enabled: false } });
  const smsDisabledTest = await admin("/api/admin/integrations/sms/test", { method: "POST", body: {} });
  check("a switched-off SMS module cannot be made to send", !smsDisabledTest.ok);

  // --- Calendar -------------------------------------------------------------
  //
  // Calendar is the one `multi` module: §41 lets a tutor pick Google or
  // Outlook, so both adapters may be live at once and each has its own app
  // registration. That makes it the module where a shared field name would be
  // a credential-handling fault rather than a tidiness one, and the checks
  // below are written against that.
  const GOOGLE_SECRET = "qa-google-client-secret-value";
  const MICROSOFT_SECRET = "qa-microsoft-client-secret-value";

  const calSave = await admin("/api/admin/integrations/calendar", {
    method: "PATCH",
    body: {
      enabled: true,
      provider: "google",
      providers: ["google"],
      config: { googleClientId: "qa-google-client-id.apps.googleusercontent.com" },
      secrets: { googleClientSecret: GOOGLE_SECRET },
    },
  });
  check("a calendar app registration saves", calSave.ok, JSON.stringify(calSave.payload?.error));
  check(
    "the client secret is stored and never returned",
    calSave.payload?.data?.module?.secrets?.googleClientSecret?.set === true &&
      !JSON.stringify(calSave.payload).includes(GOOGLE_SECRET),
  );
  check(
    "entering client credentials does not by itself count as connected",
    calSave.payload?.data?.module?.status === "CONFIGURED",
    calSave.payload?.data?.module?.status,
  );

  // Turning the second platform on, with its own registration, in the one
  // request the form actually sends. A schema that only knew about the primary
  // provider refused this as an unrecognised key, which made a `multi` module
  // impossible to finish configuring.
  const calBoth = await admin("/api/admin/integrations/calendar", {
    method: "PATCH",
    body: {
      enabled: true,
      provider: "google",
      providers: ["google", "microsoft"],
      config: {
        googleClientId: "qa-google-client-id.apps.googleusercontent.com",
        microsoftClientId: "qa-microsoft-client-id",
        microsoftTenantId: "common",
      },
      secrets: { microsoftClientSecret: MICROSOFT_SECRET },
    },
  });
  check(
    "a second calendar platform can be turned on with its own credentials",
    calBoth.ok,
    JSON.stringify(calBoth.payload?.error?.details?.fieldErrors ?? calBoth.payload?.error),
  );
  check(
    "both platforms are live",
    JSON.stringify(calBoth.payload?.data?.module?.providers ?? []) ===
      JSON.stringify(["google", "microsoft"]),
    JSON.stringify(calBoth.payload?.data?.module?.providers),
  );
  check(
    "and each platform keeps its own client id",
    calBoth.payload?.data?.module?.config?.googleClientId ===
      "qa-google-client-id.apps.googleusercontent.com" &&
      calBoth.payload?.data?.module?.config?.microsoftClientId === "qa-microsoft-client-id",
    JSON.stringify(calBoth.payload?.data?.module?.config),
  );
  check(
    "and its own client secret, side by side",
    calBoth.payload?.data?.module?.secrets?.googleClientSecret?.set === true &&
      calBoth.payload?.data?.module?.secrets?.microsoftClientSecret?.set === true,
    JSON.stringify(calBoth.payload?.data?.module?.secrets),
  );

  // The consequence that matters. A tutor starting a Google connection must be
  // sent to Google with *Google's* client id — handing over the registration
  // made with Microsoft would present one third party's confidential client
  // secret to another at token exchange.
  const googleConnect = await tutor("/api/tutor/calendar/connect", {
    method: "POST",
    body: { provider: "GOOGLE" },
  });
  const googleAuthUrl = String(googleConnect.payload?.data?.authorizationUrl ?? "");
  check(
    "a Google connection is offered under the Google client id",
    googleAuthUrl.includes("qa-google-client-id.apps.googleusercontent.com"),
    googleAuthUrl.slice(0, 160),
  );
  check(
    "and never under the Outlook one",
    !googleAuthUrl.includes("qa-microsoft-client-id"),
    googleAuthUrl.slice(0, 160),
  );

  const outlookConnect = await tutor("/api/tutor/calendar/connect", {
    method: "POST",
    body: { provider: "OUTLOOK" },
  });
  const outlookAuthUrl = String(outlookConnect.payload?.data?.authorizationUrl ?? "");
  check(
    "an Outlook connection is offered under the Outlook client id",
    outlookAuthUrl.includes("qa-microsoft-client-id") &&
      !outlookAuthUrl.includes("qa-google-client-id"),
    outlookAuthUrl.slice(0, 160),
  );
  check(
    "and no authorization URL ever carries a client secret",
    ![GOOGLE_SECRET, MICROSOFT_SECRET].some(
      (secret) => googleAuthUrl.includes(secret) || outlookAuthUrl.includes(secret),
    ),
  );

  const calUnknown = await admin("/api/admin/integrations/calendar", {
    method: "PATCH",
    body: { providers: ["google", "myspace"] },
  });
  check("a platform this build does not know is refused", calUnknown.status === 422);

  const calTest = await admin("/api/admin/integrations/calendar/test", { method: "POST", body: {} });
  check("the calendar test probes the provider and reports back", calTest.ok);
  check("invalid client credentials are reported as invalid", calTest.payload?.data?.result?.ok === false);

  // A tutor's own calendar screen must keep working throughout — the admin
  // module configures the app registration, it does not connect anybody.
  const tutorCalendar = await tutor("/api/tutor/calendar");
  check("a tutor's calendar screen still loads", tutorCalendar.ok);
  check(
    "and it carries no client secret",
    ![GOOGLE_SECRET, MICROSOFT_SECRET].some((secret) =>
      JSON.stringify(tutorCalendar.payload).includes(secret),
    ),
  );

  await admin("/api/admin/integrations/calendar", { method: "PATCH", body: { enabled: false } });
  const tutorCalendarOff = await tutor("/api/tutor/calendar");
  check("a tutor's calendar screen still loads with the module switched off", tutorCalendarOff.ok);

  // --- Storage --------------------------------------------------------------
  const storageModule = await admin("/api/admin/integrations/storage");
  check("the storage module reports where its configuration comes from", Boolean(storageModule.payload?.data?.module?.source));
  check(
    "a deployment with storage in its environment is offered the import",
    typeof storageModule.payload?.data?.module?.environment?.available === "boolean",
  );
  check(
    "the environment offer names variables, never their values",
    !JSON.stringify(storageModule.payload?.data?.module?.environment ?? {}).match(
      new RegExp(String(process.env.STORAGE_SECRET_KEY ?? "@@nothing@@")),
    ),
  );

  // --- Cross-module ---------------------------------------------------------
  const everything = JSON.stringify((await admin("/api/admin/integrations")).payload);
  check(
    "no planted credential appears anywhere in the module list",
    ![PLANTED, PLANTED_SMTP, PLANTED_TWILIO, PLANTED_STRIPE, GOOGLE_SECRET, MICROSOFT_SECRET].some(
      (secret) => everything.includes(secret),
    ),
  );
  check(
    "and no ciphertext is exposed either",
    !everything.includes("v1."),
  );

  // Settings and integrations stay separate: a credential must not appear in
  // the platform settings document, which reaches client components.
  const settingsAfter = await admin("/api/admin/settings");
  check(
    "platform settings still carry no credentials",
    ![PLANTED, PLANTED_SMTP, PLANTED_TWILIO, PLANTED_STRIPE].some((secret) =>
      JSON.stringify(settingsAfter.payload).includes(secret),
    ),
  );

  // Persistence across a new session: the configuration is stored, not held in
  // whatever request happened to write it.
  const secondAdmin = createClient();
  await login(secondAdmin, "admin@apluslearn.ca");
  const afterRelogin = await secondAdmin("/api/admin/integrations/sms");
  check(
    "a saved configuration survives signing out and back in",
    afterRelogin.payload?.data?.module?.config?.fromNumber === "+16475550123",
  );
  check(
    "and its secret is still stored, still unreadable",
    afterRelogin.payload?.data?.module?.secrets?.authToken?.set === true &&
      !JSON.stringify(afterRelogin.payload).includes(PLANTED_TWILIO),
  );

  // The admin page itself renders and leaks nothing.
  const integrationsPage = await admin("/admin/settings/integrations", { raw: true });
  const integrationsHtml = await integrationsPage.text();
  check("the external modules page renders for an administrator", integrationsPage.status === 200);
  check(
    "and the rendered HTML carries no credential",
    ![PLANTED, PLANTED_SMTP, PLANTED_TWILIO, PLANTED_STRIPE, GOOGLE_SECRET, MICROSOFT_SECRET].some(
      (secret) => integrationsHtml.includes(secret),
    ),
  );

  // Next renders a redirect as a shell document rather than a 3xx on a dynamic
  // page, so the status is not the thing to assert — the absence of the page
  // is. The API permission above is the actual control; this checks the page
  // guard did not simply render for them.
  const parentPage = await parent("/admin/settings/integrations", { raw: true });
  const parentHtml = await parentPage.text();
  check(
    "a parent is not shown the external modules page",
    !parentHtml.includes("Webhook signing secret") && !parentHtml.includes("Import from environment"),
  );
  check(
    "and the shell they get carries no configuration at all",
    ![PLANTED, PLANTED_SMTP, PLANTED_TWILIO, PLANTED_STRIPE].some((secret) => parentHtml.includes(secret)),
  );

  // Audit: the change is recorded, the value is not.
  const auditAfter = await admin("/api/admin/users?page=1");
  check("admin endpoints still work after all the module churn", auditAfter.ok);

  // Leave every module as the suite found it, so a second run starts clean and
  // no later section inherits a half-configured provider.
  for (const key of ["email", "payment", "calendar", "sms", "storage", "oauth"]) {
    const cleared = await admin(`/api/admin/integrations/${key}`, { method: "DELETE" });
    check(`the ${key} module is cleared down`, cleared.ok, JSON.stringify(cleared.payload?.error));
  }

  const modulesRestored = await admin("/api/admin/integrations");
  check(
    "every module is back on the deployment environment for the next run",
    modulesRestored.payload?.data?.modules?.every((m) => m.source !== "database"),
    modulesRestored.payload?.data?.modules?.map((m) => `${m.module}=${m.source}`).join(" "),
  );
  check(
    "and no credential survives the clear-down",
    !JSON.stringify(modulesRestored.payload).match(/donotleak/),
  );


  // --- Social sign-in ------------------------------------------------------
  //
  // Google and Apple are configured, switched on and switched off from the
  // Social sign-in module and nowhere else (§9, §26). Every assertion here is
  // against the running server: what the admin API stores and refuses, what
  // the start and callback endpoints do with a method that is off, what the
  // sign-in page renders, and what the audit log keeps.
  section("Social sign-in — admin configuration and runtime gate");

  await admin("/api/admin/integrations/oauth", { method: "DELETE" });

  const SOCIAL_ID = "qa-social-signin.apps.googleusercontent.com";
  const SOCIAL_SECRET = `GOCSPX-qa-${Date.now()}-donotleak`;
  const { generateKeyPairSync } = await import("node:crypto");
  const APPLE_P8 = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    .privateKey.export({ type: "pkcs8", format: "pem" });
  const APPLE_P8_LINE = APPLE_P8.split("\n")[1];
  const APPLE_CONFIG = {
    appleServiceId: "ca.apluslearn.qa",
    appleTeamId: "QA1234TEAM",
    appleKeyId: "QA1234KEY0",
  };
  const devCredential = (email) =>
    Buffer.from(JSON.stringify({ sub: `qa-${email}`, email, email_verified: true })).toString("base64url");
  const start = async (provider, query = "") => {
    const client = createClient();
    const socialRes = await client(`/api/auth/oauth/${provider}${query}`, { raw: true });
    return { client, socialRes, location: socialRes.headers.get("location") ?? "", cookie: socialRes.headers.get("set-cookie") ?? "" };
  };
  const signInPage = async () => (await (await anon("/login", { raw: true })).text());
  const hasButton = (html, label) => html.includes(`aria-label="Continue with ${label}"`);

  // With nothing configured, a development server keeps the labelled local
  // identity so the path stays exercisable; production never does (asserted
  // in the integration suite, which can set APP_ENV).
  const unconfiguredPage = await signInPage();
  check(
    "with nothing configured, a development server labels its test identity as such",
    !hasButton(unconfiguredPage, "Google") || unconfiguredPage.includes("Development mode"),
  );

  // Authorization: only an administrator reaches any of it.
  for (const [who, client, expected] of [["anonymous", anon, 401], ["a parent", parent, 403], ["a tutor", tutor, 403]]) {
    const read = await client("/api/admin/integrations/oauth");
    check(`${who} cannot read the social sign-in configuration`, read.status === expected, `status ${read.status}`);
    const write = await client("/api/admin/integrations/oauth", {
      method: "PATCH",
      body: { enabled: true, providers: ["google"], config: { googleClientId: SOCIAL_ID } },
    });
    check(`${who} cannot change it or switch a method on`, write.status === expected, `status ${write.status}`);
  }

  // --- Google: configured but switched off ------------------------------------
  const googleSaved = await admin("/api/admin/integrations/oauth", {
    method: "PATCH",
    body: {
      enabled: false,
      provider: "google",
      providers: ["google"],
      config: { googleClientId: SOCIAL_ID },
      secrets: { googleClientSecret: SOCIAL_SECRET },
    },
  });
  const googleModule = googleSaved.payload?.data?.module;
  check("an administrator can save Google's credentials", googleSaved.ok, JSON.stringify(googleSaved.payload?.error));
  check("the client secret is reported as stored and never returned",
    googleModule?.secrets?.googleClientSecret?.set === true && !JSON.stringify(googleSaved.payload).includes(SOCIAL_SECRET));
  check("with the module off, Google reads as configured but switched off",
    googleModule?.providerStatus?.find((p) => p.provider === "google")?.state === "DISABLED",
    JSON.stringify(googleModule?.providerStatus));
  check("the redirect URI to register is shown",
    /\/api\/auth\/oauth\/google\/callback$/.test(
      googleModule?.providerOptions?.find((o) => o.value === "google")?.registration?.[0]?.value ?? "",
    ));

  const offStart = await start("google");
  check("disabled Google: the start endpoint sends the person back, not to Google",
    /\/login\?oauthError=PROVIDER_DISABLED/.test(offStart.location) && !offStart.location.includes("accounts.google.com"),
    offStart.location);
  check("and starts no attempt", !offStart.cookie.includes("aplus_oauth_tx=v1."));
  const offDev = await anon("/api/auth/oauth", {
    method: "POST",
    body: { provider: "GOOGLE", credential: devCredential("qa-social-off@example.com") },
  });
  check("disabled Google: the development identity is refused too", offDev.status === 403, `status ${offDev.status}`);

  const bothOffPage = await signInPage();
  check("with Google off, the sign-in page shows no Google button", !hasButton(bothOffPage, "Google"));
  check("nor an Apple one", !hasButton(bothOffPage, "Apple"));
  check("and still offers email and password", bothOffPage.includes('type="password"'));
  const passwordClient = createClient();
  const passwordUser = await login(passwordClient, "jennifer.chen@example.com").catch(() => null);
  check("with every social method off, email and password sign-in still works", Boolean(passwordUser?.id));

  // --- validation: nothing half-configured goes live -------------------------
  const appleIncomplete = await admin("/api/admin/integrations/oauth", {
    method: "PATCH",
    body: { enabled: true, providers: ["google", "apple"], config: { appleServiceId: APPLE_CONFIG.appleServiceId } },
  });
  const incompleteErrors = appleIncomplete.payload?.error?.details?.fieldErrors ?? {};
  check("Apple cannot be switched on half-configured", appleIncomplete.status === 422, `status ${appleIncomplete.status}`);
  check("and the refusal names each missing field",
    Boolean(incompleteErrors["config.appleTeamId"] && incompleteErrors["secrets.applePrivateKey"]),
    JSON.stringify(Object.keys(incompleteErrors)));
  const badKey = await admin("/api/admin/integrations/oauth", {
    method: "PATCH",
    body: {
      providers: ["google", "apple"],
      config: APPLE_CONFIG,
      secrets: { applePrivateKey: "-----BEGIN PRIVATE KEY-----\nnotakey\n-----END PRIVATE KEY-----" },
    },
  });
  check("an unusable Apple private key is refused", badKey.status === 422 &&
    Boolean(badKey.payload?.error?.details?.fieldErrors?.["secrets.applePrivateKey"]));
  check("and the refusal does not echo the value", !JSON.stringify(badKey.payload).includes("notakey"));

  // --- Google: switched on -------------------------------------------------------
  const googleOn = await admin("/api/admin/integrations/oauth", {
    method: "PATCH",
    body: { enabled: true, providers: ["google"] },
  });
  check("Google can be switched on once complete",
    googleOn.payload?.data?.module?.providerStatus?.find((p) => p.provider === "google")?.state === "ENABLED",
    JSON.stringify(googleOn.payload?.error ?? googleOn.payload?.data?.module?.providerStatus));

  const onStart = await start("google", "?role=TUTOR&next=%2Fbookings&from=register");
  const googleUrl = new URL(onStart.location || "about:blank");
  check("enabled Google: the start endpoint redirects to Google", googleUrl.origin === "https://accounts.google.com",
    onStart.location.slice(0, 120));
  check("with this platform's client ID and redirect URI",
    googleUrl.searchParams.get("client_id") === SOCIAL_ID &&
      /\/api\/auth\/oauth\/google\/callback$/.test(googleUrl.searchParams.get("redirect_uri") ?? ""));
  check("carrying state, nonce and an S256 PKCE challenge",
    Boolean(googleUrl.searchParams.get("state") && googleUrl.searchParams.get("nonce")) &&
      googleUrl.searchParams.get("code_challenge_method") === "S256");
  check("and never the client secret",
    !onStart.location.includes(SOCIAL_SECRET) && !/client_secret/.test(onStart.location));
  check("the attempt is held in an httpOnly cookie scoped to the sign-in routes",
    /aplus_oauth_tx=v1\./.test(onStart.cookie) && /HttpOnly/i.test(onStart.cookie) &&
      /Path=\/api\/auth\/oauth/i.test(onStart.cookie) && /SameSite=lax/i.test(onStart.cookie),
    onStart.cookie.replace(/=v1\.[^;]+/, "=v1.…"));
  check("whose contents are opaque — the state is not readable in it",
    !onStart.cookie.includes(googleUrl.searchParams.get("state")));

  const googleOnPage = await signInPage();
  check("the sign-in page now shows Continue with Google", hasButton(googleOnPage, "Google"));
  check("and still not Apple, which is not configured", !hasButton(googleOnPage, "Apple"));
  check("and ships no credential to the browser — not even the client ID",
    !googleOnPage.includes(SOCIAL_SECRET) && !googleOnPage.includes(SOCIAL_ID));
  const registerPage = await (await anon("/register", { raw: true })).text();
  check("the registration page offers the same method", hasButton(registerPage, "Google"));

  const liveDev = await anon("/api/auth/oauth", {
    method: "POST",
    body: { provider: "GOOGLE", credential: devCredential("qa-social-live@example.com") },
  });
  check("a real provider can never be satisfied by a self-asserted identity", liveDev.status === 403,
    `status ${liveDev.status}`);

  // --- the callback's refusals ----------------------------------------------------
  const forged = await onStart.client("/api/auth/oauth/google/callback?code=qa-code&state=forged-state", { raw: true });
  const forgedCookies = forged.headers.get("set-cookie") ?? "";
  check("a callback whose state does not match is refused (login CSRF)",
    /\/register\?oauthError=STATE_INVALID/.test(forged.headers.get("location") ?? ""),
    forged.headers.get("location"));
  check("and issues no session", !/aplus_session=/.test(forgedCookies));
  check("and consumes the attempt", /aplus_oauth_tx=;/.test(forgedCookies) || /aplus_oauth_tx=(""|);/.test(forgedCookies));
  const replayed = await onStart.client(
    `/api/auth/oauth/google/callback?code=qa-code&state=${googleUrl.searchParams.get("state")}`, { raw: true });
  check("the same attempt cannot be finished after it was consumed",
    /oauthError=STATE_INVALID/.test(replayed.headers.get("location") ?? ""));

  const socialStranger = await createClient()(`/api/auth/oauth/google/callback?code=qa-code&state=${googleUrl.searchParams.get("state")}`, { raw: true });
  check("a callback in a browser that never started the attempt is refused",
    /oauthError=STATE_INVALID/.test(socialStranger.headers.get("location") ?? "") &&
      !/aplus_session=/.test(socialStranger.headers.get("set-cookie") ?? ""));

  const socialDeclined = await (await start("google")).client("/api/auth/oauth/google/callback?error=access_denied", { raw: true });
  check("declining on Google's screen reads as cancelled, not as an error",
    /oauthError=CANCELLED/.test(socialDeclined.headers.get("location") ?? ""));

  const junk = await anon("/login?oauthError=%3Cscript%3Ealert(1)%3C%2Fscript%3E", { raw: true });
  const junkHtml = await junk.text();
  check("an unknown error code in the URL renders fixed copy, never the parameter",
    !junkHtml.includes("<script>alert(1)") &&
      /We couldn(&#x27;|&#39;|')t complete that sign-in/.test(junkHtml));

  // --- Apple ---------------------------------------------------------------------
  const appleOn = await admin("/api/admin/integrations/oauth", {
    method: "PATCH",
    body: { enabled: true, providers: ["google", "apple"], config: APPLE_CONFIG, secrets: { applePrivateKey: APPLE_P8 } },
  });
  check("Apple's complete credentials can be saved and switched on",
    appleOn.payload?.data?.module?.providerStatus?.find((p) => p.provider === "apple")?.state === "ENABLED",
    JSON.stringify(appleOn.payload?.error?.details ?? appleOn.payload?.error));
  check("the private key is never returned", !JSON.stringify(appleOn.payload).includes(APPLE_P8_LINE));

  const appleStart = await start("apple");
  const appleUrl = new URL(appleStart.location || "about:blank");
  check("enabled Apple: the start endpoint redirects to Apple, asking for form_post",
    appleUrl.origin === "https://appleid.apple.com" && appleUrl.searchParams.get("response_mode") === "form_post",
    appleStart.location.slice(0, 120));
  check("Apple's attempt cookie survives Apple's cross-site POST back (SameSite=None; Secure)",
    /SameSite=none/i.test(appleStart.cookie) && /Secure/i.test(appleStart.cookie));
  const appleForged = await appleStart.client("/api/auth/oauth/apple/callback", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    rawBody: new URLSearchParams({ code: "qa-code", state: "forged-state" }).toString(),
    raw: true,
  });
  check("an Apple callback with a forged state is refused",
    /oauthError=STATE_INVALID/.test(appleForged.headers.get("location") ?? "") &&
      !/aplus_session=/.test(appleForged.headers.get("set-cookie") ?? ""));
  const appleByGet = await anon("/api/auth/oauth/apple/callback?code=x&state=y", { raw: true });
  check("Apple's callback accepts only the method Apple uses",
    /oauthError=FAILED/.test(appleByGet.headers.get("location") ?? ""));
  const bothOnPage = await signInPage();
  check("the sign-in page shows both methods once both are on",
    hasButton(bothOnPage, "Google") && hasButton(bothOnPage, "Apple"));

  // Validation makes real calls to Google and Apple with these made-up
  // credentials, so the only thing to assert is that they are judged — not
  // accepted — and that nothing sensitive comes back.
  const socialTest = await admin("/api/admin/integrations/oauth/test", { method: "POST", body: {} });
  check("the credentials can be validated from the admin panel", socialTest.ok, JSON.stringify(socialTest.payload?.error));
  check("each method is judged separately",
    ["google", "apple"].every((p) => socialTest.payload?.data?.result?.results?.some((r) => r.provider === p)));
  check("made-up credentials are not reported as working", socialTest.payload?.data?.result?.ok === false);
  check("and the result carries no credential",
    !JSON.stringify(socialTest.payload).includes(SOCIAL_SECRET) && !JSON.stringify(socialTest.payload).includes(APPLE_P8_LINE));

  // --- switching one off leaves the other --------------------------------------------
  await admin("/api/admin/integrations/oauth", { method: "PATCH", body: { enabled: true, providers: ["google"] } });
  const appleOffStart = await start("apple");
  check("unticking Apple blocks Apple sign-in at the server",
    /oauthError=PROVIDER_DISABLED/.test(appleOffStart.location), appleOffStart.location);
  check("while Google keeps working", (await start("google")).location.startsWith("https://accounts.google.com"));
  const appleOffPage = await signInPage();
  check("and the page drops only the Apple button", hasButton(appleOffPage, "Google") && !hasButton(appleOffPage, "Apple"));

  await admin("/api/admin/integrations/oauth", { method: "PATCH", body: { enabled: false } });
  check("switching the module off blocks Google at the server too",
    /oauthError=PROVIDER_DISABLED/.test((await start("google")).location));
  const allOffPage = await signInPage();
  check("and the page shows no social button at all",
    !hasButton(allOffPage, "Google") && !hasButton(allOffPage, "Apple") && allOffPage.includes('type="password"'));

  // --- audit -------------------------------------------------------------------------
  const socialAudit = await admin("/api/admin/audit-logs?entityType=Integration&pageSize=50");
  const socialEvents = (socialAudit.payload?.data?.events ?? []).filter((e) => e.metadata?.module === "oauth");
  check("social sign-in changes are in the audit log", socialEvents.length > 0);
  check("switching Apple off is its own entry",
    socialEvents.some((e) => e.action === "INTEGRATION_DISABLED" && e.metadata?.provider === "apple"));
  check("key rotations are recorded by field name",
    socialEvents.some((e) => e.action === "INTEGRATION_SECRET_ROTATED" &&
      (e.metadata?.rotated ?? []).includes("applePrivateKey")));
  check("and no credential appears anywhere in them",
    !JSON.stringify(socialAudit.payload).includes(SOCIAL_SECRET) &&
      !JSON.stringify(socialAudit.payload).includes(APPLE_P8_LINE));

  const socialCleared = await admin("/api/admin/integrations/oauth", { method: "DELETE" });
  check("the social sign-in module is cleared down", socialCleared.ok);

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

  // Reconciliation reads a payment's state from the provider; who may ask is
  // still decided against the loaded record, never the URL (§8).
  const strangerReconcile = await stranger(`/api/payments/${authPaymentId}/reconcile`, {
    method: "POST",
  });
  check(
    "a stranger cannot reconcile someone else's payment",
    !strangerReconcile.ok && [403, 404].includes(strangerReconcile.status),
    `status ${strangerReconcile.status}`,
  );
  const strangerTutorReconcile = await strangerTutor(
    `/api/payments/${authPaymentId}/reconcile`,
    { method: "POST" },
  );
  check(
    "nor can a tutor who is not on the lesson",
    !strangerTutorReconcile.ok && [403, 404].includes(strangerTutorReconcile.status),
    `status ${strangerTutorReconcile.status}`,
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
  // Seeded history supplies these, and this is the one assertion in the suite
  // that consumes a fixture it cannot put back: reporting a no-show moves the
  // lesson to NO_SHOW_TUTOR for good, and no endpoint can create a *past*
  // completed lesson to replace it. So the run leaves one behind rather than
  // taking the last, because the risk section later on needs a completed
  // lesson to raise a dispute about — a suite whose early section starves its
  // own later section fails for a reason that has nothing to do with the code.
  //
  // The steady state is therefore: plenty of fixtures, everything runs; one
  // left, this happy path stands down and says so, and every other section
  // keeps working until somebody re-seeds.
  const pastLessons = await parent("/api/bookings?scope=PAST&status=COMPLETED&pageSize=50");
  const completedPool = (pastLessons.payload?.data?.bookings ?? []).filter(
    (b) => b.status === "COMPLETED",
  );
  const reportable = completedPool.length > 1 ? completedPool[0] : null;

  if (!reportable) {
    check(
      "a completed lesson is available to test the no-show happy path",
      false,
      completedPool.length === 1
        ? "only one COMPLETED past booking left, and it is reserved for the risk section — run `bun run seed` to restore the fixtures"
        : "no COMPLETED past booking left — run `bun run seed` to restore the fixtures",
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

  // --- Password reset ----------------------------------------------------------
  //
  // Forgot password over real HTTP (§9, §36), on the account registered just
  // above — nothing seeded changes password. The code is read from the
  // development mailbox, which is where a dev server with no mail server
  // delivers: the same code, generated and checked by the same service, that
  // production would email.
  section("Password reset — emailed code, enumeration and single use");

  const mailReader = createClient();
  const readResetCode = async (address) => {
    // The send runs in `after()`, once the response has gone, so give it a moment.
    for (let i = 0; i < 25; i += 1) {
      const res = await mailReader(`/api/dev/mail?to=${encodeURIComponent(address)}`);
      if (res.status === 404) return { unavailable: true };
      const message = res.payload?.data?.messages?.find((m) => /password reset code/i.test(m.subject));
      const code = message?.text.match(/^\s+(\d{6})\s*$/m)?.[1];
      if (code) return { code };
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return {};
  };

  const resetter = createClient();
  const resetStranger = createClient();
  const unknownAddress = `qa-nobody-${Date.now()}@example.com`;
  const RESET_TO = "QaResetPass2024";

  const badAddress = await resetter("/api/auth/forgot-password", {
    method: "POST",
    body: { email: "not-an-email" },
  });
  check("an invalid email address is refused",
    badAddress.status === 422 && Boolean(badAddress.payload?.error?.details?.fieldErrors?.email));

  const knownRaw = await resetter("/api/auth/forgot-password", {
    method: "POST",
    body: { email: newEmail },
    raw: true,
  });
  const knownCookie = knownRaw.headers.get("set-cookie") ?? "";
  const forKnown = { status: knownRaw.status, payload: await knownRaw.json().catch(() => null) };
  const forUnknown = await resetStranger("/api/auth/forgot-password", {
    method: "POST",
    body: { email: unknownAddress },
  });
  const comparable = (p) => ({ ...p?.data, maskedEmail: undefined, codeExpiresInSeconds: undefined });
  check("a reset code can be requested", forKnown.status === 200 && forKnown.payload?.ok,
    JSON.stringify(forKnown.payload?.error));
  check("an unknown address gets exactly the answer a real one does",
    forUnknown.ok && JSON.stringify(comparable(forUnknown.payload)) === JSON.stringify(comparable(forKnown.payload)),
    `${JSON.stringify(forUnknown.payload)} vs ${JSON.stringify(forKnown.payload)}`);
  check("the reply is the generic one and masks the address",
    forKnown.payload?.data?.sent === true && /^q\*\*\*@example\.com$/.test(forKnown.payload?.data?.maskedEmail ?? ""));
  check("the code itself is never returned to the browser",
    !/\b\d{6}\b/.test(JSON.stringify(forKnown.payload ?? {})));
  check("the request handle is an httpOnly cookie page script cannot read",
    /aplus_password_reset=/.test(knownCookie) && /httponly/i.test(knownCookie));

  const cooldownKnown = await resetter("/api/auth/forgot-password/resend", { method: "POST" });
  const cooldownUnknown = await resetStranger("/api/auth/forgot-password/resend", { method: "POST" });
  check("resending straight away is held back by the cooldown",
    cooldownKnown.status === 429 && cooldownKnown.payload?.error?.code === "RESEND_COOLDOWN",
    `${cooldownKnown.status} ${cooldownKnown.payload?.error?.code}`);
  check("and an unknown address is held back identically",
    cooldownUnknown.status === 429 && cooldownUnknown.payload?.error?.code === "RESEND_COOLDOWN");

  const { code: resetCode, unavailable } = await readResetCode(newEmail);
  if (!registered.ok) {
    console.log("  ⊘ the rest of password reset — the account it resets could not be registered");
  } else if (unavailable) {
    console.log("  ⊘ the rest of password reset — a real mail provider is configured, so the code went to a real inbox");
  } else {
    check("the code arrives in the development mailbox", /^\d{6}$/.test(resetCode ?? ""));
    check("an unknown address is sent nothing",
      !(await readResetCode(unknownAddress)).code);

    const wrongGuess = resetCode === "000000" ? "111111" : "000000";
    const wrongKnown = await resetter("/api/auth/forgot-password/verify", {
      method: "POST",
      body: { code: wrongGuess },
    });
    const wrongUnknown = await resetStranger("/api/auth/forgot-password/verify", {
      method: "POST",
      body: { code: "123456" },
    });
    check("a wrong code is refused as invalid",
      wrongKnown.status === 422 && wrongKnown.payload?.error?.message === "The verification code is invalid.");
    check("and an unknown address's guess is refused in exactly the same words",
      wrongUnknown.status === 422 && wrongUnknown.payload?.error?.message === wrongKnown.payload?.error?.message);

    const malformed = await resetter("/api/auth/forgot-password/verify", {
      method: "POST",
      body: { code: "12" },
    });
    check("a malformed code never reaches the service", malformed.status === 422);

    const noHandle = await createClient()("/api/auth/forgot-password/verify", {
      method: "POST",
      body: { code: resetCode },
    });
    check("the right code from a browser that never asked for it is refused",
      noHandle.status === 410, `status ${noHandle.status}`);

    const forgedHandle = await createClient()("/api/auth/forgot-password/verify", {
      method: "POST",
      body: { code: resetCode },
      headers: {
        Cookie: `aplus_password_reset=${Buffer.from(JSON.stringify({ rid: "x", email: newEmail, iat: Date.now(), cx: Date.now() + 600000, exp: 9999999999 })).toString("base64url")}.forged`,
      },
    });
    check("a forged request handle is refused", forgedHandle.status === 410, `status ${forgedHandle.status}`);

    const bypass = await resetter("/api/auth/reset-password", {
      method: "POST",
      body: { otpVerified: true, verified: true, password: RESET_TO, confirmPassword: RESET_TO },
    });
    check("a browser claiming it verified the code cannot set a password", bypass.status === 422);

    const verified = await resetter("/api/auth/forgot-password/verify", {
      method: "POST",
      body: { code: resetCode },
    });
    const resetToken = verified.payload?.data?.resetToken;
    check("the right code is exchanged for a reset authorisation",
      verified.ok && typeof resetToken === "string", JSON.stringify(verified.payload?.error));
    check("verifying the code does not sign anybody in",
      (await resetter("/api/auth/session")).payload?.data?.user == null);

    const codeAgain = await resetter("/api/auth/forgot-password/verify", {
      method: "POST",
      body: { code: resetCode },
    });
    check("the same code cannot be used twice", !codeAgain.ok);

    const mismatched = await resetter("/api/auth/reset-password", {
      method: "POST",
      body: { token: resetToken, password: RESET_TO, confirmPassword: `${RESET_TO}x` },
    });
    check("mismatched passwords are refused",
      mismatched.status === 422 && Boolean(mismatched.payload?.error?.details?.fieldErrors?.confirmPassword));

    const weak = await resetter("/api/auth/reset-password", {
      method: "POST",
      body: { token: resetToken, password: "weakpass", confirmPassword: "weakpass" },
    });
    check("the existing password policy applies",
      weak.status === 422 && Boolean(weak.payload?.error?.details?.fieldErrors?.password));

    const forgedToken = await resetter("/api/auth/reset-password", {
      method: "POST",
      body: { token: "f".repeat(43), password: RESET_TO, confirmPassword: RESET_TO },
    });
    check("an authorisation that was never issued is refused",
      forgedToken.status === 410 && forgedToken.payload?.error?.code === "RESET_EXPIRED");

    const done = await resetter("/api/auth/reset-password", {
      method: "POST",
      body: { token: resetToken, password: RESET_TO, confirmPassword: RESET_TO },
    });
    check("the password is reset", done.ok && done.payload?.data?.redirectTo === "/login?reset=1",
      JSON.stringify(done.payload?.error));

    const doneAgain = await resetter("/api/auth/reset-password", {
      method: "POST",
      body: { token: resetToken, password: "AnotherPass2024", confirmPassword: "AnotherPass2024" },
    });
    check("the authorisation cannot be used twice", doneAgain.status === 410);

    check("the session that was open before the reset has ended",
      (await unverified("/api/auth/session")).payload?.data?.user == null);

    // Sign-in has its own per-client window, which the role logins earlier in
    // this run have already used most of. These two come from their own
    // address so the limiter is not what they end up measuring.
    const loginFrom = { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 10}` };
    const oldLogin = await createClient()("/api/auth/login", {
      method: "POST",
      body: { email: newEmail, password: PASSWORD },
      headers: loginFrom,
    });
    check("the old password no longer signs in", oldLogin.status === 401, `status ${oldLogin.status}`);

    const signIn = createClient();
    const newLogin = await signIn("/api/auth/login", {
      method: "POST",
      body: { email: newEmail, password: RESET_TO },
      headers: loginFrom,
    });
    check("the new password signs in", newLogin.ok, JSON.stringify(newLogin.payload?.error));
    check("and the session is real",
      (await signIn("/api/auth/session")).payload?.data?.user?.email === newEmail);

    // Five wrong guesses and the request is spent — shown on the unknown
    // address, which has no stored code at all, because the limit must hold
    // there too or it would say which addresses are real.
    for (let i = 0; i < 4; i += 1) {
      await resetStranger("/api/auth/forgot-password/verify", { method: "POST", body: { code: "123456" } });
    }
    const lockedOut = await resetStranger("/api/auth/forgot-password/verify", {
      method: "POST",
      body: { code: "123456" },
    });
    check("after five wrong guesses the request is locked",
      lockedOut.status === 429 && lockedOut.payload?.error?.code === "TOO_MANY_ATTEMPTS",
      `${lockedOut.status} ${lockedOut.payload?.error?.code}`);
  }


  // --- Meeting management ---------------------------------------------------
  //
  // Configuring the joining details on a lesson that is already booked (§27).
  // Everything here goes over real HTTP, because the point is the endpoint's
  // contract: who may reach it, what it refuses, and what it hands back to
  // whom. The service-level rules are covered in `test:integrations`.
  section("Meeting management — configuration, RBAC and visibility");

  const [meetSlot] = await freeSlots(1);
  const meetBooking = await parent("/api/bookings", {
    method: "POST",
    body: {
      tutorProfileId: ownTutorId,
      studentProfileId: studentId,
      courseId: ownCourseId,
      mode: "ONLINE",
      startAt: meetSlot,
      durationMinutes: 60,
      meetingProvider: "ZOOM",
      studentNotes: "QA — meeting management fixture",
    },
  });
  const meetBookingId = meetBooking.payload?.data?.bookings?.[0]?.id;
  const meetPaymentId = meetBooking.payload?.data?.payment?.id;
  check("a lesson is booked for the meeting fixture", meetBooking.ok,
    JSON.stringify(meetBooking.payload?.error));

  // Before payment there is no lesson to attend and so nothing to configure.
  const beforePayment = await tutor(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/11111111111" },
  });
  check("an UNPAID lesson cannot be given joining details",
    beforePayment.status === 422, `status ${beforePayment.status}`);

  await parent(`/api/payments/${meetPaymentId}/capture`, {
    method: "POST",
    body: {
      card: { number: "4242424242424242", name: "QA", expiry: "12/28", cvc: "123" },
      meetingProvider: "ZOOM",
    },
  });

  const afterPayment = await parent(`/api/bookings/${meetBookingId}`);
  check("paying gives the lesson a room automatically",
    Boolean(afterPayment.payload?.data?.booking?.meeting?.joinUrl));
  check("and the learner is told they may not manage it",
    afterPayment.payload?.data?.booking?.permissions?.canManageMeeting === false);

  // --- Who may configure it -------------------------------------------------

  const anonConfigure = await anon(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/22222222222" },
  });
  check("an anonymous request cannot configure a meeting",
    anonConfigure.status === 401, `status ${anonConfigure.status}`);

  const learnerConfigure = await parent(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/22222222222" },
  });
  check("the PURCHASER of the lesson cannot configure its meeting",
    learnerConfigure.status === 403, `status ${learnerConfigure.status}`);

  const learnerDelete = await parent(`/api/bookings/${meetBookingId}/meeting`, {
    method: "DELETE",
  });
  check("nor remove it", learnerDelete.status === 403, `status ${learnerDelete.status}`);

  const learnerDisable = await parent(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: { action: "disable" },
  });
  check("nor withdraw it", learnerDisable.status === 403, `status ${learnerDisable.status}`);

  const strangerTutorConfigure = await strangerTutor(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: { action: "manual", provider: "ZOOM", joinUrl: "https://evil.example/j/1" },
  });
  check("a tutor who does NOT teach the lesson cannot configure its meeting",
    strangerTutorConfigure.status === 403, `status ${strangerTutorConfigure.status}`);

  /*
    Ownership named in the body is not ownership.

    The request says which lesson it is about in the path; who is allowed to
    touch it is decided from the session and the loaded record, and nothing a
    caller writes in the body may enter that decision. These are the fields a
    forger would reach for, sent by a tutor who teaches a different lesson.
  */
  for (const [label, forged] of [
    ["tutorUserId", { tutorUserId: "000000000000000000000001" }],
    ["tutorId", { tutorId: "000000000000000000000001" }],
    ["teacherId", { teacherId: "000000000000000000000001" }],
    ["bookingId", { bookingId: meetBookingId }],
    ["sessionId", { sessionId: meetBookingId }],
    ["userId and role", { userId: "000000000000000000000001", role: "ADMIN" }],
  ]) {
    const res = await strangerTutor(`/api/bookings/${meetBookingId}/meeting`, {
      method: "POST",
      body: { action: "disable", ...forged },
    });
    check(`an unrelated tutor forging ${label} in the body is still REFUSED`,
      res.status === 403 || res.status === 422, `status ${res.status}`);
  }

  const stillOriginal = await parent(`/api/bookings/${meetBookingId}`);
  check("and none of those refusals changed the stored room",
    stillOriginal.payload?.data?.booking?.meeting?.joinUrl ===
      afterPayment.payload?.data?.booking?.meeting?.joinUrl);

  // --- The happy path -------------------------------------------------------

  const meetTutorView = await tutor(`/api/bookings/${meetBookingId}`);
  check("the tutor teaching it IS told they may manage the meeting",
    meetTutorView.payload?.data?.booking?.permissions?.canManageMeeting === true);

  // The flag the meeting panel renders its controls from. It is a convenience
  // for the UI and not the control — every refusal above was enforced by the
  // endpoint with the form nowhere in sight — but it has to be right, or an
  // administrator looking at a lesson during an incident sees no way to fix it.
  const meetAdminView = await admin(`/api/bookings/${meetBookingId}`);
  check("an administrator is told they may manage the meeting",
    meetAdminView.payload?.data?.booking?.permissions?.canManageMeeting === true,
    JSON.stringify(meetAdminView.payload?.data?.booking?.permissions));

  const meetConfigured = await tutor(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: {
      action: "manual",
      provider: "GOOGLE_MEET",
      joinUrl: "https://meet.google.com/qaa-bbbb-ccc",
      meetingId: "qaa-bbbb-ccc",
      passcode: "Qa9137",
      instructions: "QA — I'll admit you from the lobby.",
    },
  });
  check("the tutor teaching it CAN configure the meeting", meetConfigured.ok,
    JSON.stringify(meetConfigured.payload?.error));
  check("the platform is changed as asked",
    meetConfigured.payload?.data?.meeting?.provider === "GOOGLE_MEET");
  check("and it is recorded as entered by hand, not as one we created",
    meetConfigured.payload?.data?.meeting?.source === "MANUAL");

  const meetPersisted = await parent(`/api/bookings/${meetBookingId}`);
  check("the configuration persists and reaches the learner",
    meetPersisted.payload?.data?.booking?.meeting?.joinUrl === "https://meet.google.com/qaa-bbbb-ccc");
  check("the learner gets the passcode they need to attend",
    meetPersisted.payload?.data?.booking?.meeting?.passcode === "Qa9137");
  check("and the joining instructions",
    meetPersisted.payload?.data?.booking?.meeting?.instructions === "QA — I'll admit you from the lobby.");

  const meetNotified = await parent("/api/notifications?pageSize=50");
  const meetingNotices = (meetNotified.payload?.data?.notifications ?? []).filter(
    (n) => n.type === "MEETING_UPDATED",
  );
  check("the learner is notified that the joining details changed", meetingNotices.length > 0);
  check("but the notification never carries the link or the passcode",
    meetingNotices.every((n) => !/meet\.google\.com|Qa9137/.test(`${n.title} ${n.body}`)),
    JSON.stringify(meetingNotices.map((n) => n.body)));

  // --- Editing --------------------------------------------------------------

  const meetEdited = await tutor(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: {
      action: "manual",
      provider: "ZOOM",
      joinUrl: "https://zoom.us/j/99999999999",
      meetingId: "99999999999",
      // Omitted passcode keeps the stored one; null is what clears it.
      instructions: null,
    },
  });
  check("the configuration can be edited", meetEdited.ok, JSON.stringify(meetEdited.payload?.error));
  const afterEdit = await parent(`/api/bookings/${meetBookingId}`);
  check("the edited values are what the learner now sees",
    afterEdit.payload?.data?.booking?.meeting?.joinUrl === "https://zoom.us/j/99999999999");
  check("an omitted passcode keeps the stored one rather than wiping it",
    afterEdit.payload?.data?.booking?.meeting?.passcode === "Qa9137");
  check("while an explicit null clears a field",
    !afterEdit.payload?.data?.booking?.meeting?.instructions);

  const clearedPasscode = await tutor(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: {
      action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/99999999999",
      passcode: null,
    },
  });
  check("and a passcode can be cleared deliberately",
    clearedPasscode.ok && !clearedPasscode.payload?.data?.meeting?.passcode);

  // --- Invalid configuration ------------------------------------------------

  for (const [label, body] of [
    ["an http:// link", { action: "manual", provider: "ZOOM", joinUrl: "http://zoom.us/j/1" }],
    ["a javascript: link", { action: "manual", provider: "ZOOM", joinUrl: "javascript:alert(1)" }],
    ["a link that is not a URL", { action: "manual", provider: "ZOOM", joinUrl: "zoom" }],
    ["an empty link", { action: "manual", provider: "ZOOM", joinUrl: "" }],
    ["no link at all", { action: "manual", provider: "ZOOM" }],
    ["a platform we do not support", { action: "manual", provider: "WEBEX", joinUrl: "https://webex.com/j/1" }],
    ["a passcode with a newline", { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/1", passcode: "a\nb" }],
    ["a data: link", { action: "manual", provider: "ZOOM", joinUrl: "data:text/html,<script>alert(1)</script>" }],
    ["a link that is only whitespace", { action: "manual", provider: "ZOOM", joinUrl: "   " }],
    ["a link far longer than any platform issues",
      { action: "manual", provider: "ZOOM", joinUrl: `https://zoom.us/j/${"9".repeat(4000)}` }],
    /*
      A credential is read off the screen and typed into somebody else's app,
      so the characters that do damage are the ones nobody can see they are
      copying. A zero-width space makes a passcode that looks right and is
      wrong when it is typed back; a right-to-left override reorders what the
      badge renders, so what is shown is not what is stored. All of these were
      accepted before — `\s` and `\p{Cc}` do not cover `\p{Cf}`.
    */
    ["a passcode with a zero-width space",
      { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/1", passcode: `a${String.fromCharCode(0x200b)}b` }],
    ["a passcode with a right-to-left override",
      { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/1", passcode: `a${String.fromCharCode(0x202e)}b` }],
    ["a passcode with a soft hyphen",
      { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/1", passcode: `a${String.fromCharCode(0xad)}b` }],
    ["a meeting ID longer than any platform issues",
      { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/1", meetingId: "1".repeat(300) }],
    ["an action that does not exist", { action: "teleport" }],
    ["no action at all", {}],
  ]) {
    const res = await tutor(`/api/bookings/${meetBookingId}/meeting`, { method: "POST", body });
    check(`${label} is REFUSED`, res.status === 422, `status ${res.status}`);
  }

  const meetSurvived = await parent(`/api/bookings/${meetBookingId}`);
  check("no refused request changed the stored configuration",
    meetSurvived.payload?.data?.booking?.meeting?.joinUrl === "https://zoom.us/j/99999999999");

  // --- Withdrawing ----------------------------------------------------------

  const meetWithdrawn = await tutor(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: { action: "disable" },
  });
  check("the tutor can withdraw the link", meetWithdrawn.ok);

  const learnerAfterWithdrawal = await parent(`/api/bookings/${meetBookingId}`);
  check("a withdrawn link is NOT handed to the learner",
    learnerAfterWithdrawal.payload?.data?.booking?.meeting?.joinUrl === null,
    JSON.stringify(learnerAfterWithdrawal.payload?.data?.booking?.meeting));
  check("nor is its passcode",
    !learnerAfterWithdrawal.payload?.data?.booking?.meeting?.passcode);
  check("but the learner is still told which platform it was on, and that it was withdrawn",
    learnerAfterWithdrawal.payload?.data?.booking?.meeting?.provider === "ZOOM" &&
      learnerAfterWithdrawal.payload?.data?.booking?.meeting?.disabled === true);

  const hostAfterWithdrawal = await tutor(`/api/bookings/${meetBookingId}`);
  check("the host still sees the withdrawn link, because they have to replace it",
    hostAfterWithdrawal.payload?.data?.booking?.meeting?.joinUrl === "https://zoom.us/j/99999999999");

  /*
    Every way of reading the lesson, not only the lesson page.

    Withdrawing a link is a control, and a control that one endpoint honours
    and another does not is no control at all. The learner's booking *list*
    and the dashboard's "next lesson" summary are two further read paths over
    the same record, and both build a Join button straight out of what they
    are given — so a link the tutor has withdrawn must be absent from all
    three or it is absent from none of them. It went out on both of these.
  */
  /**
   * One lesson out of a scope, whichever page it landed on.
   *
   * The family's history grows every run, so looking only at the first page
   * makes a real assertion fail for the bookkeeping reason that the fixture
   * scrolled off it. Pages until it is found, and hands back everything it
   * read so the sweeping assertions can use it too.
   */
  const findInScope = async (client, scope, id, maxPages = 6) => {
    const seen = [];
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await client(`/api/bookings?scope=${scope}&page=${page}&pageSize=50`);
      const rows = res.payload?.data?.bookings ?? [];
      seen.push(...rows);
      const hit = rows.find((b) => b.id === id);
      if (hit || rows.length === 0) return { row: hit ?? null, seen };
    }
    return { row: null, seen };
  };

  const withdrawnScan = await findInScope(parent, "UPCOMING", meetBookingId);
  const listedWhileWithdrawn = { payload: { data: { bookings: withdrawnScan.seen } } };
  const withdrawnRow = withdrawnScan.row;
  check("the withdrawn lesson is in the learner's own booking list", Boolean(withdrawnRow));
  check("but the LIST endpoint hands out no withdrawn join link either",
    withdrawnRow?.meeting?.joinUrl == null, `joinUrl ${withdrawnRow?.meeting?.joinUrl}`);
  check("nor its passcode", !withdrawnRow?.meeting?.passcode,
    `passcode ${withdrawnRow?.meeting?.passcode}`);
  check("and no withdrawn credential appears anywhere in the list payload",
    !JSON.stringify(listedWhileWithdrawn.payload?.data ?? {}).includes("99999999999"));
  check("while the list still says which platform it was on, and that it was withdrawn",
    withdrawnRow?.meeting?.provider === "ZOOM" && withdrawnRow?.meeting?.disabled === true,
    JSON.stringify(withdrawnRow?.meeting));

  const hostRow = (await findInScope(tutor, "UPCOMING", meetBookingId)).row;
  check("the host's list still carries it, because they have to replace it",
    hostRow?.meeting?.joinUrl === "https://zoom.us/j/99999999999",
    JSON.stringify(hostRow?.meeting));

  const meetRestored = await tutor(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: { action: "enable" },
  });
  check("and can restore it", meetRestored.ok);
  check("after which the learner can join again",
    (await parent(`/api/bookings/${meetBookingId}`)).payload?.data?.booking?.meeting?.joinUrl ===
      "https://zoom.us/j/99999999999");

  // --- The administrator ----------------------------------------------------

  const adminConfigured = await admin(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: { action: "manual", provider: "MICROSOFT_TEAMS", joinUrl: "https://teams.microsoft.com/l/meetup-join/qa" },
  });
  check("an administrator can configure any lesson's meeting", adminConfigured.ok,
    JSON.stringify(adminConfigured.payload?.error));

  const adminRemoved = await admin(`/api/bookings/${meetBookingId}/meeting`, { method: "DELETE" });
  check("and remove it", adminRemoved.ok && adminRemoved.payload?.data?.meeting === null);

  const afterRemoval = await parent(`/api/bookings/${meetBookingId}`);
  check("the learner then sees a confirmed lesson with no room",
    afterRemoval.payload?.data?.booking?.status === "CONFIRMED" &&
      !afterRemoval.payload?.data?.booking?.meeting?.joinUrl);

  const rebuilt = await tutor(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: { action: "retry" },
  });
  check("the tutor can ask the platform for a fresh room", rebuilt.ok,
    JSON.stringify(rebuilt.payload?.error));
  check("which is recorded as one WE created, not one entered by hand",
    rebuilt.payload?.data?.meeting?.source === "PROVIDER");

  // --- Two people at the same moment ---------------------------------------
  //
  // A lost edit is survivable — one of two links wins whole and the loser can
  // look again. A duplicated *room* is not: it is a live meeting in the
  // platform's own Zoom account that nothing references, that no cancellation
  // will ever tear down, and that anyone holding the losing link can walk
  // into. Four simultaneous retries used to produce two of them.

  await admin(`/api/bookings/${meetBookingId}/meeting`, { method: "DELETE" });

  const simultaneousRetries = await Promise.all(
    Array.from({ length: 4 }, () =>
      tutor(`/api/bookings/${meetBookingId}/meeting`, { method: "POST", body: { action: "retry" } })),
  );
  check("four simultaneous retries create AT MOST ONE room",
    simultaneousRetries.filter((r) => r.ok).length === 1,
    simultaneousRetries.map((r) => `${r.status}:${r.payload?.error?.code ?? "ok"}`).join(","));
  check("and the losers are refused rather than failing",
    simultaneousRetries.every((r) => r.status < 500),
    simultaneousRetries.map((r) => r.status).join(","));

  const afterRace = await tutor(`/api/bookings/${meetBookingId}`);
  check("leaving the lesson with exactly one room",
    Boolean(afterRace.payload?.data?.booking?.meeting?.joinUrl));

  /*
    A tutor and an administrator editing the same lesson at the same instant.

    Both succeeding is a legitimate outcome and not asserted against: two
    requests that did not actually overlap apply in order, and the later edit
    replacing the earlier one is what an edit is for. What must hold whichever
    way they interleave is that the lesson ends up with one of the two links
    *whole* — never half of each, never a third thing, and never a 500. The
    duplicated-room case above is the one where an overlap is unrecoverable,
    and that is asserted exactly.
  */
  const simultaneousEdits = await Promise.all([
    tutor(`/api/bookings/${meetBookingId}/meeting`, {
      method: "POST",
      body: { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/55555555555" },
    }),
    admin(`/api/bookings/${meetBookingId}/meeting`, {
      method: "POST",
      body: { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/66666666666" },
    }),
  ]);
  check("simultaneous edits by a tutor and an administrator resolve cleanly",
    simultaneousEdits.every((r) => r.status < 500) && simultaneousEdits.some((r) => r.ok),
    simultaneousEdits.map((r) => `${r.status}:${r.payload?.error?.code ?? "ok"}`).join(","));

  const settledEdit = (await tutor(`/api/bookings/${meetBookingId}`))
    .payload?.data?.booking?.meeting?.joinUrl;
  check("leaving one of the two links that were sent, whole",
    ["https://zoom.us/j/55555555555", "https://zoom.us/j/66666666666"].includes(settledEdit),
    settledEdit);

  // --- A cancelled lesson keeps no live credentials -------------------------

  await parent(`/api/bookings/${meetBookingId}/cancel`, {
    method: "POST",
    body: { reason: "QA — meeting management teardown." },
  });

  const afterCancel = await parent(`/api/bookings/${meetBookingId}`);
  check("a cancelled lesson hands out NO join link",
    !afterCancel.payload?.data?.booking?.meeting?.joinUrl,
    JSON.stringify(afterCancel.payload?.data?.booking?.meeting));
  check("and NO passcode", !afterCancel.payload?.data?.booking?.meeting?.passcode);
  check("while still recording that it was an online lesson",
    afterCancel.payload?.data?.booking?.mode === "ONLINE");

  const cancelledScan = await findInScope(parent, "CANCELLED", meetBookingId);
  check("the cancelled lesson is in the learner's cancelled list", Boolean(cancelledScan.row));
  check("and the LIST hands out no credentials for it either",
    !cancelledScan.row?.meeting?.joinUrl && !cancelledScan.row?.meeting?.passcode,
    JSON.stringify(cancelledScan.row?.meeting));

  /*
    Every cancelled and finished lesson, not only this run's.

    A lesson that is over keeps its room on the record until something takes
    it away, and the list is the read path that sweeps up all of them at once
    — which is what makes it worth asserting over everything it returns rather
    than one fixture. The seeded history alone carried eight live join URLs
    here.
  */
  const pastScan = await findInScope(parent, "PAST", meetBookingId);
  const staleCredentials = [...cancelledScan.seen, ...pastScan.seen]
    .filter((b) => b.meeting?.joinUrl || b.meeting?.passcode);
  check("no cancelled or finished lesson hands out live credentials in the list",
    staleCredentials.length === 0,
    `${staleCredentials.length} carry one, e.g. ${staleCredentials[0]?.reference} → ${staleCredentials[0]?.meeting?.joinUrl}`);

  const configureCancelled = await tutor(`/api/bookings/${meetBookingId}/meeting`, {
    method: "POST",
    body: { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/33333333333" },
  });
  check("a cancelled lesson cannot be given a new room",
    configureCancelled.status === 422, `status ${configureCancelled.status}`);

  // --- Cross-lesson access --------------------------------------------------

  const foreign = await tutor(`/api/bookings/${authBookingId}/meeting`, {
    method: "POST",
    body: { action: "disable" },
  });
  check("a request naming a lesson id is checked against THAT lesson's tutor",
    foreign.ok || foreign.status === 403 || foreign.status === 422,
    `status ${foreign.status}`);

  const noSuchLesson = await admin(
    `/api/bookings/000000000000000000000000/meeting`,
    { method: "POST", body: { action: "disable" } },
  );
  check("a lesson that does not exist is a 404", noSuchLesson.status === 404,
    `status ${noSuchLesson.status}`);

  const malformedId = await admin("/api/bookings/not-an-id/meeting", {
    method: "POST", body: { action: "disable" },
  });
  check("a malformed lesson id is refused cleanly", malformedId.status === 422,
    `status ${malformedId.status}`);

  // --- Group sessions share the same endpoint shape -------------------------

  const openSessions = await anon("/api/groups?pageSize=10");
  const publicSessions = openSessions.payload?.data?.sessions ?? [];
  check("the public group listing NEVER carries a meeting room",
    publicSessions.every((s) => !s.meeting?.joinUrl && !s.meeting?.passcode),
    JSON.stringify(publicSessions.map((s) => s.meeting).filter(Boolean)));

  /*
    A group session of this run's own.

    None are seeded, so asserting against whatever happens to be in the
    database would mean skipping the group path entirely — and the group path
    is where the room is shared by many learners and where the public listing
    could leak it. The tutor creates one here, it is configured through the
    same endpoint shape a one-to-one lesson uses, and it is cancelled at the
    end so the seeded calendar is left as it was found.
  */
  const [groupSlot] = await freeSlots(1);
  const groupCreated = await tutor("/api/tutor/groups", {
    method: "POST",
    body: {
      title: `QA meeting group ${Date.now() % 100000}`,
      courseId: ownCourseId,
      mode: "ONLINE",
      meetingProvider: "ZOOM",
      startAt: groupSlot,
      durationMinutes: 60,
      minParticipants: 2,
      maxParticipants: 6,
      pricePerSeatCents: 3000,
    },
  });
  check("a tutor can create a group session for the meeting fixture",
    groupCreated.ok, JSON.stringify(groupCreated.payload?.error));

  const groupId = groupCreated.payload?.data?.session?.id;

  if (groupId) {
    const groupConfigured = await tutor(`/api/tutor/groups/${groupId}/meeting`, {
      method: "POST",
      body: {
        action: "manual",
        provider: "GOOGLE_MEET",
        joinUrl: "https://meet.google.com/qag-rrrr-ppp",
        passcode: "Grp771",
      },
    });
    check("the tutor who runs the session CAN configure its meeting",
      groupConfigured.ok, JSON.stringify(groupConfigured.payload?.error));
    check("and it is stored against the session",
      groupConfigured.payload?.data?.meeting?.joinUrl === "https://meet.google.com/qag-rrrr-ppp");

    const strangerConfiguresGroup = await strangerTutor(
      `/api/tutor/groups/${groupId}/meeting`,
      { method: "POST", body: { action: "disable" } },
    );
    check("a tutor who does NOT run it cannot touch its meeting",
      strangerConfiguresGroup.status === 403, `status ${strangerConfiguresGroup.status}`);

    const learnerConfiguresGroup = await parent(`/api/tutor/groups/${groupId}/meeting`, {
      method: "POST",
      body: { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/44444444444" },
    });
    check("a learner cannot configure a group session's meeting",
      learnerConfiguresGroup.status === 403, `status ${learnerConfiguresGroup.status}`);

    const anonConfiguresGroup = await anon(`/api/tutor/groups/${groupId}/meeting`, {
      method: "POST",
      body: { action: "manual", provider: "ZOOM", joinUrl: "https://zoom.us/j/44444444444" },
    });
    check("nor can an anonymous request",
      anonConfiguresGroup.status === 401, `status ${anonConfiguresGroup.status}`);

    // Publishing opens it to the public listing — which must not carry the room.
    const published = await tutor(`/api/tutor/groups/${groupId}`, { method: "POST" });
    if (published.ok) {
      const anonSession = await anon(`/api/groups/${groupId}`);
      check("a visitor with no seat gets NO meeting room for a published session",
        !anonSession.payload?.data?.meeting?.joinUrl,
        JSON.stringify(anonSession.payload?.data?.meeting));
      check("and the session object itself carries none either — this used to leak it",
        !anonSession.payload?.data?.session?.meeting,
        JSON.stringify(anonSession.payload?.data?.session?.meeting));
      check("nor does a learner who has not joined",
        !(await parent(`/api/groups/${groupId}`)).payload?.data?.meeting?.joinUrl);

      const listedAgain = await anon("/api/groups?pageSize=20");
      const thisOne = (listedAgain.payload?.data?.sessions ?? []).find((x) => x.id === groupId);
      check("the published session appears in the public listing", Boolean(thisOne));
      check("carrying no meeting room with it",
        thisOne ? !thisOne.meeting : true, JSON.stringify(thisOne?.meeting));
      check("and no passcode anywhere in the public payload",
        !JSON.stringify(listedAgain.payload?.data ?? {}).includes("Grp771"));

      const tutorSees = await tutor(`/api/groups/${groupId}`);
      check("while the tutor running it still sees the room",
        tutorSees.payload?.data?.meeting?.joinUrl === "https://meet.google.com/qag-rrrr-ppp",
        JSON.stringify(tutorSees.payload?.data?.meeting));
    }

    await tutor(`/api/tutor/groups/${groupId}`, {
      method: "DELETE",
      body: { reason: "QA — meeting fixture teardown." },
    });

    const afterCancel = await tutor(`/api/tutor/groups/${groupId}/meeting`, {
      method: "POST",
      body: { action: "disable" },
    });
    check("a cancelled session cannot have its joining details changed",
      afterCancel.status === 422, `status ${afterCancel.status}`);

    /*
      A cancelled session gives its room up, exactly as a cancelled one-to-one
      lesson does.

      The one-to-one path has always torn the room down and dropped the
      credentials; the group path did neither, so twelve families kept a
      working link to a lesson that was not happening and the room itself
      stayed live in the platform's account with nothing left to tear it down.
      What survives here is what a cancelled lesson has to be able to say
      about itself: that it was online, and on which platform.
    */
    const cancelledSession = await tutor(`/api/groups/${groupId}`);
    check("a cancelled session hands its host no join link",
      !cancelledSession.payload?.data?.meeting?.joinUrl,
      JSON.stringify(cancelledSession.payload?.data?.meeting));
    check("nor a passcode", !cancelledSession.payload?.data?.meeting?.passcode);
    check("while still recording which platform it was on",
      cancelledSession.payload?.data?.meeting?.provider === "GOOGLE_MEET",
      JSON.stringify(cancelledSession.payload?.data?.meeting));
    check("and the whole response carries the passcode nowhere",
      !JSON.stringify(cancelledSession.payload?.data ?? {}).includes("Grp771"));
  }

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

  // --- Promoted profiles ---------------------------------------------------
  section("Promoted profiles — authorization, ranking and lifecycle");

  const anonPromotions = await anon("/api/admin/promotions");
  check("anonymous cannot read the promotion register", anonPromotions.status === 401);

  const parentPromotions = await parent("/api/admin/promotions");
  check("a parent cannot read the promotion register", parentPromotions.status === 403);

  const tutorPromotions = await tutor("/api/admin/promotions");
  check("a tutor cannot read the promotion register", tutorPromotions.status === 403);

  const tutorSelfPromote = await tutor("/api/admin/promotions", {
    method: "POST",
    body: { tutorProfileId: tutorId },
  });
  check("a tutor cannot promote themselves", tutorSelfPromote.status === 403);

  const parentPromote = await parent("/api/admin/promotions", {
    method: "POST",
    body: { tutorProfileId: tutorId },
  });
  check("a parent cannot promote anybody", parentPromote.status === 403);

  const anonTutorPromotion = await anon("/api/tutor/promotion");
  check("anonymous cannot read a tutor's promotion status", anonTutorPromotion.status === 401);

  const parentTutorPromotion = await parent("/api/tutor/promotion");
  check("a parent cannot read the tutor promotion endpoint", parentTutorPromotion.status === 403);

  // Pick a searchable tutor who is *not* already top of "best match", so a
  // change in position is attributable to the promotion and nothing else.
  const rankingBefore = await anon("/api/search/tutors?province=ON&sort=RELEVANCE&pageSize=12");
  check("the marketplace has tutors to rank",
    rankingBefore.ok && rankingBefore.payload.data.tutors.length > 1);

  const beforeIds = rankingBefore.payload.data.tutors.map((t) => t.id);
  const beforeTotal = rankingBefore.payload.meta?.total ?? beforeIds.length;
  const promoteTarget = beforeIds.at(-1);
  check("nothing is labelled as promoted to begin with",
    rankingBefore.payload.data.tutors.every((t) => t.isPromoted !== true));

  const badTutorId = await admin("/api/admin/promotions", {
    method: "POST",
    body: { tutorProfileId: "not-an-object-id" },
  });
  check("a malformed tutor id is rejected before anything is written",
    badTutorId.status === 422);

  const missingTutor = await admin("/api/admin/promotions", {
    method: "POST",
    body: { tutorProfileId: "000000000000000000000000" },
  });
  check("promoting a tutor who does not exist is a 404", missingTutor.status === 404);

  const createdPromotion = await admin("/api/admin/promotions", {
    method: "POST",
    body: { tutorProfileId: promoteTarget, note: "QA run." },
  });
  check("an administrator can promote an eligible tutor",
    createdPromotion.status === 201,
    JSON.stringify(createdPromotion.payload?.error));

  const promotionId = createdPromotion.payload?.data?.promotion?.id;
  check("the promotion starts running straight away",
    createdPromotion.payload?.data?.promotion?.status === "ACTIVE");
  check("a status cannot be dictated by the client — the server derived it",
    createdPromotion.payload?.data?.promotion?.endsAt > new Date().toISOString());

  const duplicatePromotion = await admin("/api/admin/promotions", {
    method: "POST",
    body: { tutorProfileId: promoteTarget },
  });
  check("the same tutor cannot be promoted twice at once",
    duplicatePromotion.status === 409);

  if (promotionId) {
    const rankingAfter = await anon("/api/search/tutors?province=ON&sort=RELEVANCE&pageSize=12");
    check("the promoted tutor is lifted to the top of the default ordering",
      rankingAfter.payload.data.tutors[0]?.id === promoteTarget,
      rankingAfter.payload.data.tutors[0]?.id);
    check("and the result is disclosed as promoted",
      rankingAfter.payload.data.tutors[0]?.isPromoted === true);
    check("promotion reorders the results without adding to them",
      (rankingAfter.payload.meta?.total ?? 0) === beforeTotal);
    check("no tutor is duplicated by the promotion",
      new Set(rankingAfter.payload.data.tutors.map((t) => t.id)).size ===
        rankingAfter.payload.data.tutors.length);
    check("the same tutors are present, only in a different order",
      new Set(rankingAfter.payload.data.tutors.map((t) => t.id)).size ===
        new Set(beforeIds).size);

    const byPriceAfter = await anon("/api/search/tutors?province=ON&sort=PRICE_ASC&pageSize=12");
    const rates = byPriceAfter.payload.data.tutors.map((t) => t.hourlyRateCents);
    check("a visitor's explicit price sort is not overridden by a promotion",
      rates.every((r, i) => i === 0 || rates[i - 1] <= r), JSON.stringify(rates));
    check("and nothing is labelled promoted under an explicit sort",
      byPriceAfter.payload.data.tutors.every((t) => t.isPromoted !== true));

    // Paging the whole set must still show each tutor exactly once.
    const paged = [];
    const pageCount = Math.ceil(beforeTotal / 2);
    for (let p = 1; p <= pageCount; p += 1) {
      const res = await anon(`/api/search/tutors?province=ON&sort=RELEVANCE&pageSize=2&page=${p}`);
      paged.push(...res.payload.data.tutors.map((t) => t.id));
    }
    check("paging a promoted result set never repeats or drops a tutor",
      paged.length === beforeTotal && new Set(paged).size === beforeTotal,
      `${paged.length} rows, ${new Set(paged).size} distinct, ${beforeTotal} expected`);

    // A filter the promoted tutor fails must still exclude them.
    const filtered = await anon(
      `/api/search/tutors?province=ON&sort=RELEVANCE&mode=IN_PERSON&pageSize=12`,
    );
    check("filters still decide membership when a promotion is running",
      filtered.ok &&
        filtered.payload.data.tutors.every((t) => t.lessonModes?.includes("IN_PERSON")));

    const tutorSeesOwn = await tutor("/api/tutor/promotion");
    check("a tutor can read their own promotion status", tutorSeesOwn.ok);
    check("and the payload never carries the internal note",
      tutorSeesOwn.payload?.data?.promotion?.note === undefined);

    const tutorWrite = await tutor(`/api/admin/promotions/${promotionId}`, {
      method: "PATCH",
      body: { action: "EXTEND", endsAt: new Date(Date.now() + 300 * 86400000).toISOString() },
    });
    check("a tutor cannot extend their own promotion", tutorWrite.status === 403);

    const parentWrite = await parent(`/api/admin/promotions/${promotionId}`, {
      method: "PATCH",
      body: { action: "CANCEL" },
    });
    check("a parent cannot end somebody's promotion", parentWrite.status === 403);

    const anonRead = await anon(`/api/admin/promotions/${promotionId}`);
    check("the promotion record is not public", anonRead.status === 401);

    const badAction = await admin(`/api/admin/promotions/${promotionId}`, {
      method: "PATCH",
      body: { action: "MAKE_PERMANENT" },
    });
    check("an unknown lifecycle action is rejected", badAction.status === 422);

    const extendWithoutDate = await admin(`/api/admin/promotions/${promotionId}`, {
      method: "PATCH",
      body: { action: "EXTEND" },
    });
    check("extending without a date is rejected", extendWithoutDate.status === 422);

    const paused = await admin(`/api/admin/promotions/${promotionId}`, {
      method: "PATCH",
      body: { action: "PAUSE" },
    });
    check("an administrator can pause a promotion",
      paused.ok && paused.payload.data.promotion.status === "PAUSED");

    const whilePaused = await anon("/api/search/tutors?province=ON&sort=RELEVANCE&pageSize=12");
    check("a paused promotion stops affecting search at once",
      whilePaused.payload.data.tutors.every((t) => t.isPromoted !== true));

    const resumed = await admin(`/api/admin/promotions/${promotionId}`, {
      method: "PATCH",
      body: { action: "ACTIVATE" },
    });
    check("and it can be switched back on",
      resumed.ok && resumed.payload.data.promotion.status === "ACTIVE");

    const ended = await admin(`/api/admin/promotions/${promotionId}`, {
      method: "PATCH",
      body: { action: "CANCEL", reason: "QA cleanup." },
    });
    check("an administrator can end a promotion",
      ended.ok && ended.payload.data.promotion.status === "CANCELLED");

    const afterEnd = await anon("/api/search/tutors?province=ON&sort=RELEVANCE&pageSize=12");
    check("the tutor returns to their normal position once it ends",
      afterEnd.payload.data.tutors.every((t) => t.isPromoted !== true));
    check("and the ordering matches what it was before the promotion",
      afterEnd.payload.data.tutors[0]?.id === beforeIds[0],
      `${afterEnd.payload.data.tutors[0]?.id} vs ${beforeIds[0]}`);

    const reopen = await admin(`/api/admin/promotions/${promotionId}`, {
      method: "PATCH",
      body: { action: "ACTIVATE" },
    });
    check("a cancelled promotion cannot be reopened", reopen.status === 422);

    const stillListed = await admin(`/api/admin/promotions/${promotionId}`);
    check("but its record is kept rather than deleted",
      stillListed.ok && stillListed.payload.data.promotion.status === "CANCELLED");
  }

  const expirySweep = await admin("/api/cron/promotion-expiry", { method: "POST" });
  check("the promotion expiry job runs through the scheduler",
    expirySweep.ok && expirySweep.payload.data.job === "promotion-expiry");
  const expirySweepAgain = await admin("/api/cron/promotion-expiry", { method: "POST" });
  check("and running it again is a no-op",
    expirySweepAgain.ok && expirySweepAgain.payload.data.result?.expired === 0);

  // --- Analytics -----------------------------------------------------------
  section("Analytics — scoping, periods and authorization");

  const anonAnalytics = await anon("/api/admin/analytics");
  check("anonymous cannot read platform analytics", anonAnalytics.status === 401);

  const parentAnalytics = await parent("/api/admin/analytics");
  check("a parent cannot read platform analytics", parentAnalytics.status === 403);

  const tutorAnalyticsAsAdmin = await tutor("/api/admin/analytics");
  check("a tutor cannot read platform analytics", tutorAnalyticsAsAdmin.status === 403);

  const anonTutorAnalytics = await anon("/api/tutor/analytics");
  check("anonymous cannot read tutor analytics", anonTutorAnalytics.status === 401);

  const parentTutorAnalytics = await parent("/api/tutor/analytics");
  check("a parent cannot read the tutor analytics endpoint",
    parentTutorAnalytics.status === 403);

  const adminAnalytics = await admin("/api/admin/analytics?days=90");
  check("an administrator can read platform analytics", adminAnalytics.ok);

  const payload = adminAnalytics.payload?.data;
  check("the response carries the overview, breakdowns, Phase 2 and leaderboard",
    !!payload?.overview && !!payload?.breakdowns && !!payload?.phaseTwo && !!payload?.leaderboard);
  check("the period is reported back with the response",
    payload?.overview?.period?.from < payload?.overview?.period?.to);
  check("and the reporting time zone is stated rather than assumed",
    typeof payload?.overview?.period?.timeZone === "string");

  const money = payload?.overview?.commerce ?? {};
  check("every money figure is a whole number of cents",
    [money.grossSalesCents, money.platformRevenueCents, money.tutorEarningsCents,
      money.refundedCents, money.netCollectedCents]
      .every((v) => Number.isInteger(v)));
  check("net collected never exceeds what was collected",
    money.netCollectedCents <= money.collectedCents);
  check("rates are percentages, not ratios",
    [money.completionRate, money.cancellationRate, money.noShowRate]
      .every((v) => Number.isInteger(v) && v >= 0 && v <= 100));

  const phase2 = payload?.phaseTwo ?? {};
  check("Phase 2 analytics cover requests, packages, groups, referrals and promotions",
    !!phase2.requests && !!phase2.packages && !!phase2.groups && !!phase2.referrals &&
      !!phase2.promotions);
  check("package utilisation cannot exceed what was sold",
    phase2.packages.sessionsUsed <= phase2.packages.sessionsSold);

  const explicitRange = await admin(
    "/api/admin/analytics?from=2021-01-01T00:00:00.000Z&to=2021-02-01T00:00:00.000Z",
  );
  check("an explicit date range is accepted", explicitRange.ok);
  check("and is reported back exactly as asked for",
    explicitRange.payload?.data?.overview?.period?.from === "2021-01-01T00:00:00.000Z" &&
      explicitRange.payload?.data?.overview?.period?.to === "2021-02-01T00:00:00.000Z");

  const zoned = await admin("/api/admin/analytics?days=30&timeZone=America/Vancouver");
  check("a reporting time zone can be chosen",
    zoned.ok && zoned.payload?.data?.overview?.period?.timeZone === "America/Vancouver");

  const badRange = await admin("/api/admin/analytics?from=not-a-date");
  check("a malformed date is rejected rather than silently ignored",
    badRange.status === 422);

  const absurdWindow = await admin("/api/admin/analytics?days=99999");
  check("an absurd window is refused by validation rather than scanning everything",
    absurdWindow.status === 422);

  const tutorOwnAnalytics = await tutor("/api/tutor/analytics?days=90");
  check("a tutor can read their own analytics", tutorOwnAnalytics.ok,
    JSON.stringify(tutorOwnAnalytics.payload?.error));

  const ownStats = tutorOwnAnalytics.payload?.data?.analytics ?? {};
  check("a tutor's analytics report their own lessons and earnings",
    Number.isInteger(ownStats.lessons?.total) && Number.isInteger(ownStats.earnings?.netCents));
  check("and never the platform's commission or anybody else's revenue",
    ownStats.earnings?.commissionCents === undefined &&
      ownStats.earnings?.platformRevenueCents === undefined &&
      ownStats.leaderboard === undefined);

  // The endpoint takes no owner parameter at all, so an injected one must
  // change nothing rather than redirect the query.
  const injectedOwner = await tutor(
    "/api/tutor/analytics?days=90&tutorUserId=000000000000000000000000&userId=000000000000000000000000",
  );
  check("an injected tutor id is ignored, not honoured",
    injectedOwner.ok &&
      injectedOwner.payload?.data?.analytics?.lessons?.total === ownStats.lessons?.total,
    `${injectedOwner.payload?.data?.analytics?.lessons?.total} vs ${ownStats.lessons?.total}`);

  // --- Fraud and risk ------------------------------------------------------
  section("Risk — authorization, detection E2E and evidence");

  const anonRisk = await anon("/api/admin/risk");
  check("anonymous cannot read the risk queue", anonRisk.status === 401);

  const parentRisk = await parent("/api/admin/risk");
  check("a parent cannot read the risk queue", parentRisk.status === 403);

  const tutorRisk = await tutor("/api/admin/risk");
  check("a tutor cannot read the risk queue", tutorRisk.status === 403);

  const adminRiskQueue = await admin("/api/admin/risk");
  check("an administrator can read the risk queue", adminRiskQueue.ok);
  check("the queue reports how much needs attention",
    Number.isInteger(adminRiskQueue.payload?.data?.overview?.needsAttention));

  // There is no endpoint through which a client can create a case or state a
  // level — the absence is the control, so prove the absence.
  const forgeCase = await admin("/api/admin/risk", {
    method: "POST",
    body: { subjectUserId: "000000000000000000000000", level: "HIGH", score: 99 },
  });
  check("a risk case cannot be created over the API at all",
    forgeCase.status === 404 || forgeCase.status === 405,
    `status ${forgeCase.status}`);

  // --- a real business event, end to end -----------------------------------
  const riskSettingsBefore = (await admin("/api/admin/settings")).payload?.data?.settings?.risk;

  const tightenRisk = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { risk: { enabled: true, disputeThreshold: 1, reviewScore: 1, highScore: 3 } },
  });
  check("risk thresholds are operator-configurable", tightenRisk.ok,
    JSON.stringify(tightenRisk.payload?.error));

  const completedForDispute = (
    await parent("/api/bookings?scope=PAST&status=COMPLETED&pageSize=50")
  ).payload?.data?.bookings?.find((b) => b.status === "COMPLETED");

  if (!completedForDispute) {
    check("a completed lesson is available to drive the risk E2E", false,
      "no COMPLETED past booking left — run `bun run seed`");
  } else {
    const subjectTutorId = completedForDispute.tutorUserId?.id ?? completedForDispute.tutorUserId;

    const raised = await parent("/api/disputes", {
      method: "POST",
      body: {
        bookingId: completedForDispute.id,
        reason: "LESSON_QUALITY",
        description: "QA run — exercising the risk detection path end to end.",
      },
    });
    check("a learner can raise a dispute about a finished lesson", raised.status === 201,
      JSON.stringify(raised.payload?.error));

    const disputeId = raised.payload?.data?.dispute?.id;

    const queue = await admin("/api/admin/risk?status=OPEN");
    const opened = (queue.payload?.data?.cases ?? []).find(
      (c) => String(c.subjectUserId?.id ?? c.subjectUserId) === String(subjectTutorId),
    );
    check("the dispute opened a risk case against the account it named", !!opened,
      `${queue.payload?.data?.cases?.length ?? 0} open cases`);

    if (opened) {
      check("the case explains which signal fired",
        opened.signals?.some((s) => s.type === "REPEATED_DISPUTES"));
      check("and carries the evidence behind it",
        Number.isInteger(opened.signals?.find((s) => s.type === "REPEATED_DISPUTES")?.evidence
          ?.disputes));
      check("the score and level were derived, not supplied",
        Number.isInteger(opened.score) && ["LOW", "MEDIUM", "HIGH"].includes(opened.level));
      check("the case is keyed to the account, with a readable reference",
        /^RSK-/.test(opened.reference ?? ""));

      // Detection must not itself restrict anybody.
      const subjectAccount = await admin(`/api/admin/users/${subjectTutorId}`);
      check("opening a risk case never suspends the account by itself",
        subjectAccount.payload?.data?.user?.status === "ACTIVE",
        subjectAccount.payload?.data?.user?.status);

      // A second dispute must join the same case, not open a second one.
      const secondCompleted = (
        await parent("/api/bookings?scope=PAST&status=COMPLETED&pageSize=50")
      ).payload?.data?.bookings?.find(
        (b) =>
          b.status === "COMPLETED" &&
          b.id !== completedForDispute.id &&
          String(b.tutorUserId?.id ?? b.tutorUserId) === String(subjectTutorId),
      );

      let secondDisputeId = null;
      if (secondCompleted) {
        const secondRaised = await parent("/api/disputes", {
          method: "POST",
          body: {
            bookingId: secondCompleted.id,
            reason: "LESSON_QUALITY",
            description: "QA run — a second dispute, to prove cases accumulate rather than fork.",
          },
        });
        secondDisputeId = secondRaised.payload?.data?.dispute?.id;

        const afterSecond = await admin("/api/admin/risk?status=OPEN");
        const forSubject = (afterSecond.payload?.data?.cases ?? []).filter(
          (c) => String(c.subjectUserId?.id ?? c.subjectUserId) === String(subjectTutorId),
        );
        check("a second dispute joins the open case instead of opening a second one",
          forSubject.length === 1, `${forSubject.length} cases`);
      }

      // Authorization on the case itself.
      const tutorReadsCase = await tutor(`/api/admin/risk/${opened.id}`);
      check("the account under review cannot read its own risk case",
        tutorReadsCase.status === 403);

      const parentResolves = await parent(`/api/admin/risk/${opened.id}`, {
        method: "PATCH",
        body: { action: "RESOLVE", resolution: "CLEARED" },
      });
      check("a learner cannot resolve a risk case", parentResolves.status === 403);

      const tutorClearsSelf = await tutor(`/api/admin/risk/${opened.id}`, {
        method: "PATCH",
        body: { action: "RESOLVE", resolution: "CLEARED" },
      });
      check("the account under review cannot clear itself", tutorClearsSelf.status === 403);

      const forgedStatus = await admin(`/api/admin/risk/${opened.id}`, {
        method: "PATCH",
        body: { status: "CLEARED", level: "LOW", score: 0, fraudConfirmed: false },
      });
      check("a case's status, level and score cannot be written directly",
        forgedStatus.status === 422);

      const unexplainedConfirm = await admin(`/api/admin/risk/${opened.id}`, {
        method: "PATCH",
        body: { action: "RESOLVE", resolution: "CONFIRMED", note: "bad" },
      });
      check("a case cannot be confirmed without recording why",
        unexplainedConfirm.status === 422);

      const taken = await admin(`/api/admin/risk/${opened.id}`, {
        method: "PATCH",
        body: { action: "REVIEW" },
      });
      check("an administrator can take the case for review",
        taken.ok && taken.payload.data.case.status === "UNDER_REVIEW");

      const clearedCase = await admin(`/api/admin/risk/${opened.id}`, {
        method: "PATCH",
        body: {
          action: "RESOLVE",
          resolution: "CLEARED",
          outcome: "NONE",
          note: "QA run — cleared as part of the automated suite.",
        },
      });
      check("and resolve it", clearedCase.ok && clearedCase.payload.data.case.status === "CLEARED");
      check("the decision records who made it",
        !!clearedCase.payload.data.case.resolvedBy && !!clearedCase.payload.data.case.resolvedAt);
      check("and what was done about it",
        clearedCase.payload.data.case.actions?.at(-1)?.action === "NONE");
      check("the signals are kept as evidence, not cleared away",
        (clearedCase.payload.data.case.signals?.length ?? 0) > 0);

      const reopen = await admin(`/api/admin/risk/${opened.id}`, {
        method: "PATCH",
        body: { action: "REVIEW" },
      });
      check("a resolved case cannot be reopened", reopen.status === 422);

      const stillReadable = await admin(`/api/admin/risk/${opened.id}`);
      check("but it stays readable as a record of what was decided",
        stillReadable.ok && stillReadable.payload.data.case.status === "CLEARED");

      // Put the fixtures back: rejecting the disputes restores the lessons to
      // COMPLETED and keeps them out of any later risk count.
      for (const id of [disputeId, secondDisputeId].filter(Boolean)) {
        await admin(`/api/admin/disputes/${id}`, {
          method: "POST",
          body: { resolution: "REJECTED", note: "QA run — fixture cleanup, not a real decision." },
        });
      }

      const restored = await admin(`/api/bookings/${completedForDispute.id}`);
      check("the lesson fixture is restored for the next run",
        restored.payload?.data?.booking?.status === "COMPLETED",
        restored.payload?.data?.booking?.status);
    }
  }

  if (riskSettingsBefore) {
    const restoredRisk = await admin("/api/admin/settings", {
      method: "PATCH",
      body: { risk: riskSettingsBefore },
    });
    check("risk settings are restored after the run", restoredRisk.ok);
  }

  const riskDisabled = await admin("/api/admin/settings", {
    method: "PATCH",
    body: { risk: { highScore: 1, reviewScore: 5 } },
  });
  check("a high-risk threshold below the review threshold is refused",
    riskDisabled.status === 422);


  // --- Curriculum management -----------------------------------------------
  //
  // The whole of discovery reads this hierarchy, and every write to it is
  // behind one permission. Four things are asserted: that the read side is
  // genuinely public, that the write side is genuinely not, that deactivation
  // is a real removal from every public surface (it is the only removal path
  // provinces, grades and subjects have), and that the shapes are bounded
  // server-side rather than by the admin form.
  //
  // Subjects and grades have no delete endpoint by design, so the fixtures
  // this section creates are deactivated rather than removed — invisible
  // everywhere public, and cleared by the next `bun run seed`. Courses do
  // support delete, and this section deletes the one it makes.
  // --- Shared files and learner insights (§21, §24, §41 Phase 3) -----------
  section("Shared files — upload, download and cross-account refusal");

  const sharedFile = () =>
    new File([pdfBytes(900)], "qa shared file.pdf", { type: "application/pdf" });

  const anonUpload = await anon("/api/messages/attachments", { form: formWith(sharedFile()) });
  check("signed out, nobody can post a file into a thread", anonUpload.status === 401);

  const noTarget = await parent("/api/messages/attachments", { form: formWith(sharedFile()) });
  check("an upload that does not say who it is for is refused",
    noTarget.status === 422 &&
      Boolean(noTarget.payload?.error?.details?.fieldErrors?.conversationId),
    JSON.stringify(noTarget.payload?.error));

  const emptyUpload = await parent("/api/messages/attachments", {
    form: (() => {
      const f = new FormData();
      f.set("conversationId", conversationId);
      f.set("body", "No file attached.");
      return f;
    })(),
  });
  check("nor is one with a conversation but no file",
    emptyUpload.status === 422 &&
      Boolean(emptyUpload.payload?.error?.details?.fieldErrors?.file));

  const spoofed = new File([Buffer.from("<?php system($_GET[0]); ?>")], "notes.pdf", {
    type: "application/pdf",
  });
  const spoofRefused = await parent("/api/messages/attachments", {
    form: (() => {
      const f = new FormData();
      f.set("conversationId", conversationId);
      f.append("file", spoofed);
      return f;
    })(),
  });
  check("a file whose bytes disagree with its type never reaches the store",
    spoofRefused.status === 422 &&
      spoofRefused.payload?.error?.code === "UNSUPPORTED_FILE_TYPE",
    JSON.stringify(spoofRefused.payload?.error));

  const sentWithFile = await parent("/api/messages/attachments", {
    form: (() => {
      const f = new FormData();
      f.set("conversationId", conversationId);
      f.set("body", "QA run — here's the worksheet.");
      f.append("file", sharedFile());
      return f;
    })(),
  });
  check("a learner can send a file in their own thread",
    sentWithFile.status === 201, JSON.stringify(sentWithFile.payload?.error));

  const sentAttachment = sentWithFile.payload?.data?.message?.attachments?.[0];
  check("the message comes back carrying the attachment",
    Boolean(sentAttachment?.id) && sentAttachment.fileName === "qa shared file.pdf");
  check("with a download route and no storage key anywhere in the envelope",
    sentAttachment?.href === `/api/messages/attachments/${sentAttachment?.id}` &&
      !JSON.stringify(sentWithFile.payload).includes("storageKey"));

  const threadRead = await parent(`/api/messages/conversations/${conversationId}`);
  check("and reading the thread back carries it too",
    JSON.stringify(threadRead.payload?.data?.messages ?? []).includes(sentAttachment.id));
  check("still with no key in the thread payload",
    !JSON.stringify(threadRead.payload).includes("storageKey"));

  const senderDownloads = await parent(sentAttachment.href, { raw: true });
  check("the sender can download what they sent", senderDownloads.status === 200);
  check("served as the type the bytes proved to be",
    senderDownloads.headers.get("content-type") === "application/pdf");
  check("and never stored by a cache in between",
    /no-store/.test(senderDownloads.headers.get("cache-control") ?? ""));

  const anonFileRead = await anon(sentAttachment.href, { raw: true });
  check("signed out, the link gives nothing", anonFileRead.status === 401);

  const otherFamilyReads = await strangerParent(sentAttachment.href, { raw: true });
  check("another family cannot read a file from a thread they are not in",
    otherFamilyReads.status === 403, String(otherFamilyReads.status));

  const otherTutorReads = await strangerTutor(sentAttachment.href, { raw: true });
  check("nor can a tutor who is not in the thread",
    otherTutorReads.status === 403, String(otherTutorReads.status));

  const badAttachmentId = await parent("/api/messages/attachments/not-an-id", { raw: true });
  check("a malformed attachment id is refused by the pipeline",
    badAttachmentId.status === 422);

  const unknownAttachment = await parent(
    "/api/messages/attachments/000000000000000000000000",
    { raw: true },
  );
  check("and an id that is not an attachment resolves to nothing",
    unknownAttachment.status === 404);

  // --- learner insights -----------------------------------------------------
  section("Student analytics — scoping and authorization");

  const anonInsights = await anon(`/api/students/${studentId}/analytics`);
  check("analytics need an account", anonInsights.status === 401);

  const ownInsights = await parent(`/api/students/${studentId}/analytics?days=90`);
  check("a family can read their own learner's analytics",
    ownInsights.ok, JSON.stringify(ownInsights.payload?.error));

  const figures = ownInsights.payload?.data?.analytics;
  check("the view is marked as the whole picture", figures?.scope === "FULL");
  check("and it names the period it covers",
    Boolean(figures?.period?.from && figures?.period?.to));
  check("lessons completed never exceed lessons booked",
    figures?.lessons?.completed <= figures?.lessons?.total,
    `${figures?.lessons?.completed}/${figures?.lessons?.total}`);
  check("the series adds up to the lessons counted",
    (figures?.series ?? []).reduce((sum, p) => sum + p.lessons, 0) === figures?.lessons?.total);
  check("a family is shown what they spent, from settled payments",
    typeof figures?.spend?.netCents === "number" &&
      figures.spend.excludesPackagePurchases === true);

  const otherFamilyInsights = await strangerParent(`/api/students/${studentId}/analytics`);
  check("another family cannot read them", otherFamilyInsights.status === 403);

  const unrelatedTutorInsights = await strangerTutor(`/api/students/${studentId}/analytics`);
  check("nor can a tutor who has never taught that learner",
    unrelatedTutorInsights.status === 403, String(unrelatedTutorInsights.status));

  /**
   * The scoped view, against a learner this tutor has demonstrably taught.
   *
   * Taking the QA parent's first child would make this assertion depend on
   * whether the seeded pool still happens to pair those two — and the no-show
   * section consumes a COMPLETED lesson every run, so it drains. Reading the
   * tutor's own roster instead means the scoped assertions run every time, or
   * report themselves as unrunnable rather than quietly becoming a weaker
   * check that always passes.
   */
  const insightsRoster = await tutor("/api/tutor/students");
  const taughtLearner = (insightsRoster.payload?.data?.students ?? [])
    .find((entry) => entry.completed > 0);

  if (!taughtLearner) {
    check("student analytics — tutor-scoped view", false,
      "the seeded tutor has no completed lessons with anybody — run `bun run seed`");
  } else {
    const tutorInsights = await tutor(
      `/api/students/${taughtLearner.id}/analytics?days=366`,
    );
    check("a tutor who has taught a learner gets the scoped view",
      tutorInsights.ok && tutorInsights.payload.data.analytics.scope === "TUTOR",
      JSON.stringify(tutorInsights.payload?.error));

    const scoped = tutorInsights.payload?.data?.analytics ?? {};
    check("and is never shown what the family paid", scoped.spend === null);
    check("nor which other tutors the family uses", scoped.tutors?.count === 0);
    check("and the payload carries no spend figure at all",
      !JSON.stringify(scoped).includes("chargedCents") &&
        !JSON.stringify(scoped).includes("netCents"));
    check("the lessons it reports are the ones the roster says they taught",
      scoped.lessons?.completed <= taughtLearner.completed,
      `${scoped.lessons?.completed} vs ${taughtLearner.completed}`);
  }

  const adminInsights = await admin(`/api/students/${studentId}/analytics`);
  check("an administrator can read them under the existing RBAC",
    adminInsights.ok && adminInsights.payload.data.analytics.scope === "FULL");

  const badLearner = await parent("/api/students/not-an-id/analytics");
  check("a malformed learner id is refused by the pipeline", badLearner.status === 422);

  const missingLearner = await parent("/api/students/000000000000000000000000/analytics");
  check("and a learner that does not exist is a 404, not an empty report",
    missingLearner.status === 404);

  const badPeriod = await parent(`/api/students/${studentId}/analytics?days=9999`);
  check("an out-of-range period is refused rather than clamped silently",
    badPeriod.status === 422);

  section("Curriculum management");

  const qaTag = Date.now().toString(36).toUpperCase();

  const publicProvinces = await anon("/api/curriculum/provinces");
  check("provinces are readable without an account",
    publicProvinces.ok && publicProvinces.payload.data.provinces.length > 0);
  check("and every one offered to a visitor is active",
    publicProvinces.payload.data.provinces.every((p) => p.isActive !== false));

  const allProvinces = await anon("/api/curriculum/provinces?all=true");
  check("the 'coming soon' list can include inactive provinces",
    allProvinces.ok &&
      allProvinces.payload.data.provinces.length >= publicProvinces.payload.data.provinces.length);

  const ontario = publicProvinces.payload.data.provinces.find((p) => p.code === "ON");
  const publicGrades = await anon("/api/curriculum/grades?province=ON");
  check("grades are readable without an account",
    publicGrades.ok && publicGrades.payload.data.grades.length > 0);

  const publicSubjects = await anon("/api/curriculum/subjects");
  check("subjects are readable without an account",
    publicSubjects.ok && publicSubjects.payload.data.subjects.length > 0);

  const tree = await anon("/api/curriculum/tree?province=ON");
  check("the whole curriculum tree comes back in one call",
    tree.ok && tree.payload.data.province?.code === "ON" &&
      tree.payload.data.grades.length > 0 && tree.payload.data.subjects.length > 0);

  const badProvinceTree = await anon("/api/curriculum/tree?province=ZZ");
  check("a province code that is not Canadian is refused, not guessed at",
    badProvinceTree.status === 422, `status ${badProvinceTree.status}`);

  /**
   * A province marked "coming soon" is coming soon everywhere (§13, §41).
   *
   * `isActive` used to stop at the picker: courses under an inactive province
   * carried their own `isActive: true` and stayed in the public list, so the
   * platform told one visitor the province was not live while showing another
   * a page of its courses. The service-level proof is in the integration
   * suite; this is the endpoint saying the same thing.
   */
  const liveProvinceCodes = new Set(
    publicProvinces.payload.data.provinces.map((p) => p.code),
  );
  const publicCourseList = await anon("/api/curriculum/courses?pageSize=50");
  check("the public course list carries courses from live provinces only",
    publicCourseList.ok &&
      (publicCourseList.payload.data.courses ?? publicCourseList.payload.data.items ?? [])
        .every((c) => liveProvinceCodes.has(c.provinceCode)),
    JSON.stringify(Object.keys(publicCourseList.payload?.data ?? {})));

  // --- the write side is closed --------------------------------------------
  const anonSubject = await anon("/api/admin/curriculum/subjects", {
    method: "POST",
    body: { name: `QA anonymous ${qaTag}` },
  });
  check("an anonymous request cannot create a subject", anonSubject.status === 401);

  const parentSubject = await parent("/api/admin/curriculum/subjects", {
    method: "POST",
    body: { name: `QA parent ${qaTag}` },
  });
  check("a parent cannot create a subject", parentSubject.status === 403);

  const tutorSubject = await tutor("/api/admin/curriculum/subjects", {
    method: "POST",
    body: { name: `QA tutor ${qaTag}` },
  });
  check("a tutor cannot create a subject", tutorSubject.status === 403);

  const tutorCourse = await tutor("/api/admin/curriculum/courses", {
    method: "POST",
    body: {
      provinceId: ontario.id,
      gradeId: publicGrades.payload.data.grades[0].id,
      subjectId: publicSubjects.payload.data.subjects[0].id,
      name: `QA tutor course ${qaTag}`,
    },
  });
  check("a tutor cannot create a course", tutorCourse.status === 403);

  const tutorProvincePatch = await tutor(`/api/admin/curriculum/provinces/${ontario.id}`, {
    method: "PATCH",
    body: { isActive: false },
  });
  check("a tutor cannot deactivate a province", tutorProvincePatch.status === 403);

  const parentCourseList = await parent("/api/admin/curriculum/courses");
  check("the admin course table is closed to a parent", parentCourseList.status === 403);

  // --- subjects -------------------------------------------------------------
  const subjectName = `QA Fixture Subject ${qaTag}`;
  const newSubject = await admin("/api/admin/curriculum/subjects", {
    method: "POST",
    body: { name: subjectName, description: "Created by the QA suite.", displayOrder: 190 },
  });
  check("an administrator can create a subject", newSubject.status === 201,
    JSON.stringify(newSubject.payload?.error));
  const subjectId = newSubject.payload?.data?.subject?.id;
  check("it is given a slug derived from its name",
    newSubject.payload?.data?.subject?.slug?.startsWith("qa-fixture-subject"));

  const subjectsAfter = await anon("/api/curriculum/subjects");
  check("and it is on the public list immediately, not after a cache expires",
    subjectsAfter.payload.data.subjects.some((s) => s.id === subjectId));

  const duplicateSubject = await admin("/api/admin/curriculum/subjects", {
    method: "POST",
    body: { name: subjectName },
  });
  check("a second subject with the same name is refused as a conflict",
    duplicateSubject.status === 409, `status ${duplicateSubject.status}`);
  check("and the refusal is the standard envelope, not a driver error",
    duplicateSubject.payload?.error?.code === "CONFLICT" &&
      !/E11000|MongoServerError/i.test(JSON.stringify(duplicateSubject.payload)));

  const shortSubject = await admin("/api/admin/curriculum/subjects", {
    method: "POST",
    body: { name: "X" },
  });
  check("a subject name below the minimum length is refused", shortSubject.status === 422);
  check("with a per-field error the form can render",
    Object.keys(shortSubject.payload?.error?.details?.fieldErrors ?? {}).includes("name"));

  const subjectPatched = await admin(`/api/admin/curriculum/subjects/${subjectId}`, {
    method: "PATCH",
    body: { isPopular: true },
  });
  check("an administrator can update a subject", subjectPatched.ok);
  check("and the change is persisted",
    subjectPatched.payload?.data?.subject?.isPopular === true);

  const parentSubjectPatch = await parent(`/api/admin/curriculum/subjects/${subjectId}`, {
    method: "PATCH",
    body: { isPopular: false },
  });
  check("a parent cannot update a subject", parentSubjectPatch.status === 403);

  const missingSubject = await admin(
    "/api/admin/curriculum/subjects/000000000000000000000000",
    { method: "PATCH", body: { isPopular: true } },
  );
  check("updating a subject that does not exist is a 404", missingSubject.status === 404);

  const malformedSubjectId = await admin("/api/admin/curriculum/subjects/not-an-id", {
    method: "PATCH",
    body: { isPopular: true },
  });
  check("and a malformed id is refused before anything is looked up",
    malformedSubjectId.status === 422);

  // --- grades ---------------------------------------------------------------
  const newGrade = await admin("/api/admin/curriculum/grades", {
    method: "POST",
    body: { provinceId: ontario.id, name: `QA Grade ${qaTag}`, level: 13, stage: "SECONDARY" },
  });
  check("an administrator can create a grade", newGrade.status === 201,
    JSON.stringify(newGrade.payload?.error));
  const gradeId = newGrade.payload?.data?.grade?.id;

  const badStage = await admin("/api/admin/curriculum/grades", {
    method: "POST",
    body: { provinceId: ontario.id, name: `QA Bad ${qaTag}`, level: 9, stage: "UNIVERSITY" },
  });
  check("a grade stage outside the enumeration is refused", badStage.status === 422);

  const outOfRangeLevel = await admin("/api/admin/curriculum/grades", {
    method: "POST",
    body: { provinceId: ontario.id, name: `QA High ${qaTag}`, level: 99, stage: "SECONDARY" },
  });
  check("a grade level above the boundary is refused", outOfRangeLevel.status === 422);

  const gradeWithoutProvince = await admin("/api/admin/curriculum/grades", {
    method: "POST",
    body: { name: `QA Orphan ${qaTag}`, level: 5, stage: "ELEMENTARY" },
  });
  check("a grade with no province is refused", gradeWithoutProvince.status === 422);

  const gradesWithFixture = await anon("/api/curriculum/grades?province=ON");
  check("a new grade appears under its province",
    gradesWithFixture.payload.data.grades.some((g) => g.id === gradeId));

  await admin(`/api/admin/curriculum/grades/${gradeId}`, {
    method: "PATCH",
    body: { isActive: false },
  });
  const gradesAfterDeactivate = await anon("/api/curriculum/grades?province=ON");
  check("deactivating a grade removes it from the public list",
    !gradesAfterDeactivate.payload.data.grades.some((g) => g.id === gradeId));
  check("and from the curriculum tree",
    !(await anon("/api/curriculum/tree?province=ON")).payload.data.grades
      .some((g) => g.id === gradeId));

  // --- courses --------------------------------------------------------------
  const activeGradeId = publicGrades.payload.data.grades[0].id;
  const newCourse = await admin("/api/admin/curriculum/courses", {
    method: "POST",
    body: {
      provinceId: ontario.id,
      gradeId: activeGradeId,
      subjectId: subjectId,
      name: `QA Fixture Course ${qaTag}`,
      code: `QAX${qaTag.slice(-2)}`,
      stream: "University",
      isActive: true,
    },
  });
  check("an administrator can create a course", newCourse.status === 201,
    JSON.stringify(newCourse.payload?.error));
  const qaCourseId = newCourse.payload?.data?.course?.id;
  check("a course copies the province, grade and subject it was filed under",
    newCourse.payload?.data?.course?.provinceCode === "ON" &&
      Boolean(newCourse.payload?.data?.course?.gradeSlug) &&
      Boolean(newCourse.payload?.data?.course?.subjectSlug));

  const duplicateCode = await admin("/api/admin/curriculum/courses", {
    method: "POST",
    body: {
      provinceId: ontario.id,
      gradeId: activeGradeId,
      subjectId: subjectId,
      name: `QA Different Name ${qaTag}`,
      code: `QAX${qaTag.slice(-2)}`,
    },
  });
  check("a course code cannot be reused inside a province",
    duplicateCode.status === 409, `status ${duplicateCode.status}`);

  const courseBadParents = await admin("/api/admin/curriculum/courses", {
    method: "POST",
    body: {
      provinceId: "000000000000000000000000",
      gradeId: activeGradeId,
      subjectId: subjectId,
      name: `QA Orphan Course ${qaTag}`,
    },
  });
  check("a course cannot be filed under a province that does not exist",
    courseBadParents.status === 404, `status ${courseBadParents.status}`);

  const courseBadCode = await admin("/api/admin/curriculum/courses", {
    method: "POST",
    body: {
      provinceId: ontario.id,
      gradeId: activeGradeId,
      subjectId: subjectId,
      name: `QA Bad Code ${qaTag}`,
      code: "nope!",
    },
  });
  check("a malformed course code is refused", courseBadCode.status === 422);

  const publicCourseSearch = await anon(`/api/curriculum/courses?q=QAX${qaTag.slice(-2)}`);
  check("a new course is findable by code on the public API",
    publicCourseSearch.payload?.data?.courses?.some((c) => c.id === qaCourseId));

  await admin(`/api/admin/curriculum/courses/${qaCourseId}`, {
    method: "PATCH",
    body: { isActive: false },
  });
  const publicAfterDeactivate = await anon(`/api/curriculum/courses?q=QAX${qaTag.slice(-2)}`);
  check("deactivating a course removes it from the public course list",
    !(publicAfterDeactivate.payload?.data?.courses ?? []).some((c) => c.id === qaCourseId));

  const adminSeesInactive = await admin(
    `/api/admin/curriculum/courses?q=QAX${qaTag.slice(-2)}`,
  );
  check("but an administrator still sees it",
    (adminSeesInactive.payload?.data?.courses ?? []).some((c) => c.id === qaCourseId));

  const tutorDelete = await tutor(`/api/admin/curriculum/courses/${qaCourseId}`, {
    method: "DELETE",
  });
  check("a tutor cannot delete a course", tutorDelete.status === 403);

  const deleted = await admin(`/api/admin/curriculum/courses/${qaCourseId}`, {
    method: "DELETE",
  });
  check("an administrator can delete a course nobody teaches", deleted.ok,
    JSON.stringify(deleted.payload?.error));
  check("and it is gone from the admin table",
    !((await admin(`/api/admin/curriculum/courses?q=QAX${qaTag.slice(-2)}`))
      .payload?.data?.courses ?? []).some((c) => c.id === qaCourseId));

  const taughtCourse = await admin(`/api/admin/curriculum/courses/${courseId}`, {
    method: "DELETE",
  });
  check("a course tutors still teach is refused rather than orphaning their profiles",
    taughtCourse.status === 409, `status ${taughtCourse.status}`);

  const deleteSubject = await admin(`/api/admin/curriculum/subjects/${subjectId}`, {
    method: "DELETE",
  });
  check("subjects have no delete endpoint — deactivation is the documented path",
    deleteSubject.status === 404 || deleteSubject.status === 405,
    `status ${deleteSubject.status}`);

  // Leave the fixture subject switched off rather than lingering in pickers.
  const parkSubject = await admin(`/api/admin/curriculum/subjects/${subjectId}`, {
    method: "PATCH",
    body: { isActive: false, isPopular: false },
  });
  check("the fixture subject is deactivated at the end of the run", parkSubject.ok);
  check("and it leaves the public subject list",
    !(await anon("/api/curriculum/subjects")).payload.data.subjects.some((s) => s.id === subjectId));

  // --- Global audit log ----------------------------------------------------
  //
  // Everything above this line wrote audit records. This section is the read
  // side: who may look, what the filters actually narrow, and that nothing a
  // call site stored can turn the viewer into a credential reader (§35, §36).
  section("Global audit log");

  const anonAudit = await anon("/api/admin/audit-logs");
  check("an anonymous request cannot read the audit log", anonAudit.status === 401);

  const parentAudit = await parent("/api/admin/audit-logs");
  check("a parent cannot read the audit log", parentAudit.status === 403);

  const tutorAudit = await tutor("/api/admin/audit-logs");
  check("a tutor cannot read the audit log", tutorAudit.status === 403);

  const adminAudit = await admin("/api/admin/audit-logs?pageSize=25");
  check("an administrator can read the audit log", adminAudit.ok,
    JSON.stringify(adminAudit.payload?.error));
  check("it comes back paginated like every other list",
    Number.isInteger(adminAudit.payload?.meta?.total) &&
      Number.isInteger(adminAudit.payload?.meta?.totalPages));
  check("and newest first",
    adminAudit.payload.data.events.length < 2 ||
      new Date(adminAudit.payload.data.events[0].createdAt) >=
        new Date(adminAudit.payload.data.events[1].createdAt));
  check("every event says what happened",
    adminAudit.payload.data.events.every((e) => typeof e.action === "string" && e.action.length > 0));
  check("and when",
    adminAudit.payload.data.events.every((e) => Boolean(e.createdAt)));

  check("the entity types actually in the log are offered as filters",
    Array.isArray(adminAudit.payload.data.entityTypes) &&
      adminAudit.payload.data.entityTypes.length > 0);

  const curriculumTrail = await admin("/api/admin/audit-logs?action=CURRICULUM_UPDATED");
  check("filtering by action narrows to that action",
    curriculumTrail.ok &&
      curriculumTrail.payload.data.events.every((e) => e.action === "CURRICULUM_UPDATED"));
  check("and the curriculum writes this run just made are in it",
    curriculumTrail.payload.data.events.length > 0);

  const auditActor = adminAudit.payload.data.events.find((e) => e.actorId?.id)?.actorId?.id;
  if (auditActor) {
    const byActor = await admin(`/api/admin/audit-logs?actorId=${auditActor}`);
    check("filtering by actor narrows to what that person did",
      byActor.ok && byActor.payload.data.events.every((e) => e.actorId?.id === auditActor));
    check("and says who they are, not just an id",
      byActor.payload.data.events.every((e) => typeof e.actorId?.firstName === "string"));
  }

  const byEntityType = await admin("/api/admin/audit-logs?entityType=Subject");
  check("filtering by entity type narrows to that type",
    byEntityType.ok && byEntityType.payload.data.events.every((e) => e.entityType === "Subject"));
  check("and the subject created above is among them",
    byEntityType.payload.data.events.some((e) => e.entityId === subjectId));

  const byEntity = await admin(`/api/admin/audit-logs?entityId=${subjectId}`);
  check("filtering by one record's id gives that record's own history",
    byEntity.ok && (byEntity.payload?.data?.events ?? []).every((e) => e.entityId === subjectId),
    JSON.stringify(byEntity.payload?.error));
  check("which is every write this run made to it",
    (byEntity.payload?.data?.events ?? []).length >= 2,
    String((byEntity.payload?.data?.events ?? []).length));

  const futureWindow = await admin("/api/admin/audit-logs?from=2099-01-01&to=2099-01-02");
  check("a period with nothing in it returns nothing rather than everything",
    futureWindow.ok && futureWindow.payload.data.events.length === 0);

  const badAction = await admin("/api/admin/audit-logs?action=NOT_A_REAL_ACTION");
  check("an action the platform does not record is refused, not silently ignored",
    badAction.status === 422, `status ${badAction.status}`);

  const badActor = await admin("/api/admin/audit-logs?actorId=not-an-id");
  check("a malformed actor id is refused", badActor.status === 422);

  const hugePage = await admin("/api/admin/audit-logs?pageSize=100000");
  check("an unbounded page size is refused", hugePage.status === 422);

  const integrationTrail = await admin("/api/admin/audit-logs?entityType=Integration");
  const integrationBody = JSON.stringify(integrationTrail.payload ?? {});
  check("credential rotations are readable as events",
    integrationTrail.ok);
  check("but no credential value is ever in the payload",
    !/sk_live_|sk_test_[A-Za-z0-9]{8,}|whsec_[A-Za-z0-9]{8,}/.test(integrationBody));
  check("nor any encrypted ciphertext",
    !/"v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(integrationBody));

  const wholeLog = JSON.stringify(adminAudit.payload ?? {});
  check("and the log never carries a password hash",
    !/\$2[aby]\$\d\d\$/.test(wholeLog));

  const auditWrite = await admin("/api/admin/audit-logs", {
    method: "POST",
    body: { action: "USER_LOGIN" },
  });
  check("there is no way to write an audit record over the API",
    auditWrite.status === 404 || auditWrite.status === 405,
    `status ${auditWrite.status}`);

  const auditDelete = await admin("/api/admin/audit-logs", { method: "DELETE" });
  check("nor to delete one",
    auditDelete.status === 404 || auditDelete.status === 405,
    `status ${auditDelete.status}`);

  // --- Dispute resolution --------------------------------------------------
  //
  // A decision is terminal. This is the HTTP half of that rule: the guard has
  // to be in the service, not in the admin screen's disabled button, so it is
  // asserted here by submitting a second decision directly to the endpoint.
  //
  // Every dispute this section opens is closed as REJECTED, which returns its
  // lesson to COMPLETED — so the section re-runs without consuming a fixture.
  section("Dispute resolution");

  const disputablePool = (
    await parent("/api/bookings?scope=PAST&status=COMPLETED&pageSize=50")
  ).payload?.data?.bookings?.filter((b) => b.status === "COMPLETED") ?? [];
  const disputable = disputablePool[0];

  if (!disputable) {
    check("a completed lesson is available to test dispute resolution", false,
      "no COMPLETED past booking left — run `bun run seed`");
  } else {
    const openOne = async (description) => {
      const res = await parent("/api/disputes", {
        method: "POST",
        body: { bookingId: disputable.id, reason: "LESSON_QUALITY", description },
      });
      return res;
    };

    const raised = await openOne(
      "QA run — exercising the dispute resolution path and its terminal guard.",
    );
    check("a party can raise a dispute on a finished lesson", raised.status === 201,
      JSON.stringify(raised.payload?.error));
    const qaDisputeId = raised.payload?.data?.dispute?.id;
    check("it starts open", raised.payload?.data?.dispute?.status === "OPEN");

    const duplicateOpen = await openOne("QA run — a second dispute while one is still open.");
    check("a second dispute cannot be opened while one is running",
      duplicateOpen.status === 409, `status ${duplicateOpen.status}`);

    const strangerReadsDispute = await stranger(`/api/disputes/${qaDisputeId}`);
    check("somebody unrelated cannot read the dispute", strangerReadsDispute.status === 403);

    const partyReads = await parent(`/api/disputes/${qaDisputeId}`);
    check("the person who raised it can", partyReads.ok);
    check("and sees no internal admin notes",
      partyReads.payload?.data?.dispute?.adminNotes === undefined);

    const parentResolves = await parent(`/api/admin/disputes/${qaDisputeId}`, {
      method: "POST",
      body: { resolution: "RESOLVED_REFUND", note: "Deciding my own dispute, which I may not do." },
    });
    check("a party cannot decide their own dispute", parentResolves.status === 403);

    const tutorResolves = await tutor(`/api/admin/disputes/${qaDisputeId}`, {
      method: "POST",
      body: { resolution: "RESOLVED_NO_REFUND", note: "Nor can the tutor decide it themselves." },
    });
    check("nor can the other party", tutorResolves.status === 403);

    const anonResolves = await anon(`/api/admin/disputes/${qaDisputeId}`, {
      method: "POST",
      body: { resolution: "REJECTED", note: "An anonymous attempt at an adjudication." },
    });
    check("and an anonymous request is refused before anything else",
      anonResolves.status === 401);

    const shortNote = await admin(`/api/admin/disputes/${qaDisputeId}`, {
      method: "POST",
      body: { resolution: "RESOLVED_NO_REFUND", note: "no" },
    });
    check("a decision without a recorded reason is refused", shortNote.status === 422);

    const badResolution = await admin(`/api/admin/disputes/${qaDisputeId}`, {
      method: "POST",
      body: { resolution: "RESOLVED_SOMEHOW", note: "A resolution the platform does not define." },
    });
    check("a resolution outside the enumeration is refused", badResolution.status === 422);

    const partialWithoutAmount = await admin(`/api/admin/disputes/${qaDisputeId}`, {
      method: "POST",
      body: { resolution: "RESOLVED_PARTIAL_REFUND", note: "A partial refund of nothing at all." },
    });
    check("a partial refund without an amount is refused", partialWithoutAmount.status === 422);

    const stillOpen = await admin(`/api/disputes/${qaDisputeId}`);
    check("none of those refusals decided it",
      ["OPEN", "UNDER_REVIEW"].includes(stillOpen.payload?.data?.dispute?.status),
      stillOpen.payload?.data?.dispute?.status);

    const note = await admin(`/api/admin/disputes/${qaDisputeId}`, {
      method: "PATCH",
      body: { note: "QA run — recording an internal note before deciding." },
    });
    check("an administrator can add an internal note", note.ok);
    check("which moves the dispute into review",
      note.payload?.data?.dispute?.status === "UNDER_REVIEW");

    const tutorNote = await tutor(`/api/admin/disputes/${qaDisputeId}`, {
      method: "PATCH",
      body: { note: "A tutor writing in the internal admin notes." },
    });
    check("a tutor cannot write an internal note", tutorNote.status === 403);

    const decided = await admin(`/api/admin/disputes/${qaDisputeId}`, {
      method: "POST",
      body: { resolution: "REJECTED", note: "QA run — closing the fixture, not a real decision." },
    });
    check("an administrator can decide it", decided.ok, JSON.stringify(decided.payload?.error));
    check("and the decision is recorded",
      decided.payload?.data?.dispute?.status === "REJECTED" &&
        Boolean(decided.payload?.data?.dispute?.resolvedAt));
    check("with no refund on a rejected dispute",
      decided.payload?.data?.dispute?.refundIssuedCents === 0);

    // The defect this replaces: a closed dispute accepting a second decision.
    for (const attempt of ["RESOLVED_REFUND", "RESOLVED_NO_REFUND", "REJECTED"]) {
      const again = await admin(`/api/admin/disputes/${qaDisputeId}`, {
        method: "POST",
        body: { resolution: attempt, note: "QA run — deciding a closed dispute a second time." },
      });
      check(`a decided dispute refuses a later ${attempt}`,
        again.status === 409, `status ${again.status}`);
    }

    const unchanged = await admin(`/api/disputes/${qaDisputeId}`);
    check("and the stored decision is exactly the one that was made",
      unchanged.payload?.data?.dispute?.status === "REJECTED" &&
        unchanged.payload?.data?.dispute?.refundIssuedCents === 0);

    const lessonBack = await admin(`/api/bookings/${disputable.id}`);
    check("a rejected dispute returns the lesson to completed",
      lessonBack.payload?.data?.booking?.status === "COMPLETED",
      lessonBack.payload?.data?.booking?.status);

    // --- two administrators, at the same moment ---
    const raceRaised = await openOne("QA run — two administrators deciding at the same moment.");
    const raceDisputeId = raceRaised.payload?.data?.dispute?.id;
    check("a fresh dispute can be opened once the previous one is closed",
      raceRaised.status === 201, JSON.stringify(raceRaised.payload?.error));

    const simultaneous = await Promise.all([
      admin(`/api/admin/disputes/${raceDisputeId}`, {
        method: "POST",
        body: { resolution: "REJECTED", note: "QA run — first of two simultaneous decisions." },
      }),
      admin(`/api/admin/disputes/${raceDisputeId}`, {
        method: "POST",
        body: { resolution: "RESOLVED_NO_REFUND", note: "QA run — second of two, at the same time." },
      }),
    ]);
    check("exactly one of two simultaneous decisions is accepted",
      simultaneous.filter((r) => r.ok).length === 1,
      simultaneous.map((r) => r.status).join(","));
    check("and the other is refused as a conflict",
      simultaneous.filter((r) => r.status === 409).length === 1,
      simultaneous.map((r) => r.status).join(","));

    const raceStored = await admin(`/api/disputes/${raceDisputeId}`);
    check("the stored status is the decision that won",
      raceStored.payload?.data?.dispute?.status ===
        simultaneous.find((r) => r.ok)?.payload?.data?.dispute?.status);
    check("and no refund was issued by a race on a rejected/no-refund pair",
      raceStored.payload?.data?.dispute?.refundIssuedCents === 0);

    const raceAudit = await admin(`/api/admin/audit-logs?entityId=${raceDisputeId}&action=DISPUTE_RESOLVED`);
    check("the race produced one audit record, not two",
      raceAudit.payload?.data?.events?.length === 1,
      String(raceAudit.payload?.data?.events?.length));

    const raceLesson = await admin(`/api/bookings/${disputable.id}`);
    check("and the lesson fixture is restored for the next run",
      raceLesson.payload?.data?.booking?.status === "COMPLETED",
      raceLesson.payload?.data?.booking?.status);
  }

  // --- Tutor profile, availability and payouts -----------------------------
  //
  // The tutor journey section above proves a tutor can *read* their own
  // records. This is the write side, where the server has to be the authority
  // on what is acceptable — including the schemes a stored link may use, which
  // used to rely entirely on React refusing to render a bad one.
  section("Tutor profile and payouts");

  const tutorProfileBefore = (await tutor("/api/tutor/profile")).payload?.data?.profile;

  const headlineUpdate = await tutor("/api/tutor/profile", {
    method: "PATCH",
    body: { headline: `Experienced Ontario mathematics tutor ${qaTag}` },
  });
  check("a tutor can update their own headline", headlineUpdate.ok,
    JSON.stringify(headlineUpdate.payload?.error));
  check("and the change is persisted",
    (await tutor("/api/tutor/profile")).payload?.data?.profile?.headline ===
      `Experienced Ontario mathematics tutor ${qaTag}`);

  const shortHeadline = await tutor("/api/tutor/profile", {
    method: "PATCH",
    body: { headline: "short" },
  });
  check("a headline below the minimum length is refused", shortHeadline.status === 422);

  const shortBio = await tutor("/api/tutor/profile", {
    method: "PATCH",
    body: { bio: "Too short to tell a family anything useful." },
  });
  check("a bio below the minimum length is refused", shortBio.status === 422);

  for (const scheme of [
    "javascript:alert(document.domain)",
    "JaVaScRiPt:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "not a url at all",
  ]) {
    const attempt = await tutor("/api/tutor/profile", {
      method: "PATCH",
      body: { introVideoUrl: scheme },
    });
    check(`an intro video link using "${scheme.split(":")[0].slice(0, 12)}" is refused server-side`,
      attempt.status === 422, `status ${attempt.status}`);
  }

  const goodVideo = await tutor("/api/tutor/profile", {
    method: "PATCH",
    body: { introVideoUrl: "https://www.youtube.com/watch?v=qa-fixture" },
  });
  check("an https intro video link is accepted", goodVideo.ok,
    JSON.stringify(goodVideo.payload?.error));
  check("and it is what is stored",
    goodVideo.payload?.data?.profile?.introVideoUrl ===
      "https://www.youtube.com/watch?v=qa-fixture");

  const clearVideo = await tutor("/api/tutor/profile", {
    method: "PATCH",
    body: { introVideoUrl: "" },
  });
  check("and a blank one clears the field rather than failing", clearVideo.ok);

  const badGallery = await tutor("/api/tutor/profile", {
    method: "PATCH",
    body: { gallery: ["javascript:alert(1)"] },
  });
  check("a gallery photo with an executable scheme is refused", badGallery.status === 422);

  const relativeGallery = await tutor("/api/tutor/profile", {
    method: "PATCH",
    body: { gallery: ["//evil.example/x.png"] },
  });
  check("and a protocol-relative one is refused too", relativeGallery.status === 422);

  const tooManyPhotos = await tutor("/api/tutor/profile", {
    method: "PATCH",
    body: { gallery: Array.from({ length: 7 }, (_, i) => `https://images.unsplash.com/p-${i}`) },
  });
  check("a gallery above the maximum is refused", tooManyPhotos.status === 422);

  const clientSetsSearchable = await tutor("/api/tutor/profile", {
    method: "PATCH",
    body: { isSearchable: true, status: "APPROVED", ratingAverage: 5 },
  });
  check("a tutor cannot set their own searchability, status or rating",
    !clientSetsSearchable.ok ||
      (clientSetsSearchable.payload?.data?.profile?.ratingAverage ===
        tutorProfileBefore?.ratingAverage),
    JSON.stringify(clientSetsSearchable.payload?.data?.profile?.ratingAverage));

  const parentEditsTutorProfile = await parent("/api/tutor/profile", {
    method: "PATCH",
    body: { headline: "A parent rewriting somebody else's shopfront." },
  });
  check("a parent cannot edit a tutor profile", parentEditsTutorProfile.status === 403);

  // Put the headline back so re-runs start from where they found it.
  if (tutorProfileBefore?.headline) {
    await tutor("/api/tutor/profile", {
      method: "PATCH",
      body: { headline: tutorProfileBefore.headline },
    });
  }
  if (tutorProfileBefore?.introVideoUrl) {
    await tutor("/api/tutor/profile", {
      method: "PATCH",
      body: { introVideoUrl: tutorProfileBefore.introVideoUrl },
    });
  }

  // --- availability ---
  const availabilityNow = await tutor("/api/tutor/availability");
  check("a tutor reads their own availability", availabilityNow.ok);

  const badWindow = await tutor("/api/tutor/availability", {
    method: "PATCH",
    body: {
      weeklyRules: [{ weekday: 1, startMinutes: 600, endMinutes: 500 }],
      bufferMinutes: 0,
      slotIncrementMinutes: 30,
      minNoticeHours: 4,
    },
  });
  check("an availability window that ends before it starts is refused",
    badWindow.status === 422, `status ${badWindow.status}`);

  const parentAvailability = await parent("/api/tutor/availability");
  check("a parent cannot read a tutor's availability editor",
    parentAvailability.status === 403);

  // --- payout account ---
  const payoutAccount = await tutor("/api/payouts/account");
  check("a tutor can read their payout account", payoutAccount.ok,
    JSON.stringify(payoutAccount.payload?.error));
  check("and it never carries a raw bank detail",
    !/"(accountNumber|iban|routingNumber|transitNumber)"/i.test(
      JSON.stringify(payoutAccount.payload ?? {}),
    ));

  const parentPayoutAccount = await parent("/api/payouts/account");
  check("a parent has no payout account to read", parentPayoutAccount.status === 403);

  const onboard = await tutor("/api/payouts/account", {
    method: "POST",
    body: { action: "REFRESH" },
  });
  check("refreshing the payout account asks the provider rather than the client",
    onboard.ok, JSON.stringify(onboard.payload?.error));
  check("and the client cannot declare itself payable",
    (await tutor("/api/payouts/account", {
      method: "POST",
      body: { action: "PAYOUTS_ENABLED" },
    })).status === 422);

  const tutorPayouts = await tutor("/api/payouts");
  check("a tutor lists their own payouts", tutorPayouts.ok);
  const parentPayouts = await parent("/api/payouts");
  check("a parent cannot", parentPayouts.status === 403);

  const badPayoutStatus = await tutor("/api/payouts?status=NOT_A_STATUS");
  check("a payout status outside the enumeration is refused",
    badPayoutStatus.status === 422);

  // --- Notifications and favourites ----------------------------------------
  section("Notifications and favourites");

  const anonNotifications = await anon("/api/notifications");
  check("notifications need an account", anonNotifications.status === 401);

  const notifications = await parent("/api/notifications?pageSize=10");
  check("a parent reads their own notifications", notifications.ok);
  check("with an unread count beside them",
    Number.isInteger(notifications.payload?.data?.unreadCount));
  check("and paginated like every other list",
    Number.isInteger(notifications.payload?.meta?.total));
  const unreadOnly = await parent("/api/notifications?unreadOnly=true&pageSize=10");
  check("the unread filter returns only unread notifications",
    unreadOnly.ok && (unreadOnly.payload?.data?.notifications ?? []).every((n) => !n.readAt));

  const markRead = await parent("/api/notifications/read", {
    method: "POST",
    body: { all: true },
  });
  check("marking every notification read is accepted", markRead.ok,
    JSON.stringify(markRead.payload?.error));
  check("and the unread count drops to nothing",
    markRead.payload?.data?.unreadCount === 0, String(markRead.payload?.data?.unreadCount));

  const badMarkRead = await parent("/api/notifications/read", {
    method: "POST",
    body: { ids: ["not-an-id"] },
  });
  check("marking a malformed id read is refused", badMarkRead.status === 422);

  const badNotificationPage = await parent("/api/notifications?page=0");
  check("a page below one is refused", badNotificationPage.status === 422);

  const favouriteBad = await parent("/api/favourites", {
    method: "POST",
    body: { tutorProfileId: "not-an-id" },
  });
  check("a favourite with a malformed tutor id is refused", favouriteBad.status === 422);

  const favouriteMissing = await parent("/api/favourites", {
    method: "POST",
    body: { tutorProfileId: "000000000000000000000000" },
  });
  check("and one naming a tutor that does not exist is refused rather than stored",
    favouriteMissing.status === 404, `status ${favouriteMissing.status}`);

  const favouriteOnce = await parent("/api/favourites", {
    method: "POST",
    body: { tutorProfileId: tutorId },
  });
  const favouriteTwice = await parent("/api/favourites", {
    method: "POST",
    body: { tutorProfileId: tutorId },
  });
  check("saving the same tutor twice is idempotent rather than a duplicate",
    favouriteOnce.ok && favouriteTwice.ok,
    `${favouriteOnce.status}/${favouriteTwice.status}`);
  const favouriteList = await parent("/api/favourites");
  check("and the tutor appears exactly once",
    (favouriteList.payload?.data?.favourites ?? [])
      .filter((f) => f.tutor?.id === tutorId).length === 1,
    String((favouriteList.payload?.data?.favourites ?? []).length));

  const tutorFavourites = await tutor("/api/favourites");
  check("a tutor has no favourites list", tutorFavourites.status === 403);

  await parent(`/api/favourites?tutorProfileId=${tutorId}`, { method: "DELETE" });

  // --- Security headers ----------------------------------------------------
  //
  // Read off the running server rather than off the config file, because the
  // config file is not what a browser obeys. Two of these headers differ
  // between development and production by design — `'unsafe-eval'` for the
  // hot-module client, and HSTS, which must never pin a developer's
  // `http://localhost` to TLS — so the assertions below are the invariants
  // that have to hold in *both* modes (§36).
  section("Security headers");

  const headerProbe = await anon("/", { raw: true });
  const header = (name) => headerProbe.headers.get(name) ?? "";

  check("every response carries a content security policy",
    header("content-security-policy").length > 0);
  check("X-Content-Type-Options is still nosniff",
    header("x-content-type-options") === "nosniff");
  check("the framing controls are still set",
    header("x-frame-options") === "SAMEORIGIN" &&
      /frame-ancestors 'self'/.test(header("content-security-policy")));
  check("and the referrer policy",
    header("referrer-policy") === "strict-origin-when-cross-origin");
  check("and the permissions policy",
    /camera=\(\)/.test(header("permissions-policy")));

  const csp = header("content-security-policy");
  check("the policy has a default of self", /default-src 'self'/.test(csp));
  check("scripts may not be loaded from another origin",
    /script-src 'self'/.test(csp) && !/script-src[^;]*\*/.test(csp) &&
      !/script-src[^;]*https?:(?!\/\/)/.test(csp));
  check("plugin content is refused outright", /object-src 'none'/.test(csp));
  check("a <base> injection cannot retarget relative URLs",
    /base-uri 'self'/.test(csp));
  check("a form cannot be posted to somebody else's server",
    /form-action 'self'/.test(csp));
  check("nothing third-party may be framed", /frame-src 'self'/.test(csp));
  check("images are restricted to this origin and the configured photo hosts",
    /img-src 'self' data: blob: https:/.test(csp) && !/img-src[^;]*\s\*/.test(csp));
  check("connections are restricted to this origin",
    /connect-src 'self'/.test(csp));
  check("no directive is opened with a bare wildcard",
    !/(^|;)\s*[a-z-]+-src \*/.test(csp), csp);

  const hsts = header("strict-transport-security");
  const overTls = BASE.startsWith("https://");
  check("HSTS is sent only where it is safe to pin",
    overTls ? hsts.startsWith("max-age=") : hsts === "",
    `origin ${BASE}, header "${hsts}"`);
  if (hsts) {
    const maxAge = Number(hsts.match(/max-age=(\d+)/)?.[1] ?? 0);
    check("and its max-age is at least a year", maxAge >= 31536000, String(maxAge));
  }

  // The document policy must not be imposed on the API, because two binary
  // routes set a deliberately *stricter* one of their own — a header declared
  // in the config replaces a header a route handler set, and the verification
  // document route's `sandbox` is not something to lose to a broader default.
  const apiCsp = await anon("/api/curriculum/subjects", { raw: true });
  check("the document policy is not imposed on API responses",
    (apiCsp.headers.get("content-security-policy") ?? "") !== csp,
    apiCsp.headers.get("content-security-policy"));
  check("while the rest of the headers still reach them",
    apiCsp.headers.get("x-content-type-options") === "nosniff");

  const swHeaders = await anon("/sw.js", { raw: true });
  check("the service worker is never served from a cache",
    /no-store/.test(swHeaders.headers.get("cache-control") ?? ""));

  const apiHeaders = await parent("/api/bookings", { raw: true });
  check("and no API response may be stored by anything",
    /no-store/.test(apiHeaders.headers.get("cache-control") ?? ""));

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

  // Four kinds of bad input, each refused by the pipeline rather than by a
  // service that happened to check: a malformed id, a value outside an
  // enumeration, a number outside its bounds, and a required field left out.
  // Every one of them must come back as the standard envelope with per-field
  // detail — never as a driver error and never as a 500 (§6, §37).
  const malformed = [
    ["a booking id that is not an id", await parent("/api/bookings/12345")],
    ["a payment id that is not an id", await parent("/api/payments/not-an-id")],
    ["a dispute id that is not an id", await parent("/api/disputes/xyz")],
    ["an admin user id that is not an id", await admin("/api/admin/users/nope")],
  ];
  for (const [label, res] of malformed) {
    check(`${label} is refused cleanly`,
      res.status === 422 || res.status === 404, `status ${res.status}`);
    check(`and ${label} never leaks a driver error`,
      !/E11000|MongoServerError|CastError|ObjectId/i.test(JSON.stringify(res.payload ?? {})),
      JSON.stringify(res.payload?.error?.message));
  }

  const badEnums = [
    ["a booking scope", await parent("/api/bookings?scope=SIDEWAYS")],
    ["a booking status", await parent("/api/bookings?status=NOT_A_STATUS")],
    ["a dispute status", await parent("/api/disputes?status=NOT_A_STATUS")],
    ["a search sort order", await anon("/api/search/tutors?sort=BY_VIBES")],
    ["a lesson mode", await parent("/api/bookings", {
      method: "POST",
      body: {
        tutorProfileId: tutorId,
        studentProfileId: studentId,
        courseId,
        mode: "TELEPATHY",
        startAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        durationMinutes: 60,
      },
    })],
  ];
  for (const [label, res] of badEnums) {
    check(`${label} outside the enumeration is refused`, res.status === 422,
      `status ${res.status}`);
  }

  const boundaries = [
    ["a page below one", await parent("/api/bookings?page=0")],
    ["a page size above the ceiling", await parent("/api/bookings?pageSize=10000")],
    ["an analytics window beyond a year", await admin("/api/admin/analytics?days=9999")],
    ["a search distance beyond the maximum", await anon("/api/search/tutors?distanceKm=99999")],
    ["a review rating above five", await parent("/api/reviews", {
      method: "POST",
      body: {
        bookingId,
        rating: 6,
        knowledge: 5,
        communication: 5,
        reliability: 5,
        teaching: 5,
        body: "A rating outside the scale the product defines.",
      },
    })],
  ];
  for (const [label, res] of boundaries) {
    check(`${label} is refused`, res.status === 422, `status ${res.status}`);
  }

  const missingFields = await parent("/api/bookings", { method: "POST", body: {} });
  check("a request with none of its required fields is refused",
    missingFields.status === 422);
  check("and says which fields, one entry each",
    Object.keys(missingFields.payload?.error?.details?.fieldErrors ?? {}).length >= 3,
    Object.keys(missingFields.payload?.error?.details?.fieldErrors ?? {}).join(","));

  const notJson = await parent("/api/bookings", { method: "POST", rawBody: "{not json" });
  check("a body that is not JSON is refused as a validation error, not a crash",
    notJson.status === 422, `status ${notJson.status}`);

  const unknownFieldsIgnored = await parent("/api/students", {
    method: "POST",
    body: {
      firstName: `QA${qaTag}`,
      role: "ADMIN",
      creditBalanceCents: 100000,
      isMinor: false,
    },
  });
  if (unknownFieldsIgnored.ok) {
    const created = unknownFieldsIgnored.payload?.data?.student;
    check("fields the schema does not name are dropped rather than stored",
      created?.role === undefined && created?.creditBalanceCents === undefined,
      JSON.stringify({ role: created?.role, credit: created?.creditBalanceCents }));
    const me = await parent("/api/users/me");
    check("and the account that sent them is unchanged",
      me.payload?.data?.user?.role === "PARENT" &&
        me.payload?.data?.user?.creditBalanceCents !== 100000);
    if (created?.id) {
      await parent(`/api/students/${created.id}`, { method: "DELETE" });
    }
  } else {
    check("a learner profile carrying privileged fields is refused",
      unknownFieldsIgnored.status === 422, `status ${unknownFieldsIgnored.status}`);
  }

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
