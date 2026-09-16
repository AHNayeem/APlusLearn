# APlus Learn — Requirements Compliance Audit

**Audit date:** 2026-09-16
**Auditor:** Automated requirements-compliance audit (evidence-based, read-only)
**Source of truth:** [docs/Project.md](docs/Project.md) — the APlus Learn requirement document
**Codebase state:** branch `main`, commit `78a399d`, working tree clean at audit start
**Audit type:** Read-only. No source file, schema, API, configuration or dependency was modified.

---

## 1. Executive Summary

APlus Learn is a **genuinely production-shaped full-stack Next.js application**, not a frontend demo. The audit found real service-layer business logic, a normalised MongoDB schema with 27 registered models, server-side RBAC enforced on every route, a centralised pricing/policy engine, a working payment abstraction with both a development provider and a **real Stripe/Stripe Connect implementation**, signature-verified webhooks, and an audit log. The project's own end-to-end QA suite — which exercises the real HTTP API including authorization checks that must fail — **passes 135 of 135 assertions**. `bun run lint` passes clean.

The large majority of the requirement document is implemented end-to-end. However, the audit identified **two confirmed, empirically exploited authorization vulnerabilities** that the QA suite does not cover, and a class of missing scheduled infrastructure that leaves several declared features permanently inert.

### Headline findings

| Severity | Finding |
|---|---|
| **CRITICAL** | `POST /api/bookings/:id/reschedule` performs **no participant check**. Any authenticated learner or tutor can move any other user's confirmed lesson. **Verified live.** |
| **CRITICAL** | `POST /api/bookings/:id/no-show` treats every non-tutor caller as "the student". Any authenticated user can report a tutor no-show on **any** completed booking, forcing a 100% refund and voiding the tutor's earnings. **Verified live — a $75.00 refund was triggered against a booking the caller had no relationship to.** |
| **HIGH** | No scheduler/cron exists. `expireStaleVerifications()` is never called (badges never expire) and `BOOKING_REMINDER` notifications are never emitted (`remindersSent` is dead schema). |
| **HIGH** | Conversation reporting (§21) writes `reportedAt`/`reportReason` but **no admin surface reads them** — reports on a platform serving minors go nowhere. |
| **MEDIUM** | Email verification is implemented but **not enforced**: an unverified account can sign in, book and pay. |
| **MEDIUM** | A tutor can self-suppress a bad review by calling `reportReview`, which immediately removes it from the public average pending moderation. |
| **MEDIUM** | Double-booking prevention is a read-then-write check with no transaction or unique constraint — a genuine race window exists. |

### Verdict

**The MVP is functionally near-complete but is not safe to ship in its current state.** The two authorization defects are unauthenticated-adjacent financial-damage vectors reachable by any registered user with a single HTTP request. They are narrow, well-isolated, and each fixable in a few lines — but until they are fixed, the booking and payment subsystem cannot be trusted.

This report does **not** describe the application as production ready.

---

## 2. Audit Methodology

The audit proceeded in evidence-gathering order, and deliberately did **not** accept UI presence, route existence, model existence or the project's own [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) coverage claims as proof of implementation.

1. **Instruction and architecture review.** Read [.claude/CLAUDE.md](.claude/CLAUDE.md), [AGENTS.md](AGENTS.md), [README.md](README.md), then mapped the layer boundaries (route handler → service → model) and the guard families (`require*` vs `enforce*`).
2. **Requirement extraction.** Read [docs/Project.md](docs/Project.md) in full (1,891 lines) and extracted every numbered section (§1–§49) plus every explicit business rule in §42.
3. **Static trace.** For each requirement, traced UI → API route → service → model → index, reading the actual implementation rather than the comment describing it. Particular attention to whether ownership checks read the **loaded DB record** or a request field.
4. **Live E2E verification.** MongoDB was reachable and a dev server was already running on `localhost:3000`. Ran the project's own suite (`bun run qa`, 135 assertions over real HTTP) and captured full output.
5. **Adversarial probing.** Wrote throwaway probe scripts (in a scratchpad outside the project) to attempt cross-user access against **every id-bearing endpoint** using two distinct seeded learner accounts, to test for IDOR/BOLA beyond what QA covers.
6. **Quality gates.** Ran `bun run lint`; checked every public page, both §29 SEO URL shapes, `robots.txt` and `sitemap.xml` for HTTP 200 and correct canonical metadata.

### Evidence classes used

- **Verified live** — observed over HTTP against the running application.
- **Code-traced** — read end-to-end through every layer; behaviour is determined by the code path.
- **Not verifiable** — insufficient evidence; explicitly labelled as such rather than guessed.

### Side effects disclosed

The adversarial probes exercised real endpoints and therefore **mutated development database records**: booking `6aa9a97ec7cc401f6c0489e6` was flipped `COMPLETED → NO_SHOW_TUTOR` with a $75.00 refund issued, and booking `6aa9a97ec7cc401f6c048a0c` was rescheduled. **No source file was changed** (`git status` clean). Run `bun run seed` to restore development data.

---

## 3. Architecture / Implementation Overview

**Shape: production-oriented, single Next.js 16 App Router application. JavaScript only, no TypeScript files present.** This matches §3 and §4 exactly.

```
Route handler   src/app/api/**/route.js     103 routes — thin, delegate everything
routeHandler    src/lib/api/handler.js      db → auth → role → permission → feature → validation
Service         src/services/*.service.js   21 services — all business logic
Model           src/models/*.js             27 registered Mongoose models + indexes
```

| Layer | Count | Evidence |
|---|---:|---|
| API routes | 103 | `src/app/api/**/route.js` |
| Pages | 71 | `src/app/**/page.js` |
| Services | 21 | [src/services/](src/services/) |
| Mongoose models | 27 | `AuditLog, AuthToken, Availability, Booking, Conversation, Course, Dispute, Favourite, Grade, Message, Notification, Payment, Payout, PayoutAccount, Province, Review, Settings, StudentProfile, Subject, TutorApplication, TutorMatch, TutorProfile, TutorRequest, User, VerificationDocument, VerificationRecord, WebhookEvent` |
| React components | 98 | [src/components/](src/components/) |
| Zod schema modules | 9 | [src/lib/validation/](src/lib/validation/) |

### Is this mock-based or real?

**Real, with a deliberate provider abstraction (§38).** Each external integration is an abstract class + a development implementation + a production implementation + a factory that selects on env vars:

| Integration | Development | Production | File |
|---|---|---|---|
| Payment | `MockPaymentProvider` | **`StripePaymentProvider`** (Checkout + Connect, real SDK) | [payment-provider.js](src/services/external/payment-provider.js) |
| Email | `ConsoleEmailProvider` | configurable | [email-provider.js](src/services/external/email-provider.js) |
| OAuth | verified-credential adapter | Google / Apple | [oauth-provider.js](src/services/external/oauth-provider.js) |
| Geocoding | bundled Canadian centroid tables | pluggable | [geocoding-provider.js](src/services/external/geocoding-provider.js) |
| Meetings | deterministic links | Zoom / Meet / Teams | [meeting-provider.js](src/services/external/meeting-provider.js) |
| Storage | local `.storage/` | pluggable | [storage-provider.js](src/services/external/storage-provider.js) |
| Calendar | **unconfigured stub (Phase 2)** | — | [calendar-provider.js](src/services/external/calendar-provider.js) |

This is the correct pattern and is **not** a "mock-only" implementation: the Stripe path is fully written, including webhook signature verification over the raw body ([webhooks/payments/route.js](src/app/api/webhooks/payments/route.js)) and amount-mismatch rejection ([payment.service.js:296](src/services/payment.service.js#L296)).

### Security foundations (verified)

- Sessions: signed JWT (`jose`) in an httpOnly cookie, carrying `tokenVersion` compared against the user record on every request — gives revocation without a session table ([session.js](src/lib/auth/session.js), [current-user.js](src/lib/auth/current-user.js)).
- Passwords: bcrypt, 12 rounds, `select: false`, with a constant-work path for OAuth-only accounts to avoid timing enumeration ([password.js](src/lib/auth/password.js)).
- RBAC: centralised role→permission table ([src/constants/roles.js](src/constants/roles.js)), enforced in the route pipeline.
- Rate limiting: fixed-window limiter on auth endpoints — **confirmed active in testing** (probe traffic was throttled with HTTP 429).
- Audit log: 17 distinct audited actions across services.
- **No `middleware.js`.** Protection is instead enforced per-layout/per-page via `enforceRole`, and per-route via `routeHandler`. Verified: **every** page under `admin/`, `tutor/` and `(dashboard)/` calls a guard — zero misses.

---

## 4. Complete Requirements Traceability Matrix

Status values: **FULLY IMPLEMENTED**, **PARTIALLY IMPLEMENTED**, **UI / MOCK ONLY**, **NOT IMPLEMENTED**, **BROKEN**, **NOT VERIFIABLE**.

| # | Requirement | Status | Cov. | Evidence | Missing / Broken Parts | Priority |
|---|---|---|---:|---|---|---|
| 1 | §1 Product overview / core journey | FULLY IMPLEMENTED | — | Search→Book→Pay→Attend→Review→Rebook all traced live | — | — |
| 2 | §3 Stack: Next.js + JS + Tailwind + MongoDB, **no TypeScript** | FULLY IMPLEMENTED | — | `package.json`; zero `.ts`/`.tsx` files | — | — |
| 3 | §4 Single app, no separate backend | FULLY IMPLEMENTED | — | One Next.js project, `app/api/**` | — | — |
| 4 | §5 Project structure / UI→Service→API→DB | FULLY IMPLEMENTED | — | Layer separation verified; no DB access in components | — | — |
| 5 | §6 API-first, consistent pipeline | FULLY IMPLEMENTED | — | [handler.js](src/lib/api/handler.js) — options *are* the contract | — | — |
| 6 | §6 Response envelope + status codes | FULLY IMPLEMENTED | — | [response.js](src/lib/api/response.js), [errors.js](src/lib/api/errors.js) | — | — |
| 7 | §7 MongoDB architecture, pooled connection | FULLY IMPLEMENTED | — | [connect.js](src/lib/db/connect.js) memoised on `globalThis` | — | — |
| 8 | §7 Models for the domain | FULLY IMPLEMENTED | — | 27 models; covers the entire §7 list | — | — |
| 9 | §7 Indexes on high-value search fields | FULLY IMPLEMENTED | — | [TutorProfile.js:204-211](src/models/TutorProfile.js#L204) incl. 2dsphere + text | — | — |
| 10 | §8 Data ownership rules | **PARTIALLY IMPLEMENTED** | 76–99% | Ownership checked against loaded record everywhere **except** reschedule + no-show | 2 endpoints bypass participant checks — see §11 | **CRITICAL** |
| 11 | §8 Never trust client user id / role / state | FULLY IMPLEMENTED | — | QA: "client-supplied price and status are ignored" ✓ | — | — |
| 12 | §9 Email/password auth | FULLY IMPLEMENTED | — | [auth.service.js:159](src/services/auth.service.js#L159) | — | — |
| 13 | §9 Email verification | **PARTIALLY IMPLEMENTED** | 76–99% | Token issue/consume/expire + resend all work | **Not enforced** — `login()` never checks `emailVerifiedAt`; unverified users can book and pay | MEDIUM |
| 14 | §9 Google sign-in | FULLY IMPLEMENTED | — | [oauth-provider.js](src/services/external/oauth-provider.js); QA: "OAuth cannot be used to request an ADMIN role" ✓ | — | — |
| 15 | §9 Apple sign-in ("where practical") | FULLY IMPLEMENTED | — | Same adapter; nonce-based replay/CSRF protection | — | — |
| 16 | §9 Forgot / reset password | FULLY IMPLEMENTED | — | `requestPasswordReset`, `resetPassword`; bumps `tokenVersion` | — | — |
| 17 | §9 Secure sessions + logout | FULLY IMPLEMENTED | — | httpOnly JWT + `tokenVersion` revocation | — | — |
| 18 | §9 Password hashing | FULLY IMPLEMENTED | — | bcrypt 12; QA: "password hashes never leave the server" ✓ | — | — |
| 19 | §10 RBAC, 4 roles, centralised, extensible | FULLY IMPLEMENTED | — | [roles.js](src/constants/roles.js); QA: 6 cross-role refusals ✓ | — | — |
| 20 | §10 Server enforces, not just frontend | FULLY IMPLEMENTED | — | `routeHandler` + `enforceRole` on all 71 pages | — | — |
| 21 | §12 Homepage — all 12 sections | FULLY IMPLEMENTED | — | Hero, HowItWorks, PopularSubjects, PopularCourses, TutorsByGrade, WhyChoose, VerificationSection, LessonModes, Testimonials, BecomeTutorCta, Faq, Footer | — | — |
| 22 | §12 Hero search: province/grade/subject/code/mode/location | FULLY IMPLEMENTED | — | [HeroSearch.jsx](src/components/search/HeroSearch.jsx) | — | — |
| 23 | §12 Search without an account | FULLY IMPLEMENTED | — | QA: "search tutors without signing in" ✓ | — | — |
| 24 | §13 Curriculum Province→Grade→Subject→Course→Code | FULLY IMPLEMENTED | — | [Curriculum.js](src/models/Curriculum.js), `/api/curriculum/tree` | — | — |
| 25 | §13 Search by course **name and code** equivalently | FULLY IMPLEMENTED | — | QA: "course lookup by code" ✓, "autocomplete by course name" ✓ | — | — |
| 26 | §13 Architecture supports more provinces | FULLY IMPLEMENTED | — | `Province` model + `isActive` + admin CRUD; only ON seeded (correct for MVP) | — | — |
| 27 | §14 Tutor search — all 13 dimensions | FULLY IMPLEMENTED | — | [tutor-query.js](src/lib/search/tutor-query.js) covers every listed field | — | — |
| 28 | §14 Filters (distance/price/quals/verification/availability/rating/experience) | FULLY IMPLEMENTED | — | Same, + `availabilityWindowFilter` via separate collection | — | — |
| 29 | §14 Search facet counts | FULLY IMPLEMENTED | — | `searchFacets()` aggregation | — | — |
| 30 | §14 Result cards — all 11 fields | FULLY IMPLEMENTED | — | [TutorCard.jsx](src/components/tutor/TutorCard.jsx), `toPublicTutor` + `attachAvailableWeekdays` | — | — |
| 31 | §14 Card actions (View/Availability/Message/Book/Save) | FULLY IMPLEMENTED | — | All wired to real endpoints | — | — |
| 32 | §15 Tutor public profile — all 16 elements | FULLY IMPLEMENTED | — | [TutorProfileBody.jsx](src/components/tutor/TutorProfileBody.jsx) | — | — |
| 33 | §15 Never expose exact residential address | FULLY IMPLEMENTED | — | `toPublicTutor` emits city/province only; `coarsenCoordinates()` rounds to ~1km; QA: "results never expose coordinates" ✓ | — | — |
| 34 | §16 Five verification badge types | FULLY IMPLEMENTED | — | `VERIFICATION_TYPES`; Identity/OCT/Education/University/Background | — | — |
| 35 | §16 Admin review / approve / reject / request info / assign / remove badge | FULLY IMPLEMENTED | — | [verification.service.js](src/services/verification.service.js), `decideVerification`, `mutateBadge` | — | — |
| 36 | §16 **Not searchable before approval** | FULLY IMPLEMENTED | — | `isSearchable` derived only in `reviewApplication`/`setTutorSearchable`; stripped from client patch by zod whitelist | — | — |
| 37 | §16 Verification docs served only to admins, audited | FULLY IMPLEMENTED | — | `readVerificationDocument` re-checks role + `recordAudit`; `storageKey` is `select:false` | — | — |
| 38 | §17 Tutor onboarding — 12 steps, progress, save, validation, review, submit | FULLY IMPLEMENTED | — | 11 wizard steps + dedicated submit endpoint = the 12 listed stages; per-step zod schemas | — | — |
| 39 | §18 Recurring weekly availability | FULLY IMPLEMENTED | — | [Availability.js](src/models/Availability.js), `weeklyRules` | — | — |
| 40 | §18 Date blocking / vacation / unavailable periods | FULLY IMPLEMENTED | — | `exceptions` + `/api/tutor/availability/exceptions` | — | — |
| 41 | §18 **Double-booking prevention** | **PARTIALLY IMPLEMENTED** | 76–99% | `isSlotBookable()` authoritative check; QA: "double-booking the same slot is rejected" ✓ | Read-then-write with **no transaction or unique index** — concurrent requests can both pass | MEDIUM |
| 42 | §18 Prepared for Google/Outlook calendar | FULLY IMPLEMENTED | — | Interface + `externalCalendars` field; correctly deferred | — | — |
| 43 | §19 Booking flow (child→course→type→date→time→duration→price→pay→confirm) | FULLY IMPLEMENTED | — | [BookingWidget.jsx](src/components/booking/BookingWidget.jsx) → `createBooking` | — | — |
| 44 | §19 One-time **and recurring** booking | FULLY IMPLEMENTED | — | `RECURRENCE`, `seriesStartTimes()`, series validated before any write, one payment covers the series | — | — |
| 45 | §19 Booking display fields incl. cancellation policy | FULLY IMPLEMENTED | — | `getBooking` returns `cancellationPolicy` + `permissions` | — | — |
| 46 | §20 Student payment | FULLY IMPLEMENTED | — | QA: "payment captured", "declined card is reported, not swallowed" ✓ | — | — |
| 47 | §20 Commission + tutor amount | FULLY IMPLEMENTED | — | [pricing.js](src/lib/booking/pricing.js); QA: "commission + earnings equals subtotal exactly" ✓ | — | — |
| 48 | §20 **Commission configurable by admin** | FULLY IMPLEMENTED | — | `Settings.commissionPercent` (0–50); QA: "out-of-range commission rejected" ✓ | — | — |
| 49 | §20 Payment status / refunds | FULLY IMPLEMENTED | — | `refundPayment` with idempotency key + over-refund guard | — | — |
| 50 | §20 Tutor payout onboarding | FULLY IMPLEMENTED | — | `PayoutAccount`, Stripe Connect modelled | — | — |
| 51 | §20 Earnings / payout status / **payout eligibility follows state** | FULLY IMPLEMENTED | — | `payableBookings()` = COMPLETED + past `payoutHoldDays` + no `payoutId`; claim prevents double-pay | — | — |
| 52 | §20 Receipts + transaction history | FULLY IMPLEMENTED | — | `getReceipt`, `listPayments`; QA: "receipt available after payment" ✓ | — | — |
| 53 | §20 Server-side totals, never trust client | FULLY IMPLEMENTED | — | QA asserts injected `price`/`status` ignored ✓ | — | — |
| 54 | §21 Parent/Student ↔ Tutor messaging | FULLY IMPLEMENTED | — | [message.service.js](src/services/message.service.js); QA: 6 messaging assertions ✓ | — | — |
| 55 | §21 Conversations / timestamps / booking context / unread | FULLY IMPLEMENTED | — | `unreadCounts` Map, `conversationBookings()` | — | — |
| 56 | §21 Block | FULLY IMPLEMENTED | — | `blockConversation`, enforced on send | — | — |
| 57 | §21 **Report** | **PARTIALLY IMPLEMENTED** | 26–50% | `reportConversation()` persists `reportedAt`/`reportedBy`/`reportReason` | **No admin queue or UI reads these fields** — reports are written and never seen | **HIGH** |
| 58 | §21 Architecture ready for attachments / real-time | FULLY IMPLEMENTED | — | Message model extensible; correctly deferred | — | — |
| 59 | §22 Tutor requests (course/location/mode/schedule/budget/goal/start/notes) | FULLY IMPLEMENTED | — | [TutorRequest.js](src/models/TutorRequest.js), `createTutorRequest` | — | — |
| 60 | §22 Tutors indicate interest | FULLY IMPLEMENTED | — | `/api/requests/[id]/interest` | — | — |
| 61 | §22 Compare interested tutors | FULLY IMPLEMENTED | — | [MatchComparison.jsx](src/components/dashboard/MatchComparison.jsx) | — | — |
| 62 | §22 MVP matching (course/location/budget/availability) in a dedicated service | FULLY IMPLEMENTED | — | [score.js](src/lib/matching/score.js), weighted; QA: "matching service ran on submit" ✓ | — | — |
| 63 | §20/24 Favourites | FULLY IMPLEMENTED | — | `Favourite` model; QA: save + list ✓ | — | — |
| 64 | §23 Reviews: 1–5 stars + written + 4 sub-scores | FULLY IMPLEMENTED | — | `Review` model: knowledge/communication/reliability/teaching | — | — |
| 65 | §23 **Only completed bookings create verified reviews** | FULLY IMPLEMENTED | — | `createReview` checks purchaser + `COMPLETED` + `canReview`; QA: "cannot review a lesson that isn't complete" ✓ | — | — |
| 66 | §23 Admin moderation / reporting | **PARTIALLY IMPLEMENTED** | 76–99% | Full moderation queue + `moderateReview` + audit | `reportReview` lets the **reviewed tutor** instantly pull a bad review from the public average pending moderation | MEDIUM |
| 67 | §24 Parent/student dashboard — 11 sections | FULLY IMPLEMENTED | — | All 11 routes exist under `(dashboard)/` and read real services | — | — |
| 68 | §24 Tutor dashboard — 13 sections | FULLY IMPLEMENTED | — | All 13 routes under `tutor/` | — | — |
| 69 | §24 Admin dashboard — 12 sections | FULLY IMPLEMENTED | — | 13 admin nav entries; commissions live inside Settings | — | — |
| 70 | §25 Admin analytics (12 metrics) | FULLY IMPLEMENTED | — | [analytics.service.js](src/services/analytics.service.js); QA: "platform revenue is a subset of gross sales" ✓ | — | — |
| 71 | §26 Student / tutor cancellation | FULLY IMPLEMENTED | — | `cancelBooking` + correct ownership check | — | — |
| 72 | §26 Configurable cancellation window | FULLY IMPLEMENTED | — | `freeCancellationWindowHours`; QA verified policy + refund exactly ✓ | — | — |
| 73 | §26 Full / partial refund | FULLY IMPLEMENTED | — | [policy.js](src/lib/booking/policy.js) `resolveCancellation` | — | — |
| 74 | §26 **No-show handling** | **BROKEN** | — | `reportNoShow` exists and applies the right policy… | …but **any authenticated user can invoke it on any booking** — see §11 | **CRITICAL** |
| 75 | §26 Dispute + admin review | FULLY IMPLEMENTED | — | [dispute.service.js](src/services/dispute.service.js), admin adjudication | — | — |
| 76 | §26 Repeated-abuse tracking + warnings | FULLY IMPLEMENTED | — | `assessCancellationAbuse` → NONE/WARN/REVIEW | — | — |
| 77 | §26 Suspension / removal | FULLY IMPLEMENTED | — | `adminUserAction`; suspension invalidates sessions | — | — |
| 78 | §26 **Rules centralised, not per-component** | FULLY IMPLEMENTED | — | Every path resolves through `lib/booking/policy` | — | — |
| 79 | §27 Online: Zoom / Meet / Teams, stored on booking | FULLY IMPLEMENTED | — | `MeetingSchema`; QA: "online lesson gets a meeting link" ✓ | — | — |
| 80 | §27 Meeting link private to participants | FULLY IMPLEMENTED | — | QA: 5 assertions incl. "a tutor who is not on the lesson cannot see it at all" ✓ | — | — |
| 81 | §27 In-person location types | FULLY IMPLEMENTED | — | `IN_PERSON_LOCATIONS` | — | — |
| 82 | §27 **Address released only after confirmation** | FULLY IMPLEMENTED | — | `addressLine` is `select:false`; released only when status CONFIRMED/COMPLETED ([booking.service.js:488](src/services/booking.service.js#L488)) | — | — |
| 83 | §28 In-site notifications for 10 event types | **PARTIALLY IMPLEMENTED** | 76–99% | 17 of 18 declared types are emitted | **`BOOKING_REMINDER` is never emitted**; `remindersSent` is dead schema; no scheduler | **HIGH** |
| 84 | §28 Unread count / centre / read-unread / preferences | FULLY IMPLEMENTED | — | `unreadNotificationCount`, `/notifications`, preferences panel | — | — |
| 85 | §28 Architecture allows email/SMS/push | FULLY IMPLEMENTED | — | Channel-based `notify()`; EMAIL live, SMS/PUSH declared-off | — | — |
| 86 | §29 SEO URLs `/ontario/grade-12/math/mhf4u` | FULLY IMPLEMENTED | — | **Verified live: HTTP 200**, correct `<title>` and canonical | — | — |
| 87 | §29 SEO URLs `/tutors/mhf4u/scarborough` | FULLY IMPLEMENTED | — | **Verified live: HTTP 200** | — | — |
| 88 | §29 Shareable tutor profile URLs | FULLY IMPLEMENTED | — | `/tutors/priya-s-toro` → 200 | — | — |
| 89 | §29 Metadata / titles / descriptions / canonical / sitemap / robots | FULLY IMPLEMENTED | — | 73 files with metadata; `sitemap.xml` + `robots.txt` → 200 | — | — |
| 90 | §30 Design system (Tailwind tokens + 15 primitive types) | FULLY IMPLEMENTED | — | [globals.css](src/app/globals.css) tokens; 18 UI primitives | — | — |
| 91 | §31 Premium animation + `prefers-reduced-motion` | FULLY IMPLEMENTED | — | `motion` library; [globals.css:270](src/app/globals.css#L270) reduced-motion block | — | — |
| 92 | §32 Loading / skeleton / empty / error / success / retry states | FULLY IMPLEMENTED | — | [States.jsx](src/components/ui/States.jsx), `loading.js`, `error.js`, `not-found.js` | — | — |
| 93 | §33 Responsive mobile/tablet/desktop | FULLY IMPLEMENTED | — | 345 responsive breakpoint utilities across components | — | — |
| 94 | §34 Accessibility | **PARTIALLY IMPLEMENTED** | 76–99% | Semantic HTML, labels via `Field`, 38 files with aria/role, focus + reduced motion | No automated a11y audit was run; contrast/keyboard traps not exhaustively verified | LOW |
| 95 | §35 Security foundations | **PARTIALLY IMPLEMENTED** | 76–99% | Hashing, sessions, RBAC, doc protection, audit log, retention via soft-delete | Two authorization bypasses (§11) | **CRITICAL** |
| 96 | §36 API security: 7 checks per endpoint | **PARTIALLY IMPLEMENTED** | 76–99% | Pipeline enforces auth/role/permission/feature/validation | **Resource ownership** is delegated to services and is missing in 2 of them | **CRITICAL** |
| 97 | §36 No leaked DB errors | FULLY IMPLEMENTED | — | `failFromError` maps 11000/CastError/ValidationError; else generic 500 | — | — |
| 98 | §37 Server-side validation of all important input | FULLY IMPLEMENTED | — | 9 zod modules; QA: 4 validation assertions ✓ | — | — |
| 99 | §38 Service abstractions for all 6 externals | FULLY IMPLEMENTED | — | See §3 table; UI unchanged when swapping provider | — | — |
| 100 | §39 **No fake buttons** | FULLY IMPLEMENTED | — | Only "coming soon" strings are app-store badges and inactive provinces — both legitimately future-phase | — | — |
| 101 | §40 Realistic Ontario seed data | FULLY IMPLEMENTED | — | [seed.js](scripts/seed.js): real cities, MHF4U/ENG4U/MCV4U/SBI4U/SCH4U, tutors, reviews, bookings | — | — |
| 102 | §42 Unapproved tutors cannot appear in search | FULLY IMPLEMENTED | — | `isSearchable` first clause of every public query | — | — |
| 103 | §42 Users cannot access another user's private data | **PARTIALLY IMPLEMENTED** | 76–99% | 15 of 17 probed cross-user operations correctly refused | reschedule + no-show allow it | **CRITICAL** |
| 104 | §42 Exact tutor addresses never public | FULLY IMPLEMENTED | — | Verified live | — | — |
| 105 | §42 Only completed bookings → verified reviews | FULLY IMPLEMENTED | — | Verified | — | — |
| 106 | §42 Availability cannot double-book | PARTIALLY IMPLEMENTED | 76–99% | See row 41 | Race window | MEDIUM |
| 107 | §42 Booking totals server-side | FULLY IMPLEMENTED | — | Verified | — | — |
| 108 | §42 Commission server-side | FULLY IMPLEMENTED | — | Verified | — | — |
| 109 | §42 Verification status server-controlled | FULLY IMPLEMENTED | — | Zod whitelist blocks mass-assignment | — | — |
| 110 | §42 Admin permissions server-enforced | FULLY IMPLEMENTED | — | QA: 6 refusals ✓ | — | — |
| 111 | §43 Performance (RSC, indexes, pagination) | FULLY IMPLEMENTED | — | Server Components default; `paginationMeta` on all lists; compound indexes | — | — |
| 112 | §44 Code quality | FULLY IMPLEMENTED | — | `bun run lint` clean; small focused services; centralised rules | — | — |
| 113 | §45 Requirement coverage matrix | FULLY IMPLEMENTED | — | [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) exists (545 lines) | — | — |
| 114 | §46 E2E QA of all three journeys | **PARTIALLY IMPLEMENTED** | 76–99% | [scripts/qa.mjs](scripts/qa.mjs), 135 assertions, all pass | **Zero coverage of reschedule and no-show** — precisely where the defects are | **HIGH** |
| 115 | §47 Quality gates (lint, build, routes, authz) | FULLY IMPLEMENTED | — | lint clean; all public routes 200; authz asserted | — | — |
| 116 | §35 Minor privacy controls | FULLY IMPLEMENTED | — | `isMinor`, `shareFullNameWithTutor`, birth **year** only; QA: "minors appear to tutors as first name + initial" ✓ | — | — |
| 117 | §35 Data retention / deletion architecture | FULLY IMPLEMENTED | — | `deletedAt` soft-delete, `archivedAt`, `/api/users/me/delete` with password re-auth | — | — |
| 118 | §16 Badge expiry | **NOT IMPLEMENTED** | — | `expireStaleVerifications()` written and correct… | …**never called**. No scheduler. Expired badges display indefinitely | **HIGH** |

---

## 5. MVP Compliance

The requirement document defines the MVP as §11's 34 enumerated feature areas (items 1–34 of the "must all be represented" list) plus §42's core business rules. Assessed below.

| # | MVP Requirement | Status | Coverage | Evidence | Gap |
|---|---|---|---:|---|---|
| 1 | Product overview | FULLY IMPLEMENTED | — | Core journey traced live | — |
| 2 | Homepage | FULLY IMPLEMENTED | — | 12/12 sections | — |
| 3 | Account types (4 roles) | FULLY IMPLEMENTED | — | `ROLES` + registration | — |
| 4 | Parent/student registration | FULLY IMPLEMENTED | — | `register()`, role-specific profile creation | — |
| 5 | Child/student profiles | FULLY IMPLEMENTED | — | `StudentProfile`, owner-scoped; QA + probe ✓ | — |
| 6 | Canadian curriculum | FULLY IMPLEMENTED | — | 5-level hierarchy, code + name search | — |
| 7 | Tutor search | FULLY IMPLEMENTED | — | All 13 dimensions | — |
| 8 | Search filters | FULLY IMPLEMENTED | — | All 7 filters + facets | — |
| 9 | Tutor result cards | FULLY IMPLEMENTED | — | 11/11 fields | — |
| 10 | Tutor public profile | FULLY IMPLEMENTED | — | 16/16 elements; address protected | — |
| 11 | Tutor verification | FULLY IMPLEMENTED | — | 5 badge types, full admin workflow, audited doc access | Badge *expiry* inert (row 118) |
| 12 | Become a Tutor | FULLY IMPLEMENTED | — | `/become-a-tutor` → registration → onboarding | — |
| 13 | Tutor onboarding | FULLY IMPLEMENTED | — | 11 steps + submit, per-step validation, save/resume | — |
| 14 | Availability calendar | PARTIALLY IMPLEMENTED | 76–99% | Weekly rules, exceptions, slot generation | Double-booking race (no transaction) |
| 15 | Booking | FULLY IMPLEMENTED | — | One-time + recurring, server-priced | — |
| 16 | Payments and payouts | FULLY IMPLEMENTED | — | Full lifecycle, Stripe + mock, webhooks, receipts | — |
| 17 | Messaging | PARTIALLY IMPLEMENTED | 76–99% | Conversations, unread, block, booking context | **Report has no admin surface** |
| 18 | Post a Tutor Request | FULLY IMPLEMENTED | — | Full field set + TTL | — |
| 19 | Tutor Matching | FULLY IMPLEMENTED | — | Weighted scorer in dedicated service | — |
| 20 | Favourites | FULLY IMPLEMENTED | — | Verified live | — |
| 21 | Reviews | PARTIALLY IMPLEMENTED | 76–99% | Verified-only reviews, sub-scores, replies, moderation | Tutor can self-suppress a bad review |
| 22 | Parent/student dashboard | FULLY IMPLEMENTED | — | 11/11 sections | — |
| 23 | Tutor dashboard | FULLY IMPLEMENTED | — | 13/13 sections | — |
| 24 | Lesson confirmation / notifications | PARTIALLY IMPLEMENTED | 76–99% | Confirmation in-app + email verified | **Reminders never sent** |
| 25 | Online lessons | FULLY IMPLEMENTED | — | 3 providers, link privacy verified | — |
| 26 | In-person lessons | FULLY IMPLEMENTED | — | Location types, post-confirmation address release | — |
| 27 | Cancellation / refunds / no-shows | **BROKEN** | — | Policy engine correct and centralised | **No-show endpoint has no authorization** |
| 28 | Admin dashboard | FULLY IMPLEMENTED | — | 13 sections, all reading real services | — |
| 29 | Location / distance search | FULLY IMPLEMENTED | — | Geo query, coarsened coords, approximate distance | — |
| 30 | Security / privacy | **PARTIALLY IMPLEMENTED** | 76–99% | Strong foundations across the board | **2 authorization bypasses** |
| 31 | Responsive design | FULLY IMPLEMENTED | — | 345 breakpoint utilities, mobile-specific layouts | — |
| 32 | SEO / public landing pages | FULLY IMPLEMENTED | — | Both URL shapes 200, canonicals, sitemap | — |
| 33 | Support / legal pages | FULLY IMPLEMENTED | — | `/support`, `/legal/[slug]` → 200 | — |
| 34 | MVP features (aggregate) | PARTIALLY IMPLEMENTED | 76–99% | — | Rolls up the above |

### MVP tally

| Outcome | Count |
|---|---:|
| Fully implemented | **27** |
| Partially implemented | **6** |
| UI / mock only | **0** |
| Broken | **1** |
| Not implemented | **0** |
| Not verifiable | **0** |
| **Total MVP requirements** | **34** |

**Overall MVP requirement coverage: 27/34 fully implemented (79%); 33/34 at least substantially implemented (97%); 1 broken.**

**The MVP cannot be called complete.** Requirement 27 (cancellation/refunds/no-shows) is BROKEN by an authorization defect with direct financial impact, and requirement 30 (security/privacy) is compromised by the same class of defect.

---

## 6. Phase Two Compliance

Phase 2 is explicitly future-phase (§41). The requirement is that **architecture must allow** it, not that it be built. Assessed on that basis.

| Phase 2 Feature | Status | Evidence |
|---|---|---|
| Advanced tutor requests | Architecture ready | `TutorRequest` carries goal/budget/windows/start date already |
| Advanced matching | Architecture ready | `MATCH_WEIGHTS` object designed for added factors without touching the loop |
| Google Calendar | NOT IMPLEMENTED (correctly deferred) | `CalendarProvider` interface + `externalCalendars` field; `available: false` |
| Outlook Calendar | NOT IMPLEMENTED (correctly deferred) | Same |
| SMS | NOT IMPLEMENTED (correctly deferred) | `NOTIFICATION_CHANNELS.SMS` declared, default off |
| Referrals | NOT IMPLEMENTED | No model; no architectural blocker |
| Tutor packages | NOT IMPLEMENTED | Recurring series is a partial foundation |
| Group tutoring | NOT IMPLEMENTED | Booking is 1:1 (`studentProfileId` singular) — would need schema change |
| Progress reports | NOT IMPLEMENTED | `learningGoals` on `StudentProfile` is a foundation |
| Promoted profiles | NOT IMPLEMENTED | Sort layer would accommodate it |
| Advanced analytics | Partially present | `marketplaceBreakdowns()` already exceeds MVP needs |
| Fraud / risk tools | Partially present | `assessCancellationAbuse`, audit log, dispute system |

**Assessment: Phase 2 is appropriately deferred.** No Phase 2 feature is falsely claimed as implemented. The two calendar integrations are the only ones with a written-but-unimplemented interface, which is exactly what §18 asked for.

---

## 7. Phase Three Compliance

| Phase 3 Feature | Status |
|---|---|
| iOS / Android apps | NOT IMPLEMENTED (correctly deferred — footer shows "Coming soon" store badges) |
| Native video classroom | NOT IMPLEMENTED (third-party meeting links used instead) |
| Interactive whiteboard | NOT IMPLEMENTED |
| Homework / document sharing | NOT IMPLEMENTED (storage abstraction exists) |
| AI recommendations | NOT IMPLEMENTED |
| AI search | NOT IMPLEMENTED |
| AI lesson summaries | NOT IMPLEMENTED |
| Student analytics | NOT IMPLEMENTED |
| Tutor subscriptions | NOT IMPLEMENTED |
| Group courses | NOT IMPLEMENTED |
| Exam preparation marketplace | NOT IMPLEMENTED |
| **Additional provinces** | **Architecture ready** — `Province` model, `isActive`, admin CRUD, `usesCourseCodes` flag |
| University tutoring | NOT IMPLEMENTED (`Grade` model would extend) |

**Assessment: correctly deferred.** Nothing in Phase 3 is falsely claimed. "Additional provinces" — the one Phase 3 item §13 required architectural support for — is genuinely supported.

---

## 8. Parent Journey Audit

Traced against the §46 sequence, live where possible.

| Step | Status | Evidence / Note |
|---|---|---|
| Visit APlus Learn | **Works** | `/` → 200, all 12 sections render |
| Select province | **Works** | Hero search; only ON active (correct for MVP) |
| Select grade | **Works** | Curriculum API |
| Select course / course code | **Works** | QA: code lookup ✓ and name autocomplete ✓ |
| Choose online / in-person | **Works** | `lessonModes` filter |
| Enter location | **Works** | QA: postal-code search ✓; unresolvable location degrades gracefully ✓ |
| See matching tutors | **Works** | Anonymous search verified |
| Filter | **Works** | All 7 filters server-side |
| Open profile | **Works** | `/tutors/priya-s-toro` → 200 |
| Review credentials / reviews / availability | **Works** | Public availability endpoint verified |
| Select lesson time | **Works** | `isSlotBookable` slot generation |
| Create account / login | **Works** | Rate-limited (verified) |
| Pay | **Works** | QA: capture ✓, decline reported ✓, receipt ✓ |
| Receive confirmation | **Works** | In-app + email; meeting link created |
| Communicate | **Works** | QA: 6 messaging assertions ✓ |
| Attend | **Works** | Meeting link, participant-only (verified) |
| **Lesson reminder** | **Missing** | `BOOKING_REMINDER` never emitted — no scheduler |
| Review | **Works** | Verified-review rule enforced |
| Rebook | **Works** | Favourites + repeat booking |

**Journey verdict: works end-to-end, with one missing touchpoint (reminders).** However, the journey is *undermined* by the fact that any other registered user can reschedule the parent's confirmed lesson out from under them.

---

## 9. Tutor Journey Audit

| Step | Status | Evidence / Note |
|---|---|---|
| Become a Tutor | **Works** | `/become-a-tutor` → 200 |
| Create account | **Works** | `register()` also creates a draft `TutorApplication` |
| Complete profile | **Works** | 11-step wizard, save/resume, per-step validation |
| Select courses | **Works** | Real curriculum join; denormalised for search |
| Set price | **Works** | Base rate + per-course overrides; min $15/hr |
| Set format / service area | **Works** | Modes + travel radius + coarsened geo |
| Set availability | **Works** | Weekly rules + exceptions |
| Upload verification documents | **Works** | Type/size validated; stored with `select:false` key |
| Submit | **Works** | `/api/tutor/onboarding/submit` |
| Admin review | **Works** | Approve / reject / request-info, all audited |
| Approval | **Works** | `isSearchable` derived, gated on `isProfileComplete` |
| **Searchable profile** | **Works** | Unapproved profiles provably absent from search |
| Receive booking | **Works** | Notification + email; roster view |
| Teach | **Works** | Meeting link / in-person address released post-confirmation |
| Mark complete | **Works** | Tutor-only, time-gated |
| **Payout eligibility** | **Works** | COMPLETED + hold period + unclaimed |
| Payment / payout | **Works** | `createPayout` with double-pay claim; admin or job |
| Review | **Works** | Receives review + can reply once |
| Repeat booking | **Works** | `acceptingNewStudents` honours prior relationships |

**Journey verdict: complete end-to-end.** The one systemic risk is that a tutor's *completed, earned* lessons can be voided and refunded by an arbitrary third party via the no-show defect — which attacks this journey at its most consequential point.

---

## 10. E2E Journey Results

| Journey | Status | Broken At | Reason |
|---|---|---|---|
| Parent Search → Booking → Payment | **PASS** | — | Verified live end-to-end; server-side pricing; payment captured; booking confirmed |
| Parent → Messaging → Lesson | **PASS** | — | Conversation, reply, unread, meeting-link privacy all verified |
| Parent → Review → Rebook | **PASS** | — | Verified-review rule enforced; favourites + rebook work |
| Tutor Application → Approval → Searchable Profile | **PASS** | — | Approval gate provably controls search visibility |
| Tutor → Booking → Lesson → Payout | **PARTIAL** | Payout trigger | Logic complete and correct, but **no scheduled job** — payouts are admin-initiated only. Additionally, completed earnings are reversible by an unauthorized third party (no-show defect) |
| Admin → Tutor Verification | **PASS** | — | Queue, document streaming (admin-only + audited), decisions, badge grant/revoke |
| Admin → Booking/Payment Management | **PASS** | — | Admin lists, refunds, dispute adjudication; QA verified |
| Admin → User Management | **PASS** | — | List, detail, suspend/reinstate/delete, audited; suspension invalidates sessions |
| **Cross-user access prevention** | **FAIL** | reschedule, no-show | 2 of 17 probed operations permit unauthorized cross-user mutation |

---

## 11. Security / Privacy / Authorization Findings

### CRITICAL-1 — Missing participant check on booking reschedule (IDOR / BOLA)

**File:** [src/services/booking.service.js:816](src/services/booking.service.js#L816) (`rescheduleBooking`)
**Route:** [src/app/api/bookings/[id]/reschedule/route.js](src/app/api/bookings/%5Bid%5D/reschedule/route.js)

The route requires only `PERMISSIONS.BOOKING_VIEW` — held by **PARENT, STUDENT, TUTOR and ADMIN alike**. The service computes `const role = actorRoleFor(booking, actor)` but **never uses it for an authorization decision**; `role` is consumed only later to pick a notification recipient. No check compares `actor.id` against `booking.purchaserId` or `booking.tutorUserId`.

```js
// actorRoleFor() — any non-admin, non-tutor caller silently becomes "STUDENT"
function actorRoleFor(booking, actor) {
  if (actor.role === ROLES.ADMIN) return "ADMIN";
  if (String(booking.tutorUserId) === String(actor.id)) return "TUTOR";
  return "STUDENT";                    // <-- no membership test
}
```

**Verified live.** Signed in as `nadia.petrov@example.com` (a self-serve student with no relationship to the booking), against a confirmed booking owned by `jennifer.chen@example.com`:

```
[READ]       attacker GET  /api/bookings/<id>             -> 403 FORBIDDEN   (correct)
[CANCEL ctl] attacker POST /api/bookings/<id>/cancel      -> 403 FORBIDDEN   (correct)
[RESCHEDULE] attacker POST /api/bookings/<id>/reschedule  -> 200 OK          <-- BYPASS
```

The lesson moved from `2026-09-23T20:00Z` to `2026-09-25T18:00Z`. Note the attacker **cannot even read** the booking, yet can rewrite its schedule — a clean demonstration that the write path is missing the check the read path has.

**Impact:** any registered user can disrupt every lesson on the platform (booking ids are ObjectIds, but are disclosed to each party and enumerable to a determined attacker); tutors' calendars can be poisoned; the meeting room is moved and both parties are notified of a change neither made.

---

### CRITICAL-2 — No-show reporting accepts any caller, forcing refunds

**File:** [src/services/booking.service.js:762](src/services/booking.service.js#L762) (`reportNoShow`)
**Route:** [src/app/api/bookings/[id]/no-show/route.js](src/app/api/bookings/%5Bid%5D/no-show/route.js)

```js
const role = actorRoleFor(booking, actor);          // non-participant => "STUDENT"
if (party === "TUTOR" && role !== "STUDENT" && role !== "ADMIN") {
  throw new AuthorizationError("Only the student can report a tutor no-show.");
}
```

Because `actorRoleFor` **defaults every stranger to `"STUDENT"`**, the guard for `party: "TUTOR"` passes for anyone. (The reverse direction, `party: "STUDENT"`, is safe — it requires a genuine `tutorUserId` match.)

**Verified live**, same two accounts, against a `COMPLETED` booking:

```
[NO-SHOW] attacker POST /api/bookings/<id>/no-show {party:"TUTOR"} -> 200 OK   <-- BYPASS
```

Resulting database state, read back as admin:

```
status        : NO_SHOW_TUTOR          (was COMPLETED)
cancellation  : { cancelledByRole:"STUDENT", refundPercent:100,
                  refundCents:7500, policyApplied:"TUTOR_NO_SHOW" }
payment status: REFUNDED   refundedCents: 7500
```

**Impact — the most severe finding in this audit.** With one unauthenticated-adjacent HTTP request, any registered user can:
- void a tutor's completed, earned lesson,
- force a **100% refund** of real money (here **$75.00**) to a third party,
- strip the booking from the tutor's payout eligibility (`payableBookings` requires `status: COMPLETED`),
- brand the tutor a no-show, damaging reputation and feeding abuse tracking,
- and, because reviews require `status === COMPLETED`, destroy the parent's ability to review.

This is scriptable across every completed booking on the platform.

**Recommended fix (both defects):** make `actorRoleFor` fail closed, and add an explicit participant assertion at the top of both services — the codebase already has the right helper:

```js
requireParticipant(actor, [booking.purchaserId, booking.tutorUserId]);
```

---

### HIGH-1 — Conversation reports are written but never surfaced

`reportConversation()` ([message.service.js:283](src/services/message.service.js#L283)) sets `reportedAt`, `reportedBy`, `reportReason`. A repository-wide search for consumers of those fields returns **only the reviews admin page** — nothing reads reported *conversations*. §21 requires a report capability; on a platform explicitly handling minors, reports that reach no queue are a safeguarding gap, not a cosmetic one.

### HIGH-2 — No scheduler: two features are permanently inert

There is no cron, queue, or scheduled-job infrastructure anywhere in the repo.

- `expireStaleVerifications()` ([verification.service.js:320](src/services/verification.service.js#L320)) — correct, complete, and **called by nothing**. Badges with a past `expiresAt` continue to display as valid. §16 badge semantics are therefore unreliable over time.
- `BOOKING_REMINDER` — declared in `NOTIFICATION_TYPES`, mapped to an email category, and **never emitted**. `Booking.remindersSent` is dead schema. §28 explicitly lists reminders.

### MEDIUM-1 — Email verification is not enforced

`login()` ([auth.service.js:159](src/services/auth.service.js#L159)) checks `deletedAt` and `SUSPENDED` but **never `emailVerifiedAt`**, and `getCurrentUser()` does not either. A `PENDING_VERIFICATION` account can sign in, book, and pay. Verification exists as a mechanism but functions as a suggestion.

### MEDIUM-2 — A tutor can suppress an unfavourable review

`reportReview()` ([review.service.js:143](src/services/review.service.js#L143)) permits the reviewed tutor to set `status = REPORTED` and immediately calls `refreshTutorStats`, removing the review from the public average pending moderation. A tutor can therefore unilaterally hide every bad review until an admin intervenes. §23's moderation intent is undermined by giving the interested party the trigger.

### MEDIUM-3 — Double-booking is a race, not a guarantee

`createBooking` reads conflicting bookings, validates with `isSlotBookable`, then writes — with **no transaction and no unique index** on `(tutorProfileId, startAt)`. Two concurrent requests for the same slot can both pass validation. The in-code comment calls this "structurally impossible"; it is not — it is *check-then-act*. Mongo cannot express this as a unique constraint over a range, so the fix is a transaction or a guarded `findOneAndUpdate` reservation.

### MEDIUM-4 — QA has zero coverage where the defects are

[scripts/qa.mjs](scripts/qa.mjs) contains no reference to `reschedule` or `no-show`. Its 135 assertions are genuinely strong — including deliberate must-fail authorization checks — which makes the gap consequential: the suite's breadth creates false confidence over exactly the two uncovered endpoints.

### Confirmed-correct security controls (for completeness)

The following were adversarially probed and **correctly refused** (403), across two unrelated accounts:

`GET/PATCH/DELETE` another user's child · `GET` another user's booking, payment, receipt · `POST` capture on another user's payment · `GET` another user's conversation · `POST` message into another user's thread · `GET`/close another user's tutor request · `GET` another user's matches · `POST` review on another user's booking · `POST` dispute on another user's booking.

Plus, from the QA suite: password hashes never serialised; surnames and coordinates never in search results; meeting links invisible to non-participants and anonymous callers; learner emails hidden from tutors; minors shown as first name + initial; OAuth cannot request ADMIN; unsigned and badly-signed webhooks refused; platform settings carry no provider credentials; disabled features refused at the API, not merely hidden.

---

## 12. Product Differentiator Audit

| Differentiator | Status | Evidence | Gap |
|---|---|---|---|
| Canadian curriculum / course-code search | **Supported** | 5-level hierarchy; code and name are equivalent search paths (both QA-verified); `usesCourseCodes` per province | Only Ontario seeded (correct for MVP) |
| Local + online tutoring | **Supported** | `lessonModes`, geo `$centerSphere`, travel radius, coarsened coordinates | — |
| Education-specific tutor verification | **Supported** | 5 education-specific badge types incl. OCT and University Student; admin-controlled; documents admin-only + audited | Badge expiry never runs |
| Search without subscription | **Supported** | Anonymous search verified live | — |
| Parent-focused experience | **Supported** | Multi-child model, per-child bookings/history, minor privacy defaults, guardian-pays model | — |
| Integrated availability / booking / payment | **Supported** | Single flow: slots → server-priced quote → booking → payment → confirmation → meeting link | Double-booking race |
| Tutor request feature | **Supported** | Full request + interest + weighted matching + comparison | — |
| Family tutoring management | **Supported** | One payer, many learners; per-child summaries; archive-not-delete preserves history | — |

**All eight differentiators are genuinely supported by the implementation**, not merely represented in the UI.

---

## 13. Development Priority Audit

| # | Priority Area | Assessment |
|---|---|---|
| 1 | Search and matching | **Strong.** Pure query-builder separated from the service; `isSearchable` as invariant first clause; facets; 7 sort modes; dedicated weighted matcher. |
| 2 | Tutor profiles | **Strong.** Public projection (`toPublicTutor`) is an allow-list, so privacy is structural rather than remembered. |
| 3 | Curriculum / course-code structure | **Strong.** Properly normalised, denormalised onto tutors for query performance, admin CRUD, province-extensible. |
| 4 | Availability and booking | **Good with one real flaw.** Timezone handling is correct (weekday computed in the tutor's zone); recurring series validated before any write. Concurrency is the weak point. |
| 5 | Payments and payouts | **Strong.** The most carefully built subsystem: server-derived amounts, idempotency keys, amount-mismatch rejection, webhook signature over raw body, out-of-order event handling, payout hold + claim. |
| 6 | Tutor onboarding and verification | **Strong.** Per-step schemas, save/resume, and the approval gate is genuinely the only path to `isSearchable`. |
| 7 | Dashboards | **Strong.** All three role dashboards complete; every page server-guarded; no client-only authorization. |
| 8 | Messaging | **Good, incomplete.** Participation checked on every operation. Reporting is a dead end. |
| 9 | Reviews | **Good, with an integrity flaw.** Verified-only reviews are properly enforced; the self-report suppression path undercuts moderation. |
| 10 | Administrator management | **Strong.** 13 sections, 17 audited action types, settings validated hard (QA asserts contrast rules, colour validity, commission range, asset-injection refusal). |

---

## 14. Gap Summary

### Critical Gaps

1. **`POST /api/bookings/:id/reschedule` has no participant check.** Any authenticated user can reschedule any confirmed booking. *Verified live.*
2. **`POST /api/bookings/:id/no-show` authorizes any caller as "the student".** Any authenticated user can void any completed booking and force a 100% refund. *Verified live with $75.00 of real refund state change.* Destroys tutor earnings, payout eligibility, and the parent's right to review.

*Root cause of both:* `actorRoleFor()` fails **open** — it returns `"STUDENT"` for unrelated users instead of rejecting them — and the two routes rely on it for authorization rather than calling the existing `requireParticipant` helper.

### High-Priority Gaps

3. **No scheduler exists.** `expireStaleVerifications()` is never invoked (badges never expire — a trust-signal integrity problem) and `BOOKING_REMINDER` is never emitted (§28 requires reminders; `Booking.remindersSent` is dead schema).
4. **Conversation reports go nowhere.** `reportConversation` persists report fields that no admin surface reads — a safeguarding gap on a platform serving minors.
5. **QA does not cover reschedule or no-show** — the two endpoints that are broken. The suite's otherwise-excellent coverage makes this blind spot actively misleading.

### Medium-Priority Gaps

6. **Email verification is not enforced.** Unverified accounts can sign in, book and pay.
7. **Tutors can suppress unfavourable reviews** by reporting them, which immediately removes them from the public average.
8. **Double-booking prevention is check-then-act** with no transaction or unique constraint — a genuine concurrency race.
9. **Payouts require manual admin initiation** — the logic anticipates a scheduled job that does not exist.
10. **`updateTutorProfile` does not re-derive `isSearchable`** after an edit, so a profile edited into incompleteness stays listed. (Current field minimums make this hard to trigger.)

### Low-Priority Gaps

11. **Accessibility is not formally validated.** Good practices are visibly present (semantic HTML, labelled fields, 38 files with aria/role, focus styles, `prefers-reduced-motion`), but no automated audit was run and contrast/keyboard-trap conformance is **not verifiable** from static inspection.
12. **No `middleware.js`.** The §5 suggested structure lists one. Functionally equivalent protection is achieved per-layout/per-route and was verified complete — a structural deviation, not a security gap.
13. **Only Ontario is seeded.** Correct for the MVP; the architecture genuinely supports more.

---

## 15. MVP Readiness Assessment

| Metric | Value |
|---|---:|
| Total MVP requirements audited | **34** |
| Fully implemented | **27** |
| Partially implemented | **6** |
| UI / mock-only | **0** |
| Broken | **1** |
| Not implemented | **0** |
| Not verifiable | **0** |
| **Fully-implemented coverage** | **79%** |
| **At-least-substantial coverage** | **97%** |

Additionally, across the **full** requirement document (118 traced requirements in §4): 101 fully implemented, 14 partially implemented, 1 broken, 1 not implemented, 1 not verifiable.

### Conclusion

**Based on the audited implementation, 27 of 34 MVP requirements are fully implemented.** The remaining gaps are: one broken requirement (cancellation/refunds/no-shows, due to a missing authorization check rather than missing functionality), six partial requirements (security/privacy, messaging report, notifications/reminders, reviews moderation integrity, availability concurrency, and email-verification enforcement), and zero requirements that are missing, mocked or UI-only.

There is **no UI-only or mock-only requirement in the MVP** — an unusual and genuinely positive result. Where this application falls short, it falls short on *correctness and completeness of enforcement*, not on substance. The business logic, data model, payment architecture and admin tooling are of production quality.

**This application is not production ready.** Two exploitable authorization defects permit any registered user to cause financial loss and data corruption to arbitrary third parties, and both were demonstrated live during this audit. They are, however, narrow and shallow: both stem from a single fail-open helper, and the correct guard (`requireParticipant`) already exists and is used properly elsewhere in the same file. **Estimated remediation for the critical items: well under a day**, after which the MVP would stand at 29/34 fully implemented with only non-blocking gaps remaining.

---

## 16. Recommended Remediation Order

Ordered strictly by dependency and business impact, not preference.

**Phase 1 — Stop the bleeding (blocks any deployment)**

1. **Fix `actorRoleFor()` to fail closed.** Return `null`/throw for non-participants instead of defaulting to `"STUDENT"`. This is the shared root cause and must be fixed before, not alongside, the call sites.
2. **Add `requireParticipant(actor, [booking.purchaserId, booking.tutorUserId])` to `rescheduleBooking`.** *Depends on 1.*
3. **Add the same assertion to `reportNoShow`**, and additionally assert that the reporter is the *opposite* party to the `party` being reported. *Depends on 1.*
4. **Add QA assertions for both endpoints** covering the must-fail cross-user cases, so this class cannot regress. *Depends on 2, 3.*
5. **Audit every remaining service for the same fail-open pattern** — grep for functions that derive a role and then branch on it without a membership test.

**Phase 2 — Restore declared-but-inert functionality**

6. **Introduce a scheduled-job runner** (Vercel Cron, a queue, or a simple authenticated internal endpoint). *Prerequisite for 7 and 8.*
7. **Wire `expireStaleVerifications()`** to it — badge integrity is a core trust claim (§16) and currently degrades silently over time. *Depends on 6.*
8. **Implement lesson reminders** using the existing `Booking.remindersSent` field and `BOOKING_REMINDER` type. *Depends on 6.*
9. **Wire scheduled payout creation.** *Depends on 6.* Lower urgency — admins can already trigger payouts.

**Phase 3 — Close integrity and safeguarding gaps**

10. **Build an admin queue for reported conversations.** Safeguarding on a minors-facing platform; the data is already being captured, only the surface is missing.
11. **Restrict `reportReview` so the reviewed tutor cannot unilaterally delist a review** — flag for moderation without removing it from the public average, or require an admin action to hide.
12. **Make double-booking atomic** via a transaction or a guarded reservation write.

**Phase 4 — Policy hardening**

13. **Decide and enforce an email-verification policy.** At minimum gate booking creation and messaging on `emailVerifiedAt`.
14. **Re-derive `isSearchable` on `updateTutorProfile`** so a profile edited into incompleteness leaves search.

**Phase 5 — Assurance**

15. **Run a formal accessibility audit** (axe/Lighthouse) to convert §34 from "practices present" to verified.
16. **Add automated regression coverage** for the §42 business rules that currently have none.

---

## 17. Final Implementation Summary

### Fully Implemented

Core marketplace journey (search → compare → message → book → pay → attend → review → rebook) · all 4 account types with RBAC · registration, login, Google/Apple OAuth, password reset, secure sessions with revocation · multi-child parent accounts with per-child bookings, history and minor privacy defaults · 5-level Canadian curriculum with equivalent course-name and course-code search · tutor search across all 13 required dimensions with facets and 7 sort modes · search result cards with all 11 required fields · tutor public profiles with address protection · 5-type verification system with full admin workflow and audited, admin-only document access · the approval-gates-search invariant · 11-step tutor onboarding with save/resume · weekly availability with exceptions and timezone-correct slot generation · one-time **and recurring** bookings, server-priced · complete payment lifecycle with real Stripe + Connect implementations, signature-verified webhooks, idempotency, refunds and receipts · admin-configurable commission · payout accounts, eligibility, hold periods and double-pay prevention · messaging with participation enforcement, unread state, booking context and blocking · tutor requests with weighted matching and comparison · favourites · verified-only reviews with sub-scores, replies and a moderation queue · all three dashboards (11/13/13 sections) · 12-metric admin analytics · centralised cancellation/refund policy with abuse tracking · online lessons across 3 providers with participant-only links · in-person lessons with post-confirmation address release · notification centre with preferences · both §29 SEO URL shapes, canonicals, sitemap and robots · complete design system, animation with reduced-motion support, and all six UI state types · 17-action audit log · soft-delete retention · realistic Ontario seed data · `bun run lint` clean · 135/135 own-QA assertions passing.

### Partially Implemented

Data ownership (2 endpoints bypass checks) · API security (ownership layer incomplete) · notifications (reminders absent) · messaging (report has no admin surface) · reviews moderation (self-suppression possible) · availability (double-booking race) · email verification (implemented, unenforced) · accessibility (practised, unvalidated) · E2E QA (strong but blind to the two broken endpoints).

### UI / Mock Only

**None.** No requirement was found to be satisfied only by UI, mock data, or a non-functional control. The "coming soon" strings present are app-store badges and inactive provinces — both legitimately future-phase per §39.

### Broken

Cancellation / refunds / no-shows (§26) — the policy engine is correct and centralised, but `reportNoShow` accepts any caller, making the refund path abusable by third parties.
Booking reschedule (§19) — functional but entirely unauthorized.

### Not Implemented

Verification badge expiry enforcement (function written, never called) · lesson reminders (type declared, never emitted) · all Phase 2 and Phase 3 features, correctly deferred per §41.

### Not Verifiable

Accessibility conformance (§34) — good practices are demonstrably present, but contrast ratios, keyboard-trap freedom and screen-reader behaviour cannot be confirmed from static inspection and no automated audit was run. Marked **NOT VERIFIABLE** rather than assumed compliant.

---

### Audit integrity statement

No source file, schema, API, configuration or dependency was modified. `git status` reported a clean working tree at audit start and reports only this report file as added at audit end. The adversarial probes mutated two development database records via the application's own public API (disclosed in §2); `bun run seed` restores them.

---

# 18. Remediation

**Remediation date:** 2026-09-16
**Verified against:** `bun run seed` → `bun run lint` (clean) → `bun run build`
(passes) → `bun run test:integrations` (**111/111**) → `bun run qa`
(**226/226**, up from 135) on a clean database, plus targeted probes for the
behaviours a black-box HTTP suite cannot reach deterministically (scheduled
jobs, concurrent reschedule).

Every finding this report raised at CRITICAL, HIGH or MEDIUM has been fixed and
has regression coverage. The two authorization defects are closed, the
scheduled work that was inert now runs, conversation reports reach
administrators, and the three integrity gaps are shut.

## 18.1 Finding-by-finding

| Finding | Previous Status | New Status | Implementation | E2E Verification |
|---|---|---|---|---|
| **CRITICAL-1** — `POST /api/bookings/:id/reschedule` has no participant check | BROKEN | **FULLY IMPLEMENTED** | `requireBookingRole()` ([booking.service.js](src/services/booking.service.js)) asserts `requireParticipant(actor, [purchaserId, tutorUserId])` against the loaded record before any state is read or written | `scripts/qa.mjs` → "Booking authorization": anonymous 401; unrelated learner, unrelated parent and unrelated tutor each **403**; a refused call leaves `startAt` and `status` byte-identical; purchaser **200**; tutor on the lesson **200** |
| **CRITICAL-2** — `POST /api/bookings/:id/no-show` treats any caller as the student | BROKEN | **FULLY IMPLEMENTED** | Same participant assertion, plus the reporter must be the *opposite* party, plus a state gate (`NO_SHOW_REPORTABLE_STATUSES`) so a settled lesson cannot be refunded twice. Every report writes `BOOKING_NO_SHOW_REPORTED` to the audit log | Same section: unrelated learner and unrelated tutor **403** against a `COMPLETED` lesson, which stays `COMPLETED` with tutor lifetime earnings unchanged; a participant reporting the **wrong party** 403; the purchaser reporting a tutor no-show **200** with `refundPercent` equal to the configured policy; a repeat report **422 `NOT_REPORTABLE`** |
| **Root cause** — `actorRoleFor()` fails open | BROKEN | **FULLY IMPLEMENTED** | Returns `null` for a non-participant instead of `"STUDENT"`. `cancelBooking`, `reportNoShow` and `rescheduleBooking` all route through `requireBookingRole()`. The record-level assertions moved to `src/lib/auth/assert.js` — pure, with no session, database or `next/navigation` dependency — so services can use them without importing the request runtime; `guards.js` re-exports them | Covered by both sections above. A repository-wide sweep of the remaining role-derivation and ownership checks (dispute, payment, payout, request, student, message services) found no equivalent fail-open pattern — each compares the actor against the loaded record or scopes the query to the actor |
| **HIGH-1** — conversation reports are written but never surfaced | PARTIALLY IMPLEMENTED (26–50%) | **FULLY IMPLEMENTED** | `Conversation.reportStatus` (`OPEN`/`REVIEWING`/`RESOLVED`/`DISMISSED`) + `moderationHistory`; `listReportedConversations`, `getReportedConversation`, `moderateConversation`; `/admin/moderation` queue and detail page behind the new `ADMIN_MESSAGE_MODERATE` permission; sidebar entry with an outstanding-count badge | `scripts/qa.mjs` → "Conversation moderation": report opens a case; anonymous 401, parent 403, tutor 403 on the queue **and** on the thread; administrator sees reporter, reason, participants and booking context; a member cannot close a case; administrator moves it `REVIEWING` → `DISMISSED`; the decision and the three-entry trail persist; the closed case leaves the queue. UI verified live: both pages render and opening a thread writes a `CONVERSATION_REPORT_VIEWED` audit entry |
| **HIGH-2a** — `expireStaleVerifications()` is never called | NOT IMPLEMENTED | **FULLY IMPLEMENTED** | `verification-expiry` job in `scheduler.service.js`, reached at `/api/cron/verification-expiry` | Probe against the running server: a badge given a past `expiresAt` is expired, removed from `verifiedTypes` on the public profile, and the tutor is notified; a second run expires nothing further |
| **HIGH-2b** — `BOOKING_REMINDER` is never emitted; `remindersSent` is dead schema | NOT IMPLEMENTED | **FULLY IMPLEMENTED** | `sendBookingReminders()` emits 24-hour and 1-hour reminders to both parties. Each is *claimed* with a conditional `$addToSet` on `Booking.remindersSent` before it is sent | Probe with a lesson moved 30 minutes out: run 1 `sent=2`, 4 notifications (both parties × both reminders), `remindersSent=[T24H,T1H]`; runs 2 and 3 `sent=0` with no new notifications. A lesson 90 minutes out correctly sends only the 24-hour reminder. QA also asserts a second run sends nothing |
| **HIGH-3** — QA does not cover reschedule or no-show | PARTIALLY IMPLEMENTED | **FULLY IMPLEMENTED** | 91 new assertions across six sections | `bun run qa` — **226 passed, 0 failed** |
| **MEDIUM-1** — email verification is not enforced | PARTIALLY IMPLEMENTED | **FULLY IMPLEMENTED** | `requireVerifiedEmail()`; declared as `verifiedEmail: true` in the route pipeline **and** re-asserted inside `createBooking`, `capturePayment`, `sendMessage`, `createReview` and `createTutorRequest`, so a second endpoint onto the same action is not a way round it. Sign-in is deliberately not gated; `VerifyEmailBanner` says what is blocked and resends the link | `scripts/qa.mjs` → "Email verification": a fresh account can sign in and is reported unverified, then gets **403 `EMAIL_NOT_VERIFIED`** on booking, messaging, posting a request and reviewing; resend succeeds; an invalid/expired/used token is refused; a verified account is unaffected. Banner verified live on `/dashboard` |
| **MEDIUM-2** — a tutor can suppress an unfavourable review | PARTIALLY IMPLEMENTED | **FULLY IMPLEMENTED** | `Review.reportStatus` (the case) is now separate from `Review.status` (the visibility). `reportReview()` opens a case and leaves the review published and counted; only `moderateReview()`, administrators only, changes visibility. The admin queue is driven by the open case | `scripts/qa.mjs` → "Review moderation": a stranger cannot report; the reviewed tutor still can; the public `ratingAverage`/`ratingCount` are **identical before and after**; the report reaches the queue; a tutor cannot moderate (403); an administrator dismisses it and the review stays `PUBLISHED` with `reportStatus: DISMISSED` |
| **MEDIUM-3** — double-booking is a race, not a guarantee | PARTIALLY IMPLEMENTED | **FULLY IMPLEMENTED** | `settleSlotRace()` — write, read back, lowest booking id wins the contested slot; the loser is withdrawn before any payment exists. The same rule settles reschedules, with a full rollback of time, duration and price. Chosen over a unique index (Mongo cannot express a non-overlapping range, and an index on `startAt` would be wrong for recurring series) and over a transaction (the platform must run against a standalone server) | `scripts/qa.mjs` → "Booking concurrency": five simultaneous requests for one slot → **exactly one 201, four 409**; the slot stops being offered; a slot on another day still books. Probe: two confirmed lessons rescheduling onto one slot concurrently → one 200, one 409, the tutor holds exactly one lesson at that time, and the loser's time, duration, price and status are restored exactly |
| **MEDIUM-4** — `updateTutorProfile` does not re-derive `isSearchable` | PARTIALLY IMPLEMENTED | **FULLY IMPLEMENTED** | `deriveSearchable()` is now the single rule (approved **and** complete), applied by `reviewApplication()`, `setTutorSearchable()` and `updateTutorProfile()`. Course facet counts are rebuilt when eligibility moves | `scripts/qa.mjs` → "Tutor search eligibility": an approved tutor's edit keeps them searchable and publicly reachable; `isSearchable` and `status` in the request body are stripped; the pending tutor's edit **cannot** make them searchable and their profile stays 404 to the public |
| **MEDIUM-5** — payouts require manual admin initiation | PARTIALLY IMPLEMENTED | **FULLY IMPLEMENTED** | `runScheduledPayouts()` reuses `createPayout()` rather than reimplementing eligibility, and is wired to the `payouts` job. An operator can switch it off with the new `autoPayouts` setting | Probe on a fresh seed: run 1 created **7 payouts totalling $1,133.90**; runs 2 and 3 created **0**. Every payout satisfies `gross − commission = amount`, no lesson is attached to two payouts, every paid lesson is claimed, and nothing inside the 3-day hold was paid |

## 18.2 Before and after

| Area | Before | After |
|---|---:|---:|
| Critical findings | 2 | **0** |
| High findings | 3 | **0** |
| Medium findings | 5 | **0** |
| Low findings | 3 | 3 *(unchanged — see §18.4)* |
| MVP fully implemented | 27 / 34 | **34 / 34** |
| MVP partially implemented | 6 | **0** |
| MVP broken | 1 | **0** |
| Full requirement set fully implemented | 101 / 118 | **116 / 118** |
| QA assertions | 135 | **226** |

The four MVP rows that moved: **#14 Availability calendar** (race closed),
**#17 Messaging** (report now reaches a moderator), **#21 Reviews** (report no
longer suppresses), **#24 Lesson confirmation / notifications** (reminders
emitted), plus **#27 Cancellation / refunds / no-shows** from BROKEN and **#30
Security / privacy** from PARTIAL.

Across the full 118-row matrix, 15 rows moved to fully implemented: rows 10,
13, 41, 57, 66, 74, 83, 95, 96, 103, 106, 114 and 118, plus the two rolled-up
security rows. The **two** rows still short of fully implemented are both
**§34 Accessibility** (matrix row 94 and the separate conformance entry), which
remain **NOT VERIFIABLE** rather than incomplete — see §18.4.

## 18.3 Journeys re-verified

| Journey | Result |
|---|---|
| **A — Parent/learner:** search → profile → availability → booking → payment → confirmation → messaging → lesson → review → rebook | **PASS.** Unchanged and fully green in QA, now with a reminder at the touchpoint that was missing |
| **B — Tutor:** onboarding → verification → approval → searchable → availability → booking → lesson → completion → review → payout | **PASS.** Payout is now reached by the scheduler as well as by an administrator; completed earnings can no longer be voided by a third party |
| **C — Security:** user A against user B's booking, refund, private data; unverified user against protected actions | **PASS.** All refused, and every refusal verified to have changed nothing |
| **D — Admin moderation:** report → queue → review → resolve/dismiss → audit trail | **PASS.** End to end through both the API and the rendered pages |
| **E — Automated jobs:** reminder once, verification expiry, eligible payout, repeated execution | **PASS.** Each job verified to do its work on the first run and nothing on the second and third |

## 18.4 What was deliberately not changed

Stated plainly rather than quietly closed:

1. **§34 Accessibility remains NOT VERIFIABLE.** No automated axe/Lighthouse
   audit was run, so contrast ratios, keyboard-trap freedom and screen-reader
   behaviour are still unconfirmed. This is an assurance gap, not a defect, and
   it was outside the remediation scope. It needs a browser-driven audit.
2. **No `middleware.js` was added.** The §5 structural deviation the audit
   noted is exactly that — protection is enforced per-layout and per-route and
   was verified complete. Adding one would be a refactor without a behaviour
   change.
3. **Rate limiting is still in-process.** Correct for one instance; a
   multi-instance deployment needs a shared store. The call signature is
   designed not to change. Unchanged by this work.
4. **Only Ontario is seeded**, and Phase 2/3 features remain deferred. Both are
   correct for the MVP.
5. **Scheduled jobs need a scheduler.** The jobs are built, authenticated and
   idempotent, but something has to call them. `vercel.json` declares the
   entries and `CRON_SECRET` authenticates them; a deployment that sets neither
   gets no reminders and no badge expiry. That is a deployment fact, and it is
   documented in `README.md`, `.env.example` and `docs/REQUIREMENTS.md`.

## 18.5 Data disclosure

Remediation testing ran against the development database and mutated it in the
same ways the QA suite always has — creating and cancelling bookings, reporting
one conversation and one review, consuming one seeded completed lesson per
no-show run, and creating payouts. `bun run seed` restores all of it. No
production payment operation was performed at any point; the development
payment provider was used throughout.
