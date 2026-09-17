# APlus Learn — Requirements Compliance Audit

**Audit date:** 2026-09-17
**Repository:** `/Users/macbook/Documents/a-plus-learn` (branch `main`, commit `6621450`)
**Source of truth:** `docs/Project.md` (the APlus Learn requirement document, §1–§49)
**Audit type:** Read-only requirements-compliance audit. No source file was modified.

---

## 1. Executive Summary

APlus Learn is a genuinely implemented full-stack marketplace, not a UI shell. The audit
looked specifically for the failure modes the brief warns about — pages without services,
buttons without APIs, models without business rules, mock data standing in for persistence —
and in the large majority of the product they are **not present**. Business rules are
centralised where the requirement document asks for them to be centralised, authorization is
enforced server-side against loaded database records, and money is calculated server-side
from stored state.

The implementation was verified against a **running application backed by a live MongoDB**,
not by reading alone. Two automated suites were executed during this audit:

| Suite | Scope | Result |
|---|---|---|
| `bun run qa` | 224 assertions over the real HTTP API — parent/tutor/admin journeys, authorization refusals, concurrency, business rules | **224 passed, 0 failed** |
| `bun run test:integrations` | 111 assertions over the production provider adapters (Stripe, Stripe Connect, webhooks, Resend, Google/Apple OIDC, Google geocoding, Zoom) | **111 passed, 0 failed** |
| `bun run lint` | ESLint (`core-web-vitals` + React Compiler) | **clean, no output** |

**335 automated checks pass.** Public SEO routes, the sitemap and the §29 URL shapes were
additionally probed over HTTP and all returned 200 with real database-derived content.

That said, the audit is not a clean bill of health. Three findings materially affect
production readiness, and one of them is a functional defect that the code's own comments
incorrectly claim is handled:

1. **CRITICAL — Abandoned checkouts permanently destroy tutor availability.**
   `PENDING_PAYMENT` is a slot-blocking booking status, and **no code path or scheduled job
   ever moves a booking out of it** except successful payment. There is no `EXPIRED` status.
   Every abandoned or failed checkout silently removes a slot from the tutor's bookable
   calendar forever, and any verified learner can erase a tutor's entire calendar by creating
   bookings and never paying. Two comments in the codebase assert this is handled; it is not.

2. **CRITICAL (deployment) — Uploaded files cannot survive in production.**
   Verification documents and branding assets are written to the local filesystem under
   `.storage/`. The S3 provider is a commented-out placeholder. `vercel.json` shows a Vercel
   deployment, where that filesystem is ephemeral and read-only. Tutor verification (§16) and
   admin branding uploads (§30) therefore cannot work in the deployed environment.

3. **HIGH (environment) — No external provider is configured.**
   `.env.local` contains only `MONGODB_URI`, `AUTH_SECRET`, `NEXT_PUBLIC_APP_URL` and
   `CRON_SECRET`. Every real adapter exists and is adapter-tested, but Stripe, Resend, Zoom,
   Google Maps and Google/Apple sign-in are all inactive; the platform runs on its development
   implementations. §38 explicitly permits this during development, so this is a *go-live*
   blocker rather than an implementation defect — but it does mean no requirement that depends
   on a real external service can be marked as working in production today.

Additionally, the in-memory rate limiter does not survive the serverless/multi-instance
deployment the project targets, and the application uses no MongoDB transactions anywhere
(a deliberate, documented trade-off, largely compensated for — but not entirely).

**Bottom line:** the MVP is functionally near-complete and architecturally sound, but it is
**not production-ready**. Finding 1 is a data-integrity and denial-of-service defect in the
core marketplace loop and must be fixed regardless of deployment target.

---

## 2. Audit Methodology

1. Read `.claude/CLAUDE.md` and `AGENTS.md` for project instructions and architecture.
2. Read `docs/Project.md` in full (1,891 lines, §1–§49) as the sole requirements source.
3. Enumerated every route, API handler, service, model, lib module and component
   (393 JS/JSX files; 106 API route handlers; 16 models; 22 services; 100 components).
4. For each requirement area, traced the chain
   UI → client → API route → `routeHandler` options → service → business-rule lib → model →
   response, rather than stopping at the first layer that existed.
5. Executed the project's own verification suites against a live server and database, and
   probed public routes over HTTP.
6. Actively hunted false positives: searched for `TODO`/`FIXME`/`coming soon`/`not
   implemented`/stub markers, checked whether "mock" data was hardcoded or database-derived,
   and checked whether comments claiming a behaviour were backed by code.
7. Recorded file:line evidence for every finding. Where evidence was insufficient, the status
   is **NOT VERIFIABLE** rather than a guess.

**Explicit limitation:** responsive behaviour and accessibility were assessed from source
(breakpoint usage, ARIA attributes, focus styles, `prefers-reduced-motion`) and not by
rendering across real devices or running an automated a11y tool. Those two areas are marked
NOT VERIFIABLE at the compliance level they claim.

---

## 3. Architecture / Implementation Overview

Single Next.js 16 App Router application. JavaScript only — **zero `.ts`/`.tsx` files**,
satisfying §3. No separate backend, satisfying §4.

```
Route handler   src/app/api/**/route.js      thin; delegates everything
routeHandler    src/lib/api/handler.js       db → auth → role → permission → verified-email
                                             → feature flag → validation → service
Service         src/services/*.service.js    all business logic
Business rules  src/lib/booking/*            pricing, policy, slots — single implementation
Model           src/models/*.js              Mongoose schemas + indexes
```

**Request pipeline** ([src/lib/api/handler.js:37-101](src/lib/api/handler.js#L37-L101)) —
the seven checks §36 demands are declared as options, not hand-rolled per endpoint.

**Authorization** — `require*` throws (API/services), `enforce*` redirects (pages)
([src/lib/auth/guards.js](src/lib/auth/guards.js)). Record-level assertions are pure and
session-free ([src/lib/auth/assert.js](src/lib/auth/assert.js)), taking `ownerId` from the
loaded record. RBAC table in [src/constants/roles.js](src/constants/roles.js): 4 roles,
34 permissions.

**Sessions** — stateless JWT (jose, HS256) in an httpOnly cookie, carrying `tokenVersion`
compared against the user record for instant global revocation
([src/lib/auth/session.js](src/lib/auth/session.js)).

**Money** — integer cents throughout; one implementation in
[src/lib/booking/pricing.js](src/lib/booking/pricing.js); commission floored, tutor takes the
remainder so `subtotal === commission + earnings` exactly.

**Cancellation/refund/no-show** — one implementation in
[src/lib/booking/policy.js](src/lib/booking/policy.js), consumed by every path.

**External services** — abstract class + development implementation + **real production
implementation** + `get*Provider()` factory keyed on env vars. This is stronger than §38
requires: `StripePaymentProvider`, `ResendEmailProvider`, `ZoomMeetingProvider`,
`GoogleGeocodingProvider`, `OpenIdOAuthProvider` are all fully written and adapter-tested.

**Current posture:** *production-shaped, running on development providers.* The code is
production architecture; the environment is not a production environment.

---

## 4. Complete Requirements Traceability Matrix

Coverage percentages apply to PARTIAL items only.

| # | Requirement (§) | Status | Cov. | Evidence | Missing / Broken | Priority |
|---|---|---|---:|---|---|---|
| R1 | Product vision & marketplace feel (§1) | FULLY IMPLEMENTED | — | [src/app/(public)/page.js](src/app/(public)/page.js), design tokens in [globals.css](src/app/globals.css) | — | LOW |
| R2 | Greenfield clean architecture (§2) | FULLY IMPLEMENTED | — | UI→API→Service→DB honoured across 106 routes | — | MEDIUM |
| R3 | Stack: Next.js + JS + Tailwind + MongoDB, **no TypeScript** (§3) | FULLY IMPLEMENTED | — | 0 `.ts`/`.tsx`; [package.json](package.json) | — | HIGH |
| R4 | Single app, no separate backend (§4) | FULLY IMPLEMENTED | — | one Next.js project | — | HIGH |
| R5 | Project structure (§5) | FULLY IMPLEMENTED | — | matches recommended tree | — | LOW |
| R6 | API-first internal architecture (§6) | FULLY IMPLEMENTED | — | [handler.js](src/lib/api/handler.js); envelope in [response.js](src/lib/api/response.js) | — | HIGH |
| R7 | Memoised Mongo connection (§7) | FULLY IMPLEMENTED | — | [src/lib/db/connect.js](src/lib/db/connect.js) — `globalThis` cache | — | MEDIUM |
| R8 | Domain models + indexes (§7) | FULLY IMPLEMENTED | — | 16 model files, 1,783 lines; 2dsphere + compound indexes on [TutorProfile.js:196-205](src/models/TutorProfile.js#L196-L205) | — | HIGH |
| R9 | Data ownership rules (§8) | FULLY IMPLEMENTED | — | [assert.js](src/lib/auth/assert.js); QA "Booking authorization" §29 checks | — | CRITICAL |
| R10 | Never trust client state (§8, §42) | FULLY IMPLEMENTED | — | QA: "client-supplied price and status are ignored" | — | CRITICAL |
| R11 | Email/password auth + hashing (§9) | FULLY IMPLEMENTED | — | bcryptjs [password.js](src/lib/auth/password.js); QA: "password hashes never leave the server" | — | CRITICAL |
| R12 | Email verification (§9) | FULLY IMPLEMENTED | — | [assert.js:56-66](src/lib/auth/assert.js#L56-L66); QA "Email verification" — 10 checks | — | HIGH |
| R13 | Google sign-in (§9) | PARTIALLY IMPLEMENTED | 76–99% | `OpenIdOAuthProvider` [oauth-provider.js:95-194](src/services/external/oauth-provider.js#L95-L194); 11 adapter tests pass | `GOOGLE_CLIENT_ID` unset — inactive in this environment | HIGH |
| R14 | Apple sign-in (§9) | PARTIALLY IMPLEMENTED | 76–99% | same adapter; Apple string-boolean + private-relay handling tested | `APPLE_CLIENT_ID` unset — inactive | MEDIUM |
| R15 | Forgot/reset password (§9) | FULLY IMPLEMENTED | — | [api/auth/forgot-password](src/app/api/auth/forgot-password/route.js), [reset-password](src/app/api/auth/reset-password/route.js); `tokenVersion` bump | — | HIGH |
| R16 | Secure sessions + logout (§9) | FULLY IMPLEMENTED | — | [session.js](src/lib/auth/session.js) httpOnly/sameSite/secure | — | CRITICAL |
| R17 | RBAC, centralised, server-enforced (§10) | FULLY IMPLEMENTED | — | [roles.js](src/constants/roles.js); QA "Authorization" — 8 checks | — | CRITICAL |
| R18 | Homepage hero search (province/grade/subject/code/mode/postal) (§12) | FULLY IMPLEMENTED | — | [HeroSearch.jsx](src/components/search/HeroSearch.jsx) | — | HIGH |
| R19 | Search without an account (§12) | FULLY IMPLEMENTED | — | QA: "search tutors without signing in" | — | CRITICAL |
| R20 | All 12 homepage sections (§12) | FULLY IMPLEMENTED | — | [page.js:63-81](src/app/(public)/page.js#L63-L81) — all present; testimonials are real `Review` rows, not fixtures | — | MEDIUM |
| R21 | Curriculum hierarchy Province→Grade→Subject→Course→Code (§13) | FULLY IMPLEMENTED | — | [Curriculum.js](src/models/Curriculum.js); [curriculum.service.js](src/services/curriculum.service.js) | — | CRITICAL |
| R22 | Search by course **name and code** equivalently (§13) | FULLY IMPLEMENTED | — | [tutor-query.js:18-37](src/lib/search/tutor-query.js#L18-L37); QA: "course lookup by code", "autocomplete by course name" | — | CRITICAL |
| R23 | Architecture supports more provinces (§13) | FULLY IMPLEMENTED | — | `Province` collection + `isActive`; admin CRUD at [admin/curriculum](src/app/admin/curriculum/page.js) | — | MEDIUM |
| R24 | Tutor search — all 13 dimensions (§14) | FULLY IMPLEMENTED | — | [search.js:9-46](src/lib/validation/search.js#L9-L46) covers every listed field | — | CRITICAL |
| R25 | Search filters — all 7 (§14) | FULLY IMPLEMENTED | — | distance/price/qualification/verification/availability/rating/experience all in schema + query builder | — | CRITICAL |
| R26 | Result cards — all 11 fields (§14) | FULLY IMPLEMENTED | — | [search/](src/components/search/); `nextAvailableAt` cached on profile | — | HIGH |
| R27 | Card actions (View/Availability/Message/Book/Save) (§14) | FULLY IMPLEMENTED | — | all wired to real endpoints | — | HIGH |
| R28 | Tutor public profile — all 16 elements (§15) | FULLY IMPLEMENTED | — | [(public)/tutors/[slug]](src/app/(public)/tutors/[slug]/page.js) | — | HIGH |
| R29 | Never expose exact residential address (§15, §42) | FULLY IMPLEMENTED | — | `addressLine` `select:false` [Booking.js:47](src/models/Booking.js#L47); profile stores postal-code centroid only; QA: "search results never expose coordinates" | — | CRITICAL |
| R30 | 5 verification badge types (§16) | FULLY IMPLEMENTED | — | [domain.js:38-44](src/constants/domain.js#L38-L44) — exact match to requirement | — | HIGH |
| R31 | Admin review / approve / reject / request info / assign / remove badge (§16) | FULLY IMPLEMENTED | — | [tutor.service.js:580-673](src/services/tutor.service.js#L580-L673), [verification.service.js:136-278](src/services/verification.service.js#L136-L278) | — | CRITICAL |
| R32 | Not searchable before approval (§16, §42) | FULLY IMPLEMENTED | — | `deriveSearchable()` [tutor.service.js:676-680](src/services/tutor.service.js#L676-L680); QA "Tutor search eligibility" — 9 checks incl. "editing never grants search visibility" | — | CRITICAL |
| R33 | Verification document upload + audited admin-only access (§16, §35) | **BROKEN** (deployment) | — | [verification.service.js:57-135](src/services/verification.service.js#L57-L135); admin-only route [api/admin/verification/documents/[id]](src/app/api/admin/verification/documents/[id]/route.js) | Storage is local FS only ([storage-provider.js:88-93](src/services/external/storage-provider.js#L88-L93)); S3 provider commented out. Non-functional on Vercel | CRITICAL |
| R34 | Tutor onboarding — 11 steps, progress, save, validation, review, submit (§17) | FULLY IMPLEMENTED | — | [onboarding.js](src/constants/onboarding.js); per-step schema validation [api/tutor/onboarding/route.js:14-31](src/app/api/tutor/onboarding/route.js#L14-L31) | — | HIGH |
| R35 | Availability: weekly rules, date blocking, vacation, editing (§18) | FULLY IMPLEMENTED | — | [Availability.js](src/models/Availability.js), [availability.service.js](src/services/availability.service.js) | — | HIGH |
| R36 | Double-booking prevention (§18, §42) | FULLY IMPLEMENTED | — | `isSlotBookable` [slots.js:113-186](src/lib/booking/slots.js#L113-L186) + `settleSlotRace` [booking.service.js:271-297](src/services/booking.service.js#L271-L297); QA "Booking concurrency": 1 of 5 concurrent requests wins | — | CRITICAL |
| R37 | Google/Outlook calendar sync (§18 — *prepare for*) | NOT IMPLEMENTED (correctly deferred) | — | `CalendarProvider` abstraction declared [calendar-provider.js](src/services/external/calendar-provider.js); honest roadmap notice in UI [tutor/calendar/page.js:45-48](src/app/tutor/calendar/page.js#L45-L48) | Phase 2 — requirement asks only for readiness | LOW |
| R38 | Booking flow (child→course→mode→date→time→duration→price→pay→confirm) (§19) | FULLY IMPLEMENTED | — | [BookingWidget.jsx](src/components/booking/BookingWidget.jsx) → [api/bookings](src/app/api/bookings/route.js) → [booking.service.js:104-260](src/services/booking.service.js#L104-L260) | — | CRITICAL |
| R39 | One-time **and recurring** booking (§19) | FULLY IMPLEMENTED | — | `seriesStartTimes` [booking.service.js:300-306](src/services/booking.service.js#L300-L306); UI at [BookingWidget.jsx:340-370](src/components/booking/BookingWidget.jsx#L340-L370) | — | HIGH |
| R40 | Booking displays all 9 required fields (§19) | FULLY IMPLEMENTED | — | [BookingDetail.jsx](src/components/booking/BookingDetail.jsx); policy text from `cancellationPolicyText()` | — | MEDIUM |
| R41 | **Abandoned booking releases the slot** (§19 implied; asserted in code) | **BROKEN** | — | `PENDING_PAYMENT` ∈ `BLOCKING_BOOKING_STATUSES` [domain.js:143-150](src/constants/domain.js#L143-L150) | No `EXPIRED` status; no job; no transition out of `PENDING_PAYMENT` except payment success. Slot blocked permanently | **CRITICAL** |
| R42 | Student payment (§20) | PARTIALLY IMPLEMENTED | 76–99% | Full Stripe hosted-checkout adapter [payment-provider.js:223-528](src/services/external/payment-provider.js#L223-L528); dev provider works E2E (QA: "payment captured", "declined card is reported") | Stripe keys unset — live payments inactive | CRITICAL |
| R43 | Commission — server-side, admin-configurable (§20, §42) | FULLY IMPLEMENTED | — | [pricing.js:25-43](src/lib/booking/pricing.js#L25-L43); `commissionPercent` min 0 max 50 [Governance.js:220](src/models/Governance.js#L220); QA: "commission + earnings equals subtotal exactly" | — | CRITICAL |
| R44 | Tutor amount tracked (§20) | FULLY IMPLEMENTED | — | `tutorEarningsCents` on Booking + Payment; QA: "earnings net = gross − commission" | — | CRITICAL |
| R45 | Payment status + refunds (§20) | FULLY IMPLEMENTED | — | [payment.service.js:211-334](src/services/payment.service.js#L211-L334); refund capped at collected balance | — | CRITICAL |
| R46 | Tutor payout onboarding (§20) | PARTIALLY IMPLEMENTED | 76–99% | Stripe Connect adapter fully implemented + 12 adapter tests (hosted link, requirements, manual payouts, masked bank details) | Inactive without Stripe keys | HIGH |
| R47 | Earnings, payout status, receipts, transaction history (§20) | FULLY IMPLEMENTED | — | [payout.service.js](src/services/payout.service.js), [tutor/earnings](src/app/tutor/earnings/page.js), receipt route; QA: "receipt available after payment" | — | HIGH |
| R48 | Payout eligibility follows booking/payment state (§42) | FULLY IMPLEMENTED | — | `payableBookings` — COMPLETED + `payoutHoldDays` cutoff [payout.service.js:160-175](src/services/payout.service.js#L160-L175); QA: "running the payout job again pays nobody twice" | — | CRITICAL |
| R49 | Messaging: conversations, timestamps, booking context, unread (§21) | FULLY IMPLEMENTED | — | [message.service.js](src/services/message.service.js); QA — 6 messaging checks | — | HIGH |
| R50 | Message report + block (§21) | FULLY IMPLEMENTED | — | `reportConversation`/`blockConversation` [message.service.js:291-357](src/services/message.service.js#L291-L357); QA "Conversation moderation" — 16 checks | — | HIGH |
| R51 | Messaging ready for attachments / real-time (§21) | FULLY IMPLEMENTED (readiness) | — | attachment sub-schema declared [Messaging.js:76](src/models/Messaging.js#L76) | Phase 2 delivery not built (as specified) | LOW |
| R52 | Tutor requests — 8 fields (§22) | FULLY IMPLEMENTED | — | [TutorRequest.js](src/models/TutorRequest.js); [requests/new](src/app/(dashboard)/requests/new/page.js) | — | HIGH |
| R53 | Tutors express interest; users compare (§22) | FULLY IMPLEMENTED | — | `expressInterest`/`listMatches` [request.service.js:293-344](src/services/request.service.js#L293-L344) | — | HIGH |
| R54 | MVP matching: course, location, budget, availability (§22) | FULLY IMPLEMENTED | — | [score.js:14-45](src/lib/matching/score.js#L14-L45) — weighted, in a dedicated service; QA: "matching service ran on submit" | — | HIGH |
| R55 | Favourites (§20 list, §24) | FULLY IMPLEMENTED | — | [api/favourites](src/app/api/favourites/route.js); QA: save + appears in favourites | — | MEDIUM |
| R56 | Reviews: 1–5 + written + 4 sub-scores (§23) | FULLY IMPLEMENTED | — | [Engagement.js:71-75](src/models/Engagement.js#L71-L75) — knowledge/communication/reliability/teaching | — | HIGH |
| R57 | Only completed bookings create verified reviews (§23, §42) | FULLY IMPLEMENTED | — | `canReview` [policy.js:110-112](src/lib/booking/policy.js#L110-L112); QA: "cannot review a lesson that isn't complete" | — | CRITICAL |
| R58 | Review moderation + reporting (§23) | FULLY IMPLEMENTED | — | [admin/reviews](src/app/admin/reviews/page.js); QA "Review moderation" — 9 checks incl. "a tutor reporting a review cannot move their own public rating" | — | HIGH |
| R59 | Parent/student dashboard — all 11 areas (§24) | FULLY IMPLEMENTED | — | [(dashboard)/](src/app/(dashboard)/) — every listed area has a route + service | — | HIGH |
| R60 | Tutor dashboard — all 13 areas (§24) | FULLY IMPLEMENTED | — | [tutor/](src/app/tutor/) — all present | — | HIGH |
| R61 | Admin dashboard — all 12 areas (§24) | FULLY IMPLEMENTED | — | [admin/](src/app/admin/) — all present | — | HIGH |
| R62 | Admin analytics — all 12 metrics (§25) | FULLY IMPLEMENTED | — | [analytics.service.js:36-232](src/services/analytics.service.js#L36-L232) — every listed metric computed by aggregation | — | MEDIUM |
| R63 | Cancellation: student/tutor/configurable window/full/partial refund (§26) | FULLY IMPLEMENTED | — | [policy.js:39-79](src/lib/booking/policy.js#L39-L79); QA: "correct policy applied (20.1h notice → LATE_CANCELLATION)", "refund matches the policy exactly" | — | CRITICAL |
| R64 | No-show handling (§26) | FULLY IMPLEMENTED | — | `resolveNoShow`; QA — 12 no-show authorization checks incl. "a second no-show report cannot refund the same lesson twice" | — | HIGH |
| R65 | Disputes + admin review (§26) | FULLY IMPLEMENTED | — | [dispute.service.js](src/services/dispute.service.js); [admin/disputes](src/app/admin/disputes/page.js) | — | HIGH |
| R66 | Repeated abuse tracking, warnings, suspension (§26) | PARTIALLY IMPLEMENTED | 51–75% | `assessCancellationAbuse` [policy.js:119-138](src/lib/booking/policy.js#L119-L138) returns NONE/WARN/REVIEW; admin suspend exists | The REVIEW outcome is computed but no evidence it opens an admin case or auto-restricts; escalation is manual | MEDIUM |
| R67 | Rules centralised, not duplicated per UI (§26) | FULLY IMPLEMENTED | — | single `policy.js` consumed by student, tutor, admin and dispute paths | — | HIGH |
| R68 | Online lessons: Zoom/Meet/Teams, meeting stored on booking (§27) | PARTIALLY IMPLEMENTED | 76–99% | `MeetingSchema` on Booking; Zoom adapter fully implemented + 11 tests (waiting room on, host start URL never stored); QA: "online lesson gets a meeting link" | Only Zoom has a real adapter — Meet and Teams are enum values with no implementation; Zoom creds unset | MEDIUM |
| R69 | Meeting link privacy (§27, §35) | FULLY IMPLEMENTED | — | QA: 6 checks — never on public profile/search, purchaser yes, unrelated tutor no, anonymous no, admin yes | — | CRITICAL |
| R70 | In-person location types (5) (§27) | FULLY IMPLEMENTED | — | `IN_PERSON_LOCATIONS` enum; `LessonLocationSchema` | — | MEDIUM |
| R71 | Private address released only after confirmation (§27, §42) | FULLY IMPLEMENTED | — | [booking.service.js:543-550](src/services/booking.service.js#L543-L550) — released only on CONFIRMED/COMPLETED, to participants | — | CRITICAL |
| R72 | In-site notifications for all 10 event types (§28) | FULLY IMPLEMENTED | — | [notification.service.js](src/services/notification.service.js); `NOTIFICATION_TYPES` covers every listed event | — | HIGH |
| R73 | Unread count, centre, read/unread, preferences (§28) | FULLY IMPLEMENTED | — | [notifications](src/app/(dashboard)/notifications/page.js); `notificationPreferences` per channel on User | — | MEDIUM |
| R74 | Architecture allows email/SMS/push (§28) | FULLY IMPLEMENTED (readiness) | — | Channel enum + per-channel gate [notification.service.js:81-97](src/services/notification.service.js#L81-L97). **Email is actually delivered**, exceeding the requirement | SMS/push honestly labelled "Coming soon" (permitted by §39 as future-phase) | LOW |
| R75 | SEO URLs `/ontario/grade-12/math/mhf4u` and `/tutors/<code>/<city>` (§29) | FULLY IMPLEMENTED | — | Both route shapes exist and return 200 (probed live) | — | HIGH |
| R76 | Shareable tutor profile URLs (§29) | FULLY IMPLEMENTED | — | `slug` unique+indexed; `/tutors/priya-s-toro` in live sitemap | — | MEDIUM |
| R77 | Metadata, titles, descriptions, canonical, semantic markup, indexable (§29) | FULLY IMPLEMENTED | — | 74 files export metadata; `alternates.canonical`; 2× JSON-LD on course page (verified live); [sitemap.js](src/app/sitemap.js) + [robots.js](src/app/robots.js) | — | MEDIUM |
| R78 | Design system: tokens + 15 primitive types (§30) | FULLY IMPLEMENTED | — | [globals.css](src/app/globals.css) tokens; 18 primitives in [components/ui/](src/components/ui/) | — | MEDIUM |
| R79 | Premium animation + `prefers-reduced-motion` (§31) | FULLY IMPLEMENTED | — | `motion` library; [globals.css:270](src/app/globals.css#L270) reduced-motion block; `Reveal.jsx` | — | LOW |
| R80 | Loading / skeleton / empty / error / success / retry states (§32) | PARTIALLY IMPLEMENTED | 76–99% | `useAsync` tracks all three [useAsync.js](src/hooks/useAsync.js); `States.jsx`; EmptyState used in 46 files | Only root-level `loading.js`/`error.js` — no per-segment Suspense/error boundaries, so a slow dashboard segment shows the global fallback | MEDIUM |
| R81 | Fully responsive, no horizontal overflow (§33) | NOT VERIFIABLE | — | 196 responsive breakpoint utilities across components; dedicated mobile nav | Not validated on real viewports; overflow not measured | MEDIUM |
| R82 | Accessibility practices (§34) | PARTIALLY IMPLEMENTED | 76–99% | 180 ARIA attributes, 32 roles, 43 `sr-only`, `:focus-visible` [globals.css:188](src/app/globals.css#L188), semantic HTML | No automated a11y run; contrast and calendar/dialog keyboard traps unverified | MEDIUM |
| R83 | Security foundations — hashing, RBAC, API authz, doc security, minor privacy, audit logs, retention (§35) | FULLY IMPLEMENTED | — | 25 `AUDIT_ACTIONS` [domain.js:368-393](src/constants/domain.js#L368-L393); soft-delete `deletedAt`; [api/users/me/delete](src/app/api/users/me/delete/route.js) | See R33 for document storage in production | CRITICAL |
| R84 | Minor privacy controls (§35, §42) | FULLY IMPLEMENTED | — | `isMinor`/`shareFullNameWithTutor` + `displayName` virtual [StudentProfile.js:47-67](src/models/StudentProfile.js#L47-L67); QA: "minors appear to tutors as first name + initial", "tutors never see a learner's email" | — | CRITICAL |
| R85 | API security: 7 checks per endpoint, correct codes, no DB leaks (§36) | FULLY IMPLEMENTED | — | [handler.js](src/lib/api/handler.js); `failFromError` maps Mongo errors; QA: "malformed id rejected cleanly" | — | CRITICAL |
| R86 | Server-side validation of all important input (§37) | FULLY IMPLEMENTED | — | Zod 4 schemas in [src/lib/validation/](src/lib/validation/), shared between routes and pages; QA "Validation" + 20 settings-validation checks | — | CRITICAL |
| R87 | Service abstractions for all 6 external services (§38) | FULLY IMPLEMENTED | — | All 6 present with abstract + dev + (5 of 6) production implementations | Calendar has no production impl (Phase 2, permitted) | HIGH |
| R88 | App fully functional without external services (§38) | FULLY IMPLEMENTED | — | Demonstrated: 224 QA checks pass with zero external credentials configured | — | HIGH |
| R89 | No fake buttons (§39) | FULLY IMPLEMENTED | — | Sweep found no "coming soon" stubs on MVP features. The 3 hits are legitimate future-phase (app stores, calendar sync) or real features (inactive provinces) | — | HIGH |
| R90 | Realistic Ontario seed data (§40) | FULLY IMPLEMENTED | — | [scripts/seed-data/](scripts/seed-data/) — 162 + 374 lines; real course codes, cities, tutors, reviews, bookings | — | MEDIUM |
| R91 | Phase 2 architectural readiness (§41) | FULLY IMPLEMENTED (readiness) | — | Matching weights object, calendar abstraction, SMS channel, attachment schema | See Phase Two section | LOW |
| R92 | Phase 3 architectural readiness (§41) | PARTIALLY IMPLEMENTED | 26–50% | Multi-province curriculum is genuinely ready; REST API is app-consumable | No readiness work for whiteboard/AI/native video — acceptable, §41 says not to build them | LOW |
| R93 | Core business rules centralised (§42) — all 11 | FULLY IMPLEMENTED | — | Each of the 11 traced to a single implementation; see §11 of this report | — | CRITICAL |
| R94 | Performance: RSC, pagination, indexes, caching (§43) | FULLY IMPLEMENTED | — | `revalidate = 3600` on homepage; Server Components default; `PAGE_SIZES`; compound indexes | — | MEDIUM |
| R95 | Code quality (§44) | FULLY IMPLEMENTED | — | Lint clean; small focused modules; centralised constants and rules | — | LOW |
| R96 | Requirement coverage matrix produced (§45) | FULLY IMPLEMENTED | — | [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) — 582 lines | Was not independently re-verified line-by-line in this audit | LOW |
| R97 | E2E QA for all three journeys (§46) | FULLY IMPLEMENTED | — | [scripts/qa.mjs](scripts/qa.mjs) 1,904 lines / 224 checks + [integration-tests.mjs](scripts/integration-tests.mjs) 970 lines / 111 checks, incl. unauthorized-access tests | No unit-test runner and no browser/UI E2E layer | MEDIUM |
| R98 | Quality gates: lint, build, startup, authz, responsive, a11y (§47) | PARTIALLY IMPLEMENTED | 51–75% | lint clean; app starts; API/DB/route/authz checks automated | Responsive and accessibility gates are not automated; no CI configuration found | MEDIUM |
| R99 | Rate limiting / abuse protection (§35 implied) | PARTIALLY IMPLEMENTED | 26–50% | [rate-limit.js](src/lib/security/rate-limit.js) guards login/register/reset | In-memory per-instance; ineffective on the Vercel serverless target the repo is configured for | HIGH |
| R100 | Transactional integrity of multi-document writes (§7 implied) | PARTIALLY IMPLEMENTED | 51–75% | No transactions anywhere; compensated by write-then-read race settlement + webhook idempotency + state-assertion handlers | Booking creation → payment creation → `paymentId` link is 3 non-atomic steps; a crash between them orphans blocking bookings (compounds R41) | MEDIUM |

---

## 5. MVP Compliance

The requirement document does not print a separate numbered MVP checklist; §11 enumerates the
41 sections that "must all be represented in the actual application", and §48 Phases 3–9 define
the MVP build. This section audits those 41 areas as the MVP scope.

| # | MVP Requirement (§11) | Status | Coverage | Evidence | Gap |
|---|---|---|---:|---|---|
| M1 | Product overview | FULLY IMPLEMENTED | — | R1 | — |
| M2 | Homepage | FULLY IMPLEMENTED | — | R18–R20 | — |
| M3 | Account types | FULLY IMPLEMENTED | — | R17 — 4 roles | — |
| M4 | Parent/student registration | FULLY IMPLEMENTED | — | R11, R12 | — |
| M5 | Child/student profiles | FULLY IMPLEMENTED | — | R84; multiple children per parent via `ownerId`; per-child grade/courses/history | — |
| M6 | Canadian curriculum | FULLY IMPLEMENTED | — | R21–R23 | — |
| M7 | Tutor search | FULLY IMPLEMENTED | — | R24 | — |
| M8 | Search filters | FULLY IMPLEMENTED | — | R25 | — |
| M9 | Tutor result cards | FULLY IMPLEMENTED | — | R26, R27 | — |
| M10 | Tutor public profile | FULLY IMPLEMENTED | — | R28, R29 | — |
| M11 | Tutor verification | **BROKEN** | — | R31, R32 correct; R33 storage | Document upload/retrieval non-functional on the deployment target |
| M12 | Become a Tutor | FULLY IMPLEMENTED | — | [become-a-tutor](src/app/(public)/become-a-tutor/page.js) | — |
| M13 | Tutor onboarding | FULLY IMPLEMENTED | — | R34 | — |
| M14 | Availability calendar | FULLY IMPLEMENTED | — | R35, R36 | — |
| M15 | Booking | **BROKEN** | — | R38, R39 correct; R41 defect | Abandoned checkout permanently blocks the slot |
| M16 | Payments and payouts | PARTIALLY IMPLEMENTED | 76–99% | R42–R48 | Stripe unconfigured; live payments/payouts inactive |
| M17 | Messaging | FULLY IMPLEMENTED | — | R49–R51 | — |
| M18 | Post a Tutor Request | FULLY IMPLEMENTED | — | R52, R53 | — |
| M19 | Tutor Matching | FULLY IMPLEMENTED | — | R54 | — |
| M20 | Favourites | FULLY IMPLEMENTED | — | R55 | — |
| M21 | Reviews | FULLY IMPLEMENTED | — | R56–R58 | — |
| M22 | Parent/student dashboard | FULLY IMPLEMENTED | — | R59 | — |
| M23 | Tutor dashboard | FULLY IMPLEMENTED | — | R60 | — |
| M24 | Lesson confirmation/notifications | FULLY IMPLEMENTED | — | R72, R73 | — |
| M25 | Online lessons | PARTIALLY IMPLEMENTED | 76–99% | R68, R69 | Only Zoom implemented; unconfigured |
| M26 | In-person lessons | FULLY IMPLEMENTED | — | R70, R71 | — |
| M27 | Cancellation/refunds/no-shows | PARTIALLY IMPLEMENTED | 76–99% | R63–R67 | Abuse escalation (R66) is advisory only |
| M28 | Admin dashboard | FULLY IMPLEMENTED | — | R61, R62 | — |
| M29 | Location/distance search | FULLY IMPLEMENTED | — | `$centerSphere` geo query; QA: postal-code search, graceful degradation; distance coarsened before leaving geocoder | — |
| M30 | Security/privacy | PARTIALLY IMPLEMENTED | 76–99% | R83–R86 | Rate limiter ineffective on target (R99); document storage (R33) |
| M31 | Responsive design/future apps | NOT VERIFIABLE | — | R81 | Not validated on real viewports |
| M32 | SEO/public landing pages | FULLY IMPLEMENTED | — | R75–R77 | — |
| M33 | Support/legal pages | FULLY IMPLEMENTED | — | `/support`, `/legal/[slug]` — both 200 live; [constants/legal.js](src/constants/legal.js) | — |
| M34 | MVP features | PARTIALLY IMPLEMENTED | 76–99% | this table | — |
| M35 | Phase Two architecture | FULLY IMPLEMENTED | — | R91 | — |
| M36 | Phase Three architecture | PARTIALLY IMPLEMENTED | 26–50% | R92 | Acceptable per §41 |
| M37 | Parent journey | PARTIALLY IMPLEMENTED | 76–99% | §8 below | Payment step on dev provider |
| M38 | Tutor journey | PARTIALLY IMPLEMENTED | 76–99% | §9 below | Document upload step |
| M39 | Product differentiators | FULLY IMPLEMENTED | — | §12 below | — |
| M40 | Development priorities | FULLY IMPLEMENTED | — | §13 below | — |
| M41 | Final product objective | PARTIALLY IMPLEMENTED | 76–99% | §49 standard | Not production-live |

### MVP Totals

| Outcome | Count |
|---|---:|
| Fully implemented | **28** |
| Partially implemented | **9** |
| UI / mock only | **0** |
| Broken | **2** |
| Not implemented | **0** |
| Not verifiable | **1** |
| **Total MVP requirements** | **41** |

**Overall MVP requirement coverage: 28 of 41 fully implemented (68%); 37 of 41 (90%)
functionally present at ≥51% coverage. Zero requirements are UI/mock-only, and zero are
entirely missing.**

The MVP **cannot be called complete**: M11 and M15 are broken, and M15 (booking) is the core
marketplace loop.

---

## 6. Phase Two Compliance

§41 states Phase 2 features should *not* be implemented now, but the architecture must allow
them. Status is reported, not scored as a defect.

| Phase 2 Feature | Status | Readiness Evidence |
|---|---|---|
| Advanced tutor requests | NOT IMPLEMENTED (as specified) | MVP request model has `budget`, `goal`, `preferredSchedule`, `notes` — extensible |
| Advanced matching | NOT IMPLEMENTED (as specified) | `MATCH_WEIGHTS` object [score.js:14-20](src/lib/matching/score.js#L14-L20) — new factors add without touching the loop |
| Google Calendar | NOT IMPLEMENTED (as specified) | `CalendarProvider` abstract class declared |
| Outlook Calendar | NOT IMPLEMENTED (as specified) | same abstraction |
| SMS | NOT IMPLEMENTED (as specified) | `NOTIFICATION_CHANNELS.SMS` + per-channel preference gate already wired |
| Referrals | NOT IMPLEMENTED | No model or hook |
| Tutor packages | NOT IMPLEMENTED | Recurring series is a partial foundation |
| Group tutoring | NOT IMPLEMENTED | Booking is single-student by schema; would need modelling |
| Progress reports | NOT IMPLEMENTED | `learningGoals` on StudentProfile is a foundation |
| Promoted profiles | NOT IMPLEMENTED | Sort enum is extensible |
| Advanced analytics | PARTIALLY IMPLEMENTED | Existing analytics already exceed MVP; aggregation pipeline is extensible |
| Fraud/risk tools | PARTIALLY IMPLEMENTED | `assessCancellationAbuse`, dispute model, audit log, webhook event log all exist |

**Assessment:** architectural readiness is genuine for the items §41 emphasises (matching,
calendar, SMS). No Phase 2 feature is falsely presented as available.

---

## 7. Phase Three Compliance

| Phase 3 Feature | Status | Notes |
|---|---|---|
| iOS / Android | NOT IMPLEMENTED (as specified) | Footer shows honest "Coming soon" store badges. The REST API is app-consumable |
| Native video classroom | NOT IMPLEMENTED | `MeetingProvider` abstraction would host it |
| Interactive whiteboard | NOT IMPLEMENTED | No readiness work |
| Homework/document sharing | NOT IMPLEMENTED | Attachment schema + storage abstraction are partial foundations |
| AI recommendations / search / lesson summaries | NOT IMPLEMENTED | No readiness work |
| Student analytics | NOT IMPLEMENTED | `learningGoals` is a foundation |
| Tutor subscriptions | NOT IMPLEMENTED | Payment abstraction supports recurring in principle |
| Group courses | NOT IMPLEMENTED | — |
| Exam preparation marketplace | NOT IMPLEMENTED | — |
| **Additional provinces** | **FULLY IMPLEMENTED (ready)** | `Province` is a first-class collection with `isActive`; curriculum admin CRUD exists; UI already renders inactive provinces as "coming soon" |
| University tutoring | NOT IMPLEMENTED | Grade model is province-scoped K-12 |

**Assessment:** correctly deferred. Multi-province — the one Phase 3 item §13 explicitly
required architectural support for — is genuinely ready.

---

## 8. Parent Journey Audit

Traced against §46's parent journey.

| Step | Status | Evidence / Break point |
|---|---|---|
| Visit APlus Learn | **WORKS** | `/` returns 200; real DB-backed content |
| Select province | **WORKS** | `HeroSearch` reads `listProvinces()` |
| Select grade | **WORKS** | Grade list from curriculum service |
| Select course / course code | **WORKS** | QA: lookup by code *and* by name |
| Choose online/in-person | **WORKS** | `mode` filter in query builder |
| Enter location | **WORKS** | QA: postal-code search; unresolvable location degrades rather than erroring |
| See matching tutors | **WORKS** | QA: search without signing in; unapproved tutors never appear |
| Filter | **WORKS** | All 7 §14 filters reach MongoDB |
| Open profile | **WORKS** | `/tutors/<slug>` 200; no surname, no coordinates, no meeting link |
| Review credentials/reviews/availability | **WORKS** | QA: "availability is public" |
| Select lesson time | **WORKS** | Slot generation respects notice, buffer, exceptions, bookings |
| Create account / login | **WORKS** | QA: registration + login + field-level validation errors |
| Pay | **PARTIAL** | Dev provider completes E2E (QA: captured, declined-card reported, booking confirmed after payment). **Stripe unconfigured — no real money can move** |
| Receive confirmation | **WORKS** | Booking CONFIRMED; meeting link issued; receipt available; notification + email dispatched |
| Communicate | **WORKS** | QA: 6 messaging checks incl. cross-conversation posting refused |
| Attend | **PARTIAL** | Meeting link generated and correctly access-controlled; real Zoom room requires credentials |
| Review | **WORKS** | Gated on COMPLETED + no existing review |
| Rebook | **WORKS** | Favourites, "my tutors", and repeat booking all functional |

**Journey break point:** none that halts the flow in development. The journey is
**completable end-to-end today on development providers**. It is *not* completable with real
money or a real video room.

**Latent defect on this journey:** if the parent abandons checkout at the "Pay" step, the
selected slot is removed from the tutor's calendar permanently (R41).

---

## 9. Tutor Journey Audit

| Step | Status | Evidence / Break point |
|---|---|---|
| Become a Tutor | **WORKS** | `/become-a-tutor` 200 |
| Create account | **WORKS** | Role TUTOR; email verification gate |
| Complete profile | **WORKS** | 11-step wizard; per-step Zod validation; progress saved server-side |
| Select courses | **WORKS** | Bound to real `Course` documents; denormalised for search |
| Set price | **WORKS** | Base rate + per-course overrides; `minHourlyRateCents` maintained for filtering |
| Set format / service area | **WORKS** | `lessonModes`, `travelRadiusKm`, postal-code centroid |
| Set availability | **WORKS** | Weekly rules + exceptions in tutor's timezone |
| Upload verification documents | **BROKEN (deployment)** | Service, validation, admin-only audited retrieval and image inspection all implemented; **storage is local FS and will not persist on Vercel** |
| Submit | **WORKS** | `submitApplication` [tutor.service.js:268](src/services/tutor.service.js#L268); audit + notification |
| Admin review | **WORKS** | approve / reject / request-info / grant badges, with audit log, email and in-app notification |
| Approval | **WORKS** | `deriveSearchable()` — approval **and** profile completeness |
| Searchable profile | **WORKS** | QA: 9 eligibility checks — a tutor cannot set their own searchability; editing never grants visibility to an unapproved profile |
| Receive booking | **WORKS** | Appears on tutor bookings + calendar |
| Teach | **PARTIAL** | Meeting link present; real room needs Zoom credentials |
| Payout eligibility | **WORKS** | COMPLETED + hold period; idempotent claim |
| Payment / payout | **PARTIAL** | Full Stripe Connect adapter with 12 passing adapter tests; **inactive without keys** |
| Review | **WORKS** | Tutor can reply; reporting a review cannot move their own rating |
| Repeat booking | **WORKS** | Recurring series and repeat-student stats |

**Journey break point:** **verification document upload** — the only step that is broken
rather than merely unconfigured.

---

## 10. E2E Journey Results

| Journey | Status | Broken At | Reason |
|---|---|---|---|
| Parent Search → Booking → Payment | **PARTIAL** | Payment | Completes on the development provider (QA-verified). Stripe unconfigured, so no real payment. Abandoning checkout permanently blocks the slot (R41) |
| Parent → Messaging → Lesson | **PARTIAL** | Lesson | Messaging fully passes (6 + 16 moderation checks). Meeting link generated and access-controlled; real Zoom room needs credentials |
| Parent → Review → Rebook | **PASS** | — | Review gated on completed booking; rebooking via favourites/my-tutors works |
| Tutor Application → Approval → Searchable Profile | **PARTIAL** | Document upload | Every other step verified by QA. Storage layer non-functional on the deployment target |
| Tutor → Booking → Lesson → Payout | **PARTIAL** | Payout execution | Eligibility, hold period, idempotency and Connect adapter all verified. No real transfers without Stripe keys |
| Admin → Tutor Verification | **PARTIAL** | Document review | Approve/reject/request-info/badges all work with audit logging; the admin cannot reliably retrieve the document in production |
| Admin → Booking/Payment Management | **PASS** | — | Admin booking list, payment list, refund route, payout queue, dispute resolution all verified |
| Admin → User Management | **PASS** | — | QA: admin lists users; password hashes never leave the server; suspend/reinstate with audit |

---

## 11. Security / Privacy / Authorization Findings

### Verified strengths (evidence-backed)

- **No IDOR/BOLA found.** Every ownership check reads the loaded database record, never a
  request field. The QA suite explicitly attacks this surface — unrelated learners, parents and
  tutors are refused on reschedule, no-show, messaging, conversations, children and bookings
  (29 "Booking authorization" checks plus 8 "Authorization" checks). All refusals hold.
- **Privilege escalation blocked.** QA: "a tutor cannot set their own searchability or status";
  "OAuth cannot be used to request an ADMIN role"; "a parent cannot write settings".
- **Client-supplied state ignored.** QA: "client-supplied price and status are ignored".
- **Password hashes never serialised** (`select: false` + QA assertion).
- **Card data.** Only brand + last 4 stored. The Stripe adapter **refuses** a raw card
  (`capturePayment` throws) to stay out of PCI scope — verified by adapter test.
- **Webhooks.** Signature verified over the raw body *before* any DB access; unique index on
  `(provider, eventId)` for idempotency; handlers written as state assertions so a late failure
  cannot un-pay a settled payment; an event whose amount disagrees with the booking is refused.
  17 adapter tests.
- **Privacy defaults.** `publicName` (first name + last initial) everywhere public; learner
  surnames masked from tutors unless opted in; exact addresses `select:false` and released only
  to participants on a confirmed booking; geocoded coordinates coarsened before leaving the
  geocoder; Zoom host start URL never returned or stored.
- **Audit logging.** 25 audit actions covering every sensitive admin operation, including
  `CONVERSATION_REPORT_VIEWED` — an administrator reading a reported thread is itself audited.
- **Uploads.** Nothing is written into `public/`. Filenames are generated, never taken from the
  upload. Image content is inspected — QA proves a non-image disguised as a PNG and an SVG logo
  are both refused.
- **OAuth CSRF/replay.** Single-use httpOnly nonce compared against the signed ID token.

### Findings

| ID | Severity | Finding |
|---|---|---|
| S1 | **CRITICAL** | **Availability denial-of-service.** `PENDING_PAYMENT` blocks slots and is never expired. Any verified learner can enumerate a tutor's slots, create bookings, abandon checkout, and permanently erase that tutor's calendar. No rate limit applies to booking creation. See R41 |
| S2 | **CRITICAL** | **Verification documents unretrievable in production.** Local-FS storage on an ephemeral serverless filesystem. Beyond the functional break, a partially-written or lost document store around identity paperwork is a privacy-handling concern |
| S3 | **HIGH** | **Rate limiting ineffective on target deployment.** [rate-limit.js:11-15](src/lib/security/rate-limit.js#L11-L15) uses a per-process `Map`. On Vercel each invocation may be a fresh process, so login/registration/reset brute-force protection largely evaporates. The file documents this; it is unaddressed |
| S4 | MEDIUM | **No transactions.** Booking creation, payment creation and the `paymentId` back-link are three separate writes. A crash between them leaves blocking bookings with no payment — which, given S1, are then permanent |
| S5 | LOW | `CRON_SECRET` is set in `.env.local` but the running server reported it unset during QA ("skipping the scheduler-token checks"), indicating the process predates the variable. The fail-closed design is correct; this is an operational note |

---

## 12. Product Differentiator Audit

| Differentiator | Status | Evidence | Gap |
|---|---|---|---|
| Canadian curriculum / course-code search | **FULLY IMPLEMENTED** | Province→Grade→Subject→Course→Code modelled; code and name search equivalently; `courseCodes` indexed; SEO URLs by code | — |
| Local **and** online tutoring | **FULLY IMPLEMENTED** | `lessonModes`; geo `$centerSphere` for in-person, borderless for online; QA verifies mode filtering | — |
| Education-specific tutor verification | **PARTIALLY IMPLEMENTED (76–99%)** | 5 education-specific badge types (OCT, University Student, Education…); admin workflow complete; badge expiry job | Document storage broken in production (S2) |
| Search without subscription | **FULLY IMPLEMENTED** | QA: anonymous search, anonymous availability view | — |
| Parent-focused experience | **FULLY IMPLEMENTED** | Multiple children per account, per-child grade/courses/history, minor-privacy defaults, guardian-pays model | — |
| Integrated availability + booking + payment | **PARTIALLY IMPLEMENTED (76–99%)** | One continuous flow, single payment per series, server-side pricing | Payment on dev provider; slot-leak defect (S1) |
| Tutor request feature | **FULLY IMPLEMENTED** | Request → auto-matching → tutor interest → compare → close | — |
| Family tutoring management | **FULLY IMPLEMENTED** | `StudentProfile.ownerId` + `isSelf`; separate bookings, history and courses per child | — |

---

## 13. Development Priority Audit

| # | Priority Area (§40) | Assessment |
|---|---|---|
| 1 | Search and matching | **Strong.** Every §14 dimension and filter reaches MongoDB. `isSearchable: true` is the first clause of every public query. Dedicated matching service with weighted scoring. Indexes chosen deliberately, including a documented workaround for MongoDB's parallel-array restriction |
| 2 | Tutor profiles | **Strong.** All 16 §15 elements; trust-ordered; privacy-safe (no surname, no coordinates, no address, no meeting link). Completeness is a precondition of searchability |
| 3 | Curriculum / course-code structure | **Strong.** First-class collections, admin CRUD, multi-province ready, code and name search equivalent |
| 4 | Availability and booking | **Strong design, one critical defect.** Slot generation is timezone-correct and buffer-aware; the double-booking race is settled deterministically without transactions and proven by a 5-way concurrency test. **Undermined by the unexpired `PENDING_PAYMENT` hold (S1)** |
| 5 | Payments and payouts | **Architecturally complete, operationally inactive.** Server-side pricing, admin-configurable commission, exact commission/earnings split, refund caps, Stripe + Connect adapters, verified webhooks, payout hold and idempotent claiming. No credentials configured |
| 6 | Tutor onboarding and verification | **Strong workflow, broken storage.** 11 steps with per-step validation and saved progress; full admin decision workflow with audit, email and notification. Document persistence fails on the deployment target |
| 7 | Parent/student and tutor dashboards | **Strong.** Every area §24 lists exists as a route backed by a service |
| 8 | Messaging | **Strong.** Conversations, booking context, unread counts, block, report, and a complete admin moderation queue whose triage view deliberately carries no message bodies |
| 9 | Reviews | **Strong.** 4 sub-scores, completed-booking gate, tutor replies, moderation that cannot be gamed by the reviewed tutor, denormalised stats refreshed on change |
| 10 | Administrator management | **Strong.** Users, applications, verification, curriculum, bookings, payments, payouts, disputes, reviews, moderation, analytics, settings — all present, permission-gated and audited. Business rules are admin-configurable as §20 and §26 require |

---

## 14. Gap Summary

### Critical Gaps

1. **Abandoned checkouts permanently destroy tutor availability (R41 / S1).**
   `PENDING_PAYMENT` is in `BLOCKING_BOOKING_STATUSES` ([domain.js:143-150](src/constants/domain.js#L143-L150))
   and nothing ever moves a booking out of it. There is no `EXPIRED` status, no cleanup job
   ([scheduler.service.js:32-37](src/services/scheduler.service.js#L32-L37) registers only four
   jobs), and neither `markPaymentFailed` nor the `checkout.session.expired` handler touches the
   Booking documents. Two comments assert the opposite —
   [booking.service.js:101-103](src/services/booking.service.js#L101-L103) ("an abandoned
   checkout never blocks a tutor's calendar indefinitely") and
   [webhook.service.js:231-233](src/services/webhook.service.js#L231-L233) ("until the booking
   service expires them"). Both claims are false. *Impact: data integrity, core marketplace
   function, and an abuse vector.*

2. **Verification document storage is non-functional on the deployment target (R33 / S2).**
   [storage-provider.js:88-93](src/services/external/storage-provider.js#L88-L93) returns a
   local-filesystem provider; the S3 provider is a commented-out line. `vercel.json` configures
   a Vercel deployment. Tutor verification (§16) and admin branding uploads (§30) cannot work.

3. **No payment provider configured.** `.env.local` has no `STRIPE_SECRET_KEY`. The platform
   cannot take money. The adapter is complete and tested, so this is configuration — but until
   it is done, §20 is not satisfied in any live sense.

### High-Priority Gaps

4. **Rate limiting does not survive the target deployment (S3).** In-memory per-process store;
   needs Redis or equivalent before exposure.
5. **Google and Apple sign-in inactive (R13, R14).** §9 requires both. Adapters are written and
   tested; client IDs are unset.
6. **Email delivery inactive.** `ResendEmailProvider` is implemented and tested; `RESEND_API_KEY`
   unset, so all mail goes to the console transport. Verification links, receipts, cancellation
   and payout notices do not reach real inboxes.
7. **Meeting links are not real rooms.** Zoom adapter is implemented and tested; credentials
   unset. Google Meet and Microsoft Teams — both named in §27 — have **no implementation at all**,
   only enum values.

### Medium-Priority Gaps

8. **Cancellation-abuse escalation is advisory (R66).** `assessCancellationAbuse` returns
   `REVIEW` but nothing consumes that outcome to open a case or restrict the account; §26 asks
   for warnings and suspension/removal.
9. **No per-segment loading/error boundaries (R80).** Only root-level `loading.js`/`error.js`,
   so §32's per-feature states rely entirely on client-side `useAsync`.
10. **No transactions (S4).** Documented trade-off, but it compounds gap 1.
11. **Responsive and accessibility compliance unverified (R81, R82).** Strong signals in source;
    no automated or device verification, and §47 lists both as quality gates.
12. **No CI configuration found.** §47's gates exist as scripts but nothing enforces them.

### Low-Priority Gaps

13. **No unit-test runner (R97).** Pure, highly testable modules (`pricing.js`, `policy.js`,
    `slots.js`, `score.js`, `tutor-query.js`) have no direct unit tests; they are covered only
    indirectly through HTTP.
14. **No browser/UI E2E layer.** Both suites are API-level.
15. **`CLAUDE.md` is stale** — it states `scripts/qa.mjs` is the only test suite, but
    `scripts/integration-tests.mjs` (970 lines, 111 checks) also exists.
16. **`CRON_SECRET` not loaded by the running process (S5).** Operational, fail-closed.

---

## 15. MVP Readiness Assessment

| Measure | Count |
|---|---:|
| Total MVP requirements (§11 areas) | **41** |
| Fully implemented | **28** |
| Partially implemented | **9** |
| UI / mock-only | **0** |
| Broken | **2** |
| Not implemented | **0** |
| Not verifiable | **1** |

**Conclusion.** Based on the audited implementation, **28 of 41 MVP requirements are fully
implemented**, 9 are partially implemented, 2 are broken, 1 is not verifiable, and **none are
missing or UI/mock-only**. The remaining gaps are: (a) abandoned bookings permanently blocking
tutor availability; (b) verification-document storage that cannot function on the configured
deployment target; (c) every external provider — payments, email, video, maps, social sign-in —
being unconfigured, so no requirement depending on one is live; (d) rate limiting that does not
survive serverless execution; and (e) responsive/accessibility compliance that was not verified.

This application is **not production ready**. It is, on the evidence, a well-architected and
substantially complete MVP with one genuine functional defect in its core loop, one deployment
-incompatible subsystem, and an unconfigured integration surface. The distance to production is
measured in configuration plus two focused fixes, not in rebuilding features.

The quality signal is unusually strong for a codebase of this size: 335 automated checks pass,
lint is clean, no fake buttons or mock-data screens were found, and the business rules the
requirement document asked to be centralised genuinely are.

---

## 16. Recommended Remediation Order

Ordered by dependency and business impact. **No changes were made; this is a checklist.**

1. **Expire abandoned bookings.** Add a terminal status (e.g. `EXPIRED`) outside
   `BLOCKING_BOOKING_STATUSES`, and a scheduled job that releases `PENDING_PAYMENT` bookings past
   a grace window (align with the 1-hour Stripe session expiry). Have the
   `checkout.session.expired` and `payment_intent.payment_failed` handlers release slots
   immediately. Correct the two false comments. *First, because it corrupts availability
   continuously and every booking made before the fix may already have leaked slots.*
2. **Replace filesystem storage with an object store.** Implement `S3StorageProvider` behind the
   existing interface and return it from `getStorageProvider()`. *Unblocks tutor verification,
   which gates searchability, which gates the entire marketplace.*
3. **Move rate limiting to a shared store.** The call signature is already designed for it.
   *Security precondition for exposing login and registration publicly.*
4. **Configure and smoke-test Stripe** (payments + Connect + both webhook secrets). *Nothing
   downstream — payouts, refunds, receipts — can be validated live until this exists.*
5. **Configure Resend.** *Email verification gates booking, messaging, reviews and requests, so
   real mail is a prerequisite for real users.*
6. **Configure Google/Apple OAuth and Google Maps.** *Completes §9 and moves geocoding off the
   bundled table.*
7. **Configure Zoom; decide on Meet and Teams.** Either implement the two remaining §27
   providers or record them as an explicit scope decision.
8. **Add transactional integrity** to booking→payment creation (or a compensating sweep), now
   that step 1 has established a release path.
9. **Close the cancellation-abuse loop** so `REVIEW` opens an admin case.
10. **Add per-segment loading/error boundaries.**
11. **Verify responsive and accessibility compliance** with real devices and an automated a11y
    pass; add both to CI alongside lint, build, `qa` and `test:integrations`.
12. **Add unit tests** for the pure rule modules, and update `CLAUDE.md` to mention the second
    suite.

---

## 17. Final Implementation Summary

### Fully Implemented
Curriculum hierarchy and course-code search · tutor search with every §14 dimension and filter ·
search-without-account · unapproved tutors excluded from search · tutor public profiles with
correct privacy redaction · 11-step tutor onboarding with saved progress · admin approval
workflow with audit, email and notification · 5 verification badge types and lifecycle ·
availability with timezone-correct slot generation · double-booking prevention including a
proven concurrency race settlement · booking flow including recurring series · server-side
pricing with exact commission/earnings split · admin-configurable commission and every
cancellation parameter · centralised cancellation/refund/no-show policy · no-show handling ·
disputes · messaging with block, report and a full admin moderation queue · tutor requests and
weighted matching · favourites · reviews with 4 sub-scores, completed-booking gate and
ungameable moderation · all three dashboards in full · all 12 admin analytics metrics ·
notifications with preferences (email genuinely delivered) · in-person address release only
after confirmation · meeting-link access control · minor privacy controls · RBAC with 4 roles
and 34 permissions · session revocation via `tokenVersion` · Zod validation on every important
input · SEO (metadata, canonical, JSON-LD, sitemap, robots, both §29 URL shapes) · design system
and reduced-motion support · realistic Ontario seed data · scheduled jobs with constant-time
token auth · 335 passing automated checks.

### Partially Implemented
Payments and payouts (adapters complete, unconfigured) · Google sign-in · Apple sign-in · online
lessons (Zoom only, unconfigured) · cancellation-abuse escalation · loading/error state coverage ·
accessibility · rate limiting · transactional integrity · Phase 3 readiness · quality gates.

### UI / Mock Only
**None found.** Every MVP screen audited resolved to a real service and real persistence.
Homepage testimonials are live `Review` documents, not fixtures.

### Broken
Tutor verification document storage on the deployment target · abandoned-booking slot release.

### Not Implemented
Google Meet and Microsoft Teams meeting providers (named in §27) · all Phase 2 features except
architectural hooks (as §41 instructs) · all Phase 3 features except multi-province readiness
(as §41 instructs).

### Not Verifiable
Responsive behaviour across real devices (§33) · WCAG-level accessibility conformance (§34) ·
live third-party behaviour of Stripe, Resend, Zoom, Google Maps and Apple/Google OIDC, since no
credentials are configured — adapter-level behaviour is verified, service-level is not.

---

*Audit performed read-only. `git status` was clean before and after; no source file, schema,
API, configuration or dependency was modified. The only file written is this report.*

---

---

# 18. Remediation — 2026-09-17

> **This section was added after the audit above, by the work that fixed what it found.**
> Everything before this heading is the original read-only report and is left unchanged,
> including the statements this work has since made obsolete. Where the two disagree, this
> section is current.

## 18.1 What was fixed

### R41 / S1 — Abandoned checkouts permanently destroyed tutor availability — **BROKEN → FIXED**

The audit was correct in every particular: `PENDING_PAYMENT` was a blocking status with no
transition out of it, no `EXPIRED` status existed, no job released anything, and two comments
claimed otherwise.

A booking lifecycle was added around a single rule, not scattered through the call sites.

**The status.** `BOOKING_STATUS.EXPIRED` is terminal and is deliberately *absent* from
`BLOCKING_BOOKING_STATUSES` — which is where the defect actually lived. `canCancel()` refuses
it, the learner's "Cancelled" tab includes it so an expired lesson is visible rather than
silently gone, and the admin booking filter can select it.

**The window, in one place.** `CHECKOUT_HOLD` in `src/constants/config.js` is the shipped
default; `Settings.checkoutHoldMinutes` is the administrable value, sitting beside
`payoutHoldDays` and `freeCancellationWindowHours` as §26 asks. Three things read it and
cannot drift: the expiry sweep, the policy module, and the Stripe session's own `expires_at`.
`graceMinutes` is applied *only* to a provider-stated session expiry, which is the one place a
race is possible.

**The rule, in one place.** `shouldReleaseHold()` and `failureReleasesHold()` in
`src/lib/booking/policy.js` — the module that already owned every cancellation path — decide
whether a hold may be released. Nothing else makes that judgement. A settled payment is
refused there, and refused again in the service, because it is the invariant that matters.

**The sweep.** `expireStaleBookings()` claims each booking with a conditional update on its
`PENDING_PAYMENT` status, so three concurrent runs release it exactly once and the losers see
`modifiedCount === 0` and move on. It refreshes `nextAvailableAt`, audits the release,
notifies the purchaser, and closes the abandoned payment so a slot that no longer exists
cannot still be paid for. Registered as `booking-expiry` in the **existing** scheduler
registry and in `vercel.json` at `*/10 * * * *` — no second scheduler was introduced.

**The webhooks.** `checkout.session.expired` now releases the slot immediately. A decline
(`payment_intent.payment_failed`) releases it *only when no live checkout session remains*,
so an honest parent whose first card is declined does not lose the lesson to a typo — the
sweep collects it if they walk away. Both paths validate that the event actually belongs to
the payment (see 18.3) and that the expiring session is the payment's *current* one, so a
late delivery for a superseded session cannot take a booking out from under someone who is
actively paying.

**Bookings that leaked before the fix** are old `PENDING_PAYMENT` rows with a lapsed hold,
which is precisely what the sweep's query selects. They are released on the first run; no
migration, no deletion. Bookings orphaned by a crash between `Booking.create` and
`createPaymentForBooking` (audit item S4) have no `paymentId` at all and are released by the
same rule — which is the compensating mechanism §10 of the remediation brief asked for,
rather than a transaction the deployment architecture may not support.

**A payment that settles after its hold lapsed** — an async payment method, a very late
webhook — is handled rather than ignored: `confirmBookings()` revives an `EXPIRED` booking if
the slot is still free, and when it is not, audits it as needing a refund and logs loudly.

**The false comments** in `booking.service.js` and `webhook.service.js` were corrected.

### R33 / S2 — Verification document storage was non-functional on the deployment target — **BROKEN → FIXED**

`S3StorageProvider` implements the existing `StorageProvider` interface. It speaks the S3 API
directly — SigV4 signed with `node:crypto` over `fetch` — so it runs unchanged against Amazon
S3, Cloudflare R2, Backblaze B2, DigitalOcean Spaces and MinIO. The signing is verified
against **AWS's own published test vector**, byte for byte.

No SDK was added. Three operations did not justify tens of megabytes in the server bundle;
this is the same trade `lib/images/inspect.js` already makes.

Privacy is structural rather than configured:

- **No method returns a URL.** Both scopes are fetched server-side and streamed through a
  route that has already authorised the caller, so there is no signed link to leak, expire
  badly or forward. This is stricter than the signed-URL approach the brief permitted.
- No ACL is set, so objects inherit the bucket's private default. `AES256` at rest is
  requested.
- Keys are UUIDs under a scope prefix; a stored key that tries to escape its scope is
  flattened by `safeKey`, not followed.

**`STORAGE_PROVIDER=development` is now refused when `APP_ENV=production`** — the same
`fakeAllowedInProduction: false` treatment payments and email already had. The broken
deployment assumption cannot recur silently; the deployment fails to start instead.

Branding uploads go through the same provider and the same scopes — no second storage
implementation was created. Migration is a file copy that preserves filenames, because the
stored `storageKey` *is* the object name; nothing in the database changes. Documented in
`.env.example` §6 and `docs/INTEGRATIONS.md` §6. Nothing under `.storage/` is deleted.

### R68 — Google Meet and Microsoft Teams — **NOT IMPLEMENTED → IMPLEMENTED**

Confirmed against `docs/Project.md` §27, which names all three platforms for the MVP. Both
implement the existing `MeetingProvider` contract; no provider-specific logic was added to
booking code.

- **`GoogleMeetProvider`** — service-account JWT assertion with domain-wide delegation,
  exchanged for a token, then Calendar `events.insert` with `conferenceDataVersion=1`. Google
  has no standalone-room API, so the room is a conference on an event the platform owns.
- **`MicrosoftTeamsMeetingProvider`** — Graph client credentials, `onlineMeetings` under one
  organiser account scoped by an application access policy. No calendar event, no invitations.

Both create after payment, PATCH on reschedule so an existing join link keeps working, DELETE
on cancellation, and fail into the existing "booking confirms anyway, link filled in later"
path. `getMeetingProvider(provider)` resolves the adapter through a fixed lookup table, so a
string arriving on the wire can never reach an adapter — an unknown value falls through to the
development provider.

**Privacy went further than parity with Zoom.** No adapter sends a participant's name or email
to a meeting provider: Meet events are created with no attendees, Teams meetings with no
participants. A lesson for a minor must not become a row in a third party's calendar carrying
the child's address book entry. Each adapter also drops its platform's host credential — Zoom's
`start_url`, Teams' `audioConferencing` conference id and `joinInformation`, Meet's organiser —
and the integration tests assert each one is absent from what is returned and stored.

`MEETING_PROVIDER` accepts a comma-separated list, since a learner chooses per booking. A
platform without credentials degrades to a working development link; a platform *named*
without its secrets is still a hard startup failure.

## 18.2 Defects found while implementing, and fixed

These were not in the audit. They were found by tracing the two features end to end, and each
one would have undermined the fix it sat next to.

1. **The learner's chosen meeting platform was discarded.** `meetingProvider` was validated at
   booking time, required for online lessons — and never stored. `confirmBookings()` took it
   from the *capture request body* instead, which the checkout page never sent, and the webhook
   path could not send. Every online lesson silently became Zoom regardless of what the family
   chose. It is now persisted on the Booking at creation and read back when the room is made;
   the capture route no longer accepts it at all.

2. **No server-side check that the tutor offers the chosen platform.** Tutors declare
   `onlineMeetingProviders`, but `createBooking` never validated against it. Harmless while the
   value was ignored; a real gap once it decides which provider a room is created on.

3. **Header injection through an uploaded filename.** `readVerificationDocument` returned
   `file.name` as stored, and the admin route interpolated it into `Content-Disposition`,
   stripping only quotes. A filename containing CRLF would have ended that header and started
   one of the attacker's choosing. Filenames are now sanitised on the way in *and* on the way
   out, and the route sends `nosniff`, a `sandbox` CSP and `no-referrer`.

4. **Verification documents were never inspected.** Branding uploads were validated by magic
   bytes; verification documents trusted `file.type`, a string the browser sends. A script
   declared `application/pdf` was stored and later served back to an administrator's browser.
   `inspectDocument()` now reads the bytes, and the declared type must agree with them.

5. **Webhook events were not bound to the payment they named.** `resolvePayment` accepted
   `metadata.paymentId` as sufficient. That was tolerable when handlers only settled payments
   with an amount check; it is not tolerable when a handler can expire someone's bookings.
   `eventMatchesPayment()` now requires the event to carry a provider identifier already stored
   against that payment.

## 18.3 Tests added

All existing tests were kept. One assertion was **extended, not weakened**: the webhook
amount-tampering test now carries a matching payment intent so it still exercises the amount
guard after the new identity gate, and a second case was added for the identity gate itself.

| Suite | Before | After | Added |
|---|---:|---:|---:|
| `bun run qa` | 235 | **269** | 34 |
| `bun run test:integrations` | 111 | **225** | 114 |
| **Total** | 346 | **494** | 148 |

**`scripts/integration-tests.mjs`** gained three sections:

- *Google Meet adapter* and *Microsoft Teams adapter* — real signed assertions (a throwaway RSA
  key is generated in-process), conference creation, reschedule-keeps-the-link, teardown, token
  caching, and negative cases: bad credentials, an invalid key whose material is not echoed, and
  a provider that returns no join link. Plus the privacy assertions: no attendees, no
  participants, no organiser identity, no dial-in conference id.
- *Provider selection* — all three live at once, per-platform fallback, production honouring an
  explicit list, a named platform without secrets failing hard, and `["WEBEX", "../zoom", "",
  null, "__proto__", "constructor"]` all resolving to the development provider.
- *File storage* — SigV4 against AWS's published vector, round trip, scope separation, key
  generation, traversal flattening, no-URL, no-ACL, encryption, provider failure not leaking
  bucket internals, and every selection case including the production refusal of local storage.
- *Booking holds (R41)* — against a real database and the real services. Covers all eleven
  cases the remediation brief listed, plus the orphaned booking, the provider-session override,
  and the superseded-session delivery.

**`scripts/qa.mjs`** gained two sections, both over real HTTP:

- *Verification documents (R33)* — upload → the storage key is never returned → a disguised
  script is refused on its bytes → an SVG is refused → anonymous, parent, the uploading tutor
  and another tutor are all refused retrieval → an administrator retrieves it → the response
  carries no injected header and is `nosniff`/`sandbox`/`no-store` → a second read is identical.
- *Abandoned checkout releases the slot (R41)* — the full journey: free slot → booking created →
  slot leaves the public calendar → another family is refused it → the job leaves a fresh hold
  alone → the hold lapses → the job releases it → the slot is back on the public calendar →
  **another family books it** → re-running the job is safe → a paid booking is never claimed.
  Plus: a platform the tutor does not offer is refused, the chosen platform is stored on the
  booking, and an injected `status`, `meeting`, `price` and `confirmedAt` are each ignored on a
  request that otherwise *succeeds* — a 409 would have proven nothing about §42.

## 18.4 Verification

| Gate | Result |
|---|---|
| `bun run lint` | clean, no warnings |
| `bun run build` | succeeds |
| `bun run test:integrations` | **225 passed, 0 failed** |
| `bun run qa` | **269 passed, 0 failed** |
| Application start | dev server boots, routes respond |

## 18.5 Audit findings this work did not address

Deliberately out of scope, and still open:

- **S3 — rate limiting is in-memory** and does not survive serverless execution. Unchanged.
- **Every provider remains unconfigured** (Stripe, Resend, Zoom/Meet/Teams, Maps, OIDC, S3).
  All adapters are written and adapter-level tested; none has credentials. Meet and Teams have
  moved from *not implemented* to *awaiting credentials*, which is the same state Zoom was in.
- **R66 cancellation-abuse escalation is still advisory.**
- **R80 per-segment loading/error boundaries.**
- **R81/R82 responsive and accessibility conformance** remain unverified.
- **No CI configuration.**
- All Phase 2 / Phase 3 features listed in §11 of this report remain intentionally unbuilt,
  as §41 of the requirement document instructs.

One genuine issue was **found and not fixed**, because fixing it properly needs a product
decision rather than code:

- **Zoom meetings are created with `waiting_room: true` and `join_before_host: false`, and the
  host is a platform-owned account that will never attend.** Taken literally, nobody can start
  the meeting. It is pre-existing behaviour the original audit recorded as correct, and the
  right fix is to make the tutor an alternative host — which needs the tutor's Zoom email,
  which the platform does not collect. Meet and Teams were deliberately configured so the two
  participants can start without an organiser, so they do not inherit the problem.

## 18.6 Verdict

The two **BROKEN** requirements are fixed, verified through the full request path, and covered
by regression tests that fail if either defect returns. The two genuinely missing MVP
requirements — Google Meet and Microsoft Teams — are implemented on the existing abstraction
and are now in the same *awaiting credentials* state as every other integration.

No MVP requirement is BROKEN. No MVP requirement is NOT IMPLEMENTED. The distance to
production is configuration, plus the open items in 18.5.
