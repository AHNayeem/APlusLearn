/**
 * Development seed (§40).
 *
 * Builds a realistic Ontario marketplace: curriculum, approved tutors with
 * availability, families with children, completed and upcoming bookings,
 * payments, reviews, conversations, a tutor request, and an admin account.
 *
 *   bun run seed          # wipe and reseed
 *   bun run seed --keep   # only add what is missing
 */

import mongoose from "mongoose";
import bcrypt from "bcryptjs";

import { PROVINCES, GRADES, SUBJECTS, COURSES } from "./seed-data/curriculum.js";
import { TUTORS, PARENTS, SELF_STUDENTS, REVIEW_TEMPLATES } from "./seed-data/people.js";

// Models are plain mongoose schemas with relative imports, so they load
// directly under Node without the bundler's path alias.
import {
  User, Province, Grade, Subject, Course, TutorProfile, TutorApplication,
  VerificationRecord, StudentProfile, Availability, Booking, Payment, Payout,
  PayoutAccount, Conversation, Message, TutorRequest, TutorMatch, Favourite,
  Review, Notification, Dispute, AuditLog, Settings,
} from "../src/models/index.js";

const SEED_PASSWORD = "AplusLearn2024!";
const KEEP = process.argv.includes("--keep");

const log = (...args) => console.log("  ", ...args);
const section = (title) => console.log(`\n▸ ${title}`);

function slugify(value = "") {
  return String(value).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function reference(prefix) {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${prefix}-${out}`;
}

const CITY_COORDS = {
  Toronto: [-79.3832, 43.6532], Scarborough: [-79.2318, 43.7764],
  "North York": [-79.4163, 43.7615], Mississauga: [-79.6441, 43.589],
  Brampton: [-79.7624, 43.7315], Markham: [-79.337, 43.8561],
  Ottawa: [-75.6972, 45.4215], Hamilton: [-79.8711, 43.2557],
  London: [-81.2497, 42.9849], Oshawa: [-78.8658, 43.8971],
};

/**
 * Teaching-environment photos for the search-card gallery. Unsplash is the
 * only image host `next.config.mjs` allows, and these are rooms and desks —
 * never a building exterior, which would leak an address (§15, §42).
 */
const GALLERY_POOL = [
  "photo-1517245386807-bb43f82c33c4",
  "photo-1524178232363-1fb2b075b655",
  "photo-1503676260728-1c00da094a0b",
  "photo-1509062522246-3755977927d7",
  "photo-1522202176988-66273c2fd55f",
  "photo-1427504494785-3a9ca7044f45",
  "photo-1544377193-33dcf4d68fb5",
  "photo-1588072432836-e10032774350",
  "photo-1497633762265-9d179a990aa6",
  "photo-1513475382585-d06e58bcb0e0",
  "photo-1434030216411-0b793f4b4173",
  "photo-1546410531-bb4caa6b424d",
  "photo-1571260899304-425eee4c7efc",
  "photo-1523240795612-9a054b0db644",
  "photo-1600880292203-757bb62b4baf",
  "photo-1596495578065-6e0763fa1178",
].map((id) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=800&q=70`);

/** Five photos per tutor, rotating so no two neighbouring cards look alike. */
function galleryFor(index) {
  return Array.from(
    { length: 5 },
    (_, i) => GALLERY_POOL[(index * 3 + i) % GALLERY_POOL.length],
  );
}

const timeToMinutes = (t) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

/** Next occurrence of a weekday/time, offset by whole weeks. */
function nextOccurrence(weekday, minutes, weeksAhead = 0) {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const delta = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + delta + weeksAhead * 7);
  // Toronto is UTC-4/-5; +4 hours approximates local wall clock closely enough
  // for seed data and always lands inside the tutor's availability window.
  date.setUTCHours(Math.floor(minutes / 60) + 4, minutes % 60, 0, 0);
  return date;
}

function pick(array, index) {
  return array[index % array.length];
}

async function main() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/aplus_learn";
  await mongoose.connect(uri);
  console.log(`\nAPlus Learn seed → ${uri}`);

  if (!KEEP) {
    section("Clearing existing data");
    await Promise.all(
      [User, Province, Grade, Subject, Course, TutorProfile, TutorApplication,
       VerificationRecord, StudentProfile, Availability, Booking, Payment, Payout,
       PayoutAccount, Conversation, Message, TutorRequest, TutorMatch, Favourite,
       Review, Notification, Dispute, AuditLog, Settings].map((M) => M.deleteMany({})),
    );
    log("collections cleared");
  }

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // --- Settings ------------------------------------------------------------
  section("Platform settings");
  await Settings.findOneAndUpdate({ key: "PLATFORM" }, { $setOnInsert: { key: "PLATFORM" } },
    { upsert: true, setDefaultsOnInsert: true });
  log("commission 15%, 24h free cancellation");

  // --- Curriculum ----------------------------------------------------------
  section("Curriculum");
  const provinces = {};
  for (const p of PROVINCES) {
    provinces[p.code] = await Province.findOneAndUpdate(
      { code: p.code },
      { $set: { ...p, slug: slugify(p.name) } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
  }
  log(`${PROVINCES.length} provinces (Ontario active)`);

  const ontario = provinces.ON;
  const grades = {};
  for (const g of GRADES) {
    grades[g.level] = await Grade.findOneAndUpdate(
      { provinceId: ontario._id, slug: slugify(g.name) },
      { $set: { ...g, provinceId: ontario._id, slug: slugify(g.name) } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
  }
  log(`${GRADES.length} Ontario grades`);

  const subjects = {};
  for (const s of SUBJECTS) {
    subjects[s.name] = await Subject.findOneAndUpdate(
      { slug: slugify(s.name) },
      { $set: { ...s, slug: slugify(s.name) } },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
  }
  log(`${SUBJECTS.length} subjects`);

  const courses = {};
  for (const c of COURSES) {
    const grade = grades[c.grade];
    const subject = subjects[c.subject];
    const doc = await Course.findOneAndUpdate(
      c.code
        ? { provinceId: ontario._id, code: c.code }
        : { provinceId: ontario._id, gradeId: grade._id, slug: slugify(c.name) },
      {
        // `code` is only set when the course actually has one — writing an
        // explicit null would collide under the partial unique index.
        $set: {
          provinceId: ontario._id, gradeId: grade._id, subjectId: subject._id,
          name: c.name, slug: slugify(c.name),
          description: c.description, credits: c.credits, stream: c.stream,
          provinceCode: "ON", gradeSlug: grade.slug, gradeLevel: grade.level,
          subjectSlug: subject.slug, subjectName: subject.name,
          isPopular: c.isPopular ?? false, isActive: true,
          ...(c.code ? { code: c.code } : {}),
        },
        ...(c.code ? {} : { $unset: { code: "" } }),
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    courses[c.code ?? `${c.name}-${c.grade}`] = doc;
    if (c.code) courses[c.code] = doc;
    else courses[c.name] = doc; // elementary courses looked up by name
  }
  log(`${COURSES.length} Ontario courses (MHF4U, ENG4U, MCV4U, SBI4U, SCH4U …)`);

  // --- Admin ---------------------------------------------------------------
  section("Accounts");
  const admin = await User.findOneAndUpdate(
    { email: "admin@apluslearn.ca" },
    {
      $set: {
        email: "admin@apluslearn.ca", passwordHash, firstName: "Alex", lastName: "Morgan",
        role: "ADMIN", status: "ACTIVE", emailVerifiedAt: new Date(),
        city: "Toronto", province: "ON", acceptedTermsAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );
  log("admin@apluslearn.ca");

  // --- Tutors --------------------------------------------------------------
  const tutorProfiles = [];
  for (const t of TUTORS) {
    const user = await User.findOneAndUpdate(
      { email: t.email },
      {
        $set: {
          email: t.email, passwordHash, firstName: t.firstName, lastName: t.lastName,
          role: "TUTOR", status: "ACTIVE", emailVerifiedAt: new Date(),
          phone: `416555${String(1000 + tutorProfiles.length).slice(-4)}`,
          city: t.city, province: "ON", postalCode: t.postalCode,
          timeZone: "America/Toronto", acceptedTermsAt: new Date(),
          avatarUrl: null,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    const taught = t.courses
      .map((key) => courses[key])
      .filter(Boolean)
      .map((course, i) => ({
        courseId: course._id, code: course.code, name: course.name,
        subjectId: course.subjectId, subjectSlug: course.subjectSlug,
        gradeLevel: course.gradeLevel, gradeSlug: course.gradeSlug, provinceCode: "ON",
        // A couple of courses carry a premium for the tutor's specialism.
        hourlyRateCents: i === 0 ? undefined : undefined,
        yearsTeaching: Math.max(1, t.years - i),
      }));

    const coords = CITY_COORDS[t.city] ?? CITY_COORDS.Toronto;

    const profile = await TutorProfile.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          userId: user._id,
          slug: `${slugify(`${t.firstName}-${t.lastName.charAt(0)}`)}-${slugify(t.city).slice(0, 4)}`,
          headline: t.headline, bio: t.bio,
          gallery: galleryFor(tutorProfiles.length),
          status: "APPROVED", isSearchable: true, approvedAt: new Date(),
          education: t.education, experience: t.experience ?? [],
          qualifications: t.qualifications, octNumber: t.oct,
          yearsExperience: t.years,
          courses: taught,
          courseIds: taught.map((c) => c.courseId),
          courseCodes: taught.map((c) => c.code).filter(Boolean),
          subjectIds: [...new Set(taught.map((c) => String(c.subjectId)))],
          subjectSlugs: [...new Set(taught.map((c) => c.subjectSlug))],
          gradeLevels: [...new Set(taught.map((c) => c.gradeLevel))],
          provinceCodes: ["ON"],
          lessonModes: t.modes,
          // All three platforms §27 names. Not every tutor offers every one,
          // so the booking form has something real to choose between.
          onlineMeetingProviders: t.modes.includes("ONLINE")
            ? tutorProfiles.length % 3 === 0
              ? ["ZOOM", "GOOGLE_MEET", "MICROSOFT_TEAMS"]
              : tutorProfiles.length % 3 === 1
                ? ["ZOOM", "GOOGLE_MEET"]
                : ["GOOGLE_MEET", "MICROSOFT_TEAMS"]
            : [],
          // Not everyone teaching in person is willing to host at their own
          // place, so alternate — otherwise every card looks identical.
          inPersonLocationTypes: t.modes.includes("IN_PERSON")
            ? [
                "STUDENT_HOME", "LIBRARY", "PUBLIC_PLACE",
                ...(tutorProfiles.length % 2 === 0 ? ["TUTOR_LOCATION"] : []),
              ]
            : [],
          city: t.city, province: "ON", postalCodePrefix: t.postalCode.slice(0, 3),
          location: { type: "Point", coordinates: coords },
          travelRadiusKm: t.radius,
          hourlyRateCents: t.rate, minHourlyRateCents: t.rate,
          offersFreeIntro: t.freeIntro ?? false,
          languages: t.languages, timeZone: "America/Toronto",
          verifiedTypes: t.badges,
          verificationBadges: t.badges.map((type) => ({
            type, grantedAt: new Date(), grantedBy: admin._id,
          })),
          acceptingNewStudents: true,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    await TutorApplication.findOneAndUpdate(
      { userId: user._id },
      {
        $set: {
          userId: user._id, tutorProfileId: profile._id, status: "APPROVED",
          completedSteps: ["PERSONAL", "PROFILE", "EDUCATION", "QUALIFICATIONS", "COURSES",
            "LESSON_TYPE", "LOCATION", "PRICING", "AVAILABILITY", "DOCUMENTS", "REVIEW"],
          currentStep: "REVIEW",
          submittedAt: new Date(Date.now() - 30 * 86400000),
          reviewedAt: new Date(Date.now() - 28 * 86400000),
          reviewedBy: admin._id,
          reviewNotes: [{ adminId: admin._id, action: "APPROVED", message: "Credentials verified." }],
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    for (const type of t.badges) {
      await VerificationRecord.findOneAndUpdate(
        { tutorProfileId: profile._id, type },
        {
          $set: {
            tutorProfileId: profile._id, userId: user._id, type, status: "APPROVED",
            submittedAt: new Date(Date.now() - 30 * 86400000),
            reviewedAt: new Date(Date.now() - 28 * 86400000), reviewedBy: admin._id,
            referenceNumber: type === "OCT" ? t.oct : undefined,
          },
        },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }

    await Availability.findOneAndUpdate(
      { tutorProfileId: profile._id },
      {
        $set: {
          tutorProfileId: profile._id, userId: user._id, timeZone: "America/Toronto",
          weeklyRules: t.availability.map((a) => ({
            weekday: a.weekday,
            startMinutes: timeToMinutes(a.start),
            endMinutes: timeToMinutes(a.end),
          })),
          bufferMinutes: 15, slotIncrementMinutes: 30, minNoticeHours: 4,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    await PayoutAccount.findOneAndUpdate(
      { tutorUserId: user._id },
      {
        $set: {
          tutorUserId: user._id, provider: "MOCK",
          providerAccountId: `acct_seed_${profile._id}`,
          onboardingStatus: "COMPLETE", payoutsEnabled: true, chargesEnabled: true,
          bankName: "Mock Bank of Canada",
          accountLast4: String(1000 + tutorProfiles.length).slice(-4),
          completedAt: new Date(),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );

    tutorProfiles.push({ user, profile, seed: t });
  }
  log(`${TUTORS.length} approved tutors with availability and payout accounts`);

  // --- Families ------------------------------------------------------------
  const families = [];
  for (const p of PARENTS) {
    const user = await User.findOneAndUpdate(
      { email: p.email },
      {
        $set: {
          email: p.email, passwordHash, firstName: p.firstName, lastName: p.lastName,
          role: "PARENT", status: "ACTIVE", emailVerifiedAt: new Date(),
          city: p.city, province: "ON", postalCode: p.postalCode,
          timeZone: "America/Toronto", acceptedTermsAt: new Date(),
          location: { type: "Point", coordinates: CITY_COORDS[p.city] ?? CITY_COORDS.Toronto },
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );

    const children = [];
    for (const c of p.children) {
      const grade = grades[c.grade];
      children.push(
        await StudentProfile.findOneAndUpdate(
          { ownerId: user._id, firstName: c.firstName },
          {
            $set: {
              ownerId: user._id, isSelf: false,
              firstName: c.firstName, lastName: c.lastName, birthYear: c.birthYear,
              provinceCode: "ON", gradeId: grade._id, gradeLevel: grade.level,
              gradeName: grade.name, school: c.school, notes: c.notes,
              isMinor: new Date().getFullYear() - c.birthYear < 18,
            },
          },
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
        ),
      );
    }
    families.push({ user, children });
  }

  for (const s of SELF_STUDENTS) {
    const user = await User.findOneAndUpdate(
      { email: s.email },
      {
        $set: {
          email: s.email, passwordHash, firstName: s.firstName, lastName: s.lastName,
          role: "STUDENT", status: "ACTIVE", emailVerifiedAt: new Date(),
          city: s.city, province: "ON", postalCode: s.postalCode,
          timeZone: "America/Toronto", acceptedTermsAt: new Date(),
          location: { type: "Point", coordinates: CITY_COORDS[s.city] ?? CITY_COORDS.Toronto },
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    const grade = grades[s.grade];
    const self = await StudentProfile.findOneAndUpdate(
      { ownerId: user._id, isSelf: true },
      {
        $set: {
          ownerId: user._id, isSelf: true, firstName: s.firstName, lastName: s.lastName,
          birthYear: s.birthYear, provinceCode: "ON", gradeId: grade._id,
          gradeLevel: grade.level, gradeName: grade.name, notes: s.notes, isMinor: false,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
    families.push({ user, children: [self] });
  }
  log(`${PARENTS.length} parents, ${PARENTS.reduce((n, p) => n + p.children.length, 0)} children, ${SELF_STUDENTS.length} self-serve students`);

  // --- Bookings, payments, reviews ----------------------------------------
  section("Marketplace activity");
  let completedCount = 0;
  let upcomingCount = 0;
  let reviewCount = 0;
  const commission = 15;

  for (const [familyIndex, family] of families.entries()) {
    for (const [childIndex, child] of family.children.entries()) {
      // Pair each learner with two tutors who teach at their grade level.
      const matches = tutorProfiles.filter((t) =>
        t.profile.gradeLevels.includes(child.gradeLevel),
      );
      const chosen = matches.length
        ? [pick(matches, familyIndex + childIndex), pick(matches, familyIndex + childIndex + 3)]
        : [pick(tutorProfiles, familyIndex)];

      for (const [tutorIndex, { user: tutorUser, profile, seed }] of chosen.entries()) {
        const taught = profile.courses.filter((c) => c.gradeLevel === child.gradeLevel);
        const course = taught[0] ?? profile.courses[0];
        if (!course) continue;

        const rule = seed.availability[tutorIndex % seed.availability.length];
        const duration = 60;
        const subtotal = Math.round((profile.hourlyRateCents * duration) / 60);
        const commissionCents = Math.floor((subtotal * commission) / 100);
        const price = {
          hourlyRateCents: profile.hourlyRateCents, durationMinutes: duration,
          subtotalCents: subtotal, commissionPercent: commission,
          commissionCents, tutorEarningsCents: subtotal - commissionCents,
          totalCents: subtotal, currency: "CAD",
        };

        // --- Two completed lessons in the past ---
        for (let week = 1; week <= 2; week += 1) {
          const startAt = nextOccurrence(rule.weekday, timeToMinutes(rule.start), -week);
          if (startAt >= new Date()) continue;
          const endAt = new Date(startAt.getTime() + duration * 60000);

          const booking = await Booking.create({
            reference: reference("APL"),
            purchaserId: family.user._id, studentProfileId: child._id,
            tutorProfileId: profile._id, tutorUserId: tutorUser._id,
            courseId: course.courseId, courseName: course.name, courseCode: course.code,
            subjectName: SUBJECTS.find((s) => slugify(s.name) === course.subjectSlug)?.name,
            mode: profile.lessonModes[0],
            meeting: profile.lessonModes[0] === "ONLINE"
              ? { provider: "ZOOM", joinUrl: `https://zoom.us/j/${Date.now()}${week}`, meetingId: `${Date.now()}${week}`, createdAt: startAt }
              : undefined,
            location: profile.lessonModes[0] === "IN_PERSON"
              ? { type: "LIBRARY", label: "Local public library", city: profile.city }
              : undefined,
            startAt, endAt, durationMinutes: duration, timeZone: "America/Toronto",
            status: "COMPLETED", price,
            confirmedAt: new Date(startAt.getTime() - 5 * 86400000),
            completedAt: endAt,
          });

          const payment = await Payment.create({
            bookingId: booking._id, purchaserId: family.user._id, tutorUserId: tutorUser._id,
            subtotalCents: price.subtotalCents, commissionPercent: commission,
            commissionCents: price.commissionCents, tutorEarningsCents: price.tutorEarningsCents,
            totalCents: price.totalCents, status: "PAID", provider: "MOCK",
            providerPaymentIntentId: `pi_seed_${booking._id}`,
            paymentMethodBrand: "Visa", paymentMethodLast4: "4242",
            paidAt: new Date(startAt.getTime() - 5 * 86400000),
            receiptNumber: `RCPT-${String(booking._id).slice(-8).toUpperCase()}`,
          });
          booking.paymentId = payment._id;
          await booking.save();
          completedCount += 1;

          // A review on the first completed lesson of each pairing.
          if (week === 1) {
            const template = pick(REVIEW_TEMPLATES, completedCount + familyIndex);
            const review = await Review.create({
              bookingId: booking._id, tutorProfileId: profile._id, tutorUserId: tutorUser._id,
              authorId: family.user._id, studentProfileId: child._id,
              courseId: course.courseId, courseCode: course.code, courseName: course.name,
              rating: template.rating,
              knowledge: Math.min(5, template.rating), communication: template.rating,
              reliability: Math.min(5, template.rating + (template.rating < 5 ? 1 : 0)),
              teaching: template.rating,
              title: template.title, body: template.body,
              isVerified: true, status: "PUBLISHED",
              createdAt: new Date(endAt.getTime() + 86400000),
            });
            booking.reviewId = review._id;
            await booking.save();
            reviewCount += 1;
          }
        }

        // --- One upcoming confirmed lesson ---
        const upcomingStart = nextOccurrence(rule.weekday, timeToMinutes(rule.start), 1);
        const upcomingEnd = new Date(upcomingStart.getTime() + duration * 60000);
        const upcoming = await Booking.create({
          reference: reference("APL"),
          purchaserId: family.user._id, studentProfileId: child._id,
          tutorProfileId: profile._id, tutorUserId: tutorUser._id,
          courseId: course.courseId, courseName: course.name, courseCode: course.code,
          mode: profile.lessonModes[0],
          meeting: profile.lessonModes[0] === "ONLINE"
            ? { provider: "ZOOM", joinUrl: `https://zoom.us/j/9${Date.now()}`, meetingId: `9${Date.now()}`, createdAt: new Date() }
            : undefined,
          location: profile.lessonModes[0] === "IN_PERSON"
            ? { type: "STUDENT_HOME", label: "Student's home", city: family.user.city }
            : undefined,
          startAt: upcomingStart, endAt: upcomingEnd, durationMinutes: duration,
          timeZone: "America/Toronto", status: "CONFIRMED", price,
          confirmedAt: new Date(),
        });
        const upcomingPayment = await Payment.create({
          bookingId: upcoming._id, purchaserId: family.user._id, tutorUserId: tutorUser._id,
          subtotalCents: price.subtotalCents, commissionPercent: commission,
          commissionCents: price.commissionCents, tutorEarningsCents: price.tutorEarningsCents,
          totalCents: price.totalCents, status: "PAID", provider: "MOCK",
          providerPaymentIntentId: `pi_seed_${upcoming._id}`,
          paymentMethodBrand: "Visa", paymentMethodLast4: "4242", paidAt: new Date(),
          receiptNumber: `RCPT-${String(upcoming._id).slice(-8).toUpperCase()}`,
        });
        upcoming.paymentId = upcomingPayment._id;
        await upcoming.save();
        upcomingCount += 1;

        // --- Conversation with booking context ---
        const conversation = await Conversation.findOneAndUpdate(
          { learnerUserId: family.user._id, tutorUserId: tutorUser._id },
          {
            $setOnInsert: {
              participantIds: [family.user._id, tutorUser._id],
              learnerUserId: family.user._id, tutorUserId: tutorUser._id,
              tutorProfileId: profile._id, bookingId: upcoming._id,
            },
          },
          { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
        );

        const thread = [
          { sender: family.user._id, body: `Hi ${tutorUser.firstName}, I'm looking for help with ${course.code ?? course.name} for ${child.firstName}. ${child.notes ?? ""}`.trim() },
          { sender: tutorUser._id, body: `Hi ${family.user.firstName}, thanks for reaching out. I teach ${course.code ?? course.name} regularly. Could you tell me what mark ${child.firstName} is sitting at now, and whether there's a specific unit causing trouble?` },
          { sender: family.user._id, body: "Currently around 72. The last unit test was the problem — a lot of lost marks on multi-step questions even though the homework was fine." },
          { sender: tutorUser._id, body: "That usually means the individual steps are solid but they're not yet connecting them under time pressure. I'd suggest starting weekly and we can reassess after three sessions. I've got the slot we booked available ongoing if that works." },
        ];

        let last;
        for (const [i, m] of thread.entries()) {
          last = await Message.create({
            conversationId: conversation._id, senderId: m.sender, body: m.body,
            readBy: [m.sender],
            createdAt: new Date(Date.now() - (thread.length - i) * 3600000),
          });
        }
        conversation.lastMessageAt = last.createdAt;
        conversation.lastMessagePreview = last.body.slice(0, 140);
        conversation.lastMessageSenderId = last.senderId;
        conversation.unreadCounts = new Map([[String(family.user._id), 1], [String(tutorUser._id), 0]]);
        await conversation.save();
      }

      // Save a tutor the family hasn't booked yet.
      const saved = pick(tutorProfiles, familyIndex + 5);
      await Favourite.findOneAndUpdate(
        { userId: family.user._id, tutorProfileId: saved.profile._id },
        { $setOnInsert: { userId: family.user._id, tutorProfileId: saved.profile._id } },
        { upsert: true, setDefaultsOnInsert: true },
      );
    }
  }
  log(`${completedCount} completed lessons, ${upcomingCount} upcoming, ${reviewCount} reviews`);

  // --- An open tutor request with matches ----------------------------------
  const requester = families[0];
  const requestCourse = courses.SBI4U;
  const request = await TutorRequest.create({
    reference: reference("REQ"),
    ownerId: requester.user._id, studentProfileId: requester.children[0]._id,
    courseId: requestCourse._id, courseName: requestCourse.name, courseCode: requestCourse.code,
    subjectId: requestCourse.subjectId, gradeLevel: requestCourse.gradeLevel, provinceCode: "ON",
    modes: ["ONLINE", "IN_PERSON"], city: "Toronto", postalCode: "M4W 1A8",
    location: { type: "Point", coordinates: CITY_COORDS.Toronto },
    maxDistanceKm: 20, preferredWindows: ["WEEKDAY_EVENING", "WEEKEND"],
    sessionsPerWeek: 2, preferredDurationMinutes: 90,
    budgetMinCents: 5000, budgetMaxCents: 7500,
    goal: "Emily needs to lift SBI4U from a 78 to the high 80s before her university offers are finalised in the spring. Biochemistry and molecular genetics are the weak units.",
    startDate: new Date(Date.now() + 7 * 86400000),
    notes: "We'd prefer evenings after 6pm on weekdays, or Saturday mornings. Happy with either online or in person around midtown Toronto.",
    expiresAt: new Date(Date.now() + 30 * 86400000),
    interestedCount: 0,
  });

  const bioTutors = tutorProfiles.filter((t) => t.profile.courseCodes.includes("SBI4U"));
  for (const [i, { user: tutorUser, profile }] of bioTutors.entries()) {
    await TutorMatch.create({
      requestId: request._id, tutorProfileId: profile._id, tutorUserId: tutorUser._id,
      status: i === 0 ? "TUTOR_INTERESTED" : "SUGGESTED",
      score: 92 - i * 7,
      scoreBreakdown: { course: 40, location: 18 - i * 2, budget: 20, availability: 12, quality: 5 },
      distanceKm: 6 + i * 4,
      message: i === 0
        ? "I tutor SBI4U regularly and biochemistry is the unit students most often need help with — it's where the memorisation load jumps sharply. I'd suggest two 90-minute sessions a week until the unit test, then dropping back to one. I'm free Tuesday and Thursday evenings and Saturday mornings, which matches what you've asked for."
        : undefined,
      proposedRateCents: i === 0 ? 6200 : undefined,
      respondedAt: i === 0 ? new Date() : undefined,
    });
  }
  await TutorRequest.updateOne({ _id: request._id }, { $set: { interestedCount: 1 } });
  log(`1 open tutor request with ${bioTutors.length} matches`);

  // --- A pending application for the admin queue ---------------------------
  const pendingUser = await User.findOneAndUpdate(
    { email: "james.oconnor@example.com" },
    {
      $set: {
        email: "james.oconnor@example.com", passwordHash,
        firstName: "James", lastName: "O'Connor", role: "TUTOR",
        status: "ACTIVE", emailVerifiedAt: new Date(),
        city: "Waterloo", province: "ON", postalCode: "N2L 3G1",
        phone: "5195550188", timeZone: "America/Toronto", acceptedTermsAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  const pendingCourses = ["MCV4U", "MHF4U", "ICS4U"].map((c) => courses[c]).filter(Boolean);
  const pendingProfile = await TutorProfile.findOneAndUpdate(
    { userId: pendingUser._id },
    {
      $set: {
        userId: pendingUser._id, slug: "james-o-wate",
        headline: "Mathematics and computer science — Waterloo graduate, contest coaching",
        bio: "I graduated from Waterloo's combinatorics and optimization program and have spent three years tutoring senior mathematics and computer science alongside contract software work. Most of my students are aiming at Waterloo, Toronto or McMaster engineering programs, where the marks required leave very little room for error.\n\nMy focus is on problem-solving technique rather than content coverage — by Grade 12 most students have seen the material, and what separates an 80 from a 93 is how they approach an unfamiliar question. I run sessions around a problem set graded slightly above the course level.\n\nI also coach for the Euclid and CCC contests and can prepare students for those alongside their coursework.",
        status: "PENDING_REVIEW", isSearchable: false,
        education: [
          { institution: "University of Waterloo", credential: "BMath", fieldOfStudy: "Combinatorics and Optimization", startYear: 2018, endYear: 2022 },
        ],
        experience: [
          { title: "Software Developer", organisation: "Contract", startYear: 2022, current: true },
          { title: "Private Tutor", organisation: "Self-employed", startYear: 2021, current: true },
        ],
        qualifications: ["GRADUATE", "SUBJECT_SPECIALIST"],
        yearsExperience: 3,
        courses: pendingCourses.map((c) => ({
          courseId: c._id, code: c.code, name: c.name, subjectId: c.subjectId,
          subjectSlug: c.subjectSlug, gradeLevel: c.gradeLevel, gradeSlug: c.gradeSlug,
          provinceCode: "ON", yearsTeaching: 3,
        })),
        courseIds: pendingCourses.map((c) => c._id),
        courseCodes: pendingCourses.map((c) => c.code),
        subjectIds: [...new Set(pendingCourses.map((c) => String(c.subjectId)))],
        subjectSlugs: [...new Set(pendingCourses.map((c) => c.subjectSlug))],
        gradeLevels: [...new Set(pendingCourses.map((c) => c.gradeLevel))],
        provinceCodes: ["ON"],
        lessonModes: ["ONLINE"], onlineMeetingProviders: ["ZOOM"],
        city: "Waterloo", province: "ON", postalCodePrefix: "N2L",
        location: { type: "Point", coordinates: [-80.5204, 43.4643] },
        travelRadiusKm: 0, hourlyRateCents: 6500, minHourlyRateCents: 6500,
        languages: ["English"], timeZone: "America/Toronto",
        verifiedTypes: [], acceptingNewStudents: true,
      },
    },
    { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
  );

  await TutorApplication.findOneAndUpdate(
    { userId: pendingUser._id },
    {
      $set: {
        userId: pendingUser._id, tutorProfileId: pendingProfile._id,
        status: "PENDING_REVIEW",
        completedSteps: ["PERSONAL", "PROFILE", "EDUCATION", "QUALIFICATIONS", "COURSES",
          "LESSON_TYPE", "LOCATION", "PRICING", "AVAILABILITY", "DOCUMENTS", "REVIEW"],
        currentStep: "REVIEW",
        submittedAt: new Date(Date.now() - 2 * 86400000),
        data: {
          PERSONAL: { firstName: "James", lastName: "O'Connor", phone: "5195550188", province: "ON", city: "Waterloo", timeZone: "America/Toronto" },
          DOCUMENTS: { requestedBadges: ["IDENTITY", "EDUCATION"] },
        },
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  await Availability.findOneAndUpdate(
    { tutorProfileId: pendingProfile._id },
    {
      $set: {
        tutorProfileId: pendingProfile._id, userId: pendingUser._id,
        timeZone: "America/Toronto",
        weeklyRules: [
          { weekday: 1, startMinutes: 1020, endMinutes: 1290 },
          { weekday: 3, startMinutes: 1020, endMinutes: 1290 },
          { weekday: 6, startMinutes: 600, endMinutes: 900 },
        ],
        bufferMinutes: 0, slotIncrementMinutes: 30, minNoticeHours: 12,
      },
    },
    { upsert: true, setDefaultsOnInsert: true },
  );

  for (const type of ["IDENTITY", "EDUCATION"]) {
    await VerificationRecord.findOneAndUpdate(
      { tutorProfileId: pendingProfile._id, type },
      {
        $set: {
          tutorProfileId: pendingProfile._id, userId: pendingUser._id, type,
          status: "PENDING", submittedAt: new Date(Date.now() - 2 * 86400000),
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }
  log("1 pending tutor application awaiting review");

  // --- Keep derived counters accurate --------------------------------------
  section("Derived data");
  for (const { profile } of tutorProfiles) {
    const reviews = await Review.find({ tutorProfileId: profile._id, status: "PUBLISHED" }).lean();
    const completed = await Booking.countDocuments({ tutorProfileId: profile._id, status: "COMPLETED" });
    const students = await Booking.distinct("studentProfileId", { tutorProfileId: profile._id });
    const avg = (key) => reviews.length
      ? Math.round((reviews.reduce((s, r) => s + (r[key] ?? 0), 0) / reviews.length) * 10) / 10
      : 0;

    await TutorProfile.updateOne({ _id: profile._id }, {
      $set: {
        "stats.ratingAverage": avg("rating"), "stats.ratingCount": reviews.length,
        "stats.ratingKnowledge": avg("knowledge"), "stats.ratingCommunication": avg("communication"),
        "stats.ratingReliability": avg("reliability"), "stats.ratingTeaching": avg("teaching"),
        "stats.completedLessons": completed, "stats.totalStudents": students.length,
        "stats.responseTimeMinutes": 30 + Math.floor(Math.random() * 180),
        "stats.lastActiveAt": new Date(),
      },
    });
  }

  const counts = await TutorProfile.aggregate([
    { $match: { isSearchable: true } },
    { $unwind: "$courseIds" },
    { $group: { _id: "$courseIds", count: { $sum: 1 } } },
  ]);
  await Course.updateMany({}, { $set: { tutorCount: 0 } });
  for (const c of counts) {
    await Course.updateOne({ _id: c._id }, { $set: { tutorCount: c.count } });
  }
  log("tutor ratings and course supply counts recalculated");

  // --- Summary -------------------------------------------------------------
  const [users, searchable, bookings, reviews] = await Promise.all([
    User.countDocuments({}), TutorProfile.countDocuments({ isSearchable: true }),
    Booking.countDocuments({}), Review.countDocuments({}),
  ]);

  console.log(`
────────────────────────────────────────────────────────
  APlus Learn is seeded.

  ${users} users · ${searchable} searchable tutors
  ${bookings} bookings · ${reviews} reviews · ${COURSES.length} courses

  Sign in with password:  ${SEED_PASSWORD}

    Admin    admin@apluslearn.ca
    Parent   jennifer.chen@example.com
    Tutor    priya.sharma@example.com
    Student  nadia.petrov@example.com
    Pending  james.oconnor@example.com   (awaiting approval)
────────────────────────────────────────────────────────
`);

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error("\nSeed failed:", error);
  await mongoose.disconnect();
  process.exit(1);
});
