# APlusLearn — Final Implementation Audit Report

**Audit date:** 21 September 2026
**Repository:** `a-plus-learn` (branch `main`, commit `9b8dbb3`)
**Method:** Static code review of all 544 source files, plus live verification against a running instance of the application with a freshly seeded database. Both automated test suites, lint and the production build were executed and their real output recorded.
**Scope note:** No application code was changed during this audit. The working tree is unchanged.

---

## 1. Executive Summary

APlusLearn is a Canada-focused tutoring marketplace built as a single Next.js 16 application (JavaScript, MongoDB, Tailwind v4). It comprises **96 pages, 154 API endpoints, 34 services, 25 database models and 9 scheduled jobs**.

### Overall implementation: **90% complete**

| Measure | Count |
|---|---:|
| Modules audited | 26 (24 functional + 2 cross-cutting) |
| 🟢 Fully Implemented | 19 |
| 🟡 Partially Implemented | 7 |
| 🔴 Not Implemented | 0 |
| ⚪ Needs Verification | 0 |

*The two cross-cutting modules are External Integrations and File Storage; each is examined in its own dedicated section (§7 and §8) as well as appearing in the module table.*

**The product functionality is essentially finished.** Every business module in the specification is built, wired from user interface through to database, and defended by server-side authorisation. I verified the complete money path, the messaging path, the document-upload path and the tutor-approval path live against the running application, not just by reading code.

**What is genuinely outstanding is operational, not functional.** The single theme running through every remaining gap is the same: **no external service provider has ever been proven to work against a live account in this environment.** Payments, email, SMS, calendar, meeting links and object storage are all built to a clean adapter interface, are covered by 1,167 passing adapter tests, and all currently run on their built-in development implementations. That is a deliberate and well-executed architecture — but it means the claim "production-ready" cannot yet be made for any of them.

### Major remaining work

1. **File storage against a real S3/MinIO bucket is currently broken in this environment** and is the sole cause of every one of the 10 failing automated tests. The credentials in `.env.local` are literal placeholder text (`...`). This is a configuration problem, not a code problem — I proved the code works by running the same uploads successfully in local-filesystem mode.
2. **Live provider verification.** The Stripe test key authenticates successfully, but the connected Stripe account has `charges_enabled: false`, so no real charge has ever been taken. Email, SMS, calendar and meeting-link providers have no credentials at all.
3. **Two confirmed defects** (detailed in §11): a dispute can be re-decided after it has been closed, leaving the dispute record contradicting the payment ledger; and internal file-storage identifiers plus an administrator's user ID are published in the HTML of every public page.
4. **Production hardening:** no Content-Security-Policy or HSTS headers, no global audit-log viewer for administrators, and an in-memory rate limiter that will not hold across multiple server instances.

### Major risks and blockers

| Risk | Impact |
|---|---|
| No live payment has ever been taken | Blocks launch. The entire revenue path is unproven against Stripe. |
| External object storage unconfigured | Blocks verification-document and branding uploads in any deployment with an ephemeral filesystem. |
| No global audit log view | Refunds, settings changes and credential rotations are recorded but unreadable by operators. |
| Single-instance assumptions (rate limiter, booking race resolution) | Correct on one server; both need review before horizontal scaling. |

### Current project state

The application is **feature-complete and internally consistent, but not yet production-verified**. A team could reasonably plan for launch readiness in a short, well-defined window of work that is mostly credential provisioning and live-provider testing rather than new development.

---

## 2. Overall Module Status

| # | Module | Status | Completion | Key Implemented Areas | Remaining Work |
|---|---|---|---:|---|---|
| 1 | Authentication & Sessions | 🟢 Fully Implemented | 96% | Register, login, logout, JWT sessions with revocation, email verification, forgot/reset password, password change, account deletion | OAuth never run against a live Google/Apple app |
| 2 | RBAC & Permissions | 🟢 Fully Implemented | 98% | 4 roles, 40 permissions, enforced in one pipeline on all 154 endpoints and on every page | Roles are code-defined, not operator-editable (matches spec) |
| 3 | Public Marketplace & SEO | 🟢 Fully Implemented | 96% | Homepage, search, facets, tutor profiles, curriculum browse, 10 static pages, sitemap, robots | — |
| 4 | Tutor Search & Discovery | 🟢 Fully Implemented | 95% | Filtered search, facets, suggestions, `isSearchable` gating, name privacy | Full-text relevance tuning is basic |
| 5 | Curriculum Management | 🟢 Fully Implemented | 92% | Province/grade/subject/course CRUD, public read APIs, admin manager UI | No hard delete for subjects/grades/provinces; zero automated test coverage |
| 6 | Tutor Onboarding & Applications | 🟢 Fully Implemented | 95% | 11-step wizard, draft persistence, submission, admin approve/reject/request-info, profile creation on approval | — |
| 7 | Tutor Verification & Documents | 🟡 Partially Implemented | 80% | Upload, admin review, badge issue/expiry, audited private retrieval | External storage unverified; uploads fail with current credentials |
| 8 | Tutor Profile & Availability | 🟢 Fully Implemented | 94% | Profile editor, per-course rates, weekly availability, exceptions, slot generation | Intro-video/avatar URLs not scheme-validated |
| 9 | Booking & Scheduling | 🟢 Fully Implemented | 96% | Quote, create, recurring series, hold/expiry, cancel, reschedule, complete, no-show, reminders | Slot-race resolution is single-instance-safe only |
| 10 | Payments & Checkout | 🟡 Partially Implemented | 85% | Full lifecycle verified live on the development provider; Stripe hosted Checkout, webhooks, idempotency, reconciliation all built | No live Stripe charge ever taken (`charges_enabled: false`) |
| 11 | Payouts & Earnings | 🟡 Partially Implemented | 85% | Connect Express onboarding, scheduled payout job, transfers with idempotency, earnings dashboards | Stripe Connect never run live |
| 12 | Cancellation / Refund / No-show | 🟢 Fully Implemented | 96% | One central policy module, refunds pro rata, abuse detection, all paths resolve through it | — |
| 13 | Disputes | 🟡 Partially Implemented | 80% | Raise, admin queue, notes, resolve with refund, risk-case linkage | **Confirmed defect:** closed disputes can be re-decided |
| 14 | Messaging | 🟢 Fully Implemented | 92% | Conversations, send, read receipts, blocking, archiving, admin moderation queue | Attachments are schema-only (deliberate Phase 2 deferral) |
| 15 | Reviews & Moderation | 🟢 Fully Implemented | 94% | Create (gated on completed lesson), multi-dimension ratings, tutor reply, report, admin moderation | — |
| 16 | Tutor Requests & Matching | 🟢 Fully Implemented | 95% | Request CRUD, open board, interest, invite, weighted matching, expiry job, admin moderation | — |
| 17 | Progress Reports | 🟢 Fully Implemented | 94% | Authoring, revision history, family acknowledgement, privacy scoping, admin view | — |
| 18 | Packages | 🟢 Fully Implemented | 94% | Tutor package CRUD, purchase, balance consumption, expiry job with pro-rata refund | — |
| 19 | Group Sessions | 🟢 Fully Implemented | 94% | Capacity, enrolment, settlement job, attendance, meeting rooms, cancellation refunds | — |
| 20 | Referrals & Credits | 🟢 Fully Implemented | 94% | Code issue, attribution, qualification, credit ledger, abuse guards, reversal on refund | — |
| 21 | Promoted Profiles | 🟢 Fully Implemented | 95% | Admin promotion CRUD, clock-derived eligibility, ranking, labelling, expiry job | — |
| 22 | Risk & Fraud Tools | 🟢 Fully Implemented | 94% | Signal detection with deduplication, case management, evidence retention, admin review | — |
| 23 | Analytics | 🟢 Fully Implemented | 94% | Payment-sourced revenue, time-zone-aware periods, Phase-2 feature metrics, role-scoped tutor view | — |
| 24 | Admin Console & Settings | 🟡 Partially Implemented | 88% | 23 admin screens, platform settings, feature toggles, branding, integration module manager | No global audit-log viewer |
| — | **External Integrations** (cross-cutting) | 🟡 Partially Implemented | 70% | 6 adapter families, admin configuration UI, encrypted secrets, connection tests | **None verified against a live account** |
| — | **File Storage** (cross-cutting) | 🟡 Partially Implemented | 75% | S3-compatible adapter, local fallback (verified live), scoping, key hardening | External mode never successfully reached a bucket |

---

## 3. Detailed Module Audit

### 3.1 Authentication & Sessions

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 96%

#### Implemented
- Email/password registration with bcrypt (cost 12), role selection, terms acceptance and optional referral code attribution.
- Stateless sessions: signed JWT in an httpOnly cookie, carrying a `tokenVersion` compared against the user record on every request, so a password reset or forced logout invalidates every issued token at once.
- Email verification with single-use, hashed, 24-hour tokens; resend endpoint that cannot be used to enumerate accounts.
- Forgot/reset password with hashed, single-use, 1-hour tokens; the response is identical whether or not the account exists.
- Password change requiring the current password, bumping `tokenVersion`.
- Google/Apple OAuth with ID-token verification against the provider's JWKS and a single-use nonce held in an httpOnly cookie (CSRF/replay protection for a flow with no redirect to carry `state`).
- Account deletion that anonymises the user and preserves financial history, refusing while upcoming lessons exist.
- Rate limiting on login, registration and password reset.
- Suspended and deleted accounts are rejected at session resolution, not only at login.

#### Remaining
- OAuth has never been run against a live Google or Apple application; only the development provider has been exercised.

#### Verification / Evidence
- [src/services/auth.service.js](src/services/auth.service.js), [src/lib/auth/session.js](src/lib/auth/session.js), [src/lib/auth/current-user.js](src/lib/auth/current-user.js)
- Live: logged in as all four seeded roles (ADMIN, PARENT, TUTOR, STUDENT) — all HTTP 200.
- QA suite section "Email verification" — 10 assertions passing.

#### Risks / Notes
- OAuth account-linking rules are conservative and correct: linking by email requires a provider-verified address, one provider identity maps to one account, and OAuth never grants a role to an existing account.

---

### 3.2 RBAC & Permissions

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 98%

#### Implemented
- Four roles (PARENT, STUDENT, TUTOR, ADMIN) and 40 named permissions defined in one file.
- Every one of the 154 API routes declares its contract as options to a single `routeHandler` pipeline: database → authentication → role → permission → email verification → feature toggle → validation → service. I confirmed by inspection that **no route omits this**.
- Page-level guards (`enforceRole`/`enforceAuth`) redirect; API/service guards (`require*`) throw typed errors.
- Record-level ownership is asserted against the loaded database record, never a request field.
- `ADMIN_INTEGRATION_MANAGE` is deliberately held apart from `ADMIN_SETTINGS_MANAGE`, so editing footer copy and rotating a Stripe key are separable rights.

#### Remaining
- Roles and permissions are defined in code rather than being operator-editable. This matches the specification (§10) and is not a gap.

#### Verification / Evidence
- [src/constants/roles.js](src/constants/roles.js), [src/lib/api/handler.js](src/lib/api/handler.js), [src/lib/auth/assert.js](src/lib/auth/assert.js)
- **Live API enforcement:** parent → `/api/admin/users` = 403; tutor → `/api/admin/analytics` = 403; parent → `/api/admin/integrations` = 403; tutor → `/api/admin/payouts` = 403.
- **Live page enforcement:** a parent requesting `/admin/users` receives a Next.js streaming redirect and **zero data** (40 KB shell vs. the administrator's 172 KB page; zero user email addresses present). Note for the record: the HTTP status is 200 because Next.js issues the redirect inside the streamed response — this is framework behaviour, not a bypass.
- **Live record-level enforcement:** a non-participant student reading or posting to another pair's conversation = 403 on both.
- QA suite sections "Authorization" (8) and "Booking authorization" (30) — all passing.

---

### 3.3 Public Marketplace & SEO

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 96%

#### Implemented
- Homepage, `/find-a-tutor`, `/courses`, `/groups`, `/how-it-works`, `/pricing`, `/about`, `/faq`, `/safety`, `/support`, `/become-a-tutor`, `/verification`, `/legal/[slug]`.
- Province → grade → subject → course landing pages, and city-scoped tutor pages, for local SEO.
- `sitemap.xml` and `robots.txt` generated.
- Privacy on public surfaces: tutors are shown as first name plus last initial.

#### Remaining
- Nothing material.

#### Verification / Evidence
- **Live:** all 18 public routes returned HTTP 200 unauthenticated.
- Public search API returns `Priya S.`, `Rahul P.`, … confirming the name-masking rule is applied at the API, not only in the UI.

---

### 3.4 Tutor Search & Discovery

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 95%

#### Implemented
- `/api/search/tutors`, `/api/search/facets`, `/api/search/suggest`.
- Denormalised `courseCodes`/`subjectSlugs` on the tutor profile for single-query search; 2dsphere geo index; text index for course search.
- `isSearchable` is derived server-side from approval state and gates every public query.
- Promotion reorders results but never widens them: a promoted read applies the identical filter the visitor's search built, applies only to default relevance ordering, and labels every promoted result.

#### Verification / Evidence
- [src/lib/search/tutor-query.js](src/lib/search/tutor-query.js), [src/lib/search/promotion.js](src/lib/search/promotion.js)
- **Live:** a pending tutor was absent from search; after administrative approval the searchable total moved 12 → 13 immediately, confirming `isSearchable` is derived rather than set by a job.
- QA section "Tutor search eligibility" (9) and "Promoted profiles" (41) — all passing.

---

### 3.5 Curriculum Management

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 92%

#### Implemented
- Admin CRUD for provinces, grades, subjects and courses, behind `ADMIN_CURRICULUM_MANAGE`.
- Public read endpoints including a full curriculum tree.
- Admin curriculum manager UI with active/inactive ("coming soon") province handling.

#### Remaining
- **No automated test coverage.** Neither suite contains a curriculum section; this is the only substantial module with zero test assertions.
- Subjects, grades and provinces support create and update but **not delete** — deactivation is the only removal path. An erroneously created subject can be hidden but not removed. (Courses do support delete.)

#### Verification / Evidence
- **Live:** created a subject (201), it appeared in the public subject list, patched it to inactive (200), `DELETE` returned 405, and a tutor attempting to create one received 403.
- [src/services/curriculum.service.js](src/services/curriculum.service.js), [src/components/admin/CurriculumManager.jsx](src/components/admin/CurriculumManager.jsx)

---

### 3.6 Tutor Onboarding & Applications

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 95%

#### Implemented
- Eleven-step onboarding wizard (personal, profile, education, qualifications, courses, lesson type, location, pricing, availability, documents, review) with per-step draft persistence.
- Submission moves the application to `PENDING_REVIEW`.
- Admin review screen with approve, reject and request-more-information decisions, each notifying the applicant.
- Approval creates the tutor profile and makes it searchable.

#### Verification / Evidence
- **Live:** the seeded pending applicant showed `PENDING_REVIEW` with saved steps; approval via `POST /api/admin/applications/{id}` with `{"decision":"APPROVED"}` returned 200, the tutor profile became readable to that tutor, and the searchable tutor count increased.
- [src/services/tutor.service.js](src/services/tutor.service.js), [src/components/tutor/onboarding/](src/components/tutor/onboarding/)

---

### 3.7 Tutor Verification & Documents

**Status:** 🟡 Partially Implemented
**Estimated Completion:** 80%

#### Implemented
- Five verification types (identity, OCT, education, university student, background check).
- Multipart document upload, with the uploader's filename discarded and a generated UUID key used instead.
- Storage key is `select: false` on the model and is never returned to the uploader.
- Documents are served **only** through an admin-authorised, audited route — never as a direct URL.
- Badge issue on approval, and a nightly `verification-expiry` job that withdraws lapsed badges from public profiles.

#### Remaining
- Uploads currently **fail** in this environment because external object storage is misconfigured (see §8). This is a configuration issue; the code path is sound.

#### Verification / Evidence
- **Live, local-storage mode:** uploaded a PDF as a tutor → HTTP 201, file written to `.storage/documents/`, storage key absent from the response. An administrator retrieved it → HTTP 200, `application/pdf`, **byte-identical** to the original. The uploading tutor received 403 on the same admin route; an anonymous request received 401.
- **Live, external-storage mode:** the same upload returned `INTERNAL_ERROR` (HTTP 500).
- QA section "Verification documents (R33)" — 6 of 7 assertions pass; the failing one is the upload itself.

#### Risks / Notes
- The failing assertion is the only one in the entire suite that touches this module's write path, so the read, privacy and authorisation guarantees are all independently proven.

---

### 3.8 Tutor Profile & Availability

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 94%

#### Implemented
- Profile editor: bio, headline, languages, qualifications, per-course hourly-rate overrides, lesson modes, travel radius.
- Weekly availability with per-day windows, date exceptions, and a slot generator honouring lead time, increments and existing bookings.
- Public availability API returning bookable slots only.

#### Remaining
- `introVideoUrl` and `avatarUrl` are validated only as strings of at most 500 characters, with no URL-scheme check (see §11, issue 3).

#### Verification / Evidence
- **Live:** `GET /api/tutors/{id}/availability?days=21` returned 21 days of slots in `America/Toronto`; the first free slot was successfully booked.
- [src/services/availability.service.js](src/services/availability.service.js), [src/lib/booking/slots.js](src/lib/booking/slots.js)

---

### 3.9 Booking & Scheduling

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 96%

#### Implemented
- Quote, create (single and recurring series), cancel, reschedule, complete, no-show reporting, reminders.
- `PENDING_PAYMENT` holds the slot for a configurable window; `EXPIRED` does not. The `booking-expiry` job releases abandoned holds, claiming each booking atomically on its status first.
- Before any hold is released the provider is asked directly what happened to the payment, so a lost webhook cannot cause a paid lesson to be given away.
- Every cancellation path (student, tutor, admin, dispute) resolves through one policy module.
- Meeting links are provisioned at confirmation, per the platform the learner chose.

#### Remaining
- Concurrent-booking resolution uses a compare-after-write strategy (write, re-read for conflicts, the higher ObjectId withdraws) rather than a unique database index. This is correct and verified on a single instance but has a narrow theoretical window across multiple instances (see §10, Medium).

#### Verification / Evidence
- **Live end-to-end:** created a booking with `price.totalCents: 1` and `status: "CONFIRMED"` injected in the request body. The server **ignored both**, deriving $75.00 from the tutor's rate and setting `PENDING_PAYMENT`. This is the central "client supplies intent, never state" rule, proven at runtime.
- QA sections "Parent journey" (27), "Business rules" (9), "Booking concurrency" (4 — exactly one of five concurrent requests wins), "Abandoned checkout releases the slot" (34) — all passing.

---

### 3.10 Payments & Checkout

**Status:** 🟡 Partially Implemented
**Estimated Completion:** 85%

#### Implemented
- Complete lifecycle: payment record creation, checkout session, capture, confirmation, failure, expiry, reconciliation, receipt, refund.
- Stripe adapter using **hosted Checkout** — no card data ever touches the application or the browser bundle, keeping PCI scope minimal.
- Webhook handling outside the normal request pipeline, verifying a signature over the **raw** body, with a unique `(provider, eventId)` index as the idempotency lock. Failed events are retried on redelivery rather than dropped as duplicates.
- Only the webhook envelope is stored — no card details, no customer PII, no raw payloads.
- Refunds are capped by what was actually collected; a retried refund is idempotent via a key derived from the amount already returned.
- A reconciliation endpoint asks the provider directly when a webhook is missing.

#### Remaining
- **No live Stripe charge has ever been taken.** The test key in `.env.local` authenticates successfully (HTTP 200 against `GET /v1/account`, country CA), but the account reports **`charges_enabled: false`** — Stripe onboarding for the account is incomplete, so it cannot accept a payment. Note this corrects the repository's own documentation, which states the credentials are invalid; they are valid, the account is simply not enabled for charges.

#### Verification / Evidence
- **Live end-to-end on the development provider:**
  `create` → `PENDING_PAYMENT` → declined card (`4000…0002`) → `PAYMENT_FAILED` 422, booking still `PENDING_PAYMENT` → approved card (`4242…4242`) → payment `PAID`, booking `CONFIRMED`, Zoom meeting link provisioned, receipt retrievable. A **second capture on the same payment was a no-op**: status `PAID`, `refundedCents: 0`, total unchanged at 7500, no double charge.
- Integration suite sections "Payments — Stripe adapter", "Webhooks — signature, idempotency, amount checks", "Checkout return — reconciliation, ordering and idempotency" — all passing with HTTP stubbed.
- [src/services/payment.service.js](src/services/payment.service.js), [src/services/webhook.service.js](src/services/webhook.service.js), [src/app/api/webhooks/payments/route.js](src/app/api/webhooks/payments/route.js)

#### Risks / Notes
- The architecture is sound and thoroughly tested in isolation. The residual risk is entirely that no real money has moved. That risk cannot be retired by more code — only by enabling the Stripe account and running a live test transaction.

---

### 3.11 Payouts & Earnings

**Status:** 🟡 Partially Implemented
**Estimated Completion:** 85%

#### Implemented
- Stripe Connect Express onboarding with account links, using **separate charges and transfers** (the platform takes the full lesson total and transfers the tutor's share).
- Account state is never declared complete by the application — only the provider decides, and state is refreshed from the provider and from a dedicated Connect webhook endpoint with its own signing secret.
- A nightly `payouts` job creates payouts for tutors whose completed lessons have cleared the hold period, claiming bookings as it pays so a repeat run pays nobody twice.
- Transfers carry an idempotency key.
- Tutor earnings dashboard and admin payout queue.

#### Remaining
- Stripe Connect has never been exercised live. The seeded payout account reports `provider: "MOCK"`.

#### Verification / Evidence
- **Live:** tutor payout account, payout list and earnings summary all returned correct aggregated figures (lifetime gross $300.00, commission $45.00, net $255.00 across 4 lessons).
- QA: "the payout job runs and follows the existing eligibility rules", "running the payout job again pays nobody twice", "a tutor cannot run the payout job" — all passing.

---

### 3.12 Cancellation, Refund & No-show Policy

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 96%

#### Implemented
- One policy module owns cancellation windows, refund percentages, no-show outcomes and whether an unpaid booking gives its slot back.
- Refunds are subtracted pro rata per payment; commission is recalculated after a refund.
- Cancellation abuse assessment against configurable thresholds.
- All four actors (student, tutor, admin, dispute) route through the same rules.

#### Verification / Evidence
- [src/lib/booking/policy.js](src/lib/booking/policy.js), [src/lib/booking/pricing.js](src/lib/booking/pricing.js)
- QA: "refund matches the policy exactly", "no refused no-show issued a refund", "a second no-show report cannot refund the same lesson twice", "an expired booking can no longer be cancelled or refunded" — all passing.

---

### 3.13 Disputes

**Status:** 🟡 Partially Implemented
**Estimated Completion:** 80%

#### Implemented
- A learner or tutor can raise a dispute about a finished lesson.
- Admin queue, internal notes, and resolution with four outcomes (full refund, partial refund, no refund, rejected).
- Resolution issues the refund through the central payment service and returns the booking to a settled state.
- Both parties are notified. A dispute opens or joins a risk case against the account named.

#### Remaining
- **Confirmed defect:** there is no guard preventing a dispute that has already been resolved from being decided again. See §11, issue 1.

#### Verification / Evidence
- **Live, reproduced:** a dispute already in status `REJECTED` was re-submitted as `RESOLVED_REFUND` and the application **issued a full $45.00 refund on the second decision** (HTTP 200). A third attempt was correctly refused by the payment layer (`REFUND_EXCEEDS_BALANCE`, 422) — so money is protected. However, the dispute was then re-submitted as `RESOLVED_NO_REFUND` and accepted, leaving the stored record reading `status: RESOLVED_NO_REFUND, refundIssuedCents: 0` **while $45.00 had in fact been refunded**.
- [src/services/dispute.service.js:142](src/services/dispute.service.js#L142)

#### Risks / Notes
- Financial exposure is contained by the payment ledger. The damage is to the integrity of the dispute record and therefore to any reporting or audit built on it.

---

### 3.14 Messaging

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 92%

#### Implemented
- Conversations scoped to a booking or a tutor relationship, message send, read receipts, archiving, blocking.
- Free-text is passed through a sanitiser (control-character stripping, blank-line collapsing, length capping) as defence in depth.
- Administrative moderation operates on a **reported-conversation triage queue** that returns no message bodies; opening an individual thread is a separate, audited read.

#### Remaining
- Message attachments exist in the schema but are not implemented in the service, validation or UI. This is an explicit, documented Phase 2 deferral, not an oversight.

#### Verification / Evidence
- **Live:** parent listed 3 conversations, sent a message (201), the tutor read the thread and saw it as the latest of 7 messages, and marked it read (200). A non-participant student was refused both read (403) and write (403).
- [src/services/message.service.js](src/services/message.service.js)

---

### 3.15 Reviews & Moderation

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 94%

#### Implemented
- Review creation gated on a completed lesson, with multi-dimensional ratings (knowledge, communication, reliability, teaching) plus an overall score.
- Tutor reply, public review listing, reporting, and an admin moderation queue with hide/restore.
- Tutor aggregate ratings recalculated on change.

#### Verification / Evidence
- **Live:** public review API returned real seeded reviews with all rating dimensions.
- QA section "Review moderation" (9) plus review assertions throughout the parent journey — all passing.

---

### 3.16 Tutor Requests & Matching

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 95%

#### Implemented
- Request creation, editing, closing, cancellation; an open request board for tutors; expression of interest; direct invitation.
- A weighted matching engine with operator-tunable weights and an eligibility filter, re-run when a request is edited.
- A `request-expiry` job that warns before expiry and closes afterwards, stamping each warning so repeat runs never send a second.
- Admin moderation of requests.

#### Verification / Evidence
- QA section "Tutor requests — edit, invite, respond, moderate" — 34 assertions passing, including "a tutor cannot edit a family's request" and "editing re-runs matching".
- Integration section "Matching — scoring, weights and eligibility" — passing.

---

### 3.17 Progress Reports

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 94%

#### Implemented
- Tutor authoring with revision history, family acknowledgement, and admin visibility.
- Separate write and view permissions: families read, only the authoring tutor may change.
- Privacy scoping so a tutor sees only their own students' reports.

#### Verification / Evidence
- QA section "Progress reports — authorship, privacy and acknowledgement" — 24 assertions passing.
- Integration section "Progress reports — authorship, privacy and revision history" — passing.

---

### 3.18 Packages

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 94%

#### Implemented
- Tutors publish and archive lesson packages; pricing validated against the standard hourly rate.
- Purchase creates a balance; bookings consume sessions from it; unused value is computed centrally.
- A `package-expiry` job refunds undelivered lessons and warns before expiry, claiming each purchase on its `ACTIVE` status first so a repeat run refunds nothing twice.
- Package purchases activate through the same payment-settlement funnel as lessons, so there is no second call site that could forget.

#### Verification / Evidence
- QA section "Packages — pricing rules, ownership and balance" — 22 assertions passing.
- Integration section "Packages — pricing, consumption, cancellation and expiry" — passing.

---

### 3.19 Group Sessions

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 94%

#### Implemented
- Tutors publish group sessions with capacity, minimum enrolment and a confirmation deadline.
- Learner enrolment, capacity enforcement, attendance recording, group meeting rooms.
- A `group-settlement` job confirms sessions that filled and cancels-and-fully-refunds those that did not, claiming each on its `PUBLISHED` status first.
- A cancelled session releases its meeting room.

#### Verification / Evidence
- **Live:** admin group list returned 20 seeded sessions.
- QA section "Group sessions — capacity, privacy and authorization" — 35 assertions passing.

---

### 3.20 Referrals & Credits

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 94%

#### Implemented
- Referral code issue and lookup; attribution at registration that is a quiet no-op on an unknown code, a self-referral or an already-introduced account — creating an account never fails because a code was wrong.
- Qualification on a first completed lesson, credit ledger entries, and administrator credit adjustment.
- Abuse guards (self-referral, same-IP, duplicate email).
- Credit is unwound when the qualifying lesson is refunded, so a refund cannot be used to keep both the money and the credit. Referral credit is accounted as a platform cost, not a discount.

#### Verification / Evidence
- QA section "Referrals — codes, credit and abuse prevention" — 25 assertions passing.

---

### 3.21 Promoted Profiles

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 95%

#### Implemented
- Administrator creates, pauses, extends and cancels promotion windows.
- Discovery derives whether a promotion is live **from the clock on every request**, so no read path depends on a job having run; the `promotion-expiry` job only settles the stored record.
- Promotion reorders default-relevance results only; an explicit sort is treated as the visitor's instruction. Every promoted result is labelled. Neither behaviour is configurable, by design.
- Pagination arithmetic accounts for promoted slots so nothing is skipped or repeated across pages.

#### Verification / Evidence
- QA section "Promoted profiles — authorization, ranking and lifecycle" — 41 assertions passing.
- Integration section "Promoted profiles — eligibility, ranking, pagination and expiry" — passing.

---

### 3.22 Risk & Fraud Tools

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 94%

#### Implemented
- All fraud logic lives in one service. Every signal carries a deduplication key derived from the event, so replays record once.
- Every call site records signals through a safe wrapper, so detection can never break the action being taken.
- Cases accumulate signals rather than forking; a resolved case cannot be reopened; evidence is retained rather than cleared.
- **Risk detects but never punishes** — no score restricts an account; only an administrator does, from user management.
- Configurable thresholds, with a guard refusing a high-risk threshold below the review threshold.

#### Verification / Evidence
- QA section "Risk — authorization, detection E2E and evidence" — 30 assertions passing.
- [src/services/risk.service.js](src/services/risk.service.js)

---

### 3.23 Analytics

**Status:** 🟢 Fully Implemented
**Estimated Completion:** 94%

#### Implemented
- Aggregated in MongoDB. **Revenue comes from the `Payment` collection on `paidAt`**, never from summing booking prices — which would count abandoned checkouts as revenue.
- Refunds subtracted pro rata per payment; referral credit treated as a platform cost.
- Half-open, time-zone-aware periods.
- Supply, demand, commerce, breakdowns (subjects, courses, cities, lesson modes, daily series) and a leaderboard.
- Dedicated Phase 2 metrics: request match rate, matching conversion, package utilisation, group fill rate, referral conversion, promotions.
- A separate, role-scoped tutor analytics view.

#### Verification / Evidence
- **Live:** `days=30` and `days=90` both returned coherent figures (gross $3,420.00, refunded $257.00, net collected $3,163.00, platform revenue $474.47, 97% completion rate). `days=9999` correctly rejected with 422.
- QA section "Analytics — scoping, periods and authorization" — 23 assertions passing.

---

### 3.24 Admin Console & Settings

**Status:** 🟡 Partially Implemented
**Estimated Completion:** 88%

#### Implemented
- 23 administrative screens: dashboard, users, tutors, applications, verification, bookings, payments, payouts, disputes, reviews, moderation, curriculum, settings, integrations, analytics, requests, groups, packages, progress, promotions, referrals, risk, SMS.
- Platform settings: branding, theme, SEO, contact, social, footer, feature toggles, notification categories, commission, cancellation windows, checkout hold, matching weights, risk thresholds.
- Feature toggles have runtime teeth — the API guard, the page and the navigation all read the same switch.
- Branding asset upload with real image inspection (dimensions read from the bytes) and serving through a controlled route.
- User management including suspension, credit adjustment and per-user audit history.

#### Remaining
- **No global audit-log viewer.** Audit events are written for registration, login, refunds, settings changes, verification decisions, scheduled job runs, integration changes, promotions, packages, referrals and risk decisions — but the only place an operator can read them is a single user's detail page, filtered to `entityType: "User"`. There is no screen or API to browse by action or across entity types. Against the specification's "audit logging" requirement, the write side is complete and the read side is not.

#### Verification / Evidence
- **Live:** all 23 admin pages returned HTTP 200 for an administrator; all 18 admin list APIs returned real aggregated data.
- Audit write path: [src/services/audit.service.js](src/services/audit.service.js). Only consumer: [src/app/admin/users/[id]/page.js:26](src/app/admin/users/[id]/page.js#L26) — confirmed by a repository-wide search for `listAuditLogs`.
- QA section "Platform settings" — 50 assertions passing.

---

## 4. Authentication & Authorization Audit

| Feature | Status | Completion | Notes |
|---|---|---:|---|
| Registration | 🟢 Fully Implemented | 98% | bcrypt cost 12, role selection, referral attribution, rate-limited, verified live |
| Login | 🟢 Fully Implemented | 98% | Identical error for unknown email and wrong password; suspended accounts refused; verified live for all 4 roles |
| Logout | 🟢 Fully Implemented | 100% | Destroys the session cookie |
| Session | 🟢 Fully Implemented | 97% | Signed JWT, httpOnly, `tokenVersion` checked per request, suspended/deleted users rejected at resolution |
| Password Change | 🟢 Fully Implemented | 98% | Requires current password; bumps `tokenVersion`, invalidating all sessions |
| Forgot Password | 🟢 Fully Implemented | 97% | Hashed single-use token, 1-hour TTL, response cannot enumerate accounts |
| Reset Password | 🟢 Fully Implemented | 98% | Consumes the token, invalidates prior sessions, notifies the user |
| Email Verification | 🟢 Fully Implemented | 97% | 24-hour hashed token; gates money, messaging and public actions — not sign-in |
| OAuth / Google Sign-In | 🟡 Partially Implemented | 75% | JWKS verification, nonce replay protection, conservative linking rules — but **never run against a live provider** |
| RBAC | 🟢 Fully Implemented | 98% | Enforced in one pipeline on all 154 endpoints; verified live at the API and page layers |
| Permissions | 🟢 Fully Implemented | 98% | 40 permissions, server-side only; frontend guards are UX |

---

## 5. Admin Audit

| Area | Status | Notes |
|---|---|---|
| Dashboard | 🟢 Complete | Live metrics, queues and recent activity |
| User management | 🟢 Complete | List, detail, suspend, credit adjustment, per-user audit trail |
| Roles | 🟢 Complete (by design) | Code-defined and enforced server-side; the specification does not require operator-editable roles |
| Permissions | 🟢 Complete (by design) | As above; `ADMIN_INTEGRATION_MANAGE` deliberately separated from `ADMIN_SETTINGS_MANAGE` |
| Application settings | 🟢 Complete | Branding, theme, SEO, contact, footer, commission, policy windows, matching weights, risk thresholds |
| System configuration | 🟢 Complete | Five integration modules configurable at `/admin/settings/integrations`, driven by one registry |
| Audit / logs | 🔴 **Gap** | Events are written comprehensively but there is **no global audit-log viewer**; only per-user history exists |
| Administrative workflows | 🟢 Complete | Application review, verification decisions, dispute resolution, review moderation, conversation moderation, refunds, payouts, promotions, risk cases |

**The one clearly missing administrative capability is a global audit log browser.**

---

## 6. Payment & Financial Flow Audit

`Checkout → Payment → Webhook → Confirmation → Business Record → Final State`

| Stage | Status | Evidence |
|---|---|---|
| **Quote** | 🟢 Fully Implemented | Live: server returned $75.00 / 15% commission / $63.75 tutor earnings from the tutor's rate |
| **Booking creation (intent)** | 🟢 Fully Implemented | Live: injected `price` and `status` both ignored; server derived both |
| **Hold** | 🟢 Fully Implemented | `PENDING_PAYMENT` blocks the calendar for the configured window; `EXPIRED` does not |
| **Checkout session** | 🟢 Fully Implemented (dev) / 🟡 Unverified (live) | Stripe hosted Checkout implemented; no live session ever opened |
| **Payment — success** | 🟢 Fully Implemented (dev) | Live: capture → `PAID`, booking `CONFIRMED`, meeting link created |
| **Payment — failure** | 🟢 Fully Implemented (dev) | Live: declined card → `PAYMENT_FAILED` 422; booking correctly left `PENDING_PAYMENT` |
| **Payment — pending/async** | 🟢 Fully Implemented | A payment settling after the sweep can revive its booking, but only if the slot is still free |
| **Payment — timeout / abandoned** | 🟢 Fully Implemented | `booking-expiry` job releases the hold, but only after asking the provider directly what happened |
| **Webhook — signature** | 🟢 Fully Implemented | Verified over the raw body; unsigned requests rejected with 400; separate Connect secret |
| **Webhook — idempotency** | 🟢 Fully Implemented | Unique `(provider, eventId)` index; duplicates acknowledged without re-processing; `FAILED` events retried on redelivery |
| **Reconciliation** | 🟢 Fully Implemented | Dedicated endpoint asks the provider directly when a webhook is lost; authorisation verified (a stranger and an unrelated tutor are both refused) |
| **Booking state sync** | 🟢 Fully Implemented | Confirmation, package activation and meeting provisioning all run through one funnel |
| **Payment state sync** | 🟢 Fully Implemented | `PAID` / `PARTIALLY_REFUNDED` / `REFUNDED` / `FAILED` / `EXPIRED` transitions centralised |
| **Refund** | 🟢 Fully Implemented | Capped by amount collected; idempotency key derived from amount already refunded; referral credit unwound; live-verified that a second full refund is refused |
| **Receipt** | 🟢 Fully Implemented | Live: retrievable by the purchaser |
| **Payout** | 🟡 Partially Implemented | Connect Express + transfers built and job-tested; never run live |
| **Retry / error handling** | 🟢 Fully Implemented | Non-2xx returned to the provider asks for redelivery; typed errors mapped to correct statuses |

**Summary:** the financial architecture is complete, correct and defensively written. Its single unresolved risk is that it has never processed a real transaction.

---

## 7. External Integration Audit

| Integration | Purpose | Status | Configuration | Error Handling | Testing |
|---|---|---|---|---|---|
| **Stripe (payments)** | Hosted Checkout, refunds | 🟡 Partial — built, not live | Admin-configurable; key authenticates but account has `charges_enabled: false` | Typed errors; unreachable vs. bad-credential distinguished; key never echoed | Adapter tests pass (HTTP stubbed); **no live charge** |
| **Stripe Connect (payouts)** | Tutor transfers | 🟡 Partial — built, not live | Separate Connect webhook secret | Provider is the sole authority on account readiness | Job-level tests pass; **never run live** |
| **Resend / SMTP (email)** | Transactional mail | 🟡 Partial — built, not live | Admin-configurable; no credentials present | Best-effort delivery; a bounce never undoes the action it announced | Adapter + 13 branded templates tested; **never sent live** |
| **Twilio (SMS)** | Lesson notifications | 🟡 Partial — built, not live | Admin-configurable; no credentials | Consent, opt-out (STOP/START), idempotency, callback signature verification | Adapter and consent rules tested; **never sent live** |
| **Google Calendar** | Busy-period sync, lesson events | 🟡 Partial — built, not live | Admin-configurable OAuth app; no credentials | Per-connection isolation — one failing account never stops the rest | Adapter tested against Calendar v3 shapes; **never connected live** |
| **Microsoft / Outlook Calendar** | Same | 🟡 Partial — built, not live | Admin-configurable Entra app registration | Expired vs. wrong secret distinguished | Graph adapter tested; **never connected live** |
| **Zoom** | Meeting links | 🟡 Partial — built, not live | Server-to-Server OAuth; waiting room on, join-before-host off, recording off | Falls back to a tutor-supplied room, labelled as such | Adapter tested; **never created a live meeting** |
| **Google Meet** | Meeting links | 🟡 Partial — built, not live | Service-account JWT via Calendar conferencing | As above | Adapter tested |
| **Microsoft Teams** | Meeting links | 🟡 Partial — built, not live | Graph client credentials, lobby bypassed for the two participants | As above | Adapter tested |
| **Google Geocoding** | Address → coordinates | 🟡 Partial — built, not live | Country-filtered to Canada, 4s timeout | Falls back to a bundled Canadian table | Adapter and fallback tested |
| **Google / Apple OAuth** | Sign-in | 🟡 Partial — built, not live | JWKS verification, single-use nonce | Conservative account-linking rules | ID-token verification tested; **never run live** |
| **MinIO / S3 (storage)** | Private file storage | 🟡 Partial — built, external mode broken here | Endpoint, bucket, keys, region, prefix, path-style all configurable | Bad credentials reported as such, not as a missing file; timeouts tagged | 60+ adapter assertions pass; **live round trip fails** |

**Cross-cutting strengths worth recording:**
- Configuration resolves through one merge chain — built-in defaults → environment variables → stored admin configuration — merged **per field**, so a deployment that never opens the admin panel behaves exactly as before.
- Credentials live in their own collection, AES-256-GCM encrypted and `select: false` — never in the settings document that reaches client components.
- **Secrets are write-only.** No endpoint returns one; omitting a secret on update keeps what is stored; only the Stripe secret key reveals a last-4.
- Production refuses to select a fake provider for payments, email or storage, and no stored row can override that.
- A credential that will not decrypt is an explicit error state, never a silent fallback to the environment.
- `enabled` has real runtime teeth: payments refuse checkout, email/SMS record a skip, calendar sync no-ops, storage refuses uploads **but still serves reads** — because breaking retrieval of identity documents would be an incident, not a setting.

---

## 8. File Storage Audit

This module was audited in particular depth at the request of the brief.

### Configuration surface — complete

All the fields asked about are present, in both environment variables and the admin UI, driven from one registry:

| Field | Environment variable | Admin UI | Required |
|---|---|---|---|
| Endpoint | `STORAGE_ENDPOINT` | ✅ | Yes |
| Bucket | `STORAGE_BUCKET` | ✅ | Yes |
| Access key | `STORAGE_ACCESS_KEY` | ✅ | Yes |
| Secret key | `STORAGE_SECRET_KEY` | ✅ (write-only) | Yes |
| Region | `STORAGE_REGION` | ✅ | No (defaults `us-east-1`) |
| Key prefix | `STORAGE_PREFIX` | ✅ | No |
| Path-style addressing | `STORAGE_FORCE_PATH_STYLE` | ✅ | No (defaults on) |
| Local directory | `STORAGE_LOCAL_DIR` | — | No |
| Refuse local fallback | `STORAGE_REQUIRE_EXTERNAL` | — | No |
| Per-object encryption | `STORAGE_SSE` | — | No |
| Request timeout | `STORAGE_TIMEOUT_MS` | — | No (defaults 20 s) |

### Operations

| Operation | Local mode | External mode |
|---|---|---|
| Upload | 🟢 **Verified live** | 🔴 Fails in this environment |
| Download / access | 🟢 **Verified live, byte-identical** | ⚪ Never reached |
| Delete | 🟢 Implemented and tested | ⚪ Never reached |
| Metadata (HEAD) | 🟢 Tested | ⚪ Never reached |
| Replace | 🟢 **Verified live** (new key issued, old bytes replaced) | ⚪ Never reached |
| Configuration validation | 🟢 Implemented | 🟢 Implemented (`storage:check` reports precisely) |

### Local fallback — verified working

The fallback is **not** theoretical. I ran the application with external storage unconfigured and exercised the real paths:

- Tutor uploaded a PDF → HTTP 201; file written to `.storage/documents/6201075d-….pdf`; the storage key was **not** returned to the uploader.
- Administrator retrieved it → HTTP 200, `application/pdf`, **byte-identical** to the original.
- The uploading tutor was refused on the admin route (403); an anonymous request was refused (401).
- Administrator uploaded a 120×60 PNG logo → HTTP 200; the service read the **real dimensions from the bytes** (120×60 recorded); an 8×8 image was correctly rejected with "Logo must be at least 48×24 pixels"; a tutor attempting the same upload received 403.
- The logo served at `/api/branding/logo` → HTTP 200, `image/png`, `X-Content-Type-Options: nosniff`, **byte-identical**.

### Behaviour when configuration is incomplete

The selection rule is written once and is correct: external storage is used only when endpoint, bucket, access key **and** secret key are all present; anything missing selects the local filesystem and names the missing variable in the diagnostic. `STORAGE_REQUIRE_EXTERNAL=true` converts the fallback into a hard boot failure for deployments with an ephemeral filesystem. Local mode logs a warning on selection, loudly in production.

**However — and this is the current blocker —** the rule tests for *presence*, not *validity*. In this environment `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` and `STORAGE_BUCKET` are the literal three-character string `...`. Those are present, so external mode is selected, and every upload then fails with HTTP 500. This is the correct design choice (a silent fallback after an operator has configured a bucket would be worse), but it means the deployment is currently in a broken state rather than a degraded one.

Running the project's own diagnostic confirms this precisely:

```
$ bun run storage:check
  endpoint   https://wfss001.freeli.io
  bucket     ...
✗ Object storage refused the request: the credentials are wrong or lack
  permission on this bucket.
```

I independently confirmed the endpoint host is reachable (HTTP 404 on its root, 4.2 s), so the problem is authentication, not connectivity.

### Security

| Control | Status |
|---|---|
| Nothing written inside `public/` | 🟢 Enforced — a writable directory in the web root is how uploads become remote code execution |
| Generated keys, uploader filename discarded | 🟢 Verified |
| Key shape validated (`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`), traversal flattened then rejected | 🟢 Verified |
| Scoped directories (`documents`, `branding`) — a documents key cannot be read through the branding scope | 🟢 Tested |
| No URL ever returned — bytes streamed through an authorised route | 🟢 Verified |
| Storage key `select: false` on the model | 🟢 For verification documents |
| No ACL set — objects inherit the bucket's private default | 🟢 Tested |
| Requests signed with SigV4; no credentials in URLs | 🟢 Tested against AWS's published signature |
| Credentials encrypted at rest, write-only through the API | 🟢 Tested |
| Error messages name no bucket internals; credentials redacted from logs | 🟢 Tested |

### Remaining gaps

1. Provide real credentials and confirm the live round trip — this alone clears all 10 failing tests.
2. Consider treating obviously-placeholder values as unset, or surfacing the failure at boot rather than at first upload.
3. Branding file records leak internal identifiers to public pages (see §11, issue 2).

---

## 9. Testing & Quality Audit

All commands below were executed during this audit. The results are recorded verbatim.

| Area | Command | Result | Notes |
|---|---|---|---|
| **Unit Tests** | — | ⚪ None exist | There is no unit-test runner. The project deliberately uses two bespoke suites instead. |
| **Integration Tests** | `bun run test:integrations` | 🟡 **1,167 passed, 1 failed** | 31 sections covering every provider adapter plus DB-backed service rules, with `fetch` stubbed so no third party is contacted. The single failure is the live MinIO round trip. |
| **E2E / API Tests** | `bun run qa` | 🟡 **745 passed, 9 failed** | 30 sections driving the real HTTP API against a running server, asserting both success paths and the authorisation checks that must fail. **All 9 failures are storage uploads.** |
| **Lint** | `bun run lint` | 🟢 **Clean** | ESLint with `eslint-config-next` core-web-vitals plus React Compiler rules; zero warnings. |
| **Type Check** | — | ⚪ Not applicable | The project is JavaScript-only by specification (§3). Zero `.ts`/`.tsx` files. |
| **Production Build** | `bun run build` | 🟢 **Clean** | 96 routes compiled, no errors or warnings. |

### Failure analysis

**All 10 failures across both suites share one root cause: invalid object-storage credentials.**

```
✗ the bucket is reachable with the configured credentials
✗ a tutor can upload a verification document
✗ a valid logo uploads  /  records its real dimensions  /  is served publicly
✗ the logo is served as an image and not sniffed
✗ the bytes served are the bytes that were stored
✗ a logo can be replaced  /  gets its own storage key  /  the replacement is served
```

These are **known baseline failures, not newly introduced ones** — the repository's own coverage matrix records the same count from a previous run. I confirmed the cause directly rather than accepting the documentation's explanation, and I proved the underlying code is correct by running the identical operations successfully in local-filesystem mode.

### Coverage gaps

| Area | Assertions | Assessment |
|---|---:|---|
| External modules | 112 | Very strong |
| Meeting management | 100 | Very strong |
| Platform settings | 50 | Strong |
| Promoted profiles | 41 | Strong |
| Group sessions | 35 | Strong |
| Tutor requests | 34 | Strong |
| Abandoned checkout | 34 | Strong |
| Booking authorization | 30 | Strong |
| Risk | 30 | Strong |
| Parent journey | 27 | Adequate |
| Referrals / Progress / Analytics / Calendar | 23–25 each | Adequate |
| Packages | 22 | Adequate |
| Conversation moderation | 16 | Adequate |
| **Admin journey** | 9 | **Thin** |
| **Tutor journey** | 9 | **Thin** |
| **Business rules** | 9 | **Thin** |
| **Validation** | 4 | **Thin** |
| **Curriculum management** | **0** | **No coverage** |
| **Disputes (resolution)** | ~4 | **Thin — and this is where the confirmed defect lives** |
| **Notifications, favourites, payout account setup** | 2–4 each | Thin |

### Documentation accuracy

The brief asked me not to trust existing documentation. Checking it against reality:

| Documentation claim | Reality |
|---|---|
| `docs/REQUIREMENTS.md`: "982 passed, 1 failed" (integrations) | Now **1,167 passed, 1 failed** — stale but directionally honest |
| `docs/REQUIREMENTS.md`: "637 passed, 9 failed" (QA) | Now **745 passed, 9 failed** — stale but directionally honest |
| `docs/REQUIREMENTS.md`: "103 route handlers" | Actually **154** — stale |
| `docs/REQUIREMENTS.md` line 505: "Calendar — `CalendarProvider` interface declared — Phase 2" | **Contradicts the same document's own Phase 2 table** and is wrong: Google Calendar v3 and Microsoft Graph adapters are fully built, with a sync job and UI |
| `CLAUDE.md`: "the repository's Stripe test credentials are not valid" | **Incorrect.** The key authenticates (HTTP 200); the account simply has `charges_enabled: false` |
| `docs/REQUIREMENTS.md`: storage endpoint "answers with 403 InvalidAccessKeyId" | Now times out on HEAD within 20 s, though the host answers on its root — worth re-checking |
| `docs/REQUIREMENTS.md`: "All twelve Phase 2 features are built" | **Confirmed accurate** — I verified each one has model, service, API, UI, permissions and tests |
| `docs/REQUIREMENTS.md`: message attachments deferred | **Confirmed accurate** — schema only, no service, validation or UI |

### Code quality signals

- **Zero `TODO` or `FIXME` comments** in the entire source tree.
- The only "not implemented" strings are abstract base-class methods in the provider interfaces — the intended pattern.
- No fake or dead UI: the only "coming soon" labels are (a) app-store badges, (b) inactive provinces, which is a real curriculum state, and (c) push notifications, which the specification places in Phase 3 (requires a mobile app).
- Loading, empty and error states are a shared primitive used across 66 files; root-level `loading.js`, `error.js` and per-segment `not-found.js` exist.
- Security headers present on every response: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`.

---

## 10. Critical / High-Priority Remaining Work

### Critical — blocks core functionality, security, data integrity or production readiness

1. **Provision working object-storage credentials.** `STORAGE_ACCESS_KEY`, `STORAGE_SECRET_KEY` and `STORAGE_BUCKET` are placeholder text. Verification-document and branding uploads fail outright. This single change clears all 10 failing tests. *(Configuration, not code.)*
2. **Enable charges on the Stripe account and run a live test transaction.** The account currently reports `charges_enabled: false`. Until a real payment is taken, refunded and reconciled against a real webhook, the revenue path is unproven.
3. **Fix dispute re-resolution** (§11, issue 1). A closed dispute can be re-decided, leaving the record contradicting the payment ledger.

### High — important incomplete functionality

4. **Provision and verify the remaining providers:** email (Resend or SMTP), meeting links (at least one of Zoom / Meet / Teams), and OAuth sign-in. Each is built and adapter-tested but has never contacted the real service.
5. **Build a global audit-log viewer.** Audit events are written comprehensively and read almost nowhere.
6. **Stop publishing branding file records on public pages** (§11, issue 2).
7. **Add automated coverage for curriculum management** — currently the only substantial module with zero test assertions.
8. **Add dispute-lifecycle test coverage** — the confirmed defect exists precisely where coverage is thinnest.

### Medium — important but non-blocking

9. **Replace the in-memory rate limiter** with a shared store (Redis) before running more than one instance. The call signature was deliberately designed not to change.
10. **Review concurrent-booking resolution for multi-instance deployment.** The current compare-after-write strategy is verified correct on one server; a unique database index on tutor + start time would make it unconditional.
11. **Add Content-Security-Policy and Strict-Transport-Security headers.**
12. **Validate URL schemes** on `introVideoUrl` and `avatarUrl` (§11, issue 3).
13. **Restore `import "server-only"`** to `src/lib/db/connect.js` and `src/lib/auth/tokens.js`, which the project's own convention requires.
14. **Treat obviously-placeholder configuration values as unset**, or fail at boot rather than at first upload.
15. **Thicken the admin-journey, tutor-journey and validation test sections.**

### Low / Future — optional

16. Extract `passwordIssues` from `src/lib/auth/password.js` so the bcrypt-carrying module is not imported by client components.
17. Add per-route `loading.js` files for finer-grained streaming.
18. Correct the stale figures and the self-contradictory calendar row in `docs/REQUIREMENTS.md`.
19. Message attachments (explicitly deferred Phase 2 backlog).
20. Add a hard-delete path for curriculum subjects, grades and provinces.
21. Monitoring and alerting integration (currently `console.error` only).

---

## 11. Known Bugs / Issues

These are **confirmed by reproduction against the running application**, not inferred from reading code. Speculative concerns are listed separately in §10 as hardening items.

| # | Issue | Severity | Affected Module | Evidence | Status |
|---|---|---|---|---|---|
| 1 | **A resolved dispute can be re-decided, leaving the dispute record contradicting the payment ledger.** `resolveDispute` has no terminal-state guard, unlike the equivalent risk-case logic. | **High** | Disputes / Payments | Reproduced live: a dispute in status `REJECTED` was re-submitted as `RESOLVED_REFUND` and a full **$45.00 refund was issued on the second decision** (HTTP 200). It was then re-submitted as `RESOLVED_NO_REFUND` and accepted, so the stored record now reads `refundIssuedCents: 0` while the money had already gone out. A third full-refund attempt *was* correctly refused by the payment layer (`REFUND_EXCEEDS_BALANCE`, 422), so cash exposure is contained. [src/services/dispute.service.js:142](src/services/dispute.service.js#L142) | Open |
| 2 | **Internal storage identifiers and an administrator's user ID are published in the HTML of every public page.** `resolveAppConfig` attaches a `files` object — documented as "for the admin panel's preview" — containing each branding asset's raw `storageKey`, `fileName`, `sizeBytes` and `uploadedBy`. It is passed to `SiteHeader`, a client component, so it is serialised into the payload of every page including unauthenticated ones. | **Medium** | Admin settings / Branding | Reproduced live: `curl http://localhost:3000/` returns `"files":{"logo":{"storageKey":"6a995eb9-…png",…,"uploadedBy":"6ab1372b998f04ad610cadc0"}}`. Not directly exploitable — branding assets are only addressable through `/api/branding/[asset]`, which resolves the key from settings — but it discloses internal identifiers and an admin user ID, contrary to the project's own stated rule. [src/services/settings.service.js:151](src/services/settings.service.js#L151) | Open |
| 3 | **`introVideoUrl` and `avatarUrl` accept any string, including `javascript:` URLs, and the intro video is rendered into an `href` on the admin application-review screen.** | **Low** | Tutor profile / Admin | Reproduced live: a tutor stored `javascript:alert(document.domain)` (HTTP 200) and it was served by the public tutor API. **However, this is not exploitable:** React blocks it, rendering `href="javascript:throw new Error('React has blocked a javascript: URL as a security precaution.')"`. The gap is the missing server-side scheme validation, which currently relies entirely on a framework protection. [src/lib/validation/tutors.js:181](src/lib/validation/tutors.js#L181) | Open (mitigated) |
| 4 | **Object-storage uploads fail with HTTP 500 in the current environment.** | **Critical (environment)** | File storage | `bun run storage:check` → "Object storage refused the request: the credentials are wrong or lack permission on this bucket." Credentials are the literal string `...`. Not a code defect — the same operations succeed in local mode. | Open (configuration) |
| 5 | **`src/lib/db/connect.js` and `src/lib/auth/tokens.js` are missing `import "server-only"`,** which the project's own architecture rules require for everything under `lib/db` and `lib/auth`. | **Low** | Architecture | Confirmed by inspection. No current leak — no client component imports either — but the safety net is absent. (`assert.js` is intentionally pure and documented as such; `password.js` is imported by client forms for its password-policy helper, which is a separate design question.) | Open |

**No speculative bugs are listed above.** Items I investigated and found *not* to be defects — page-level RBAC returning HTTP 200 (a Next.js streaming redirect with zero data), the empty admin conversation queue (a reported-conversation queue, correctly empty), and the `javascript:` URL being executable (React blocks it) — are recorded here so they are not re-investigated later.

---

## 12. Production Readiness Checklist

- [x] **Core functionality** — all 24 modules built and wired end to end
- [x] **Authentication** — registration, login, sessions, verification, password reset, deletion, all verified live
- [x] **Authorization** — RBAC enforced server-side on all 154 endpoints and every page; verified live at both layers
- [x] **Data integrity** — server-derived pricing and status, ownership checked against loaded records, atomic job claims, idempotent webhooks
- [ ] **Payments** — architecture complete; **no live transaction has ever been processed** (`charges_enabled: false`)
- [x] **Webhooks** — signature verification over the raw body, unique-index idempotency, retry semantics, separate Connect endpoint
- [ ] **File storage** — code complete and local mode verified live; **external mode fails with the current credentials**
- [ ] **External integrations** — all six adapter families built and unit-tested; **none verified against a live account**
- [x] **Error handling** — one typed error hierarchy, one envelope, Mongo errors mapped, no raw driver errors reach clients
- [ ] **Security** — strong fundamentals (bcrypt 12, httpOnly JWT with revocation, AES-256-GCM secrets, write-only credentials, private document serving, rate limiting, sanitisation, security headers). **Missing CSP and HSTS; one confirmed information disclosure (§11, issue 2).**
- [ ] **Tests** — 1,912 assertions passing across two suites; **10 failing (all storage)**; no unit-test runner; curriculum has zero coverage
- [x] **Build** — `bun run build` clean, 96 routes
- [x] **Configuration** — layered defaults → environment → admin, merged per field; production refuses fake providers; `.env.example` is thorough and well documented
- [ ] **Logging / monitoring** — audit events written comprehensively but **readable almost nowhere**; application logging is `console.*` only; no monitoring integration
- [ ] **Deployment readiness** — `vercel.json` correctly declares all 9 cron jobs matching the registry; **blocked on credentials and the single-instance assumptions in the rate limiter and booking-race resolution**

**Score: 8 of 15 fully met.** Every unmet item is either a credential/configuration task or a well-defined hardening task — none requires new feature development.

---

## 13. Final Remaining Work Plan

### Phase 1 — Critical Completion

*Unblocks verification of the whole platform. Almost entirely configuration.*

1. Provision valid object-storage credentials; run `bun run storage:check` until it passes; re-run both suites and confirm 0 failures.
2. Complete Stripe account onboarding so `charges_enabled` becomes true. Then run a live test charge, a live refund, and a live webhook delivery via `stripe listen`; confirm booking and payment state both settle correctly.
3. Fix dispute re-resolution: refuse a decision on a dispute already in a terminal state, and add the regression test.

### Phase 2 — High Priority

*Completes the integration story and closes the reporting gap.*

4. Provision and live-verify email, one meeting-link provider, and Google/Apple OAuth. Record the `CONNECTED` result for each from the admin integrations screen.
5. Live-verify Stripe Connect onboarding and a transfer to a test connected account.
6. Build a global audit-log viewer (filter by action, actor, entity type and date) behind an admin permission.
7. Remove the branding `files` record from the public app config; serve it only to the admin settings screen.
8. Add automated coverage for curriculum management and the dispute lifecycle.

### Phase 3 — Production Hardening

*Required before scaling beyond one instance or handling real customer data at volume.*

9. Replace the in-memory rate limiter with Redis.
10. Add a unique database index on tutor + start time to make booking-race resolution unconditional, or document single-instance deployment as a constraint.
11. Add Content-Security-Policy and Strict-Transport-Security headers.
12. Validate URL schemes on `introVideoUrl` and `avatarUrl`; apply the existing text sanitiser to tutor bios.
13. Restore `import "server-only"` to `lib/db/connect.js` and `lib/auth/tokens.js`.
14. Fail at boot, or report clearly, when storage configuration is present but obviously placeholder.
15. Wire application logging and error reporting to a monitoring service.
16. Thicken the admin-journey, tutor-journey and validation test sections.
17. Correct the stale figures and the self-contradictory calendar row in `docs/REQUIREMENTS.md`.

### Phase 4 — Optional Enhancements

18. Message attachments (documented Phase 2 backlog).
19. Hard delete for curriculum subjects, grades and provinces.
20. Extract the password-policy helper so bcrypt is not reachable from client components.
21. Per-route `loading.js` for finer-grained streaming.
22. Phase 3 items from the specification — mobile apps, native video classroom, whiteboard, AI features, student analytics, additional provinces.

---

## 14. Final Status

**Current estimated completion: 90%.**

**What is already substantially complete.** Every business module described in the specification is built and working: the public marketplace and search, curriculum, tutor onboarding and verification, availability and booking, the full payment and refund lifecycle, payouts, messaging, reviews, tutor requests and matching, and all twelve Phase 2 features — progress reports, packages, group sessions, referrals, promoted profiles, advanced analytics and risk tooling. The architecture is unusually disciplined: one request pipeline enforcing authentication, role, permission and validation on all 154 endpoints; one response envelope; one implementation of each business rule; and scheduled work in a single registry where every job claims its work atomically. 1,912 automated assertions pass. Lint and the production build are clean. There is not a single `TODO` in the source tree.

I verified the most important flows against the running application rather than only reading them: the full money path from quote to confirmed lesson (including a declined card and a duplicate capture that correctly did nothing), document upload and audited retrieval with byte-identical bytes, a tutor application approval propagating to public search, messaging with correct refusal of a non-participant, and role separation at both the API and page layers.

**What remains.** Three things, in order of weight. First, **no external service has been proven against a live account** — payments, email, SMS, calendar, meeting links, OAuth and object storage are all built to a clean interface and tested in isolation, and all currently run on development implementations. Second, **object storage is misconfigured in this environment**, which is the sole cause of all 10 failing tests and which I confirmed is a credentials problem by making the same uploads succeed in local mode. Third, a small set of **defects and hardening items**: a dispute that can be re-decided after closure, internal identifiers published on public pages, no global audit-log viewer, no CSP or HSTS, and two components that assume a single server instance.

**Major blockers.** Only one is a true blocker to launch: **the Stripe account cannot currently accept charges**, so the revenue path has never been exercised. The storage credentials are a close second, because verification documents are central to the trust model of a tutoring marketplace.

**What needs to happen before final delivery.** Provision credentials for object storage and complete Stripe account onboarding; run a live charge, refund and webhook end to end; fix the dispute-resolution guard; remove the branding metadata from public pages; and build the audit-log viewer. That is a focused, well-bounded body of work dominated by configuration and verification rather than new development. Once it is done, the remaining Phase 3 items on the hardening list are the normal cost of operating at scale, not of shipping.

The honest summary is this: **the software is built; it has not yet been proven against the real world.** The gap between those two states is measured in credentials and a short verification cycle, not in months of engineering.

---

*Prepared from direct inspection of the repository and live verification against a running instance. Every test result quoted was produced during this audit. No application code was modified; the working tree is unchanged.*
