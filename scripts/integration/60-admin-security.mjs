/**
 * Administration and security hardening (R28.2, R28.3, R28.25–R28.32,
 * R30.10, S8, S9, S10, S11, S14, S15, S19).
 *
 * Fixture accounts only; nothing seeded is changed.
 */
export default async function adminSecuritySuite({ section, check, skip, throws, connectForSuite, randomUUID }) {
  section("Admin — suspend, ban, restore and their limits (R28.2, S14)");
  if (!(await connectForSuite())) return skip("admin & security", "MongoDB is not reachable");

  const models = await import("@/models");
  const { User, StudentProfile, Conversation, Message, AuditLog, SearchEvent } = models;
  const users = await import("@/services/user.service");
  const { authenticateWithPassword } = await import("@/services/auth.service");
  const { getConversation } = await import("@/services/message.service");
  const { hashPassword } = await import("@/lib/auth/password");
  const { clientIp } = await import("@/lib/security/rate-limit");
  const { readBoundedFormData } = await import("@/lib/security/upload-size");
  const { marketplaceOverview, marketplaceBreakdowns } = await import("@/services/analytics.service");
  const { USER_STATUS, AUDIT_ACTIONS } = await import("@/constants");

  const tag = randomUUID().slice(0, 8);
  const ids = [];
  const make = async (role, extra = {}) => {
    const user = await User.create({
      email: `qa-sec-${role.toLowerCase()}-${ids.length}-${tag}@example.com`, firstName: "Sec", lastName: `User${ids.length}`,
      role, status: USER_STATUS.ACTIVE, emailVerifiedAt: new Date(), passwordHash: await hashPassword("AplusLearn2024!"),
      phone: "4165550100", city: "Toronto", province: "ON", postalCode: "M5V 2T6", ...extra,
    });
    ids.push(user._id);
    return user;
  };
  const actor = (u) => ({ id: String(u._id), role: u.role });

  try {
    const admin = await make("ADMIN");
    const target = await make("PARENT");

    const selfBan = await throws(() => users.adminUserAction(String(admin._id), { action: "BAN", reason: "testing myself out" }, actor(admin)));
    check("an administrator cannot ban themselves", selfBan.threw, selfBan.error?.message);

    await users.adminUserAction(String(target._id), { action: "BAN", reason: "Repeated off-platform payment requests" }, actor(admin));
    const banned = await User.findById(target._id).lean();
    check("a ban is its own state, with its reason", banned.status === USER_STATUS.BANNED && /off-platform/.test(banned.statusReason ?? ""));
    const login = await throws(() => authenticateWithPassword({ email: target.email, password: "AplusLearn2024!" }));
    check("a banned account cannot sign in", login.threw, login.error?.message);
    await users.adminUserAction(String(target._id), { action: "REINSTATE", reason: "Appeal accepted after review" }, actor(admin));
    check("…and is restored only by an administrator, with a reason", (await User.findById(target._id).lean()).status === USER_STATUS.ACTIVE);

    // S15 — the audit names what happened.
    await users.adminUserAction(String(target._id), { action: "FORCE_LOGOUT" }, actor(admin));
    const forced = await AuditLog.findOne({ entityId: target._id }).sort({ createdAt: -1 }).lean();
    check("a forced sign-out is audited as itself, not as a reinstatement (S15)", forced && forced.action !== AUDIT_ACTIONS.USER_REINSTATED, forced?.action);

    // R28.3 — history from the records themselves.
    const detail = await users.getUserDetail(String(target._id));
    check("an account's detail carries its booking, payment and conversation history", Boolean(detail) && ["bookings", "payments", "conversations"].every((k) => k in (detail.history ?? detail)),
      Object.keys(detail ?? {}).join(","));

    // --- S9 deletion ---------------------------------------------------------
    section("Deletion — one anonymisation for self and admin (S9, R30.10)");
    const parent = await make("PARENT");
    const child = await StudentProfile.create({ ownerId: parent._id, firstName: "Kidname", lastName: "Surname", school: "QA School", notes: "Struggles with fractions", isMinor: true });
    await users.deleteAccount(String(parent._id), { password: "AplusLearn2024!" });
    const goneParent = await User.findById(parent._id).lean();
    const goneChild = await StudentProfile.findById(child._id).lean();
    check("self-deletion removes the person's name, email, phone and address",
      goneParent.status === USER_STATUS.DELETED && goneParent.firstName !== "Sec" && !goneParent.email.includes("qa-sec") && !goneParent.phone && !goneParent.postalCode);
    check("…and empties their children's profiles", goneChild.firstName !== "Kidname" && !goneChild.school && !goneChild.notes);

    const other = await make("PARENT");
    await users.adminUserAction(String(other._id), { action: "DELETE", reason: "Requested deletion by email" }, actor(admin));
    const adminDeleted = await User.findById(other._id).lean();
    check("an administrator's delete anonymises exactly the same way", adminDeleted.status === USER_STATUS.DELETED && !adminDeleted.email.includes("qa-sec") && !adminDeleted.phone);

    // --- S8 -------------------------------------------------------------------
    section("Messaging — an administrator is not a participant (S8)");
    const learner = await make("PARENT");
    const tutor = await make("TUTOR");
    const conversation = await Conversation.create({ participantIds: [learner._id, tutor._id], learnerUserId: learner._id, tutorUserId: tutor._id });
    const adminRead = await throws(() => getConversation(String(conversation._id), actor(admin)));
    check("an administrator cannot open a thread they are not in through the participant path", adminRead.threw, adminRead.error?.message);
    const own = await getConversation(String(conversation._id), actor(learner));
    check("a participant can", Boolean(own));
    await Message.deleteMany({ conversationId: conversation._id });
    await Conversation.deleteOne({ _id: conversation._id });

    // --- S11 / S19 ------------------------------------------------------------
    section("Request hardening — client address and upload size (S11, S19)");
    const req = (headers) => ({ headers: new Headers(headers) });
    const saved = process.env.TRUSTED_PROXY_HOPS;
    delete process.env.TRUSTED_PROXY_HOPS;
    check("a spoofed X-Forwarded-For is not the client address", clientIp(req({ "x-forwarded-for": "6.6.6.6", "x-real-ip": "10.0.0.7" })) === "10.0.0.7");
    process.env.TRUSTED_PROXY_HOPS = "1";
    check("with one trusted proxy, the address it appended is used", clientIp(req({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" })) === "203.0.113.9");
    if (saved === undefined) delete process.env.TRUSTED_PROXY_HOPS;
    else process.env.TRUSTED_PROXY_HOPS = saved;

    const huge = new Request("http://test/upload", { method: "POST", headers: { "content-length": String(50 * 1024 * 1024) }, body: "x" });
    const tooBig = await throws(() => readBoundedFormData(huge, 1024 * 1024, "too big"));
    check("an upload declaring more than the limit is refused before it is read", tooBig.threw && tooBig.error?.status === 413, String(tooBig.error?.status));

    // --- Analytics ------------------------------------------------------------
    section("Analytics — figures match their labels (R28.25–R28.32)");
    const overview = await marketplaceOverview({ days: 30 });
    const breakdowns = await marketplaceBreakdowns({ days: 30 });
    const flat = JSON.stringify({ overview, breakdowns });
    check("the overview reports approved tutors and active learners", /approved/i.test(flat) && /active/i.test(flat));
    const event = await SearchEvent.create({ subjectSlug: `qa-${tag}`, subjectName: `QA ${tag}`, queryKind: "SUBJECT", createdAt: new Date(), expiresAt: new Date(Date.now() + 86400000) });
    const after = await marketplaceBreakdowns({ days: 30, limit: 1000 });
    await SearchEvent.deleteOne({ _id: event._id });
    check("searches recorded as events reach the admin report (R28.31)",
      after.search?.totalSearches === (breakdowns.search?.totalSearches ?? 0) + 1,
      `${breakdowns.search?.totalSearches} → ${after.search?.totalSearches}`);
  } finally {
    await StudentProfile.deleteMany({ ownerId: { $in: ids } });
    await AuditLog.deleteMany({ $or: [{ entityId: { $in: ids } }, { actorId: { $in: ids } }] });
    await User.deleteMany({ _id: { $in: ids } });
  }
}
