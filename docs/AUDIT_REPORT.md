# APlus Learn — Original Requirements Audit

## 0. Remediation Update — 5 October 2026

This section records the remediation carried out after the audit below. It is the current status; §1–§17 are the original audit, with the status cells of every item that changed updated in place (§4 and §17) and the pre-fix evidence kept, labelled "Before the fix". Scope was the in-scope MVP and current requirements; real external providers (Stripe, Resend/SMTP, Twilio, Zoom/Meet/Teams, Google Maps, S3, Google/Apple OAuth production configuration, external calendars) and Phase Three were excluded by instruction.

### 0.1 Result

| | Before (1 Oct) | After (5 Oct) |
|---|---:|---:|
| Base requirements §1–§33 (328 items) — ✅ | 187 | 307 |
| — 🟡 partial | 108 | 20 |
| — 🟠 broken | 15 | 0 |
| — 🔴 not implemented | 17 | 0 |
| — ⚪ unverified | 1 | 1 |
| All 353 items (incl. Phase Two/Three) — ✅ / 🟡 / 🟠 / 🔴 / ⚪ | 196 / 113 / 15 / 28 / 1 | 316 / 25 / 0 / 11 / 1 |
| MVP §34 (22 items) — ✅ / 🟡 / 🟠 | 3 / 14 / 5 | 17 / 5 / 0 |

Every remaining 🟡 base item is one of: an excluded external provider, hosting/legal work outside the application, or a deliberately deferred non-MVP item (§0.5). None is an application defect. The five MVP items still 🟡 are M6 (catalogue *data*), M8 (real geocoding), M11 (live card payments), M12 (Stripe payout schedule) and M19 (S3 storage) — each now correct in the application and waiting on an excluded provider or on curriculum data an operator loads.

### 0.2 What changed, by area

- **Security / P0.** JSON-LD is serialised through one escaping helper (S1, regression test with a `</script><script>` headline). Minor surnames are removed in the services, not at render (S5/R30.7). Email verification cannot lift a suspension (S7). Admins are not conversation participants (S8). Client IP comes from a trusted source (S11). Uploads are size-capped before buffering on every upload route (S19). Cookie jars removed from the tree (S13). The seed refuses production and redacts the URI, and builds every index before writing (S20). Identity documents fail closed in production without object storage (S10).
- **Money integrity (application-level).** Payouts claim lessons atomically, follow a server-enforced state machine (FAILED is final) and pay the share net of every refund; a refund after payout becomes a visible deduction on the next payout (`PayoutAdjustment`). A learner's tutor-no-show report opens a dispute — no self-refund — inside a configurable window, never on completed or paid-out lessons. Disputes are limited to eligible, paid lessons and end in the status the decision justifies. Refunds are planned from what was collected (credit-aware) before a lesson is saved as cancelled; unpaid cancellations void the checkout (S2, S3, S4, R16.4, R16.7, R27.2, R27.5, R27.6).
- **Dynamic curriculum (no province hard-coding).** Homepage, hero, find-a-tutor, course browsing, child profiles and tutor onboarding all load grades/subjects/courses for the *selected* province from the curriculum collections; the default province is the first live one in admin order. Curriculum writes cascade names/codes onto tutor profiles, keep retired slugs as aliases and revalidate cached public pages. The development seed now has two live provinces (Ontario, British Columbia) with their own grades and courses, Ontario courses for every grade K–12, subject/course aliases, and tutors/families in both.
- **Search.** Typed words are matched against the curriculum (code → subject/alias → course/alias → text). Location is RESOLVED / UNRESOLVED / INVALID and never substituted; unknown places are answered from tutors who serve them; online tutors stay in local searches; "Offers both", real "Any distance", closest-first and soonest-available over the whole set, spec qualification categories, and Today / Tomorrow / This week / This weekend / time-of-day / specific date+time filters evaluated on real bookable slots. Cards show live next-available time and View availability / Message / Book. Every search is recorded as an anonymous `SearchEvent` for the admin "most searched" report.
- **Availability and booking.** One busy-time definition (bookings + published group sessions + external calendars) for display, claim, reschedule and group publishing; DST-safe slot checks; "Other" location detail; rebook and signed-out slot selection survive sign-in; confirmation emails carry location, the amount actually paid and the live policy; booking events are narrated in the conversation; booking from a tutor request closes it.
- **Onboarding.** Province → grade → subject → course picker; documents upload before submission against a reserved profile id and reach the reviewer; profile photo step; other credentials; identity verification required to approve; background-check expiry; tutors without a geocodable address get no location (never Toronto); suspension/ban keeps search state correct.
- **Learners and registration.** Phone, province, city and postal code at sign-up; birth year for self-registering students (minimum age, minors derived); child profiles with province, grade, subjects, courses, format preference, current/target marks, goals, areas to improve and learning preferences, isolated per family.
- **Dashboards and admin.** Past lessons by the clock plus an auto-completion job; rosters and "My tutors" from real lesson relationships; tutor earnings net and all-time; admin bookings views (Upcoming / Past / Cancelled / No-shows / Disputed / Unpaid / Expired) and money totals from collected payments over the whole set; per-tutor earnings; ban/restore; one anonymising deletion for self and admin; user history; corrected analytics definitions; search demand.
- **Messaging, requests, reviews.** Contact details masked in messages with a risk signal; tutor-initiated contact from a booking; request interest limited to eligible tutors; request reporting queue; optional written reviews; wider review reporting with an approval queue.
- **Public pages, SEO, legal.** Real 404s for invalid dynamic URLs; province, province+subject, grade+subject and topic+city landing pages; alias URLs (e.g. `/ontario/grade-12/math/mhf4u`) redirect permanently to canonical; sitemap lists only URLs with content; every business number and claim on public pages comes from settings or data; verification disclaimer; help centre; Community Standards and Tutor Agreement; Cookie Policy lists every cookie and browser store; governing law and retention from settings.

### 0.3 Tests

| Gate | Result |
|---|---|
| Lint (`bun run lint`) | Clean |
| Integration (`bun run test:integrations`, all legacy sections + 7 area suites) | 2353 passed, 0 failed, 2 skipped (a live MinIO round trip — no storage credentials; the change-stream realtime source — needs a MongoDB replica set) |
| HTTP QA (`bun run qa`, against a dev server on an isolated database) | 1196 passed, 0 failed |
| Browser E2E (`bun run e2e:journeys`) | `e2e:journeys` 36 passed, 0 failed · `e2e` (forgot password) 20/0 · `e2e:realtime` 24/0 · `e2e:install` 102/0 |
| Build (`bun run build`) | Succeeds (warnings only: Turbopack file-tracing notes on the existing storage path-traversal guard) |

New regression suites: `scripts/integration/05-search.mjs`, `20-onboarding.mjs`, `40-money.mjs`, `45-booking-lifecycle.mjs`, `50-public.mjs`, `60-admin-security.mjs` (plus `01-output-safety`, `10-learners`, `30-requests-reviews` from the earlier session). Legacy assertions that encoded a defect this work removed were changed to assert the corrected rule, never deleted: the Toronto FSA fallback (R29.1), the left-most `X-Forwarded-For` client address (S11), production meeting fallback to a fabricated room (R25.1), an administrator reading an unreported thread's files (S8), and disputes on lessons outside the dispute window or already fully refunded (S4). All test runs used an isolated database (`aplus_learn_e2e`); the development database was not written to.

### 0.4 Dynamic verification

- Ontario works: search, landing pages, onboarding courses and child profiles (`05-search`, `50-public`, `10-learners`).
- British Columbia (a second live province) works: BC grades in the hero and refine bar, BC courses in onboarding (`MPREC12` lands on a profile with `provinceCodes: ["BC"]`), BC-only results for BC + Grade 12, a BC postal code finds the Vancouver tutor, `/british-columbia/mathematics` renders.
- A province activated at runtime works with no code change: the suites create Yukon (integration) and activate Nova Scotia through the admin API (browser) with a grade and a coded course, then find it in the curriculum API, the onboarding picker query, the refine bar and search.
- No runtime `"ON"`/"Ontario" literal remains in the homepage, search, course browsing, onboarding, child profiles or public copy; remaining occurrences are seed data, tests, comments, and the name of the Ontario College of Teachers credential (a domain constant).

### 0.5 Remaining

Excluded external providers: R1.3 (the core journey's live payment and meeting steps), R4.2, R4.3 (Google/Apple sign-in), R4.12 and R24.11 (Twilio SMS), R15.8, R16.1, R16.2, R16.8 (Stripe charges, Connect, payout schedule), R24.10 (email delivery), R25.1 (real meeting rooms — production no longer fabricates links), R29.1 (real geocoding — the Toronto fallback defect is fixed), R30.5 (S3 storage — production fails closed). Outside the application: R30.1 (TLS at the host), R30.11 (legal review). Deliberately deferred, not MVP: R19.2 (extra matching factors), R23.4 (booking accept/decline step — bookings confirm by payment), R30.4 / R30.8 (admin 2FA and sub-roles), R31.2 (native-app auth and push), R6.3 (full Ontario catalogue — data loaded through Admin → Curriculum). Phase Two items keep their status (P2.2, P2.3, P2.4, P2.9); Phase Three was out of scope. The development database (`aplus_learn`) still holds legacy qualification values: run `MONGODB_URI=… node scripts/migrate-qualifications.mjs` once (it was only dry-run there).

### 0.6 Browser journeys covered

| Journey | Script | What it proves |
|---|---|---|
| A — parent search | `e2e-journeys` | Hero province → BC grades from the curriculum API; "Math" searched as the Mathematics subject; BC + Vancouver finds the Vancouver tutor; no distance from a guessed city; sort writes the URL; profile opens at its availability |
| B — dynamic province | `e2e-journeys` | Admin activates Nova Scotia, adds Grade 11 and course NSPHY11 through the admin API; curriculum API, onboarding picker query, search and the refine bar all use it; it is offered as live |
| D — child profile | `e2e-journeys` | BC child with grade, course MPREC12, online preference, marks 72/86 and a goal saved through the form, persisted after reload, unreadable by another parent |
| E — filters ↔ URL | `e2e-journeys` | Tomorrow, Offers both, PhD, Clear all; page results equal the API's for the same URL |
| F — booking | `e2e-journeys` | Profile → slot → checkout (development card form) → CONFIRMED → listed in the tutor's upcoming lessons |
| G — messaging | `e2e-journeys` (M), `e2e:realtime` | A phone number is removed before storage; live delivery, unread badges, notifications, offline recovery, retry |
| H — admin | `e2e-journeys` | Curriculum, applications, bookings (Upcoming), payouts (tutor earnings), analytics (search demand), support, moderation render for an administrator |
| I — SEO / public routes | HTTP checks on the dev server | `/tutors/<unknown>`, unknown/inactive province, unknown course, unknown topic+city and `/legal/<unknown>` → 404 (`noindex`); `/ontario/grade-12/math/mhf4u`, `/ontario/math`, `/tutors/math/scarborough`, `/tutors/grade-12-math/scarborough`, `/tutors/calculus/toronto` → 308 to canonical, which return 200; `/ontario`, `/british-columbia`, `/british-columbia/mathematics`, `/help-centre`, `/legal/community-standards`, `/legal/tutor-agreement`, `/sitemap.xml`, `/robots.txt` → 200 |
| Forgot password, PWA install | `e2e`, `e2e:install` | Unchanged flows still pass |

Tutor onboarding (Journey C) is exercised end to end at the service level by `20-onboarding` — registration → every wizard step through the same validation the routes use → document upload before a profile exists → submission → reviewer sees the document → identity-required approval → searchable → suspension removes from search. Its browser walk-through was not scripted.

---



## 1. Executive Summary (original audit, 1 October 2026 — current status in §0)

| | |
|---|---|
| **Audit date** | 1 October 2026 |
| **Application version** | `a-plus-learn` 0.1.0 (`package.json`), branch `main`, commit `1cb362b` ("update", 2026-10-01 20:53 +0600). The working tree was clean apart from the untracked requirements file `docs/Original.md`. |
| **Requirements source** | `docs/Original.md` ("APlus Learn — Detailed Website Features & Functional Requirements, Developer Brief – MVP and Future-Ready Architecture", 41 numbered sections). It is byte-identical to `~/Downloads/Original.md`, the file supplied for this audit. `docs/Project.md` is an implementation prompt, not the requirement baseline, and was not used as a source of requirements. |
| **Audit type** | Read-only. No application code, schema, seed data, configuration or tests were changed. The only file created in the repository is this report. |

### Overall implementation summary

353 individual requirement items were audited. They are the line items of §1–§33, plus the §35 Phase Two and §36 Phase Three feature lists. §34 (MVP), §37–§38 (journeys), §39 (differentiators), §40 (priority) and §41 (objective) re-group those same requirements. They are scored separately in §5–§10 so that nothing is counted twice.

| Status | Count | Share (count ÷ 353) |
|---|---:|---:|
| ✅ FULLY IMPLEMENTED | 196 | 55.5 % |
| 🟡 PARTIALLY IMPLEMENTED | 113 | 32.0 % |
| 🟠 BROKEN / DEFECTIVE | 15 | 4.2 % |
| 🔴 NOT IMPLEMENTED | 28 | 7.9 % |
| ⚪ UNVERIFIED | 1 | 0.3 % |

On the base requirements only (§1–§33, 328 items), the split is: **187 fully implemented (57.0 %), 108 partial, 15 broken, 17 not implemented, 1 unverified.**

**MVP (§34, 22 items): 3 fully implemented, 14 partial, 5 broken, 0 not implemented.** The application is **not MVP-ready** by the definition this audit was given: every MVP item must be sufficiently implemented.

### Major completed areas

The application is a real full-stack marketplace, not a UI shell. It has 171 API route files, 103 pages, 28 Mongoose model files and 39 services. Every part of the MVP has a persisted, server-enforced implementation. The areas below are implemented end-to-end, with evidence in §4:

- **Curriculum.** The province → grade → subject → course → code model, with admin CRUD.
- **Public tutor profiles.** First name + last initial, badges, credentials, reviews, live availability, Book / Message / Save.
- **Server-side authorisation.** `routeHandler` options on every route; ownership is checked against loaded records.
- **Booking.** Server-side pricing, one-time and recurring lessons, slot locking, and checkout holds that expire.
- **Stripe-shaped payment flow (code).** Webhook signature verification and idempotent webhook processing.
- **Messaging.** Realtime delivery, unread state, attachments, block, and reporting to a moderation queue.
- **Tutor requests.** Matching, interest, comparison, expiry.
- **Reviews.** Only from completed bookings, one per booking.
- **Dashboards.** Parent, tutor and administrator dashboards covering most listed areas.
- **Responsive layout.** No horizontal overflow was found on any of 57 routes at 4 viewports in a real browser.
- **Phase Two.** 7 of 11 features are implemented, ahead of the MVP.

### Major gaps

- **Search and location (priority #1 in §40).**
  - Any place missing from the bundled geocoding table resolves to Toronto.
  - Online-only tutors are dropped when a location is entered.
  - Common subject words typed in the hero ("Math", "Physics") are sent as course codes and return 0 results.
  - The Today / Tomorrow / This Week / specific-date availability filters do not exist.
  - "Next available" is empty for 10 of the 12 searchable tutors, although all 12 have open slots.
- **Child profiles (§5).**
  - There are no fields for subjects/courses, online/in-person preference, current mark or target mark.
  - Learning goals cannot be created.
- **Registration (§4).** Phone, province, city and postal code are not collected at sign-up.
- **Messaging (§17).** No protection against moving payment off-platform.
- **SEO (§32).**
  - There are no landing pages for "Grade 12 math tutor Scarborough" or "Ontario math tutor".
  - The spec's own example URL, `/ontario/grade-12/math/mhf4u`, returns "Course not found".
  - Invalid dynamic URLs return HTTP 200 instead of 404.
- **Legal (§33).**
  - There is no Community Standards page and no Tutor Agreement page.
  - The Cookie Policy lists 1 of the 5 cookies the app sets.
  - The Privacy Policy says verification documents are deleted when a badge expires; no code deletes them.
- **Admin analytics (§28).** "Most searched subjects/courses" cannot be produced, because searches are never recorded.

### Major blockers (verified in code; see §11)

1. **Stored XSS on public tutor profiles (High).** A tutor's headline is written into a JSON-LD `<script>` with `JSON.stringify`, which does not escape `</script>`. The CSP allows inline script, so the tutor's script would run for every visitor to that profile.
2. **Money-integrity defects in payouts and refunds (High).**
   - Two concurrent payout runs can pay the same lessons twice.
   - A FAILED payout can later be marked PAID.
   - A learner can report a tutor no-show on any COMPLETED lesson, at any time, and receive an immediate 100 % refund with no admin review.
   - A dispute settled with a partial refund leaves the booking COMPLETED, and the tutor is then paid the full amount.
3. **Tutor onboarding (High).** First-time applicants cannot upload verification documents in the application wizard. The upload service requires a `TutorProfile`, which is only created when the application is submitted.
4. **No external provider is production-configured.** `.env.local` sets Stripe test keys only. The Stripe account cannot take charges (`charges_enabled: false`, per `.claude/CLAUDE.md`). Email, meeting links, geocoding, object storage, SMS, calendar and social sign-in all run on development implementations. Several of those are permitted in production:
   - Without a configured provider, meeting links are randomly generated `zoom.us/j/<hex>` URLs that look real and do not work.
   - Uploaded identity documents fall back to unencrypted local disk.
5. **Minor privacy (Medium).** Learner surnames are masked from tutors only when the page renders. The full `lastName` is in the API JSON, and in screen-reader text on two tutor pages. Self-registered students are always treated as adults, with no age check.

---

## 2. Audit Methodology

**Requirements first.** All 41 sections of `docs/Original.md` were read in full before inspecting code. Each line item became an audit row. Nothing outside the document was treated as a requirement. Where the code goes further than the document (for example SMS, packages, group tutoring), that is noted but never counted as a gap.

**Code inspection.** Every item was traced from UI → API route (`src/app/api/**/route.js`) → `routeHandler` options → service (`src/services/*.service.js`) → model (`src/models/*.js`). A route, field, component, test name or documentation claim was not accepted as proof on its own. The existing self-assessments (`docs/REQUIREMENTS.md`, `APLUS_LEARN_*_AUDIT.md`, `APlusLearn-Final-Audit-Report.md`) were used only to find code, never as evidence. Eight parallel code reviews covered the requirement areas. Every High-severity finding, and the main Medium findings quoted in §1, was then re-read in the source by the lead auditor before inclusion. Where a defect is described as "verified in code", that is what was done; none was exploited.

**Runtime verification** was done against the running `next dev` server on `http://localhost:3000` (Next 16.3.5, started 2026-10-01 20:36) and its local MongoDB. It consisted of:

- Unauthenticated `curl` GETs against public pages and APIs. These covered search with different filters, profile JSON, sitemap, robots, security headers, legal pages, and protected routes without a session (all returned 401).
- A read-only MongoDB query, with secrets excluded. It found:
  - no stored admin integration configuration (so `.env.local` is in effect);
  - 8 provinces, 1 of them active;
  - 13 real grades, plus 6 leftover `QA Grade …` rows from past test runs (inactive and not served publicly);
  - 38 courses;
  - 13 tutor profiles, 12 of them searchable;
  - `commissionPercent` 15 and `checkoutHoldMinutes` 60.
- A responsive sweep in system Chrome via Playwright. It loaded 57 routes (15 public, 15 parent, 12 tutor, 15 admin) at 1440×900, 768×1024, 390×844 and 360×800, which is 228 page loads. Each load recorded HTTP status, landing path, horizontal overflow and the offending elements, small tap targets and console errors, and a screenshot was taken at the narrower widths.
- `bun run lint`, which completed with no output (clean).

**Side effects of runtime verification (disclosed).** The responsive sweep signed in once each as the seeded parent (`jennifer.chen@example.com`), tutor (`priya.sharma@example.com`) and admin (`admin@apluslearn.ca`), using the development sign-in code. That writes the ordinary session records the app writes for any sign-in:

- `lastLoginAt`;
- a `USER_LOGIN` audit entry;
- login-verification tokens;
- `TrustedDevice` rows;
- rate-limit windows.

Nothing else was written. No booking, message, payment or profile was created or changed.

**Tests inspected.** `scripts/qa.mjs` (7,706 lines, 43 sections, about 1,148 checks), `scripts/integration-tests.mjs` (13,238 lines, 48 sections, about 1,735 checks) and the three browser e2e scripts were read. **None was run**, because each writes to the development database:

- `qa` clears the `integrations` collection, consumes seeded completed lessons and creates bookings and messages.
- `test:integrations` removes and then restores stored integrations.
- The e2e scripts sign in and send messages.

`next build` was not run either. The only results available are the historical outputs in `scratchpad/*.txt`, dated 20 September 2026, which are older than the current suites.

**Limitations.**

- No live Stripe, Resend/SMTP, Zoom/Meet/Teams, Google Maps, S3, Twilio, Google/Apple or calendar round-trip could be performed, because none is configured. Everything depending on them is code-verified only.
- Interactive browser flows were not exercised: opening the filter sheet, completing a booking, onboarding steps, uploading a file. The responsive sweep measured page loads only.
- No real iOS/Android device testing was done; mobile was emulated in Chrome.
- Soft-404 behaviour was observed on the dev server and should be confirmed on a production build.
- This is a requirements audit, not a penetration test. Security findings are what the code shows.

---

## 3. Overall Requirement Status

Area status rule: **✅** only if every item in the area is ✅; **🟠** if any item is 🟠; **🔴** if most items are 🔴; otherwise **🟡**. The counts are ✅/🟡/🟠/🔴/⚪.

| # | Requirement Area | Status | Counts | Evidence | Key Gap |
|---|---|---|---|---|---|
| 1 | Project Overview | 🟡 | 3/1/0/0/0 | `src/models/Curriculum.js`, `src/constants/roles.js` | Remaining (see §0.5): R1.3 |
| 2 | Homepage | ✅ | 20/0/0/0/0 | `src/components/search/HeroSearch.jsx`, `src/components/home/Sections.jsx` | — |
| 3 | Account Types | ✅ | 6/0/0/0/0 | `src/services/student.service.js`, `src/models/StudentProfile.js` | — |
| 4 | Parent/Student Registration | 🟡 | 9/3/0/0/0 | `src/components/auth/RegisterForm.jsx`, `src/services/auth.service.js` | Remaining (see §0.5): R4.2, R4.3, R4.12 |
| 5 | Child / Student Profiles | ✅ | 12/0/0/0/0 | `src/components/dashboard/ChildrenManager.jsx` | — |
| 6 | Canadian Curriculum Database | 🟡 | 4/1/0/0/0 | `src/models/Curriculum.js`, `scripts/seed-data/curriculum.js` | Remaining (see §0.5): R6.3 |
| 7 | Tutor Search | ✅ | 12/0/0/0/0 | `src/services/search.service.js`, `src/lib/search/tutor-query.js` | — |
| 8 | Search Filters | ✅ | 23/0/0/0/0 | `src/components/search/SearchFilters.jsx`, `src/lib/validation/search.js` | — |
| 9 | Tutor Search Result Cards | ✅ | 13/0/0/0/0 | `src/components/tutor/TutorCard.jsx` | — |
| 10 | Tutor Public Profile | ✅ | 19/0/0/0/0 | `src/app/(public)/tutors/[slug]/page.js` | — |
| 11 | Tutor Verification | ✅ | 7/0/0/0/0 | `src/services/verification.service.js` | — |
| 12 | Become a Tutor Page | ✅ | 8/0/0/0/0 | `src/app/(public)/become-a-tutor/page.js` | — |
| 13 | Tutor Application / Onboarding | ✅ | 13/0/0/0/0 | `src/components/tutor/onboarding/steps/*`, `src/services/tutor.service.js` | — |
| 14 | Tutor Availability Calendar | ✅ | 6/0/0/0/0 | `src/services/availability.service.js`, `src/lib/booking/slots.js` | — |
| 15 | Booking System | 🟡 | 9/1/0/0/0 | `src/services/booking.service.js`, `src/components/booking/BookingWidget.jsx` | Remaining (see §0.5): R15.8 |
| 16 | Payments and Tutor Payouts | 🟡 | 7/3/0/0/0 | `src/services/payment.service.js`, `src/services/payout.service.js` | Remaining (see §0.5): R16.1, R16.2, R16.8 |
| 17 | Messaging | ✅ | 7/0/0/0/0 | `src/services/message.service.js` | — |
| 18 | Post a Tutor Request | ✅ | 11/0/0/0/0 | `src/services/request.service.js` | — |
| 19 | Tutor Matching | 🟡 | 1/1/0/0/0 | `src/lib/matching/*` | Remaining (see §0.5): R19.2 |
| 20 | Favourites / Saved Tutors | ✅ | 2/0/0/0/0 | `src/services/student.service.js:145-178` | — |
| 21 | Reviews and Ratings | ✅ | 5/0/0/0/0 | `src/services/review.service.js` | — |
| 22 | Parent / Student Dashboard | ✅ | 9/0/0/0/0 | `src/app/(dashboard)/*` | — |
| 23 | Tutor Dashboard | 🟡 | 10/1/0/0/0 | `src/app/tutor/*` | Remaining (see §0.5): R23.4 |
| 24 | Lesson Confirmation and Notifications | 🟡 | 9/2/0/0/0 | `src/services/external/email-templates.js`, `src/services/notification.service.js` | Remaining (see §0.5): R24.10, R24.11 |
| 25 | Online Lessons | 🟡 | 0/1/0/0/0 | `src/services/meeting.service.js`, `src/services/external/meeting-provider.js` | Remaining (see §0.5): R25.1 |
| 26 | In-Person Lessons | ✅ | 6/0/0/0/0 | `src/constants/domain.js:122-128`, `src/services/booking.service.js:1339-1346` | — |
| 27 | Cancellations, Refunds and No-Shows | ✅ | 8/0/0/0/0 | `src/lib/booking/policy.js`, `src/services/dispute.service.js` | — |
| 28 | Administrator Dashboard | ✅ | 34/0/0/0/0 | `src/app/admin/*`, `src/services/analytics.service.js` | — |
| 29 | Location and Distance Search | 🟡 | 2/1/0/0/0 | `src/services/external/geocoding-provider.js` | Remaining (see §0.5): R29.1 |
| 30 | Security and Privacy | 🟡 | 6/4/0/0/1 | `src/lib/auth/*`, `next.config.mjs` | Remaining (see §0.5): R30.1, R30.4, R30.5, R30.8, R30.11 |
| 31 | Mobile Responsiveness and Future Apps | 🟡 | 1/1/0/0/0 | Responsive sweep (228 loads) | Remaining (see §0.5): R31.2 |
| 32 | SEO and Public Landing Pages | ✅ | 9/0/0/0/0 | `src/app/sitemap.js`, `src/app/(public)/tutors/[slug]/[city]/page.js` | — |
| 33 | Customer Support and Legal Pages | ✅ | 16/0/0/0/0 | `src/constants/legal.js`, `src/app/(public)/*` | — |
| 34 | MVP – Required for Initial Launch | 🟡 | 17/5/0/0/0 | §5 of this report | Remaining MVP items wait on excluded providers or catalogue data (§0.1) |
| 35 | Phase Two | 🟡 | 7/4/0/0/0 | §6 | Calendar and SMS live-unverified; promotions admin-only |
| 36 | Phase Three | 🔴 | 2/1/0/11/0 | §7 | No native apps, AI, video or whiteboard |
| 37 | Core Parent Journey | 🟡 | — | §8 | Location, search, booking, review and rebook fixed; payment and meeting links depend on excluded providers |
| 38 | Core Tutor Journey | 🟡 | — | §9 | Document upload and course selection fixed; payouts' money movement depends on Stripe (excluded) |
| 39 | Product Differentiators | 🟡 | — | §10 | Course-code and local search fixed; remaining gaps are external providers |
| 40 | Development Priority | 🟡 | — | §4.40 | No priority area has an application defect left; external providers remain (§0.5) |
| 41 | Final Development Objective | 🟡 | — | §4.41 | Objective achievable only in development mode today |

---
## 4. Detailed Requirement Audit

Item IDs (`R<section>.<n>`) are reused in the Final Requirement Matrix (§17). Line numbers refer to commit `1cb362b`.

### 4.1 Project Overview

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R1.1 | Canada-focused, Ontario K–12 initial launch | ✅ | Before the fix: `scripts/seed-data/curriculum.js:9-33`; DB: ON active, 7 provinces inactive; 13 grades K–12 | Fixed: every Ontario grade K–12 now has courses in the development catalogue and a tutor who teaches it (`scripts/seed-data/curriculum.js`, `people.js`); grade search for Kindergarten returns tutors (`05-search`). |
| R1.2 | Structured around province, grade, subject, course, course code | ✅ | `src/models/Curriculum.js:12-102` | Subject is a global collection; Course references province, grade and subject. |
| R1.3 | Core journey Search → Compare → Match → Message → Book → Pay → Attend → Review → Rebook | 🟡 | Before the fix: See §8 | Every in-scope step now works end to end (search → book → pay (development provider) → message → review → rebook). Live payment and real meeting links depend on excluded external providers (§0.6). |
| R1.4 | Primary user types Parent/Student, Tutor, Administrator | ✅ | `src/constants/roles.js:9-14,177-207` | PARENT, STUDENT, TUTOR, ADMIN. |

### 4.2 Homepage

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R2.1 | Begin searching without an account | ✅ | `src/components/search/HeroSearch.jsx:34-49`; `/find-a-tutor` 200 anonymously | |
| R2.2 | Hero: Province | ✅ | `HeroSearch.jsx:81-93`; `src/app/(public)/page.js:34` | Inactive provinces are shown disabled ("coming soon"). |
| R2.3 | Hero: Grade | ✅ | Before the fix: `HeroSearch.jsx:95-107`; `page.js:35` `listGrades({ provinceCode: "ON" })` | Fixed: the hero's grade and subject lists reload from `/api/curriculum/tree` for the chosen province (`HeroSearch.jsx`, `hooks/useProvinceCurriculum.js`); homepage default province comes from data (`defaultProvinceCode()`), never `"ON"`. |
| R2.4 | Hero: Subject or course | ✅ | Before the fix: `HeroSearch.jsx:109-121` (subject select), `:274-445` (course autocomplete) | Fixed: the subject list is every subject the chosen province teaches, not only the popular ones. |
| R2.5 | Hero: Course code | ✅ | Before the fix: `HeroSearch.jsx:40` regex `/^[A-Za-z]{3}[A-Za-z0-9]{1,5}$/` | Fixed: the hero sends what was typed as `q`; `search.service.interpretQuery` matches it against the curriculum (real course code → subject/alias → course name/alias → free text). "Math", "Physics" are subjects; "MHF4U" is a course (`05-search`, `e2e-journeys` A). |
| R2.6 | Hero: Online or in-person | ✅ | `HeroSearch.jsx:123-132` | ANY / ONLINE / IN_PERSON. |
| R2.7 | Hero: Location or postal code | ✅ | Before the fix: `HeroSearch.jsx:43-46,136-143`; `src/services/external/geocoding-provider.js:58-86,219-241` | Fixed: unknown places are reported as unresolved and answered from tutor data, never substituted with Toronto (see R29.1). |
| R2.8 | Search button | ✅ | `HeroSearch.jsx:144,163-196` | The spec example (ON, Grade 12, MHF4U, In Person, Scarborough) returns 2 tutors. |
| R2.9 | How APlus Learn Works | ✅ | `src/components/home/Sections.jsx:162` | |
| R2.10 | Popular Subjects | ✅ | `Sections.jsx:182-230` (DB `Subject.isPopular`) | |
| R2.11 | Popular Ontario Courses | ✅ | `Sections.jsx:280-310`; `src/services/curriculum.service.js:338-346` | |
| R2.12 | Find Tutors by Grade | ✅ | Before the fix: `Sections.jsx:468-520` | Fixed with R1.1: every grade chip now leads to tutors. |
| R2.13 | Why Choose APlus Learn | ✅ | `Sections.jsx:581-620` | Static copy. |
| R2.14 | Tutor Verification | ✅ | `Sections.jsx:655-760` | |
| R2.15 | Online vs. In-Person Tutoring | ✅ | `Sections.jsx:792-880` | |
| R2.16 | Testimonials | ✅ | Before the fix: `src/app/(public)/page.js:40-75`; `Sections.jsx:886-900` | Data-driven from published reviews; the development database's reviews are seed fixtures, which is expected for that environment. |
| R2.17 | Become a Tutor | ✅ | `Sections.jsx:904-975` | Commission is read from Settings; "48h typical review time" is hard-coded. |
| R2.18 | FAQ | ✅ | Before the fix: `Sections.jsx:981-1045` | Fixed: FAQ answers are built from live settings and the live curriculum (`constants/public-copy.js` `homeFaqs`); the identity and "complete curriculum" claims were made accurate (`50-public`). |
| R2.19 | Footer with legal and support links | ✅ | `src/components/layout/SiteFooter.jsx:196-217`; `src/constants/navigation.js:91-111` | Footer promises "live chat (replies within 4 hours)" (`:102-104`); no chat exists. |
| R2.20 | CTAs Find a Tutor and Become a Tutor | ✅ | `src/components/layout/SiteHeader.jsx:90,122,139`; `Sections.jsx:170,938` | |

### 4.3 Account Types

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R3.1 | Parent manages one or more children under one account | ✅ | `src/services/student.service.js:14-50`; `src/app/(dashboard)/children/page.js`; `src/app/api/students/route.js` (`CHILD_MANAGE`) | |
| R3.2 | Each child has separate courses, tutors, bookings, lesson history, progress | ✅ | Before the fix: Bookings carry `studentProfileId` (`booking.service.js:1268`); per-child insights (`src/app/(dashboard)/insights/page.js:41-74`); progress reports per learner | Fixed: per-child courses/subjects (R5.5) and a validated per-child filter on the parent's bookings page. |
| R3.3 | Older students manage their own account | ✅ | `src/services/auth.service.js:63-72` (self `StudentProfile`) | |
| R3.4 | Distinguish minors from adults for privacy, communication and payment | ✅ | Before the fix: `src/models/StudentProfile.js:28-29,48-49,59-65`; `student.service.js:122-125`; `src/lib/utils/format.js:109-119` | Fixed: a self-registering student gives a birth year; under 13 must be added by a parent; minor status is derived and enforced server-side (`lib/utils/age.js`, `10-learners`). |
| R3.5 | Tutor separate onboarding and dashboard | ✅ | `src/app/tutor/layout.js:13`; `src/app/tutor/onboarding`, `src/app/tutor/dashboard` | |
| R3.6 | Administrator full permissions, access controlled by role | ✅ | `src/constants/roles.js:26-140,206`; `src/lib/api/handler.js` | One ADMIN role holds all permissions; enforced server-side. There are no admin sub-roles; the document does not require them (see S14). |

### 4.4 Parent/Student Registration

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R4.1 | Email/password registration | ✅ | `RegisterForm.jsx:88-96`; `src/app/api/auth/register/route.js`; `src/lib/validation/auth.js:6-37`; `auth.service.js:43-111` | Rate-limited. |
| R4.2 | Google sign-in | 🟡 | `src/services/external/oauth-provider.js:321-400`; `src/components/layout/OAuthButtons.jsx` | Real authorization-code + PKCE adapter. No `GOOGLE_*` credentials, so only the development identity runs. Live: `/api/auth/oauth/google` → 303 `oauthError=PROVIDER_DISABLED`. |
| R4.3 | Apple sign-in if practical | 🟡 | `oauth-provider.js:406-600` | Same: adapter present, not configured. |
| R4.4 | First name and last name | ✅ | `RegisterForm.jsx:141-160` | |
| R4.5 | Email | ✅ | `RegisterForm.jsx:165` | |
| R4.6 | Phone number | ✅ | Before the fix: Schema accepts it (`validation/auth.js:14`); form has no field (`RegisterForm.jsx:41-56`); Settings → Phone (`src/components/dashboard/PhonePanel.jsx`) | Fixed: collected at registration (`RegisterForm.jsx`, `validation/auth.js`). |
| R4.7 | Parent or Student account type | ✅ | `RegisterForm.jsx:18-34,124-137` | |
| R4.8 | Province | ✅ | Before the fix: `validation/auth.js:15` optional; no form field | Fixed: collected at registration and checked against the postal code's province. |
| R4.9 | City | ✅ | Before the fix: `validation/auth.js:16` optional; no form field | Fixed: collected at registration. |
| R4.10 | Postal code | ✅ | Before the fix: Not in `registerSchema`; `src/lib/validation/users.js:26` (Settings) | Fixed: collected at registration; must belong to the chosen province. |
| R4.11 | Email verification | ✅ | Before the fix: `auth.service.js:114-181`; gate in `src/lib/auth/assert.js:54-59`, used by booking, payment, message, review and 17 routes (`verifiedEmail: true`) | Flow and enforcement work; verifying no longer lifts a suspension (S7). Delivery uses the development mailbox until an email provider is configured (excluded). |
| R4.12 | Optional phone verification | 🟡 | `src/app/api/users/me/phone/route.js`; `src/services/sms.service.js:232-387`; Twilio adapter `src/services/external/sms-provider.js:98-107` | Post-registration only. Twilio is not configured, so codes go to the console. |

### 4.5 Child / Student Profiles

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R5.1 | Parents create individual child profiles | ✅ | `ChildrenManager.jsx:161-205`; `student.service.js:33-50` | |
| R5.2 | First name | ✅ | `StudentProfile.js:24`; `validation/users.js:61` | |
| R5.3 | Grade | ✅ | `StudentProfile.js:32-34`; `ChildrenManager.jsx` | `gradeId` is not checked against the child's province. |
| R5.4 | Province | ✅ | Before the fix: `StudentProfile.js:31`; `validation/users.js:68` | Fixed: province on the child form; grade and courses are validated against it. |
| R5.5 | Subjects/courses requiring tutoring | ✅ | Before the fix: `StudentProfile.js:37-38` (`currentCourses`, `subjectsOfInterest`) | Fixed: subjects and courses per child, validated against the child's province, never reset by an unrelated PATCH (`student.service.js`, `patchSchema`). |
| R5.6 | Online/in-person preference | ✅ | Before the fix: No implementation found after inspecting `src/models/StudentProfile.js`, `src/lib/validation/users.js` and `src/components/dashboard/ChildrenManager.jsx` | Fixed: `lessonModePreference` (online / in person / either), UI → API → model → display. |
| R5.7 | General learning goals | ✅ | Before the fix: `StudentProfile.js:3-10,40`; `learningGoalSchema` (`validation/users.js:84`) is imported by no route | Fixed: learning goals with target date and achieved flag, editable in the child form. |
| R5.8 | Optional current mark | ✅ | Before the fix: No implementation found after inspecting `src/models/StudentProfile.js`, `src/lib/validation/users.js` and `src/components/dashboard/ChildrenManager.jsx` | Fixed: `currentMark` (0–100). |
| R5.9 | Optional target mark | ✅ | Before the fix: No implementation found after inspecting `src/models/StudentProfile.js`, `src/lib/validation/users.js` and `src/components/dashboard/ChildrenManager.jsx` | Fixed: `targetMark` (0–100). |
| R5.10 | Optional areas needing improvement | ✅ | Before the fix: `notes` (`StudentProfile.js:41`) | Fixed: `areasForImprovement` field. |
| R5.11 | Optional learning preferences | ✅ | Before the fix: `accessibilityNeeds` (`StudentProfile.js:42`) | Fixed: `learningPreferences` field. |
| R5.12 | Sensitive educational information not public by default | ✅ | Before the fix: `student.service.js:22-31,52-58` (owner/admin only); every `/api/students*` route requires auth; public tutor/search JSON contains no learner data (curl) | Fixed: tutors see learner details only for real lesson relationships (confirmed or later), minors' surnames masked in the service (`10-learners`). |

### 4.6 Canadian Curriculum Database

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R6.1 | Province → Grade → Subject → Course → Course Code | ✅ | `src/models/Curriculum.js:12-102` (code unique per province, `:95-98`) | |
| R6.2 | Example Ontario → Grade 12 → Mathematics → Advanced Functions → MHF4U | ✅ | `scripts/seed-data/curriculum.js`; `/ontario/grade-12/mathematics/mhf4u` 200 | |
| R6.3 | Ontario curriculum/course-code data | 🟡 | DB: 38 courses, 32 with codes; Grade 9/10/11/12 = 4/6/9/13 courses | A fraction of the Ontario secondary catalogue. Elementary has 6 generic courses. The only loader (`scripts/seed.js`) wipes data and inserts fake users and reviews; there is no curriculum-only import. |
| R6.4 | Search by course name or code, same results | ✅ | Before the fix: `src/lib/search/tutor-query.js:18-37`; `search.service.js:194-224` | Fixed: name, code and alias resolve to the same courses; curriculum edits re-copy names/codes onto tutor profiles (`lib/curriculum/taught.js`). |
| R6.5 | Support additional provinces without rebuilding | ✅ | Before the fix: Admin CRUD `src/app/api/admin/curriculum/**`; `CurriculumManager.jsx`; `Province.usesCourseCodes` | Fixed: no province literal in onboarding, homepage, search or course browsing; a province activated in admin works with no code change (`05-search` runtime province, `e2e-journeys` B). |

### 4.7 Tutor Search

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R7.1 | Province | ✅ | `src/lib/validation/search.js:14`; `tutor-query.js:23`; `RefineSearch.jsx:86-92`; curl `province=ON` 12, `BC` 0 | |
| R7.2 | Grade | ✅ | `search.service.js:217-221`; curl `grade=grade-12` 9 | |
| R7.3 | Subject | ✅ | `tutor-query.js:21`; curl `subject=mathematics` 8 | |
| R7.4 | Course | ✅ | `search.service.js:204-210`; curl `course=advanced-functions` 3 | "Refine" drops the `course` slug (`RefineSearch.jsx:18,41-50`). |
| R7.5 | Course code | ✅ | Before the fix: `search.service.js:197-202` | Fixed with R2.5. |
| R7.6 | Location | ✅ | Before the fix: `search.service.js:226-237`; `tutor-query.js:45-52` (`$geoWithin`) | Fixed: location statuses RESOLVED / UNRESOLVED / INVALID; unknown places matched from tutor data; out-of-province postal codes flagged (`05-search`). |
| R7.7 | Online / in-person / both | ✅ | Before the fix: `search.js:21`; `tutor-query.js:40-45` | Fixed: distance constrains only in-person teaching — online tutors stay in a local search; "Offers both" added (`lib/search/tutor-query.js` `locationClause`). |
| R7.8 | Price | ✅ | `tutor-query.js:56-63`; curl `minPrice=5000&maxPrice=6000` 5 | API takes cents; the UI converts. |
| R7.9 | Availability | ✅ | Before the fix: `search.js:35-37`; `tutor-query.js:82-97` | Fixed: availability filters ask each tutor's real calendar (exceptions, bookings, group sessions, notice, horizon). |
| R7.10 | Tutor qualification | ✅ | Before the fix: `tutor-query.js:68`; `src/constants/domain.js:1044-1060` | Fixed: spec categories; several chosen qualifications match any of them. |
| R7.11 | Verification status | ✅ | `tutor-query.js:69`; curl `verified=BACKGROUND_CHECK` 6 | |
| R7.12 | Rating | ✅ | `tutor-query.js:66`; curl `minRating=4.8` 4 | |

### 4.8 Search Filters

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R8.1 | Location | ✅ | Before the fix: `RefineSearch.jsx:110-124` | Fixed with R7.6. |
| R8.2 | Online | ✅ | `SearchFilters.jsx:69-94`; curl `mode=ONLINE` 12 | |
| R8.3 | In person | ✅ | curl `mode=IN_PERSON` 10 | |
| R8.4 | Both | ✅ | Before the fix: `SearchFilters.jsx:72` "Online or in person" | Fixed: `mode=BOTH` (offers online and in person). |
| R8.5 | Distance radius 5/10/25/50 km | ✅ | Before the fix: `src/constants/config.js:676` `[5,10,25,50,100]`; curl Toronto 5 km → 2, 50 km → 8 | Fixed: "Any distance" is `distanceKm=any`; closest-first ranks the whole result set before paging (`rankedPage`). |
| R8.6 | Min/max hourly rate | ✅ | `SearchFilters.jsx:298-352` | Local inputs don't reset on "Clear all". |
| R8.7 | OCT Certified Teacher | ✅ | `domain.js:1045-1046` (`CERTIFIED_TEACHER`, `OCT_MEMBER`) | |
| R8.8 | University/College Student | ✅ | `domain.js:1047` | Label says "University student". |
| R8.9 | Bachelor's Degree | ✅ | Before the fix: `GRADUATE` "University graduate" (`domain.js:1048`) | Fixed: `BACHELORS_DEGREE`; legacy values migrated by `scripts/migrate-qualifications.mjs`. |
| R8.10 | Master's Degree | ✅ | Before the fix: `POSTGRADUATE` (`domain.js:1049`) | Fixed: `MASTERS_DEGREE`. |
| R8.11 | PhD | ✅ | Before the fix: Same `POSTGRADUATE` value | Fixed: `DOCTORATE` (PhD). |
| R8.12 | Professional/Industry Expert | ✅ | Before the fix: `SUBJECT_SPECIALIST` "Subject specialist" (`domain.js:1050`) | Fixed: `INDUSTRY_PROFESSIONAL`. |
| R8.13 | Identity Verified | ✅ | `VERIFICATION_TYPES.IDENTITY` (`domain.js:38-52`) | |
| R8.14 | Education Verified | ✅ | `EDUCATION` | |
| R8.15 | OCT Verified | ✅ | `OCT` | |
| R8.16 | Background/Vulnerable Sector Check Verified | ✅ | `BACKGROUND_CHECK`; curl 6 | |
| R8.17 | Availability: Today | ✅ | Before the fix: `search.js:35-37` enum; curl `availability=TODAY` → 422 | Implemented: `availability=TODAY`, evaluated on real open slots in the tutor's zone (`lib/search/availability-filter.js`). |
| R8.18 | Availability: Tomorrow | ✅ | Before the fix: Same | Implemented: `TOMORROW`. |
| R8.19 | Availability: This Week | ✅ | Before the fix: Same | Implemented: `THIS_WEEK` (to the coming Sunday). |
| R8.20 | Availability: Weekend | ✅ | Before the fix: `WEEKEND` window (`config.js:694`); curl 11 | Fixed: `WEEKEND` means a bookable slot this weekend. |
| R8.21 | Availability: Specific date/time | ✅ | Before the fix: No date/time parameter in `tutorSearchSchema` | Implemented: `date` + `time` (a slot starting exactly then). |
| R8.22 | Rating threshold | ✅ | `RATING_OPTIONS [4.5,4,3.5,3]` (`config.js:681`) | |
| R8.23 | Years of experience | ✅ | `EXPERIENCE_OPTIONS` (`config.js:683-688`); curl `minExperience=10` 3 | |

### 4.9 Tutor Search Result Cards

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R9.1 | Profile photo | ✅ | `src/components/tutor/TutorCard.jsx:53-76` | 11 of 12 seeded tutors have no avatar (initials shown). |
| R9.2 | First name + last initial | ✅ | `publicName` (`src/lib/utils/format.js:101-104`); API has no `lastName` | |
| R9.3 | Star rating and review count | ✅ | `TutorCard.jsx:92-96` | Count is zero-padded "(02)". |
| R9.4 | Verification badge(s) | ✅ | `TutorCard.jsx:84,399` (max 3) | |
| R9.5 | Top courses/subjects | ✅ | `TutorCard.jsx:129,404-434` | |
| R9.6 | Years of experience | ✅ | `TutorCard.jsx:375-380` | |
| R9.7 | Approximate distance | ✅ | Before the fix: Haversine `src/lib/geo/index.js:17-25`; `TutorCard.jsx:476-480` | Fixed: distance shown only for in-person tutors with a known location and a resolved search location. |
| R9.8 | Online / in-person status | ✅ | `TutorCard.jsx:278-340` | |
| R9.9 | Hourly rate | ✅ | `TutorCard.jsx:342-366` | |
| R9.10 | Next available time | ✅ | Before the fix: `TutorCard.jsx:384-389` reads cached `TutorProfile.nextAvailableAt`, written only on availability or booking writes (`availability.service.js:235-243`); no job refreshes it | Fixed: next available is computed live from the booking calendar for every card and for the "soonest" sort (`availability.service.nextAvailableFor`); a booking or group session moves it immediately (`05-search`). |
| R9.11 | View Profile button | ✅ | `TutorCard.jsx:67-69` | |
| R9.12 | View Availability button | ✅ | Before the fix: Not in `TutorCard.jsx`; 0 occurrences in rendered `/find-a-tutor` | Implemented: "View availability" on every card (`#availability` on the profile). |
| R9.13 | Optional Message and Book buttons | ✅ | Before the fix: Not in `TutorCard.jsx` | Implemented: "Message" and "Book" on every card. |

### 4.10 Tutor Public Profile

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R10.1 | Professional profile photo | ✅ | `src/components/tutor/TutorProfileHeader.jsx:24-29` | |
| R10.2 | First name + last initial | ✅ | `TutorProfileHeader.jsx:34-36`; `GET /api/tutors/priya-s-toro` has no `lastName` | |
| R10.3 | Rating and review count | ✅ | `TutorProfileHeader.jsx:55-59` | |
| R10.4 | Number of completed lessons | ✅ | `TutorProfileHeader.jsx:63-69`; `refreshTutorStats` (`tutor.service.js:745-789`) | Hidden when 0. |
| R10.5 | Hourly rate | ✅ | `TutorProfileHeader.jsx:118-125` | |
| R10.6 | Approximate location | ✅ | `TutorProfileHeader.jsx:77-85` (city, province) | |
| R10.7 | Online/in-person status | ✅ | `TutorProfileHeader.jsx:87-97` | |
| R10.8 | Response time | ✅ | Before the fix: Running average updated on tutor reply (`message.service.js:263-288`) | Fixed: the measured response time is shown, or nothing. |
| R10.9 | Verification badges | ✅ | `TutorProfileHeader.jsx:47-49` | |
| R10.10 | Introduction/bio | ✅ | `TutorProfileBody.jsx:31` | |
| R10.11 | Education | ✅ | `TutorProfileBody.jsx:105-160` | Per-entry "Verified" tag never shows (`TutorProfile.education[].verified` is never set). |
| R10.12 | Teaching/tutoring experience | ✅ | `TutorProfileBody.jsx:160+` | |
| R10.13 | Specific courses taught | ✅ | `TutorProfileBody.jsx:47-100` | |
| R10.14 | Availability calendar | ✅ | Before the fix: `BookingWidget.jsx:70`; `AvailabilityPicker.jsx:15-31` | Fixed: signed-out visitors get the full week-paged picker; a chosen slot survives sign-in (`lib/booking/widget-params.js`). |
| R10.15 | Reviews | ✅ | `ReviewsSection`; `GET /api/tutors/[slug]/reviews` | |
| R10.16 | Book button | ✅ | `BookingWidget.jsx:161` | Signed-out visitors see "Sign in to book". |
| R10.17 | Message button | ✅ | `MessageTutorPanel.jsx:22` | For a tutor or admin viewer the `#message` anchor points to nothing. |
| R10.18 | Save/Favourite button | ✅ | `TutorProfileHeader.jsx:39-44` → `FavouriteButton.jsx` | |
| R10.19 | Exact residential address never public | ✅ | `toPublicTutor` (`tutor.service.js:49-129`); curl of profile JSON and HTML shows no address, coordinates or postal prefix | The profile's JSON-LD block is an XSS sink (S1). |

### 4.11 Tutor Verification

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R11.1 | Identity Verified (government ID reviewed) | ✅ | `src/constants/domain.js:38-63`; `src/services/verification.service.js:58-136` (upload), `:171-225` (decision), `:227-260` (grant/revoke); `VerificationBadges.jsx:22-46` | Upload → admin decision → `TutorProfile.verifiedTypes` → public badge. The site says ID is "required of every tutor" (`src/app/(public)/verification/page.js:20,74`), but approval does not enforce it (`tutor.service.js:590-630`). |
| R11.2 | OCT Verified | ✅ | Same chain; OCT number validated as 6 digits (`src/lib/validation/tutors.js:92-97`); admin link to OCT register (`src/app/admin/applications/[id]/page.js:165-178`) | |
| R11.3 | Education Verified | ✅ | Same chain | |
| R11.4 | University Student Verified | ✅ | Same chain | |
| R11.5 | Background Check Verified (recent police/VSC) | ✅ | Before the fix: Expiry: `src/models/Verification.js:59-60`; `verification.service.js:355-382`; daily `verification-expiry` job (`vercel.json`) | Fixed: background-check badges always get an expiry (setting `backgroundCheckValidityMonths`, overridable); expiry job still runs on re-uploads (`20-onboarding`). |
| R11.6 | Clearly define what each badge means | ✅ | `src/app/(public)/verification/page.js:15-42,108-161`; `VERIFICATION_DESCRIPTIONS` | |
| R11.7 | Avoid implying verification guarantees performance or safety | ✅ | Before the fix: Only Terms §6 (`src/constants/legal.js:80`) | Fixed: `VERIFICATION_DISCLAIMER` on /verification, /safety, the profile trust card and the help centre. |

### 4.12 Become a Tutor Page

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R12.1 | How the platform works | ✅ | Before the fix: `src/app/(public)/become-a-tutor/page.js:202-235` | Fixed: an "After you apply" section covers verification → approval → bookings → teaching → payout → reviews. |
| R12.2 | Benefits of joining | ✅ | `page.js:91-146` | |
| R12.3 | Platform commission/fees | ✅ | Before the fix: `page.js:65-67,78,164` read `getSettings().commissionPercent` | Fixed: every number on the page comes from settings (commission, minimum rate, review time, payout hold, cancellation). |
| R12.4 | Tutor requirements | ✅ | `page.js:175-196` | |
| R12.5 | Verification process | ✅ | Before the fix: `page.js:113-115,191-194,250-257` | Fixed: the verification step is described concretely (ID required before approval, badges one at a time). |
| R12.6 | How tutors get paid | ✅ | `page.js:40-42,150-173` | |
| R12.7 | Tutor FAQs | ✅ | `page.js:22-55,262` | |
| R12.8 | "Create Your Tutor Profile" call to action | ✅ | `page.js:70-71,82-84,231-233,247-249` → `/register?role=TUTOR` | Labelled "Start my application". |

### 4.13 Tutor Application / Onboarding

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R13.1 | Personal information: name, email, phone, city, province | ✅ | `tutors.js:54-61`; `PersonalStep.jsx:13-75` | |
| R13.2 | Profile photo | ✅ | Before the fix: Not in the wizard (`ProfileStep.jsx`); Settings only (`ProfilePhotoPanel.jsx:76`) | Fixed: photo uploaded in the Profile step, required to submit, shown to the reviewer. |
| R13.3 | Biography, languages, years of experience | ✅ | `tutors.js:63-82,98`; `ProfileStep.jsx:31-134`; `QualificationsStep.jsx:80` | |
| R13.4 | Education: institution, degree/program, field, graduation year | ✅ | `tutors.js:18-30`; `EducationStep.jsx:61-135` | |
| R13.5 | Teaching qualifications: OCT or other credentials | ✅ | Before the fix: `tutors.js:88-100`; `domain.js:1044-1051` | Fixed: spec qualification list plus free-text "other credentials". |
| R13.6 | Subjects/courses: province → grade → subject → course | ✅ | Before the fix: `CoursesStep.jsx:18,33,180-199`; `src/app/tutor/onboarding/page.js:21` | Fixed: province → grade → subject → course picker driven by the curriculum APIs; server validates every course id (`CoursesStep.jsx`, `20-onboarding`). |
| R13.7 | Lesson type: online, in person or both | ✅ | `tutors.js:106-121`; `LessonTypeStep.jsx` | |
| R13.8 | Location: city, general area, travel radius | ✅ | `tutors.js:123-128`; `LocationStep.jsx:23-64`; `tutor.service.js:363-392` | General area is the postal prefix plus a centroid. |
| R13.9 | Pricing: hourly rate | ✅ | `tutors.js:130-140` (minimum $15) | The minimum is not enforced on later profile edits or per-course rates (`tutors.js:48,202`). |
| R13.10 | Availability: recurring weekly schedule | ✅ | `tutors.js:142-160`; `AvailabilityStep.jsx`; `tutor.service.js:458-474` | |
| R13.11 | Verification documents: secure upload | ✅ | Before the fix: `DocumentsStep.jsx:77-83,126` → `POST /api/tutor/verification/upload` → `uploadVerificationDocument` refuses when no `TutorProfile` exists (`verification.service.js:62-63`); `TutorProfile.create` exists only in `materialiseProfile`, called from `submitApplication` (`tutor.service.js:294,335,419`) | Fixed: documents upload against a profile id reserved on the application, are held out of the queue until submission, then promoted; the reviewer sees them (`verification.service.uploadTargetFor`, `20-onboarding`). |
| R13.12 | Submit application for administrator review | ✅ | `src/app/api/tutor/onboarding/submit/route.js`; `tutor.service.js:278-333` | |
| R13.13 | Not searchable until approved by an administrator | ✅ | `deriveSearchable` (`tutor.service.js:697-713`); `isSearchable:true` in every public query (`tutor-query.js:14`, `search.service.js:297,323-325`, `src/app/sitemap.js:55`, `curriculum.service.js:536`, `src/lib/matching/eligibility.js:24-25`) | Re-approving a suspended user's application makes them searchable again, because `deriveSearchable` ignores account status. |

### 4.14 Tutor Availability Calendar

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R14.1 | Recurring weekly availability | ✅ | `src/models/Availability.js:7-14`; `availability.service.js:90-122`; `TutorCalendar.jsx:195-240` | |
| R14.2 | Specific date blocking | ✅ | `Availability.js:17-30`; `availability.service.js:180-229`; `/api/tutor/availability/exceptions/*` | The UI blocks whole days, computed in the browser's time zone. |
| R14.3 | Vacation/unavailable periods | ✅ | `kind: VACATION` (`Availability.js:25`) | The `EXTRA` kind is accepted but does nothing (`slots.js:47`). |
| R14.4 | Prevent double-booking | ✅ | Before the fix: `src/lib/booking/slots.js:110-170`; `BookingSlotLock` + `settleSlotRace` (`booking.service.js:219-251,349-359,500-591`); external busy periods | Fixed: one busy-time definition (bookings + published group sessions + external calendars) for display, claim, reschedule and group publish; DST minutes read from the zone (`busyPeriodsForTutors`, `slots.js`). |
| R14.5 | Edit future availability | ✅ | `availability.service.js:90-104,128-166` | Edits apply to all future weeks; refused if they would strand a booking. |
| R14.6 | Support future Google Calendar / Outlook integrations | ✅ | `src/services/external/calendar-provider.js:107,212,539`; `src/services/calendar.service.js` | Real adapters exist (Phase Two, §6). |

### 4.15 Booking System

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R15.1 | Book directly from tutor profile | ✅ | `src/app/(public)/tutors/[slug]/page.js:89`; `BookingWidget.jsx:27` | |
| R15.2 | Select course | ✅ | `BookingWidget.jsx:33`; `assertTutorTeachesCourse` (`booking.service.js:122-127`) | |
| R15.3 | Select online or in-person | ✅ | `BookingWidget.jsx:34`; `booking.service.js:177` | |
| R15.4 | Choose date | ✅ | `AvailabilityPicker` (21 days) | |
| R15.5 | Choose available time | ✅ | `isSlotBookable` re-check; `claimSlots` (`booking.service.js:349`) | |
| R15.6 | Choose duration | ✅ | `src/lib/validation/bookings.js:40-44` (30/45/60/90/120) | |
| R15.7 | Display full lesson price | ✅ | `src/lib/booking/pricing.js:23-40`; `/api/bookings/quote`; `BookingWidget.jsx:575-617` | Price is server-derived. |
| R15.8 | Continue to secure payment | 🟡 | `src/app/(dashboard)/bookings/checkout/[paymentId]/page.js`; Stripe Checkout `payment-provider.js:287-350` | Works end to end only with the mock provider. The Stripe path is code-only; the configured account cannot take charges. |
| R15.9 | Receive confirmation | ✅ | Before the fix: `booking.service.js:1168-1213`; `/bookings/[id]?confirmed=1` | Fixed: confirmations carry location/online details, the amount actually paid and the live cancellation policy; tutor link goes to the tutor page (`45-booking-lifecycle`). |
| R15.10 | One-time and recurring lessons | ✅ | `RECURRENCE` (`domain.js:1032`); `seriesStartTimes` (`booking.service.js:614-620`), 2–24 weekly/biweekly occurrences under one `seriesId` and one payment | Packages cannot pay for a series. |

### 4.16 Payments and Tutor Payouts

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R16.1 | Marketplace-capable provider (Stripe Connect or equivalent) | 🟡 | `src/services/external/payment-provider.js:256-500` (Checkout + Connect Express, separate charges and transfers) | Real code, not exercisable: test account `charges_enabled:false`. The mock provider fakes onboarding and transfers. |
| R16.2 | Student pays through APlus Learn | 🟡 | `payment.service.js:41-100`; webhook settlement `webhook.service.js:300-360`; amount checked in `markPaymentPaid` (`payment.service.js:449-504`) | Code-verified only. |
| R16.3 | Platform commission deducted automatically | ✅ | `pricing.js:23-40` (snapshotted on `Booking.price`) | The platform collects 100 % and transfers the tutor share later. |
| R16.4 | Tutor portion tracked automatically | ✅ | Before the fix: `Booking.price.tutorEarningsCents`; `payableBookings` (`payout.service.js:160-168`) | Fixed: payable share is net of refunds on the booking; atomic payout claim; refunds after payout carried as deductions (`PayoutAdjustment`, `40-money`). |
| R16.5 | Commission percentage configurable by administrators | ✅ | `src/lib/validation/admin.js:323` (0–50); `MarketplaceSettings.jsx:20,80-91` | DB value 15. |
| R16.6 | Payment status visible to relevant users and admin | ✅ | Before the fix: Learner `src/app/(dashboard)/payments/*`; admin `src/app/admin/payments/page.js` | Fixed: tutors see the payment status (no card details) on their booking. |
| R16.7 | Refund support | ✅ | Before the fix: `payment.service.js:328-404`; `/api/admin/payments/[id]/refund` | Fixed: refunds are planned from what was collected (cash + re-credited account credit) before any booking is saved as cancelled (`payment.service.planLessonRefund`). |
| R16.8 | Tutor payout onboarding | 🟡 | `payout.service.js:36-152`; `/api/payouts/account`; `PayoutOnboarding.jsx` | Connect accounts are created with `payouts.schedule.interval: "manual"` (`payment-provider.js:430`) and nothing creates Stripe Payouts, so transferred funds may stay in the tutor's Stripe balance (to verify against Stripe). Dev onboarding completes instantly with "Mock Bank". |
| R16.9 | Tutor earnings dashboard | ✅ | Before the fix: `src/app/tutor/earnings/page.js`; `payment.service.js:668-749` | Fixed: "owed to you" is all-time and net of refunds; earnings use the payout rule (`tutorEarnings`). |
| R16.10 | Example $50 → 15 % = $7.50 → $42.50 | ✅ | `pricing.js:24-26` | 5000 × 15 / 100 = 750; 5000 − 750 = 4250. |

### 4.17 Messaging

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R17.1 | Private parent/student ↔ tutor conversations | ✅ | `src/models/Messaging.js:10-60` (2 participants, unique pair); `message.service.js:36-67,87-124,291-297` | Only a learner can start a thread (`:115-117`). Admins bypass the participant check, unaudited (S8). |
| R17.2 | Time and date stamps | ✅ | `Messaging.js:122`; `ConversationView.jsx:351-392` | |
| R17.3 | Booking-related messages | ✅ | Before the fix: `Messaging.js:21-22,106-108`; `conversationBookings` (`message.service.js:721-737`) | Fixed: confirmation, cancellation and reschedule are narrated in the thread as SYSTEM messages, once each (`booking-messages.service.js`). |
| R17.4 | Website notifications | ✅ | `message.service.js:201-213` → `notification.service.js:49-71`; SSE `src/services/realtime.service.js` | Unread counts per user; realtime hints only. |
| R17.5 | Optional future file attachments | ✅ | `/api/messages/attachments/*`; `message.service.js:134-159,629-668`; `attachment.service.js` | |
| R17.6 | Report/block | ✅ | Block `message.service.js:126-132,460-471`; report `:495-517` → `src/app/admin/moderation` | Block is one-way. Admins get no notification of reports, only a queue badge. |
| R17.7 | Anti-circumvention against moving payment off-platform | ✅ | Before the fix: `message.service.js:93` only `sanitizeMultiline` (control characters); no email, phone or payment-word detection anywhere in `src/`; no risk signal for it (`domain.js:888-894`) | Implemented: contact details are masked before storage, off-platform payment language flagged, risk signal recorded (`lib/messaging/contact-detection.js`, `e2e-journeys` M). |

### 4.18 Post a Tutor Request

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R18.1 | Course | ✅ | `src/lib/validation/engagement.js:149-155`; `request.service.js:281-315`; `RequestForm.jsx:159` | |
| R18.2 | Location | ✅ | `engagement.js:118-121,145-146`; `request.service.js:1151-1158` | |
| R18.3 | Online/in-person | ✅ | `TutorRequest.js:45-50` | |
| R18.4 | Preferred schedule | ✅ | `engagement.js:122-126`; `RequestForm.jsx:336-361` | Named windows. |
| R18.5 | Budget | ✅ | `engagement.js:127-128,143` | |
| R18.6 | Goal | ✅ | `engagement.js:138` | |
| R18.7 | Desired start date | ✅ | `engagement.js:139` | |
| R18.8 | Optional notes | ✅ | `engagement.js:140` | |
| R18.9 | Matching tutors indicate interest | ✅ | Before the fix: `/api/requests/[id]/interest`; `request.service.js:645-718` | Fixed: only eligible tutors can express interest (`30-requests-reviews`). |
| R18.10 | Parent compares interested tutors and chooses one | ✅ | Before the fix: `/api/requests/[id]/matches`; `MatchComparison.jsx`; `request.service.js:154-215,778-815` | Fixed: booking from a request is validated server-side and closes the request on payment (`45-booking-lifecycle`). |
| R18.11 | Requests expire automatically or are closable | ✅ | `request.service.js:334,819-888,990-1071`; `request-expiry` job (daily) | Read paths check only `status`, so a request stays open up to about 24 h after `expiresAt`. |

### 4.19 Tutor Matching

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R19.1 | MVP rules-based matching on course, location, budget, availability | ✅ | `src/lib/matching/eligibility.js:22-108`; `score.js:100-196`; `request.service.js:446-540` | Course and location are hard gates; budget and availability are scored. |
| R19.2 | Future: teaching style, student goals, ratings, repeat booking rate, response rate, availability | 🟡 | `src/lib/matching/weights.js:19-44`; `score.js:198-263` | Ratings and availability are used. Response *time*, not rate. Teaching style, goals and repeat-booking rate are not scored. |

### 4.20 Favourites / Saved Tutors

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R20.1 | Save tutors to a personal list | ✅ | `/api/favourites` (`FAVOURITE_MANAGE`); `student.service.js:157-178`; `FavouriteButton.jsx` | |
| R20.2 | Return later to compare or book | ✅ | Before the fix: `src/app/(dashboard)/favourites/page.js` | Fixed: only searchable tutors are listed or can be saved. |

### 4.21 Reviews and Ratings

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R21.1 | 1–5 star rating | ✅ | `engagement.js:77-83`; `src/models/Engagement.js:71` | |
| R21.2 | Optional written review | ✅ | Before the fix: `engagement.js:85-89` (body **required**, ≥20 characters) | Fixed: written review optional. |
| R21.3 | Categories: knowledge, communication, reliability, teaching ability | ✅ | `engagement.js:79-82`; `Engagement.js:72-75`; per-category averages in `tutor.service.js:753-783` | |
| R21.4 | Only users with completed bookings can leave verified reviews | ✅ | `review.service.js:35-49`; unique `bookingId` (`Engagement.js:50-56`) | A rejected dispute can turn an unpaid or cancelled booking into COMPLETED, which then becomes reviewable (S4). |
| R21.5 | Admin moderation and reporting workflow | ✅ | Before the fix: `/api/reviews/[id]/report`; `review.service.js:171-253`; `src/app/admin/reviews/page.js` | Fixed: any member can report; pending-approval queue; moderation audited (`30-requests-reviews`). |

### 4.22 Parent / Student Dashboard

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R22.1 | Upcoming lessons | ✅ | `src/app/(dashboard)/bookings/page.js:14-19`; `booking.service.js:1238-1240`; dashboard next-lesson panel | Runtime: page renders for the seeded parent at all 4 viewports. |
| R22.2 | Past lessons | ✅ | Before the fix: `booking.service.js:1242-1251` (COMPLETED, NO_SHOW_*, DISPUTED) | Fixed: Past/Upcoming split on the lesson's end by the clock; `lesson-completion` job completes unmarked lessons after the no-show window (`40-money`). |
| R22.3 | My Tutors | ✅ | Before the fix: `src/app/(dashboard)/tutors/page.js:18`; `tutor.service.js:796-822` | Fixed: only real lesson relationships. |
| R22.4 | Saved Tutors | ✅ | `src/app/(dashboard)/favourites/page.js` | |
| R22.5 | Messages | ✅ | `src/app/(dashboard)/messages/*` | |
| R22.6 | Tutor Requests | ✅ | `src/app/(dashboard)/requests/*` | |
| R22.7 | Payments/receipts | ✅ | Before the fix: `src/app/(dashboard)/payments/page.js`, `payments/[id]/page.js`; `getReceipt` (`payment.service.js:648-665`) | Fixed: an unsettled payment has no receipt; totals are account-wide, not the page. |
| R22.8 | Children/student profiles | ✅ | `src/app/(dashboard)/children/page.js` | Field gaps are in §4.5. |
| R22.9 | Profile and account settings | ✅ | `src/app/(dashboard)/settings/page.js`; `SettingsPanels.jsx` | |

### 4.23 Tutor Dashboard

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R23.1 | Dashboard overview | ✅ | `src/app/tutor/dashboard/page.js:9-29` | |
| R23.2 | Next lesson | ✅ | `tutor/dashboard/page.js:166,425-441` | `Avatar` gets the full `lastName` without `name`, so its `sr-only` label prints a minor's surname (S5). |
| R23.3 | Calendar | ✅ | `src/app/tutor/calendar/page.js`; `availability.service.js:257` | Full student `lastName` is passed to the client `TutorCalendar` (S5). |
| R23.4 | Bookings / booking requests | 🟡 | `src/app/tutor/bookings/page.js:14-18` | Bookings: yes. There is no request-to-book or accept/decline step; a booking is confirmed by payment. |
| R23.5 | Students | ✅ | Before the fix: `src/app/tutor/students/page.js:26-52,98-100,160` | Fixed: roster from real lesson relationships; earned = completed lessons net of refunds (`10-learners`). |
| R23.6 | Messages | ✅ | `src/app/tutor/messages/*` | A tutor cannot start a thread with a family who booked (`message.service.js:115-117`). |
| R23.7 | Earnings and payouts | ✅ | Before the fix: `src/app/tutor/earnings/page.js`; `src/app/tutor/payouts/page.js` | Fixed with R16.9. |
| R23.8 | Reviews | ✅ | `src/app/tutor/reviews/page.js`; `ReviewReplyForm.jsx` | |
| R23.9 | Tutor request opportunities | ✅ | `src/app/tutor/requests/page.js:15` | |
| R23.10 | Profile editing | ✅ | `src/app/tutor/profile/page.js:43` (`ProfileEditor`) | |
| R23.11 | Verification status | ✅ | `src/app/tutor/verification/page.js:47` | |

### 4.24 Lesson Confirmation and Notifications

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R24.1 | Both parties receive confirmation after payment | ✅ | `booking.service.js:1168-1213` (purchaser BOOKING_CONFIRMED, tutor BOOKING_CREATED; in-app and email) | The tutor email CTA links to learner-only `/bookings/:id` (`email-templates.js:249`), which redirects tutors away. |
| R24.2 | Tutor | ✅ | `src/services/external/email-templates.js:243` | |
| R24.3 | Course | ✅ | `email-templates.js:242` | |
| R24.4 | Date | ✅ | `email-templates.js:244` | |
| R24.5 | Time | ✅ | `email-templates.js:244` | |
| R24.6 | Format | ✅ | `email-templates.js:246` | |
| R24.7 | Location or online details | ✅ | Before the fix: `bookingEmailPayload` (`booking.service.js:1215-1229`) has no location or meeting fields | Fixed with R15.9. |
| R24.8 | Amount paid | ✅ | Before the fix: `booking.service.js:1226` (`booking.price.totalCents`) | Fixed: the Payment's total (series and credit correct). |
| R24.9 | Cancellation policy | ✅ | Before the fix: Not in the email; shown on the lesson page (`BookingDetail.jsx:328`) and before booking | Fixed: policy text from settings. |
| R24.10 | MVP: email + in-site notifications | 🟡 | `src/services/notification.service.js:48-87` | In-site works. Email goes to the development console: no Resend/SMTP is configured. |
| R24.11 | Future: SMS and mobile push | 🟡 | SMS `notification.service.js:84`, `sms-templates.js` (Twilio, not configured); push is a preference flag only, labelled "coming soon" (`SettingsPanels.jsx:291-294`) | Future scope; noted for completeness. |

### 4.25 Online Lessons

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R25.1 | Zoom / Google Meet / Teams links stored against the booking | 🟡 | Before the fix: `src/models/Booking.js:188-189`; `src/services/meeting.service.js:88-120,348` (retry, manual paste, disable); real adapters `meeting-provider.js:100-560` | Production no longer fabricates join links (no link; the tutor pastes one). Real Zoom/Meet/Teams rooms need the excluded meeting providers. |

### 4.26 In-Person Lessons

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R26.1 | Student's home | ✅ | `src/constants/domain.js:122-128`; `BookingWidget.jsx:323-352` (address collected, `:338`) | |
| R26.2 | Tutor's location | ✅ | Same | |
| R26.3 | Library | ✅ | Same | No detail captured. |
| R26.4 | Public location | ✅ | Same | No detail captured. |
| R26.5 | Other agreed location | ✅ | Before the fix: Same | Fixed: OTHER requires a description, kept private until confirmation; the type must be one the tutor offers. |
| R26.6 | Private addresses shared only after booking, never on profiles | ✅ | `Booking.js:103` (`addressLine` `select:false`); release only when CONFIRMED/COMPLETED, to participants or admin (`booking.service.js:1339-1346`) | |

### 4.27 Cancellations, Refunds and No-Shows

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R27.1 | Configurable cancellation window | ✅ | `src/lib/booking/policy.js:53`; `validation/admin.js:324` (default 24 h) | Legal and marketing pages hard-code "24 hours" or read `DEFAULT_SETTINGS`, so they can contradict the enforced value. |
| R27.2 | Student cancellation workflow | ✅ | Before the fix: `/api/bookings/[id]/cancel`; `booking.service.js:1416-1581`; `BookingActions.jsx:92` | Fixed: an unpaid cancellation refunds nothing, voids the checkout and returns credit; a late payment is refunded. |
| R27.3 | Tutor cancellation workflow | ✅ | Same path, role TUTOR → 100 % refund (`policy.js:44-46`) | |
| R27.4 | Full/partial refund rules | ✅ | `policy.js:40-90` | |
| R27.5 | No-show reporting | ✅ | Before the fix: `reportNoShow` (`booking.service.js:1665,1750-1800`); `/api/bookings/[id]/no-show` (`BOOKING_VIEW`); tutor path via `completeBooking` (`:1685-1706`) | Fixed: a learner's tutor-no-show report opens a dispute (no self-refund); only CONFIRMED, ended, unpaid-out lessons inside `noShowReportWindowHours`; learner UI added (`40-money`). |
| R27.6 | Administrator dispute review | ✅ | Before the fix: `src/app/admin/disputes/*`; `dispute.service.js:25-86,185-279` | Fixed: disputes only on eligible, paid lessons inside `disputeWindowDays`; decisions restore the interrupted status or the decided outcome; partial refunds net the payout (`40-money`). |
| R27.7 | Track repeated no-shows/cancellations | ✅ | Before the fix: Cancellation counter and risk signal (`booking.service.js:1583-1620`; `risk.service.js:238-289`) | Fixed: every no-show path records the pattern signal. |
| R27.8 | Warnings, suspension or removal for repeated abuse | ✅ | Before the fix: Automatic in-app warning at the cancellation threshold (`policy.js:220-235`; `booking.service.js:1606-1617`); risk queue `src/app/admin/risk`; manual SUSPEND/DELETE (`user.service.js:434-455`) | Fixed: warning/review at the configured no-show threshold, as for cancellations. |

### 4.28 Administrator Dashboard

Every `src/app/admin/**/page.js` (29 files) calls `enforceRole(ROLES.ADMIN)`. Every one of the 49 `src/app/api/admin/**/route.js` exports carries a `permission:` option. All 15 admin pages swept rendered for the seeded admin at all 4 viewports.

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R28.1 | View parents, students and tutors | ✅ | `src/app/admin/users/page.js:19-22,53`; `user.service.js:372-398` | Children appear under the parent's detail page. |
| R28.2 | Suspend/ban/restore accounts | ✅ | Before the fix: `validation/admin.js:20-28`; `user.service.js:425-480`; suspension blocks password, OAuth, session and SSE (`current-user.js:26-30`, `auth.service.js:205,358`) | Fixed: distinct BAN, audited restore, no self/last-admin action; search state kept in step (`60-admin-security`). |
| R28.3 | View user history as permitted | ✅ | Before the fix: `src/app/admin/users/[id]/page.js` (stats, learners, 20 audit rows) | Fixed: account detail lists bookings, payments and conversations (no bodies); spend from payments. |
| R28.4 | Review applications | ✅ | `src/app/admin/applications/*`; `/api/admin/applications/*` (`ADMIN_TUTOR_REVIEW`) | No DRAFT tab, so an info-requested application disappears from every tab once edited. |
| R28.5 | View secure documents | ✅ | `ApplicationReview.jsx:188-205`; `/api/admin/verification/documents/[id]` (audited, sandbox CSP) | Views are logged as `VERIFICATION_BADGE_GRANTED` (`verification.service.js:154-160`). |
| R28.6 | Approve/reject | ✅ | `tutor.service.js:590-690` | The note "included in their approval email" is never sent (`tutor.service.js:646`). |
| R28.7 | Request more information | ✅ | `tutor.service.js:630-634`; badge level `verification.service.js:182-187` | |
| R28.8 | Assign/remove verification badges | ✅ | Before the fix: `TutorRowActions.jsx:134-221`; `/api/admin/tutors/[id]/badges`; `verification.service.js:263-311` | Fixed: expiry on grants; restore-to-search works (`20-onboarding`). |
| R28.9 | Add/edit provinces | ✅ | `/api/admin/curriculum/provinces/*`; `CurriculumManager.jsx` | |
| R28.10 | Grades | ✅ | Before the fix: `/api/admin/curriculum/grades/*` | Fixed: deactivated grades stay listed for admins; renames cascade with slug aliases. |
| R28.11 | Subjects | ✅ | Before the fix: `/api/admin/curriculum/subjects/*` | Fixed: same for subjects. |
| R28.12 | Courses | ✅ | `/api/admin/curriculum/courses/*` | Delete blocked while tutors teach it. Admin list caps at 100 per province. |
| R28.13 | Course codes | ✅ | Course `code` field | Renaming a code doesn't update tutors' copied `courseCodes`. |
| R28.14 | View upcoming/completed/cancelled bookings | ✅ | Before the fix: `src/app/admin/bookings/page.js:22-28` | Fixed: Upcoming / Past / Cancelled / No-shows / Disputed / Unpaid / Expired views; money from collected payments. |
| R28.15 | Transactions | ✅ | `src/app/admin/payments/page.js`; `/api/admin/payments` | |
| R28.16 | Commissions | ✅ | Before the fix: Per row on admin payments and bookings | Fixed: totals over the whole filtered set (`paymentTotals`). |
| R28.17 | Tutor earnings | ✅ | Before the fix: `src/app/admin/payouts/page.js`; `pendingPayoutSummary` (`payout.service.js:396-438`) | Fixed: per-tutor earnings table (earned net, paid, in flight, deductions, owed). |
| R28.18 | Refunds | ✅ | `RefundButton` (`admin/payments/page.js:151`) | Doesn't adjust the booking or payout (R16.4). |
| R28.19 | Payout status | ✅ | Before the fix: `admin/payouts/page.js:164`; `PayoutActions.jsx` | Fixed: payout state machine enforced server-side and in the UI; FAILED is final (`40-money`). |
| R28.20 | Review complaints | ✅ | Before the fix: Review reports (`review.service.js:171-253`); support enquiries (`support.service.js:30-82`) | Fixed: support enquiries are stored tickets with an admin queue. |
| R28.21 | No-shows | ✅ | Before the fix: `reportNoShow` (audited); dispute reasons TUTOR_NO_SHOW/STUDENT_NO_SHOW (`domain.js:399-406`) | Fixed: No-shows view on admin bookings. |
| R28.22 | Refund disputes | ✅ | Before the fix: `src/app/admin/disputes/*`; `dispute.service.js` | Fixed with R27.6. |
| R28.23 | Reported reviews | ✅ | `admin/reviews/page.js:17-32` (Reported tab) | |
| R28.24 | Reported tutor requests | ✅ | Before the fix: No report path in `request.service.js`, routes or pages | Implemented: members report requests; admin report queue; dismiss/remove audited. |
| R28.25 | Analytics: registered and approved tutors | ✅ | Before the fix: `analytics.service.js:261-262` | Fixed: registered vs approved tutors reported separately. |
| R28.26 | Analytics: active students | ✅ | Before the fix: `analytics.service.js:265` | Fixed: distinct learners with a confirmed/completed lesson in the period. |
| R28.27 | Analytics: bookings | ✅ | `analytics.service.js:179-240` | |
| R28.28 | Analytics: gross tutoring sales | ✅ | `analytics.service.js:102-170` (Payment on `paidAt`) | |
| R28.29 | Analytics: platform revenue | ✅ | `analytics.service.js:166-167` | |
| R28.30 | Analytics: average booking value | ✅ | Before the fix: `analytics.service.js:313-315` | Fixed: per booked lesson, from payments. |
| R28.31 | Analytics: most searched subjects/courses | ✅ | Before the fix: No implementation found after inspecting `src/models` (every `mongoose.model` registration), `src/services/search.service.js` and the database's 42 collections | Implemented: anonymous `SearchEvent` per search (curriculum meaning, mode, resolved city — no text, postal code or identity); admin report from `searchDemand` (`05-search`, `60-admin-security`). |
| R28.32 | Analytics: most active cities | ✅ | Before the fix: `analytics.service.js:369-375` | Fixed: cities by activity in the period. |
| R28.33 | Analytics: online vs in-person bookings | ✅ | `analytics.service.js:376-379` | |
| R28.34 | Analytics: new registrations | ✅ | `analytics.service.js:270-271` | |

### 4.29 Location and Distance Search

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R29.1 | Postal code/city search via a mapping/geocoding service | 🟡 | Before the fix: `geocoding-provider.js` (`LocalTableGeocodingProvider` active; `GoogleGeocodingProvider` needs `GOOGLE_MAPS_API_KEY`, not set) | The application defect is fixed: no province-centroid fallback; unknown places are reported and answered from tutor data (`geocoding-provider.js`, `search.service.resolveLocation`). A real geocoding service (Google) is an excluded external provider. |
| R29.2 | Approximate distance calculations | ✅ | Before the fix: 2dsphere (`TutorProfile.js:203`); `$centerSphere` (`tutor-query.js:45-49`); coordinates rounded to 0.01° | Fixed: closest-first over the whole set. |
| R29.3 | Never expose exact tutor residential addresses in search results | ✅ | curl of `/api/search/tutors` responses: no address, coordinate or postal fields for tutors; stored location is a postal-prefix centroid (`tutor.service.js:360-397,541-549`) | |

### 4.30 Security and Privacy

Full findings with severities are in §11.

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R30.1 | HTTPS | 🟡 | `next.config.mjs:95,163` (HSTS, production only); `upgrade-insecure-requests` (production); cookies `secure` in production (`src/lib/auth/session.js`) | No app-level redirect; TLS depends on the host. Not verifiable on localhost. |
| R30.2 | Secure password hashing | ✅ | `src/lib/auth/password.js:4` (bcryptjs, cost 12); `passwordHash` `select:false` (`User.js:51`) | Policy allows 128 characters; bcrypt reads 72 bytes (Info). |
| R30.3 | Role-based access controls | ✅ | `src/lib/api/handler.js`; `src/constants/roles.js`; ownership against loaded records (`booking.service.js:1329-1334`, `payment.service.js:610-614`, `student.service.js:26,56,85`, etc.) | 21 protected routes returned 401 unauthenticated. No IDOR found in about 25 sampled services. Admin conversation bypass (S8). |
| R30.4 | Secure authentication | 🟡 | HS256 JWT (issuer/audience), httpOnly + SameSite=Lax; `tokenVersion` revocation; role and status reloaded per request (`current-user.js`); login rate limits; new-device emailed code (`login-verification.service.js`); OAuth state/nonce/PKCE | IP limits trust a spoofable `X-Forwarded-For` (S11). No admin 2FA (S14). Verification lifts suspension (S7). |
| R30.5 | Secure verification document storage | 🟡 | 8 MB limit, byte-sniffed type, UUID keys, path-traversal guard (`storage-provider.js:139-147,223-229`); admin-only audited serving | Production falls back to unencrypted local disk when S3 is not configured (S10). Documents are never deleted (S9). |
| R30.6 | Payment details handled by the payment provider | ✅ | Before the fix: Stripe hosted Checkout (`payment-provider.js:300`); webhook signature (`:483-499`) | Fixed: the card-capture route answers 404 before reading a body when hosted checkout is in use. |
| R30.7 | Privacy controls for minors | ✅ | Before the fix: Masking at render only (`format.js:119`); `booking.service.js:1277,1318` populate `lastName`; `Avatar.jsx:51,86` `sr-only` label; `tutor/students/page.js:98-100` | Fixed: minors' surnames removed in the services; Avatar labels use the masked name (`10-learners`). |
| R30.8 | Secure administrator dashboard | 🟡 | `enforceRole` on all admin pages; `permission:` on all admin APIs | One all-powerful role; no 2FA or step-up; 14-day sessions. |
| R30.9 | Audit logging for important admin actions | ✅ | Before the fix: `src/services/audit.service.js`; audited: suspend/delete, approvals, badges, refunds, payouts, credit, curriculum, settings, integrations, disputes, risk, moderation; viewer `/admin/audit` | Fixed: distinct action names; audit-write failures logged loudly. |
| R30.10 | Defined data retention/deletion processes | ✅ | Before the fix: Self-delete anonymises the User row (`user.service.js:113-183`); TTL indexes only on rate-limit, auth-token and trusted-device collections | Fixed: one anonymisation routine for self and admin deletion; verification-document retention job (`verificationDocumentRetentionDays`) (`60-admin-security`, `20-onboarding`). |
| R30.11 | Canadian privacy/legal review before launch | ⚪ | `src/constants/legal.js` (last updated 15 Sep 2026); no PIPEDA, Quebec Law 25 or privacy-officer content | No evidence of a review; the text contains claims the code contradicts. |

### 4.31 Mobile Responsiveness and Future Apps

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R31.1 | Fully responsive on desktop, tablet and smartphone | ✅ | Runtime sweep: 57 routes × 4 viewports = 228 loads; 0 with horizontal page overflow, 0 redirected to `/login`, 0 HTTP errors | Data tables scroll inside their card on phone and tablet (columns cut off until scrolled). Some icon buttons are below 32 px. Details in §12. Interactive flows were not exercised. |
| R31.2 | Backend usable by future iOS/Android apps | 🟡 | JSON envelope on all feature routes (`src/lib/api/response.js`); SSE realtime | Auth is cookie-only (`session.js:86-122`, audience `apluslearn:web`): no bearer tokens or refresh tokens. Checkout is hosted Stripe with web return URLs. No push. No API versioning. |

### 4.32 SEO and Public Landing Pages

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R32.1 | Public tutor and course pages indexable and optimised | ✅ | curl: `/ontario/grade-12/mathematics/mhf4u` 200, title, canonical, `Course` JSON-LD, server-rendered; `/tutors/priya-s-toro` 200, `Person` JSON-LD; `robots.txt` and `sitemap.xml` (307 URLs) | Invalid dynamic URLs return 200 with both `index, follow` and `noindex` meta (soft 404, from root `src/app/loading.js`). Observed on dev. |
| R32.2 | "MHF4U tutor Toronto" | ✅ | `/tutors/mhf4u/toronto` 200, "MHF4U tutors in Toronto" | |
| R32.3 | "Grade 12 math tutor Scarborough" | ✅ | Before the fix: `src/app/(public)/tutors/[slug]/[city]/page.js:35-41` accepts course codes only; `/tutors/math/scarborough` → soft 404 | Implemented: `/tutors/grade-12-math/scarborough` and subject/alias + city pages, data-driven, in-person tutors for that place (`50-public`). |
| R32.4 | "ENG4U tutor Toronto" | ✅ | `/tutors/eng4u/toronto` 200 | |
| R32.5 | "Ontario math tutor" | ✅ | Before the fix: `/ontario` 404; `/ontario/grade-12/mathematics` 404 | Implemented: `/ontario`, `/ontario/math`, `/british-columbia/mathematics`, grade + subject pages; unknown/inactive → 404. |
| R32.6 | "Calculus tutor near me" | ✅ | Before the fix: `/tutors/mcv4u/toronto` 200; `/tutors/calculus/toronto` soft 404 | Fixed: course aliases (`/tutors/calculus/toronto`). |
| R32.7 | URL structure `/ontario/grade-12/math/mhf4u` | ✅ | Before the fix: `src/app/(public)/[province]/[grade]/[subject]/[course]/page.js` | Fixed: slugs, aliases and codes resolve; non-canonical forms redirect permanently to the canonical URL. |
| R32.8 | URL structure `/tutors/mhf4u/scarborough` | ✅ | curl 200, "MHF4U tutors in Scarborough", canonical | No JSON-LD. |
| R32.9 | Shareable public tutor profile URL | ✅ | `/tutors/[slug]` with canonical and og:type profile | |

### 4.33 Customer Support and Legal Pages

| ID | Requirement | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| R33.1 | Help Centre | ✅ | Before the fix: `/help`, `/help-centre` 404; footer link goes to `/support` (4 topic cards + FAQ) | Implemented: `/help-centre`, built from live settings and policies. |
| R33.2 | Contact Support | ✅ | Before the fix: `/support`; `SupportEnquiryForm.jsx:30` → `/api/support/enquiries` → `support.service.js:30-80` | Fixed: enquiries stored and worked from an admin queue; no placeholder phone. |
| R33.3 | About Us | ✅ | `/about` 200 | Same placeholder phone. |
| R33.4 | How It Works | ✅ | `/how-it-works` 200 | Hard-codes "24 hours". |
| R33.5 | Find a Tutor | ✅ | `/find-a-tutor` 200, server-rendered | |
| R33.6 | Become a Tutor | ✅ | `/become-a-tutor` 200 | |
| R33.7 | Pricing/Fees | ✅ | `/pricing` 200, reads `getSettings()` | Hard-codes "24 hours" (`pricing/page.js:33,82`). |
| R33.8 | Tutor Verification | ✅ | `/verification` 200 | |
| R33.9 | Safety | ✅ | `/safety` 200 | |
| R33.10 | FAQ | ✅ | `/faq` 200, FAQPage JSON-LD | |
| R33.11 | Terms of Service | ✅ | Before the fix: `/legal/terms` 200; `legal.js:33-112` | Fixed: operator name and governing law from settings; numbers from live settings. Legal review itself remains R30.11. |
| R33.12 | Privacy Policy | ✅ | Before the fix: `/legal/privacy` 200; `legal.js:114-198` | Fixed: retention statement matches the code (setting-driven); deletion discards documents. Legal review remains R30.11. |
| R33.13 | Cookie Policy | ✅ | Before the fix: `/legal/cookies` 200; `legal.js:200-233` | Fixed: every cookie the app sets plus browser storage and service-worker caches. |
| R33.14 | Cancellation/Refund Policy | ✅ | Before the fix: `/legal/cancellation` 200; `legal.js:235-294` | Fixed: numbers from live settings. |
| R33.15 | Community Standards | ✅ | Before the fix: `/legal/community-standards` soft 404; not in `LEGAL_SLUGS` (`legal.js:343`) | Implemented: `/legal/community-standards`. |
| R33.16 | Tutor Agreement | ✅ | Before the fix: `/legal/tutor-agreement` soft 404 | Implemented: `/legal/tutor-agreement`. |

### 4.34 MVP – Required for Initial Launch

See §5. 3 ✅ · 14 🟡 · 5 🟠 · 0 🔴.

### 4.35 Phase Two

See §6. 7 ✅ · 4 🟡.

### 4.36 Phase Three

See §7. 2 ✅ · 1 🟡 · 11 🔴.

### 4.37 Core Parent Journey

See §8. 7 ✅ · 10 🟡 · 1 🟠 (18 steps).

### 4.38 Core Tutor Journey

See §9. 10 ✅ · 5 🟡 · 1 🟠 (16 steps).

### 4.39 Product Differentiators

See §10. 2 ✅ · 6 🟡.

### 4.40 Development Priority

The original priority order, with current status. Used to order the roadmap in §16.

| Priority | Area | Status | Main reason |
|---|---|---|---|
| 1 | Search and matching | 🟠 | Geocoding fallback to Toronto; course-code misdetection; no date availability filters; stale "next available" |
| 2 | Tutor profiles | 🟡 | Functionally complete; stored XSS in JSON-LD (S1) |
| 3 | Curriculum/course-code structure | 🟡 | Structure complete; 38 courses; Ontario hard-coding |
| 4 | Availability and booking | 🟡 | Group/1:1 overlap; confirmation content; unpaid-cancel defect |
| 5 | Payments/payouts | 🟠 | Double-pay, refund/payout mismatch, live Stripe unverified |
| 6 | Tutor onboarding and verification | 🟠 | Wizard document upload fails |
| 7 | Parent/student and tutor dashboards | 🟠 | Past lessons, Students roster |
| 8 | Messaging | 🟡 | Anti-circumvention missing |
| 9 | Reviews | 🟡 | Mandatory text; limited reporting |
| 10 | Administrator management | 🟠 | Dispute status defect; no search analytics; reported requests |

### 4.41 Final Development Objective

| ID | Statement | Status | Notes |
|---|---|---|---|
| R41.1 | A parent arriving knowing only the subject or course can find, compare, check online/nearby, book, pay, communicate, attend, review and rebook, all within APlus Learn | 🟡 | Possible end to end in development mode. Blocked in practice by location search outside the bundled table, no working meeting links without a provider, and a payment provider that cannot charge. |
| R41.2 | A tutor can join, build a profile, select exactly what they teach, set price and availability, receive bookings and get paid without their own infrastructure | 🟡 | Document upload fails in the wizard. Course selection is Ontario-only search. Payout money movement is manual and has double-pay defects. |
| R41.3 | Feels like a modern service marketplace, not a classified-ad directory | ⚪ | Subjective. Screenshots show a consistent designed UI, with integrated booking, payments and messaging rather than contact listings. |

---
## 5. MVP Readiness

| # | MVP item (§34) | Status | Evidence | Missing pieces | Production concerns |
|---|---|---|---|---|---|
| M1 | Parent/student registration | ✅ | R4.1–R4.12 | — (fixed, see §0) | Google/Apple not configured; verification email goes to dev console; verify-email lifts suspension |
| M2 | Tutor registration and application | ✅ | R13.1–R13.13 | — (fixed, see §0) | Applications reach admins without documents (M19) |
| M3 | Administrator access | ✅ | R3.6, R28; `enforceRole` on 29 pages, permissions on 49 admin routes | — (fixed, see §0) | No 2FA; single all-powerful role; 14-day sessions (S14) |
| M4 | Tutor profiles | ✅ | R10.1–R10.19 | — (fixed, see §0) | **Stored XSS via headline JSON-LD (S1)** |
| M5 | Tutor approval and verification badges | ✅ | R11, R13.13, R28.4–R28.8 | — (fixed, see §0) | "Restore to search" broken; badge-grant records can lack `userId` |
| M6 | Ontario curriculum/course-code database | 🟡 | R6.1–R6.5 | Catalogue data (full Ontario list loaded via Admin → Curriculum) | Seed script wipes data and has no production guard |
| M7 | Tutor search and filters | ✅ | R7, R8 | — (fixed, see §0) | "Next available" stale; subject words misread as codes |
| M8 | Location + online/in-person filtering | 🟡 | R7.6, R7.7, R29.1 | Real geocoding service (excluded); the Toronto fallback is fixed | Online-only tutors dropped when a location is given; out-of-province postcodes ignore location |
| M9 | Availability calendar | ✅ | R14.1–R14.6 | — (fixed, see §0) | — |
| M10 | Booking system | ✅ | R15.1–R15.10 | — (fixed, see §0) | Slot choice not kept across sign-in |
| M11 | Secure payments | 🟡 | R16.1–R16.2, R30.6 | Live Stripe charges (excluded); development provider completes the flow | Capture route accepts raw card fields; dev mock is the only working path |
| M12 | Tutor payouts | 🟡 | R16.4, R16.8, R28.19; `payout.service.js:160-322` | Stripe payout schedule (excluded); payout integrity fixed | **Double-pay race; FAILED → PAID; refunds not deducted (S3)** |
| M13 | Messaging | ✅ | R17.1–R17.7 | — (fixed, see §0) | Admin can read and post in any thread unaudited (S8) |
| M14 | Cancellations/refunds | ✅ | R27.1–R27.8, R16.7 | — (fixed, see §0) | **No-show self-refund on completed lessons (S2)**; credit-applied refunds fail; unpaid-cancel charge |
| M15 | Reviews | ✅ | R21.1–R21.5 | — (fixed, see §0) | Pending-moderation path not reachable in UI if enabled |
| M16 | Parent/student dashboard | ✅ | R22.1–R22.9 | — (fixed, see §0) | Failed payments get a "receipt" |
| M17 | Tutor dashboard | ✅ | R23.1–R23.11 | — (fixed, see §0) | Students roster and "Earned" wrong; surname leak |
| M18 | Administrator dashboard | ✅ | R28.1–R28.34 | — (fixed, see §0) | Page-only totals; deactivated grades and subjects vanish |
| M19 | Secure verification document uploads | 🟡 | R13.11, R30.5 | S3 storage (excluded); wizard upload fixed, production fails closed | Local-disk fallback in production; documents never deleted |
| M20 | Basic reporting/dispute management | ✅ | R17.6, R21.5, R27.6, R28.20–R28.24 | — (fixed, see §0) | **Disputes on any status; partial refund → COMPLETED → full payout (S4)** |
| M21 | Responsive mobile design | ✅ | R31.1; 228-load sweep | — (fixed, see §0) | Tables need in-card horizontal scroll on phones; some sub-32 px icon buttons |
| M22 | SEO-friendly public pages | ✅ | R32.1–R32.9 | — (fixed, see §0) | Soft 404s (HTTP 200) on invalid dynamic URLs |

**MVP readiness summary (updated 5 Oct 2026, see §0).** Of 22 MVP items: 17 are fully implemented, 5 are partial — each waiting only on an excluded external provider or on curriculum data — and 0 are broken. *Original audit:* 3 fully implemented (13.6 %), 14 partial (63.6 %), 5 broken (22.7 %), 0 absent. Every MVP item has a real, persisted, server-enforced implementation; nothing is a mock-up. The application is **not MVP-ready**:

- Five items have defects that affect money, trust or the core flows: location filtering, tutor payouts, cancellations/refunds, document uploads and dispute management.
- No item that depends on an external provider has been exercised against that provider: payments, payouts, email, meetings, geocoding, storage and social sign-in.

---

## 6. Phase Two Status

Phase Two items are not MVP failures. Seven of eleven are implemented ahead of the MVP.

| # | Item (§35) | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| P2.1 | Advanced Post a Tutor Request workflow | ✅ | `request.service.js:278-1071` (create, edit + re-match, invite, interest, withdraw, respond, close, cancel, moderate, expiry warnings); `MatchComparison.jsx`; `src/app/admin/requests` | See R18.9–R18.10 for gaps that also affect the MVP. |
| P2.2 | Advanced tutor matching | 🟡 | `src/lib/matching/weights.js:19-44` (10 weighted factors, admin-tunable via `MatchingSettings.jsx`); `score.js:51-82` | Rules-based scoring. Teaching style, student goals and repeat-booking rate are not used. |
| P2.3 | Google/Outlook calendar synchronisation | 🟡 | Google (`calendar-provider.js:212`, freeBusy `:411`), Microsoft Graph (`:539`); `calendar.service.js:120-529`; busy time used in slots and booking; push on confirm/cancel/reschedule; encrypted tokens; `calendar-sync` job every 15 min | Code is complete for busy-pull and event-push. No provider webhooks (polling plus cache, so bookings can race a stale cache). No OAuth credentials configured, so only the development provider runs. Tested only with stubbed `fetch`. |
| P2.4 | SMS notifications | 🟡 | Twilio adapter `sms-provider.js:98-107`; `sms.service.js:73-428` (opt-in, verified phone, STOP/START); `/api/webhooks/sms` (signed); `src/app/admin/sms` | Delivery receipts are never processed: the help text tells operators to point the status callback at `/api/webhooks/sms`, which ignores it (`src/constants/integrations.js:367-369`). Twilio not configured. |
| P2.5 | Referral program | ✅ | `src/models/Referral.js`; `referral.service.js:64-469`; credit ledger `credit.service.js`; `/referrals`, `/tutor/referrals`, `/admin/referrals` | Reward amounts default to 0 (`config.js:536-543`) until an admin sets them. |
| P2.6 | Tutor packages | ✅ | `src/models/Package.js`; `package.service.js:94-719`; `package-expiry` job | |
| P2.7 | Group tutoring | ✅ | `src/models/GroupSession.js`; `group.service.js:79-897` (paid join, waitlist, attendance, settlement); `group-settlement` job | Can overlap 1:1 bookings (R14.4). |
| P2.8 | Progress reports | ✅ | `src/models/ProgressReport.js`; `progress.service.js:69-626`; parent, tutor and admin pages | |
| P2.9 | Promoted tutor profiles | 🟡 | `src/models/Promotion.js`; `promotion.service.js`; `src/lib/search/promotion.js` (reorders, labelled, relevance sort only); `promotion-expiry` job | Admin-granted only: tutors cannot buy a promotion; no price or payment exists. |
| P2.10 | Advanced analytics | ✅ | `analytics.service.js:242-841`; `src/app/admin/analytics`; tutor analytics | No export. Shares the MVP analytics gaps (R28.25–R28.32). |
| P2.11 | Fraud/risk tools | ✅ | `src/models/Risk.js`; `risk.service.js:104-529`; `src/app/admin/risk` | 5 signals (cancellations, no-shows, payment failures, disputes, referral abuse). Detects and never restricts, by design. No signup velocity or message-content signals. |

**Summary:** 7 ✅ · 4 🟡 · 0 🟠 · 0 🔴 (11 items).

---

## 7. Phase Three Status

| # | Item (§36) | Status | Evidence | Notes / Gap |
|---|---|---|---|---|
| P3.1 | iOS app | 🔴 | No `ios/`, Capacitor, Expo or React Native | A PWA exists (`src/app/manifest.js`, `public/sw.js`, `src/components/pwa/*`, `docs/PWA.md`), but it is not a native app and has no push. |
| P3.2 | Android app | 🔴 | Same | No TWA wrapper. |
| P3.3 | Integrated video classroom | 🔴 | No implementation found after inspecting `src/` and `package.json` (no WebRTC, LiveKit, Jitsi, Daily or Agora) | External links only (R25.1). |
| P3.4 | Interactive whiteboard | 🔴 | No implementation found after inspecting `src/` and `package.json` (no whiteboard or canvas library) | |
| P3.5 | Homework/document sharing | ✅ | `src/models/Attachment.js`; `attachment.service.js:81-255`; message and progress-report attachments | File sharing only, by design: no submission or grading. No malware scanning. |
| P3.6 | AI tutor recommendations | 🔴 | No AI or LLM dependency or call in `src/` | Rules-based matcher only. |
| P3.7 | AI search | 🔴 | `tutor-query.js:27` (escaped regex) | |
| P3.8 | AI lesson summaries | 🔴 | `progress.service.js:207-218` (summary typed by the tutor) | |
| P3.9 | Student learning analytics | ✅ | `studentAnalytics` (`analytics.service.js:938`); `/api/students/[id]/analytics`; `src/app/(dashboard)/insights`, `src/app/tutor/students/[id]` | Scoped to owner, admin or a tutor with a completed booking. |
| P3.10 | Tutor subscriptions | 🔴 | No implementation found after inspecting `src/models`, `src/services` and `src/app/api` | Marketing copy says "no subscription" (`become-a-tutor/page.js:53,78`). |
| P3.11 | Group courses | 🔴 | `GroupSession.js:73-75` (single session) | No multi-session course entity. |
| P3.12 | Exam-preparation marketplace | 🔴 | No implementation found after inspecting `src/models` and `scripts/seed-data/curriculum.js` | Pricing label only. |
| P3.13 | Other Canadian provinces | 🟡 | 7 provinces seeded inactive (`curriculum.js:10-17`); `activeProvinceCodes()` gate; admin CRUD | No curriculum data outside Ontario; PE, NL and the territories not seeded; geocoding table Ontario-only; no provincial sales-tax handling (`pricing.js:35`); Ontario hard-coding (R6.5). |
| P3.14 | University tutoring | 🔴 | Grade `stage` enum stops at SECONDARY (`Curriculum.js:33`); search grade max 12 (`validation/search.js:65-66`) | |

**Summary:** 2 ✅ · 1 🟡 · 0 🟠 · 11 🔴 (14 items).

---

## 8. Parent Journey Audit

| Step (§37) | Status | Where implemented | Where it breaks / missing |
|---|---|---|---|
| 1. Visit APlus Learn | ✅ | `src/app/(public)/page.js` | — |
| 2. Select province | ✅ | `HeroSearch.jsx:81-93` | Only Ontario selectable (by design) |
| 3. Select grade | 🟡 | `HeroSearch.jsx:95-107` | K, 1–3, 5 and 6 return 0 tutors (R1.1) |
| 4. Select course/course code | 🟡 | `HeroSearch.jsx:109-121,274-445` | Typed subject words become course codes and return 0 (R2.5) |
| 5. Choose online or in person | ✅ | `HeroSearch.jsx:123-132` | — |
| 6. Enter location if relevant | 🟠 | `geocoding-provider.js` | Unknown places resolve to Toronto; out-of-province postcodes ignored (R29.1) |
| 7. See matching tutors | 🟡 | `search.service.js`; `TutorCard.jsx` | Online-only tutors dropped when a location is entered (R7.7); "Availability on request" on 10 of 12 cards (R9.10) |
| 8. Filter by price, qualification, rating, availability | 🟡 | `SearchFilters.jsx` | No date-based availability (R8.17–R8.21); degree levels merged (R8.9–R8.12) |
| 9. Open tutor profile | ✅ | `src/app/(public)/tutors/[slug]/page.js` | — |
| 10. Review credentials, reviews and availability | ✅ | `TutorProfileBody.jsx`; `BookingWidget.jsx` | Signed-out availability is a 4-day preview |
| 11. Select a lesson time | 🟡 | `AvailabilityPicker.jsx` | Must sign in before picking a time; choice not kept across sign-in |
| 12. Create or log into account | ✅ | `RegisterForm.jsx`; `/login` + `/login/verify` | Email must be verified before booking; email is dev-console only here |
| 13. Pay securely | 🟡 | Checkout page; Stripe Checkout | Works only with the mock provider; live Stripe unverified |
| 14. Receive booking confirmation | 🟡 | `booking.service.js:1168-1213` | Email lacks location, policy and actual amount (R24.7–R24.9) |
| 15. Communicate with tutor | ✅ | `MessageTutorPanel.jsx`; `ConversationView.jsx` | — |
| 16. Attend lesson | 🟡 | `JoinLessonButton.jsx`; `meeting.service.js` | No meeting provider: mock links do not work. The tutor can paste a real link manually. Zoom adapter cannot start meetings (R25.1) |
| 17. Leave review | 🟡 | `BookingActions.jsx`; `review.service.js` | Depends on the tutor marking the lesson complete; written text mandatory |
| 18. Rebook easily | 🟡 | "Book again" (`BookingDetail.jsx:82,264`) | Links to the profile with nothing pre-filled |

**Summary:** 7 ✅ · 10 🟡 · 1 🟠 (18 steps). The journey can be completed end to end in development mode. Step 6 is the first point where a real parent outside the bundled locations gets wrong results.

---

## 9. Tutor Journey Audit

| Step (§38) | Status | Where implemented | Where it breaks / missing |
|---|---|---|---|
| 1. Visit and click Become a Tutor | ✅ | `become-a-tutor/page.js:70,82` | — |
| 2. Create an account | ✅ | `/register?role=TUTOR` | — |
| 3. Complete profile | 🟡 | `PersonalStep`, `ProfileStep`, `EducationStep`, `QualificationsStep` | No photo step |
| 4. Select courses taught | 🟡 | `CoursesStep.jsx` | Ontario-only search, not province → grade → subject → course |
| 5. Set price | ✅ | `PricingStep.jsx` | — |
| 6. Set online/in-person options and service area | ✅ | `LessonTypeStep`, `LocationStep` | — |
| 7. Set availability | ✅ | `AvailabilityStep` | — |
| 8. Upload verification documents | 🟠 | `DocumentsStep.jsx` → `verification.service.js:62-63` | **Fails for every first-time applicant**; possible only after step 9 from `/tutor/verification` |
| 9. Submit application | ✅ | `tutor.service.js:278-333` | — |
| 10. Administrator reviews application | ✅ | `src/app/admin/applications/[id]` | The reviewer usually sees no documents (step 8) |
| 11. Profile becomes searchable after approval | ✅ | `deriveSearchable` (`tutor.service.js:697-713`) | — |
| 12. Receive booking | ✅ | `booking.service.js:1168-1213` (BOOKING_CREATED in-app + email) | Email CTA links to a learner-only page |
| 13. Teach lesson | 🟡 | Meeting links; in-person address release | Mock meeting links unless the tutor pastes their own |
| 14. Lesson becomes eligible for payout | 🟡 | `payableBookings` (COMPLETED + hold days) | Needs a manual "complete". Money moves only when an admin marks PAID. Double-pay risk (S3) |
| 15. Receive review | ✅ | `review.service.js:82-90`; `src/app/tutor/reviews` | — |
| 16. Build reputation and repeat bookings | 🟡 | Rating aggregates, repeat "Book again" | Tutors cannot message families first; rebook not pre-filled |

**Summary:** 10 ✅ · 5 🟡 · 1 🟠 (16 steps).

---

## 10. Product Differentiators Audit

| Differentiator (§39) | Status | Evidence | Gap |
|---|---|---|---|
| Canadian curriculum and course-code search | 🟡 | R6, R7.4–R7.5; landing pages `/tutors/<code>/<city>` | 38 courses; subject-word misdetection; Ontario only |
| Strong local + online tutoring support | 🟡 | R7.6–R7.7, R26, R29 | Geocoding fallback; online-only tutors excluded with a location; mock meeting links |
| Education-specific tutor verification | 🟡 | R11 (OCT, Education, University Student, Background Check badges) | Wizard upload broken; identity not enforced; expiry optional |
| No subscription required simply to search | ✅ | Public `/find-a-tutor`, `/api/search/tutors` (no auth) | — |
| Parent-focused experience | 🟡 | Children, insights, progress reports, packages | Child profiles lack subjects, mode, marks and goals (R5) |
| Integrated availability, booking and payment | 🟡 | R14, R15, R16 | Payment live-unverified; payout defects |
| Tutor request feature | ✅ | R18, P2.1 | Interest not eligibility-gated (minor) |
| Long-term family tutoring management | 🟡 | Per-child bookings, progress reports, student analytics, packages | Per-child courses and goals cannot be recorded |

**Summary:** 2 ✅ · 6 🟡 (8 items).

---
## 11. Security & Privacy Audit

**§30 requirement status:** 2 ✅ · 7 🟡 · 1 🟠 · 1 ⚪ (11 items; see §4.30).

The findings below come from code inspection plus unauthenticated HTTP probes; this is not a penetration test. "Verified in code" means the lead auditor re-read the cited lines. Nothing was exploited.

| ID | Severity | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| S1 | **High** | **Stored XSS on public tutor profiles.** `JSON.stringify({ … description: tutor.headline … })` is injected with `dangerouslySetInnerHTML` into `<script type="application/ld+json">`. `JSON.stringify` doesn't escape `<`, so a headline such as `</script><script>…</script>` (36 characters, within the 10–120 limit) closes the block. `sanitizeText` strips control characters only. The live CSP is `script-src 'self' 'unsafe-inline'`. The script would run as every visitor, including signed-in parents. Verified in code; not exploited. | `src/app/(public)/tutors/[slug]/page.js:103-135`; `src/lib/security/sanitize.js:8-14`; `src/lib/validation/tutors.js:64-68,183`; same pattern with admin-controlled data at `src/app/(public)/page.js:106`, `faq/page.js:178`, `[province]/[grade]/[subject]/[course]/page.js:325` | Escape `<`, `>` and `&` (`<` etc.) in every JSON-LD serialisation; consider a shared helper. |
| S2 | **High** | **Self-service full refund via no-show report.** A learner can report a tutor no-show on any CONFIRMED or COMPLETED lesson with no time limit. It refunds `tutorNoShowRefundPercent` (default 100 %) immediately, with no admin review, even after the tutor was paid. API only, open to `BOOKING_VIEW`. Verified in code. | `src/services/booking.service.js:1665,1750-1800`; `src/app/api/bookings/[id]/no-show/route.js`; `src/constants/config.js:325` | Limit to a short window after `endAt`; route learner reports through a dispute or admin review; exclude paid-out lessons. |
| S3 | **High** | **Payout double-pay.** (a) `createPayout` claims bookings with `updateMany` and no `payoutId: {$exists:false}` filter, so concurrent cron and admin runs can pay the same lessons twice. (b) `updatePayoutStatus` has no transition rules: a FAILED payout (bookings already released) can later be marked PAID and send a transfer. (c) Refunds never reduce `tutorEarningsCents`. Verified in code. | `src/services/payout.service.js:160-168,195-222,245-280`; `src/services/payment.service.js:328-404` | Atomic conditional claim; an explicit state machine; net refunds out of payable amounts; claw back or hold after payout. |
| S4 | **High** | **Dispute outcome rewrites booking status.** `createDispute` accepts any ended booking regardless of status. `resolveDispute` sets COMPLETED whenever the refund is less than the refundable amount, so a partial refund leaves the full tutor share payable, and a rejected dispute makes an unpaid or cancelled booking COMPLETED (reviewable, counted as a completed lesson). Verified in code. | `src/services/dispute.service.js:25-60,197-255` | Validate allowed statuses at creation; restore the prior state; record the refunded amount against payout. |
| S5 | Medium | **Minor surnames reach tutors.** Masking is render-only. `listBookings` and `getBooking` populate `studentProfileId.lastName` for tutor viewers. `Avatar` prints `firstName lastName` into `sr-only` text when `name` is not passed, as on the tutor Students page and dashboard. Request reads behave the same. Verified in code. | `src/services/booking.service.js:1277,1318`; `src/components/ui/Avatar.jsx:51,86`; `src/app/tutor/students/page.js:98-100`; `src/app/tutor/dashboard/page.js:441`; `src/services/request.service.js:93,103,115,252-262` | Mask in services before `toPlain` whenever the viewer is a tutor (as `progress.service.js:764` already does). |
| S6 | Medium | **Self-registered students are always treated as adults.** No age or birth year is collected; the self `StudentProfile` is hard-coded `isMinor:false`, including for OAuth sign-ups. The Terms require 18+, with no enforcement. | `src/services/auth.service.js:63-71,341`; `src/lib/validation/auth.js:8`; `src/constants/legal.js:48` | Capture age; route under-18 students through a guardian or set `isMinor` from the answer. |
| S7 | Medium | **Email verification lifts a suspension.** `verifyEmail` sets `status: ACTIVE` unconditionally, and `resendVerification` checks only `emailVerifiedAt`. A suspended, never-verified account can re-activate itself. Verified in code. | `src/services/auth.service.js:159-181` | Only move PENDING_VERIFICATION → ACTIVE. |
| S8 | Medium | **Admins can read and post in any conversation without audit.** `assertParticipant` returns early for ADMIN, bypassing the audited reported-conversation path. | `src/services/message.service.js:291-292,600-606` | Remove the bypass, or audit it and refuse admin sends. |
| S9 | Medium | **Incomplete deletion and no retention policy.** Self-delete leaves the phone number, child profiles (names, school, notes, accessibility needs), tutor bio and gallery, verification documents, request notes and messages. Admin DELETE anonymises nothing. The Privacy Policy and verification page claim documents are deleted when a badge expires; no code deletes them. | `src/services/user.service.js:113-183,452-459`; `src/constants/legal.js:157`; `src/app/(public)/verification/page.js:90`; `src/services/verification.service.js:355-382` | Define retention periods; one anonymisation routine for both paths; purge job; correct the published claims. |
| S10 | Medium | **Identity documents can land on unencrypted local disk in production.** Storage falls back to `.storage/` when S3 is not configured (`fakeAllowedInProduction`), unless `STORAGE_REQUIRE_EXTERNAL=true`. This contradicts the stated "development refused for storage" rule. On an ephemeral host (Vercel, per `vercel.json`) files would also be lost. | `src/lib/config/env.js:188-218`; `src/services/external/storage-provider.js:432-446,519-543` | Fail closed for the `documents` scope in production; require encryption at rest. |
| S11 | Medium | **Spoofable client IP.** Rate limits and audit `ip` use the leftmost `X-Forwarded-For` value. Per-email login limits still apply. | `src/lib/security/rate-limit.js:187-190`; `src/services/audit.service.js:26` | Derive the IP from a trusted-proxy setting or a platform header. |
| S12 | Medium | **Framework advisory.** `bun audit`: next 16.3.5 matches GHSA-vcvr-r3jv-pc5j (critical, `next/og` ImageResponse; affects ≥16.2.0 <16.3.6). `next/og` isn't imported in `src/`, so it is probably not reachable. | `package.json` | Upgrade to ≥16.3.6. |
| S13 | Low | **Session cookies committed to git.** `a.txt` and `b.txt` are tracked curl cookie jars holding `aplus_session` JWTs for a localhost PARENT account, expiring about 8 Oct 2026. They only matter if the dev `AUTH_SECRET` is reused elsewhere. `scratchpad/*.txt` are also tracked. | `git ls-files a.txt b.txt scratchpad` | Remove from the repository and history; rotate the dev `AUTH_SECRET` if shared. |
| S14 | Low | **Admin hardening.** One ADMIN role holds every permission; no TOTP or step-up; 14-day sessions; social sign-in skips new-device verification, including for admins; admins can suspend other admins. | `src/constants/roles.js:206`; `src/constants/config.js:288-295,706-710`; `src/services/user.service.js:428-430` | Admin 2FA, shorter admin sessions, assignable sub-roles. |
| S15 | Low | **Audit integrity.** Document views are logged as `VERIFICATION_BADGE_GRANTED`; VERIFY_EMAIL and FORCE_LOGOUT as `USER_REINSTATED`; info-requested as `TUTOR_REJECTED`. Dispute notes are not logged. `recordAudit` swallows write failures. The log is append-only only by convention. | `verification.service.js:154-160`; `user.service.js:467-475`; `tutor.service.js:680`; `audit.service.js:29` | Distinct action names; alert on audit-write failure; DB-level write restriction. |
| S16 | Low | `/api/payments/[id]/capture` parses raw card number, CVC and expiry in every mode; with Stripe it rejects them after parsing. | `src/app/api/payments/[id]/capture/route.js`; `payment.service.js:282-287` | 404 the route when hosted checkout is in use. |
| S17 | Low | **Over-sharing to tutors and counterparties.** Tutors receive the family's full postal code, coordinates and `ownerId` on requests. Dispute reads include the counterparty's email. Tutors see notes and accessibility needs for learners from abandoned checkouts. | `request.service.js:136-137,247-262`; `dispute.service.js:115-116`; `src/app/tutor/students/page.js:26` | Send only the postal prefix and city; drop email; filter roster by status. |
| S18 | Low | Cron endpoint accepts an admin session cookie on GET (top-level cross-site navigation sends Lax cookies). Jobs are idempotent. | `src/app/api/cron/[job]/route.js:65-76,88` | Bearer-only, or POST for the session path. |
| S19 | Low | Upload routes call `request.formData()` before any size check. | `src/app/api/tutor/verification/upload/route.js`, `messages/attachments/route.js`, `users/me/avatar/route.js` | Check `Content-Length` and cap at the proxy. |
| S20 | Low | `scripts/seed.js` has no production guard, wipes 24 collections, and prints the full `MONGODB_URI` to the console. | `scripts/seed.js:107-123` | Refuse when `APP_ENV=production`; redact the URI. |
| S21 | Info | `X-Powered-By: Next.js` sent; CSP `'unsafe-inline'` (documented trade-off); no Origin check (relies on SameSite=Lax + JSON); `AUTH_SECRET` also derives the integration-secret key, so rotating it destroys stored credentials. | `next.config.mjs:50-180`; `src/lib/api/handler.js`; `src/lib/security/crypto.js:20-52` | `poweredByHeader:false`; document key coupling. |

**Confirmed controls (verified).**

- **Secrets.** No real secret is committed. `.env*` and `.storage/` are gitignored; pattern matches in `scripts/*` are test fixtures.
- **Unauthenticated access.** All 21 protected routes probed return 401 without a session.
- **Webhooks.** Stripe and Twilio webhooks verify signatures.
- **Uploads.** File type is read from the bytes; SVG is refused; non-images are served as downloads with `nosniff` and a sandbox CSP.
- **Input validation.** Updates pass through strict zod schemas (no mass assignment found). Registration cannot choose ADMIN.
- **Session revocation.** Suspension invalidates sessions (`tokenVersion`).
- **Address privacy.** The in-person `addressLine` is `select:false` and released only on confirmed bookings.
- **Payment data.** No card data is stored.

**Not verifiable here:** HTTPS/HSTS in production; encryption at rest of the production database or storage; Stripe account configuration; legal review.

---

## 12. Mobile / Responsive Audit

**Method.** System Chrome via Playwright loaded 57 routes at four viewports: 1440×900 (desktop), 768×1024 (tablet), and 390×844 and 360×800 (phones, with `isMobile` and touch). That is 228 loads.

- **Routes covered.** 15 public; 15 as a signed-in parent; 12 as a signed-in tutor; 15 as the admin.
- **Recorded per load.** HTTP status; landing path (to catch silent redirects to `/login`); `scrollWidth − innerWidth` and the elements responsible for any overflow; tap targets under 32×32 px (phones); console and page errors.
- **Screenshots.** Saved for the non-desktop viewports and reviewed for representative pages.

| Result | Value |
|---|---|
| Page loads with horizontal page overflow | **0 of 228** |
| Signed-in pages that redirected to `/login` | 0 |
| HTTP errors | 0 (the soft-404 page `/ontario/grade-12/math/mhf4u` returns 200 "Course not found") |
| Console/page errors | 1 page: `Failed to execute 'measure' on 'Performance': 'CourseLandingPage' cannot have a negative time stamp` (dev-mode React profiling, on the not-found course page, tablet and phones) |

**Concrete findings.**

1. **Data tables require in-card horizontal scrolling on phones and tablets.** At 360 px, `/admin/payments` shows the Lesson and Family columns and cuts "Paid" mid-date. At 768 px, `/admin/curriculum` cuts the Actions column. The page itself doesn't overflow, but the table hides columns until it is scrolled sideways, with no visual hint. This affects admin list pages generally.
2. **Small tap targets on phones.** Visible links and buttons under 32×32 px, measured at 390 px:

   | Route | Count |
   |---|---:|
   | `/admin/curriculum` | 76 (row edit icons) |
   | `/find-a-tutor` | 7 |
   | `/tutor/calendar` | 6 |
   | `/tutors/mhf4u/scarborough` | 5 |
   | parent `/tutors` | 4 |
   | `/` | 3 |
   | All other swept routes | 0 |

3. **The floating support launcher overlaps content** at the bottom-right on phones: tutor cards on `/find-a-tutor`, day cards on `/tutor/calendar`. The Next.js dev-tools badge (bottom-left) is development-only.
4. **Navigation.** Public pages use a hamburger header. Dashboard, tutor and admin areas use a hamburger plus avatar menu at phone and tablet widths. All swept pages rendered their `h1` and primary content.
5. **Search and filters on phone.** `/find-a-tutor` stacks the search form, then a "Filters" button, sort and cards, without overflow. The filter panel itself was not opened (no interactions were scripted).
6. **Tutor profile and booking on phone.** The profile header, badges, stats and rate render in one column. The booking widget was not interacted with.
7. **Messaging on phone.** The thread view fits at 360 px: booking strip (horizontally scrollable), bubbles with timestamps, attachment control, composer.

**Not covered:** interactive flows (filter sheet, booking modal, onboarding steps, file upload, dialogs), landscape orientation, real iOS Safari or Android Chrome, accessibility (no axe/Lighthouse run), performance on mobile networks. The repository has no responsive regression suite: `scripts/e2e-install.mjs` checks only the PWA install card at phone widths.

---

## 13. SEO / Public Pages Audit

| Check | Result | Evidence |
|---|---|---|
| Server-rendered public content | ✅ Tutor cards, course pages and profiles are in the initial HTML | curl of `/find-a-tutor`, `/ontario/grade-12/mathematics/mhf4u`, `/tutors/priya-s-toro` |
| `robots.txt` | ✅ 200; disallows `/api/`, `/dashboard`, `/bookings`, `/tutor/`, `/admin/`; lists sitemap | Doesn't list `/insights`, `/packages`, `/progress`, `/my-groups`, `/referrals` (all auth-gated). `Host:` includes a scheme. |
| `sitemap.xml` | ✅ 200, 307 URLs (240 `/tutors/<code>/<city>`, 38 course pages, 12 profiles, static and legal) | `src/app/sitemap.js`; base URL comes from `NEXT_PUBLIC_APP_URL` (localhost on dev) |
| Structured data | ✅ `Person` (profiles), `Course` (course pages), `FAQPage` (FAQ) | The `Person` JSON-LD is the XSS sink in S1 |
| Canonicals and Open Graph | ✅ on profile and course pages; 🟡 `/tutors/<code>/<city>` has a canonical but no JSON-LD, and og:title falls back to the site default | |
| High-intent shapes | 2 of 5 have a dedicated page (MHF4U Toronto, ENG4U Toronto); "Calculus near me" partial; "Grade 12 math tutor Scarborough" and "Ontario math tutor" have none | R32.2–R32.6 |
| Spec URL `/ontario/grade-12/math/mhf4u` | 🟡 Route exists; the seeded slug is `mathematics`, so the literal URL is "Course not found" | R32.7 |
| Spec URL `/tutors/mhf4u/scarborough` | ✅ 200 | R32.8 |
| Soft 404s | 🟠 `/tutors/nonexistent-slug-xyz`, `/legal/tutor-agreement`, `/legal/community-standards`: HTTP 200 with both `index, follow` and `noindex` meta. Unmatched static paths (`/ontario`, `/help`) correctly return 404. | Root `src/app/loading.js` streams before `notFound()`. Observed on dev; confirm on a production build. |
| Content accuracy on public pages | 🟡 Hard-coded "24 hours", "85 %", "48h review", "live chat within 4 hours", 555 phone number; FAQ claims identity is always checked and the "complete" curriculum is loaded | R2.18, R12.3, R33.2 |
| Data hygiene visible publicly | 🟡 Dev DB contains QA leftovers (a tutor headline "Experienced Ontario tutor — QA 23704"; inactive `QA Grade` rows). Testimonials are seed fixtures | R2.16 |

---

## 14. Testing & QA Coverage

**Tooling.** No unit-test runner (no jest, vitest or mocha; no `*.test.*`), no coverage tool, no CI configuration (no `.github/`). Suites are custom sequential scripts with `check(name, cond)` helpers. Playwright isn't a dependency; the e2e scripts load it from the npx cache and use system Chrome.

| Script | Size | Kind |
|---|---|---|
| `scripts/qa.mjs` | 7,706 lines, 43 sections, ≈1,148 checks | Real HTTP against a running dev server; success paths and refusals |
| `scripts/integration-tests.mjs` | 13,238 lines, 48 sections, ≈1,735 checks | Imports `src/` directly; `fetch` stubbed for providers; DB sections skip without Mongo |
| `scripts/e2e-password-reset.mjs` | 264 lines, ≈22 checks | Browser: forgot password |
| `scripts/e2e-realtime.mjs` | 398 lines, ≈26 checks | Two browsers: live messages, badges, offline recovery |
| `scripts/e2e-install.mjs` | 669 lines, ≈71 checks | Browser: PWA install card, phone layouts of the card |

**Run during this audit:** `bun run lint` (clean). **Not run:** `qa`, `test:integrations`, `e2e*` (each writes to the database) and `build`. The most recent results available are historical (`scratchpad/*.txt`, 20 September 2026), from smaller earlier versions of the suites:

- `final-qa.txt`: 525 passed, 9 failed (verification-document upload `INTERNAL_ERROR`, branding upload).
- `final-integrations.txt`: 913 passed, 2 failed (storage credentials, a full-refund check).

There is no current pass/fail data.

| Area | Automated coverage exists | Remains unverified |
|---|---|---|
| RBAC / authorisation refusals | qa "Authorization", "Booking authorization" and per-feature blocks | — |
| Search, public marketplace | qa "Public marketplace", "Tutor search eligibility"; integ "Public surfaces" | Geocoding of unknown places (the Toronto fallback isn't asserted against); hero code detection; "next available" freshness |
| Registration, sign-in, email verification, password reset, new device | qa and integ sections; e2e-password-reset | Registration/login UI in a browser (except forgot password); verify-email on a suspended account |
| Booking, pricing, holds, concurrency | qa "Parent journey", "Business rules", concurrency, abandoned checkout | **Booking/checkout UI in a browser**; group vs 1:1 overlap; DST |
| Payments, webhooks, refunds | integ Stripe/webhook sections (stubbed) | **Any live Stripe charge, Connect onboarding or payout**; credit-applied refund; unpaid-cancel then pay |
| Payouts | qa payouts | Concurrent payout runs; FAILED → PAID |
| No-shows, disputes | qa disputes and no-show sections | No-show on COMPLETED/paid-out lessons; partial-refund dispute → payout |
| Tutor onboarding, verification documents | qa verification (uses a **seeded, already-submitted** tutor, `qa.mjs:2148-2164`) | **Upload during the wizard by a new applicant (the defect in R13.11)** |
| Messaging, realtime | qa messaging; integ; e2e-realtime | Admin bypass of participation; anti-circumvention (absent) |
| Tutor requests, matching, reviews | qa and integ sections | Request/compare UI in a browser |
| Phase Two features | qa and integ per feature | Live Google/Microsoft calendar, Twilio |
| Minor privacy | qa asserts some masking | Surname in tutor-facing API JSON and `sr-only` text |
| Dashboards, admin UI, tutor UI | Incidental page visits in e2e-install only | **No functional browser tests** for parent, tutor or admin screens |
| Responsive layout | e2e-install (install card only); this audit's sweep (page loads) | No responsive regression suite; interactive flows on phones |
| Accessibility, performance, SEO rendering | None | All |

Passing suites, historical or future, do not establish that a requirement is fully implemented. Several defects in this report sit exactly where the suites use seeded or already-advanced state.

---
## 15. Implementation Gaps

> **Superseded (5 October 2026).** This section describes the state found by the original audit. Every application-level item in it has since been fixed; what remains is listed in §0.5.

### 15.1 Broken / defective (15 items)

| Area | Items |
|---|---|
| Search & location | R2.5 hero course-code detection · R2.7 hero location · R7.6 / R8.1 / R29.1 geocoding fallback to Toronto · R9.10 "next available" |
| Onboarding | R13.11 document upload inside the wizard |
| Payments & refunds | R16.4 tutor portion (refunds not netted; double-pay) · R27.5 no-show self-refund · R27.6 / R28.22 dispute status rewrite |
| Dashboards | R22.2 past lessons drop ended-but-unmarked lessons · R23.5 tutor Students roster and "Earned" |
| Privacy | R30.7 minors' surnames reach tutors |
| Legal | R33.13 Cookie Policy omits 4 of 5 cookies |

### 15.2 Not implemented, within MVP scope (§1–§33: 17 items)

| Area | Items |
|---|---|
| Child profiles | R5.5 subjects/courses · R5.6 online/in-person preference · R5.8 current mark · R5.9 target mark |
| Search filters | R8.17 Today · R8.18 Tomorrow · R8.19 This Week · R8.21 specific date/time |
| Result cards | R9.12 View Availability button · R9.13 optional Message/Book buttons |
| Messaging | R17.7 anti-circumvention |
| Admin | R28.24 reported tutor requests · R28.31 most-searched analytics (no search logging) |
| SEO | R32.3 grade + subject + city pages · R32.5 province/subject pages |
| Legal | R33.15 Community Standards · R33.16 Tutor Agreement |

### 15.3 Partial, grouped by work type

- **Data and content.**
  - Ontario course catalogue coverage (R6.3, R1.1, R2.12).
  - Hard-coded policy numbers and claims on marketing and legal pages (R2.18, R12.3, R27.1, R33.11–R33.14).
  - Placeholder phone number (R33.2).
  - Seed testimonials (R2.16).
- **Registration and accounts.**
  - Phone, province, city and postal code at sign-up (R4.6–R4.10).
  - Age capture and minor handling (R3.4).
  - Per-child data and goals (R3.2, R5.4, R5.7, R5.10–R5.12).
- **Search refinements.**
  - "Both" mode (R8.4); distance "Any" and sort (R8.5).
  - Degree-level qualifications (R8.9–R8.12); Weekend semantics (R8.20).
  - Online-only tutors with a location (R7.7); refine drops the course (R7.4).
- **Profile and booking polish.**
  - Response-time copy (R10.8); signed-out availability (R10.14).
  - Confirmation content (R15.9, R24.7–R24.9); "Other" location detail (R26.5).
  - Group/1:1 overlap and DST (R14.4).
- **Payments.**
  - Live Stripe (R15.8, R16.1–R16.2); payout schedule (R16.8).
  - Tutor payment view (R16.6); credit-applied refunds and unpaid cancels (R16.7, R27.2).
  - Earnings period (R16.9); receipts (R22.7).
- **Messaging and requests.**
  - Booking system messages (R17.3); tutor-initiated contact.
  - Request interest eligibility (R18.9); request → booking link (R18.10).
- **Reviews and moderation.**
  - Optional text (R21.2); reporting and pending moderation (R21.5).
  - Complaints storage (R28.20); no-show view (R28.21); no-show tracking and warnings (R27.7–R27.8).
- **Admin.**
  - Ban, anonymise and history (R28.2–R28.3); badge expiry and restore (R28.8).
  - Curriculum deactivate and rename (R28.10–R28.11).
  - Booking tabs and page totals (R28.14, R28.16–R28.17, R28.19).
  - Analytics definitions (R28.25–R28.26, R28.30, R28.32).
- **Verification.** Background-check expiry (R11.5), disclaimer (R11.7), Become-a-Tutor content (R12.1, R12.5), photo and credentials in the wizard (R13.2, R13.5–R13.6).
- **Security.** HTTPS assumption (R30.1), authentication hardening (R30.4), storage (R30.5), card fields (R30.6), admin (R30.8), audit (R30.9), retention (R30.10).
- **Future apps.** Token auth and push (R31.2).

### 15.4 Environment and production readiness (not code defects, but go-live blockers)

| Provider | Configured here | Effect today |
|---|---|---|
| Payments (Stripe) | Test keys; account `charges_enabled:false` | Only the mock provider completes a payment |
| Email (Resend/SMTP) | No | Mail goes to the dev console (`/api/dev/mail`) |
| Meeting links (Zoom/Meet/Teams) | No | Random non-working links, also permitted in production |
| Geocoding (Google) | No | Bundled table plus Toronto fallback, also permitted in production |
| Object storage (S3/MinIO) | No | Local `.storage/`, also permitted in production |
| Social sign-in (Google/Apple) | No | Development identity only |
| SMS (Twilio), calendar (Google/Microsoft) | No | Console / development providers |
| Legal review (PIPEDA, Quebec Law 25) | No evidence | Required by §30 before launch |

---

## 16. Recommended Next Implementation Phases

> **Superseded (5 October 2026).** This section describes the state found by the original audit. Every application-level item in it has since been fixed; what remains is listed in §0.5.

The ordering follows the original **Development Priority** (§40) and **MVP** definition (§34). Two adjustments, both driven by the brief itself:

- **Phase A comes first.** Its items are security, privacy, money-integrity or core-journey blockers. §30 and §34 ("secure payments", "tutor payouts", "cancellations/refunds", "secure verification document uploads") require them. They have no dependency on the other phases and would invalidate testing of everything else.
- **Provider configuration is folded into the phase that needs it**, because live verification depends on it.

### Phase A — Launch blockers: security, money integrity, journey stoppers

| Requirement | Why next | Current | Dependencies | Expected outcome |
|---|---|---|---|---|
| S1 (R10, M4) JSON-LD XSS | A visitor-facing script-injection path on every tutor profile | 🟠 (High) | None | All JSON-LD escaped; a malicious headline renders inert |
| S3 + R16.4 payout double-pay and refund netting | Real money paid twice or overpaid | 🟠 | None | Atomic claim; payout state machine; payable amount net of refunds |
| S2 / R27.5 no-show self-refund | Any learner can refund any completed lesson | 🟠 | Product rule for the reporting window | Time-boxed, reviewed no-show refunds; paid-out lessons protected |
| S4 / R27.6 / R28.22 dispute status | Disputes rewrite bookings and leave the full payout | 🟠 | Phase A payout fix | Disputes only on eligible statuses; outcomes reflected in payout |
| R16.7 / R27.2 credit-applied refund and unpaid cancel | Cancellations can strand customers' money | 🟡 | None | Refund based on the amount collected; unpaid cancel voids checkout and returns credit |
| R13.11 wizard document upload | Blocks step 8 of every new tutor's journey (§38) and MVP M19 | 🟠 | None | New applicants can upload before submitting; reviewers see documents |
| S5 / R30.7 minor surname masking | Privacy default stated in §3/§5/§30 is not met server-side | 🟠 | None | Masking in services; no surname in tutor JSON or `sr-only` text |
| S7 verify-email lifts suspension | Bypasses an admin control | 🟡 | None | Verification activates only pending accounts |
| S12, S13 | Known advisory; committed session cookies | 🟡 | None | next ≥16.3.6; jars removed from the repository |

### Phase B — Search and matching (§40 priority 1)

| Requirement | Why next | Current | Dependencies | Expected outcome |
|---|---|---|---|---|
| R29.1 / R7.6 / R8.1 / R2.7 geocoding | Location search is wrong outside about 20 cities | 🟠 | Google Maps API key (business) | Real geocoding; unknown places refused or flagged, never silently Toronto |
| R7.7 online-only with a location | Online tutors disappear from local searches | 🟡 | None | "Either" mode keeps online tutors |
| R2.5 / R7.5 course-code detection; R7.4 refine keeps course | First-search failure for common words | 🟠 | None | Codes matched against the catalogue, words searched as text |
| R9.10 next available | 10 of 12 cards show "Availability on request" | 🟠 | None | Computed on read, or refreshed by a scheduled job |
| R8.17–R8.21 date availability filters | Listed MVP filters missing | 🔴 | Slot computation reused from booking | Today / Tomorrow / This Week / Weekend / specific date |
| R8.4, R8.5, R8.9–R8.12 | Filter semantics differ from the spec | 🟡 | Qualification data model change | "Both"; real "Any distance"; global distance sort; Bachelor/Master/PhD/Professional |
| R9.12 (and R9.13) card buttons | Listed card actions | 🔴 | None | View Availability (and optional Message/Book) |
| R28.31 search logging | Needed for the admin "most searched" metric | 🔴 | None | Search events recorded and aggregated |
| R18.9 interest eligibility; R19.2 | Matching quality | 🟡 | None | Only eligible tutors pitch |

### Phase C — Tutor profiles and curriculum (§40 priorities 2–3)

| Requirement | Why next | Current | Dependencies | Expected outcome |
|---|---|---|---|---|
| R6.3 / R1.1 / R2.12 Ontario catalogue | K–12 claim; empty grade chips | 🟡 | Curriculum data source | Full Ontario course list, including elementary grades |
| R6.5 / R13.6 province → grade → subject picker | Hard-coded Ontario blocks the "add provinces" requirement | 🟡 | None | Data-driven pickers in onboarding and homepage |
| R28.10–R28.13 curriculum admin | Deactivated items vanish; renames don't cascade | 🟡 | None | Inactive items manageable; cascaded slugs and names |
| R32.1, R32.3, R32.5, R32.7 SEO | §32 high-intent pages; soft 404s | 🔴 / 🟡 | Phase C catalogue | Real 404s; `/math/` alias; subject/grade/city and province/subject pages |
| R10.8, R10.14 | Profile accuracy and usefulness | 🟡 | None | Consistent response time; full availability for visitors |

### Phase D — Availability, booking and lesson delivery (§40 priority 4)

| Requirement | Why next | Current | Dependencies | Expected outcome |
|---|---|---|---|---|
| R14.4 group vs 1:1 overlap, DST | Double-booking requirement | 🟡 | None | Group sessions block 1:1 slots; wall-clock minutes |
| R15.9 / R24.1 / R24.7–R24.9 confirmation | §24 field list | 🟡 | Email provider (Phase H) | Email includes location or online details, actual amount, policy; tutor link fixed |
| R25.1 meeting links | Online lessons cannot start without a real link | 🟡 | Meeting provider credentials | Real links or no link (never fake in production); Zoom host fix |
| R22.2 ended lessons | Lessons vanish; reviews blocked | 🟠 | Product rule (auto-complete or prompt) | Ended lessons visible; review unblocked |
| R26.5, slot kept across sign-in, R18.10 | Journey friction | 🟡 | None | "Other" location detail; preserved slot; request linked to booking |

### Phase E — Payments and payouts go-live (§40 priority 5)

| Requirement | Why next | Current | Dependencies | Expected outcome |
|---|---|---|---|---|
| R16.1 / R16.2 / R15.8 live Stripe | No real charge ever exercised | 🟡 | Stripe account with charges enabled; Connect platform approval | End-to-end test-mode charge, webhook, refund |
| R16.8 payout schedule | Funds may never leave the Stripe balance | 🟡 | Phase A payout fixes | Stripe Payouts or automatic schedule; `payout.paid` webhook matched |
| R16.6, R16.9, R22.7 | Visibility for tutors and parents | 🟡 | None | Tutor payment view; correct pending earnings; downloadable receipt; no receipt for failed payments |
| R28.14, R28.16, R28.17, R28.19 | Admin money views summed from a page | 🟡 | None | Whole-dataset totals, cancelled tab, per-tutor earnings |

### Phase F — Tutor onboarding and verification (§40 priority 6)

| Requirement | Why next | Current | Dependencies | Expected outcome |
|---|---|---|---|---|
| S10 / R30.5 storage | Identity documents on local disk | 🟡 | S3-compatible bucket | Fail-closed in production; encryption at rest |
| R11.1, R11.5, R11.7 | Trust claims not enforced or disclaimed | 🟡 | Product rule (is ID mandatory?) | Required badges enforced; expiry required for background checks; disclaimers |
| S9 document deletion | Published claim is false | 🟡 | Retention policy | Documents deleted as stated, or claim corrected |
| R13.2, R13.5, R28.8 | Onboarding completeness | 🟡 | None | Photo step; other credentials; restore-to-search works |

### Phase G — Accounts and dashboards (§40 priority 7)

| Requirement | Why next | Current | Dependencies | Expected outcome |
|---|---|---|---|---|
| R4.6–R4.10 registration fields; R4.2–R4.3 social sign-in | §4 field list | 🟡 | Google/Apple credentials | Fields collected at sign-up; live social sign-in |
| S6 / R3.4 minors | §3 minor/adult distinction | 🟡 | Product and legal decision on under-18 accounts | Age captured; minor rules applied |
| R5.4–R5.11, R3.2 | Child profile list in §5 | 🔴 / 🟡 | None | Courses, mode preference, marks, goals per child; child filter |
| R22.3, R23.5, R23.7 | Wrong rosters and figures | 🟡 / 🟠 | None | Status-filtered rosters; correct earnings |

### Phase H — Messaging and notifications (§40 priority 8)

| Requirement | Why next | Current | Dependencies | Expected outcome |
|---|---|---|---|---|
| R17.7 anti-circumvention | Explicit §17 requirement | 🔴 | Product rule (block, mask or warn) | Contact and payment-detail detection with masking or warning and a risk signal |
| S8 admin access | Unaudited reading of private threads | 🟡 | None | Moderation only through the audited path |
| R17.3, tutor-initiated contact | Booking-related messaging | 🟡 | None | System messages on booking events; tutor can message booked families |
| R24.10 email provider | MVP email notifications | 🟡 | Resend/SMTP credentials | Real delivery |

### Phase I — Reviews and disputes (§40 priority 9)

| Requirement | Why next | Current | Dependencies | Expected outcome |
|---|---|---|---|---|
| R21.2, R21.5 | Spec says text optional; moderation gaps | 🟡 | None | Optional text; wider reporting; Pending tab |
| R28.20, R28.21, R28.24 | Complaints and reported requests missing | 🔴 / 🟡 | None | Stored complaints queue; request reporting; no-show admin view |
| R27.7, R27.8 | Abuse tracking incomplete | 🟡 | Phase A no-show fix | No-show signals on every path; warnings |

### Phase J — Administrator management, hardening, legal (§40 priority 10)

| Requirement | Why next | Current | Dependencies | Expected outcome |
|---|---|---|---|---|
| R28.2, R28.3, S9 | User management and deletion | 🟡 | Retention policy | Ban; anonymising delete; user history |
| R28.25–R28.32 | Analytics definitions | 🟡 / 🔴 | Phase B search logging | Metrics match their labels |
| S14, S15, S11 | Admin security and audit integrity | 🟡 | None | Admin 2FA; correct audit labels; trusted client IP |
| R33.11–R33.16, R30.11, R33.1–R33.2 | Legal pages missing or inaccurate; legal review | 🔴 / 🟠 / 🟡 / ⚪ | Counsel | Community Standards, Tutor Agreement, accurate Cookie and Privacy policies built from live settings; stored support enquiries; real contact details |

### Phase K — Phase Two completion (after MVP)

P2.2 (goals, teaching style, repeat rate in matching) · P2.3 (live calendar credentials, provider webhooks) · P2.4 (SMS delivery receipts) · P2.9 (tutor-purchasable promotions). All depend on the MVP being stable.

### Phase L — Phase Three

P3.13 other provinces (data plus removal of Ontario hard-coding, which Phase C starts) · P3.14 university tutoring · native apps (P3.1–P3.2, which need token auth and push, R31.2) · video classroom and whiteboard · AI features · subscriptions · group courses · exam-prep marketplace.

---
## 17. Final Requirement Matrix

One row per audited item (353). Evidence is the primary location; full evidence is in §4, §6 and §7. "Phase" refers to the roadmap in §16.

| ID | Original Requirement | Status | Evidence | Missing / Risk | Recommended Next Step |
|---|---|---|---|---|---|
| R1.1 | Canada-focused, Ontario K–12 initial launch | ✅ | Before the fix: `scripts/seed-data/curriculum.js:9-33` | Fixed: every Ontario grade K–12 now has courses in the development catalogue and a tutor who teaches it (`scripts/seed-data/curriculum.js`, `people.js`); grade search for Kindergarten returns tutors (`05-search`). | — |
| R1.2 | Structured around province, grade, subject, course, course code | ✅ | `src/models/Curriculum.js:12-102` | Subject is a global collection; Course references province, grade and subject. | — |
| R1.3 | Core journey Search → Compare → Match → Message → Book → Pay → Attend → Review → Rebook | 🟡 | Before the fix: See §8 | Every in-scope step now works end to end (search → book → pay (development provider) → message → review → rebook). Live payment and real meeting links depend on excluded external providers (§0.6). | See §0.5 |
| R1.4 | Primary user types Parent/Student, Tutor, Administrator | ✅ | `src/constants/roles.js:9-14,177-207` | PARENT, STUDENT, TUTOR, ADMIN. | — |
| R2.1 | Begin searching without an account | ✅ | `src/components/search/HeroSearch.jsx:34-49` | — | — |
| R2.2 | Hero: Province | ✅ | `HeroSearch.jsx:81-93` | Inactive provinces are shown disabled ("coming soon"). | — |
| R2.3 | Hero: Grade | ✅ | Before the fix: `HeroSearch.jsx:95-107` | Fixed: the hero's grade and subject lists reload from `/api/curriculum/tree` for the chosen province (`HeroSearch.jsx`, `hooks/useProvinceCurriculum.js`); homepage default province comes from data (`defaultProvinceCode()`), never `"ON"`. | — |
| R2.4 | Hero: Subject or course | ✅ | Before the fix: `HeroSearch.jsx:109-121` | Fixed: the subject list is every subject the chosen province teaches, not only the popular ones. | — |
| R2.5 | Hero: Course code | ✅ | Before the fix: `HeroSearch.jsx:40` | Fixed: the hero sends what was typed as `q`; `search.service.interpretQuery` matches it against the curriculum (real course code → subject/alias → course name/alias → free text). "Math", "Physics" are subjects; "MHF4U" is a course (`05-search`, `e2e-journeys` A). | — |
| R2.6 | Hero: Online or in-person | ✅ | `HeroSearch.jsx:123-132` | ANY / ONLINE / IN_PERSON. | — |
| R2.7 | Hero: Location or postal code | ✅ | Before the fix: `HeroSearch.jsx:43-46,136-143` | Fixed: unknown places are reported as unresolved and answered from tutor data, never substituted with Toronto (see R29.1). | — |
| R2.8 | Search button | ✅ | `HeroSearch.jsx:144,163-196` | The spec example (ON, Grade 12, MHF4U, In Person, Scarborough) returns 2 tutors. | — |
| R2.9 | How APlus Learn Works | ✅ | `src/components/home/Sections.jsx:162` | — | — |
| R2.10 | Popular Subjects | ✅ | `Sections.jsx:182-230` | — | — |
| R2.11 | Popular Ontario Courses | ✅ | `Sections.jsx:280-310` | — | — |
| R2.12 | Find Tutors by Grade | ✅ | Before the fix: `Sections.jsx:468-520` | Fixed with R1.1: every grade chip now leads to tutors. | — |
| R2.13 | Why Choose APlus Learn | ✅ | `Sections.jsx:581-620` | Static copy. | — |
| R2.14 | Tutor Verification | ✅ | `Sections.jsx:655-760` | — | — |
| R2.15 | Online vs. In-Person Tutoring | ✅ | `Sections.jsx:792-880` | — | — |
| R2.16 | Testimonials | ✅ | Before the fix: `src/app/(public)/page.js:40-75` | Data-driven from published reviews; the development database's reviews are seed fixtures, which is expected for that environment. | — |
| R2.17 | Become a Tutor | ✅ | `Sections.jsx:904-975` | Commission is read from Settings; "48h typical review time" is hard-coded. | — |
| R2.18 | FAQ | ✅ | Before the fix: `Sections.jsx:981-1045` | Fixed: FAQ answers are built from live settings and the live curriculum (`constants/public-copy.js` `homeFaqs`); the identity and "complete curriculum" claims were made accurate (`50-public`). | — |
| R2.19 | Footer with legal and support links | ✅ | `src/components/layout/SiteFooter.jsx:196-217` | Footer promises "live chat (replies within 4 hours)" (`:102-104`); no chat exists. | — |
| R2.20 | CTAs Find a Tutor and Become a Tutor | ✅ | `src/components/layout/SiteHeader.jsx:90,122,139` | — | — |
| R3.1 | Parent manages one or more children under one account | ✅ | `src/services/student.service.js:14-50` | — | — |
| R3.2 | Each child has separate courses, tutors, bookings, lesson history, progress | ✅ | Before the fix: `booking.service.js:1268` | Fixed: per-child courses/subjects (R5.5) and a validated per-child filter on the parent's bookings page. | — |
| R3.3 | Older students manage their own account | ✅ | `src/services/auth.service.js:63-72` | — | — |
| R3.4 | Distinguish minors from adults for privacy, communication and payment | ✅ | Before the fix: `src/models/StudentProfile.js:28-29,48-49,59-65` | Fixed: a self-registering student gives a birth year; under 13 must be added by a parent; minor status is derived and enforced server-side (`lib/utils/age.js`, `10-learners`). | — |
| R3.5 | Tutor separate onboarding and dashboard | ✅ | `src/app/tutor/layout.js:13` | — | — |
| R3.6 | Administrator full permissions, access controlled by role | ✅ | `src/constants/roles.js:26-140,206` | One ADMIN role holds all permissions; enforced server-side. | — |
| R4.1 | Email/password registration | ✅ | `RegisterForm.jsx:88-96` | Rate-limited. | — |
| R4.2 | Google sign-in | 🟡 | `src/services/external/oauth-provider.js:321-400` | Real authorization-code + PKCE adapter. No `GOOGLE_*` credentials, so only the development identity runs. | See §0.5 |
| R4.3 | Apple sign-in if practical | 🟡 | `oauth-provider.js:406-600` | Same: adapter present, not configured. | See §0.5 |
| R4.4 | First name and last name | ✅ | `RegisterForm.jsx:141-160` | — | — |
| R4.5 | Email | ✅ | `RegisterForm.jsx:165` | — | — |
| R4.6 | Phone number | ✅ | Before the fix: `validation/auth.js:14` | Fixed: collected at registration (`RegisterForm.jsx`, `validation/auth.js`). | — |
| R4.7 | Parent or Student account type | ✅ | `RegisterForm.jsx:18-34,124-137` | — | — |
| R4.8 | Province | ✅ | Before the fix: `validation/auth.js:15` | Fixed: collected at registration and checked against the postal code's province. | — |
| R4.9 | City | ✅ | Before the fix: `validation/auth.js:16` | Fixed: collected at registration. | — |
| R4.10 | Postal code | ✅ | Before the fix: `src/lib/validation/users.js:26` | Fixed: collected at registration; must belong to the chosen province. | — |
| R4.11 | Email verification | ✅ | Before the fix: `auth.service.js:114-181` | Flow and enforcement work; verifying no longer lifts a suspension (S7). Delivery uses the development mailbox until an email provider is configured (excluded). | — |
| R4.12 | Optional phone verification | 🟡 | `src/app/api/users/me/phone/route.js` | Post-registration only. Twilio is not configured, so codes go to the console. | See §0.5 |
| R5.1 | Parents create individual child profiles | ✅ | `ChildrenManager.jsx:161-205` | — | — |
| R5.2 | First name | ✅ | `StudentProfile.js:24` | — | — |
| R5.3 | Grade | ✅ | `StudentProfile.js:32-34` | `gradeId` is not checked against the child's province. | — |
| R5.4 | Province | ✅ | Before the fix: `StudentProfile.js:31` | Fixed: province on the child form; grade and courses are validated against it. | — |
| R5.5 | Subjects/courses requiring tutoring | ✅ | Before the fix: `StudentProfile.js:37-38` | Fixed: subjects and courses per child, validated against the child's province, never reset by an unrelated PATCH (`student.service.js`, `patchSchema`). | — |
| R5.6 | Online/in-person preference | ✅ | Before the fix: No implementation found (areas inspected: §4/§7) | Fixed: `lessonModePreference` (online / in person / either), UI → API → model → display. | — |
| R5.7 | General learning goals | ✅ | Before the fix: `StudentProfile.js:3-10,40` | Fixed: learning goals with target date and achieved flag, editable in the child form. | — |
| R5.8 | Optional current mark | ✅ | Before the fix: No implementation found (areas inspected: §4/§7) | Fixed: `currentMark` (0–100). | — |
| R5.9 | Optional target mark | ✅ | Before the fix: No implementation found (areas inspected: §4/§7) | Fixed: `targetMark` (0–100). | — |
| R5.10 | Optional areas needing improvement | ✅ | Before the fix: `StudentProfile.js:41` | Fixed: `areasForImprovement` field. | — |
| R5.11 | Optional learning preferences | ✅ | Before the fix: `StudentProfile.js:42` | Fixed: `learningPreferences` field. | — |
| R5.12 | Sensitive educational information not public by default | ✅ | Before the fix: `student.service.js:22-31,52-58` | Fixed: tutors see learner details only for real lesson relationships (confirmed or later), minors' surnames masked in the service (`10-learners`). | — |
| R6.1 | Province → Grade → Subject → Course → Course Code | ✅ | `src/models/Curriculum.js:12-102` | — | — |
| R6.2 | Example Ontario → Grade 12 → Mathematics → Advanced Functions → MHF4U | ✅ | `scripts/seed-data/curriculum.js` | — | — |
| R6.3 | Ontario curriculum/course-code data | 🟡 | DB: 38 courses, 32 with codes; Grade 9/10/11/12 = 4/6/9/13 courses | A fraction of the Ontario secondary catalogue. | See §0.5 |
| R6.4 | Search by course name or code, same results | ✅ | Before the fix: `src/lib/search/tutor-query.js:18-37` | Fixed: name, code and alias resolve to the same courses; curriculum edits re-copy names/codes onto tutor profiles (`lib/curriculum/taught.js`). | — |
| R6.5 | Support additional provinces without rebuilding | ✅ | Before the fix: `src/app/api/admin/curriculum/**` | Fixed: no province literal in onboarding, homepage, search or course browsing; a province activated in admin works with no code change (`05-search` runtime province, `e2e-journeys` B). | — |
| R7.1 | Province | ✅ | `src/lib/validation/search.js:14` | — | — |
| R7.2 | Grade | ✅ | `search.service.js:217-221` | — | — |
| R7.3 | Subject | ✅ | `tutor-query.js:21` | — | — |
| R7.4 | Course | ✅ | `search.service.js:204-210` | "Refine" drops the `course` slug (`RefineSearch.jsx:18,41-50`). | — |
| R7.5 | Course code | ✅ | Before the fix: `search.service.js:197-202` | Fixed with R2.5. | — |
| R7.6 | Location | ✅ | Before the fix: `search.service.js:226-237` | Fixed: location statuses RESOLVED / UNRESOLVED / INVALID; unknown places matched from tutor data; out-of-province postal codes flagged (`05-search`). | — |
| R7.7 | Online / in-person / both | ✅ | Before the fix: `search.js:21` | Fixed: distance constrains only in-person teaching — online tutors stay in a local search; "Offers both" added (`lib/search/tutor-query.js` `locationClause`). | — |
| R7.8 | Price | ✅ | `tutor-query.js:56-63` | API takes cents; the UI converts. | — |
| R7.9 | Availability | ✅ | Before the fix: `search.js:35-37` | Fixed: availability filters ask each tutor's real calendar (exceptions, bookings, group sessions, notice, horizon). | — |
| R7.10 | Tutor qualification | ✅ | Before the fix: `tutor-query.js:68` | Fixed: spec categories; several chosen qualifications match any of them. | — |
| R7.11 | Verification status | ✅ | `tutor-query.js:69` | — | — |
| R7.12 | Rating | ✅ | `tutor-query.js:66` | — | — |
| R8.1 | Location | ✅ | Before the fix: `RefineSearch.jsx:110-124` | Fixed with R7.6. | — |
| R8.2 | Online | ✅ | `SearchFilters.jsx:69-94` | — | — |
| R8.3 | In person | ✅ | curl `mode=IN_PERSON` 10 | — | — |
| R8.4 | Both | ✅ | Before the fix: `SearchFilters.jsx:72` | Fixed: `mode=BOTH` (offers online and in person). | — |
| R8.5 | Distance radius 5/10/25/50 km | ✅ | Before the fix: `src/constants/config.js:676` | Fixed: "Any distance" is `distanceKm=any`; closest-first ranks the whole result set before paging (`rankedPage`). | — |
| R8.6 | Min/max hourly rate | ✅ | `SearchFilters.jsx:298-352` | Local inputs don't reset on "Clear all". | — |
| R8.7 | OCT Certified Teacher | ✅ | `domain.js:1045-1046` | — | — |
| R8.8 | University/College Student | ✅ | `domain.js:1047` | Label says "University student". | — |
| R8.9 | Bachelor's Degree | ✅ | Before the fix: `domain.js:1048` | Fixed: `BACHELORS_DEGREE`; legacy values migrated by `scripts/migrate-qualifications.mjs`. | — |
| R8.10 | Master's Degree | ✅ | Before the fix: `domain.js:1049` | Fixed: `MASTERS_DEGREE`. | — |
| R8.11 | PhD | ✅ | Before the fix: `domain.js:1049` | Fixed: `DOCTORATE` (PhD). | — |
| R8.12 | Professional/Industry Expert | ✅ | Before the fix: `domain.js:1050` | Fixed: `INDUSTRY_PROFESSIONAL`. | — |
| R8.13 | Identity Verified | ✅ | `domain.js:38-52` | — | — |
| R8.14 | Education Verified | ✅ | `EDUCATION` | — | — |
| R8.15 | OCT Verified | ✅ | `OCT` | — | — |
| R8.16 | Background/Vulnerable Sector Check Verified | ✅ | `BACKGROUND_CHECK`; curl 6 | — | — |
| R8.17 | Availability: Today | ✅ | Before the fix: `search.js:35-37` | Implemented: `availability=TODAY`, evaluated on real open slots in the tutor's zone (`lib/search/availability-filter.js`). | — |
| R8.18 | Availability: Tomorrow | ✅ | Before the fix: `search.js:35-37` | Implemented: `TOMORROW`. | — |
| R8.19 | Availability: This Week | ✅ | Before the fix: `search.js:35-37` | Implemented: `THIS_WEEK` (to the coming Sunday). | — |
| R8.20 | Availability: Weekend | ✅ | Before the fix: `config.js:694` | Fixed: `WEEKEND` means a bookable slot this weekend. | — |
| R8.21 | Availability: Specific date/time | ✅ | Before the fix: No date/time parameter in `tutorSearchSchema` | Implemented: `date` + `time` (a slot starting exactly then). | — |
| R8.22 | Rating threshold | ✅ | `config.js:681` | — | — |
| R8.23 | Years of experience | ✅ | `config.js:683-688` | — | — |
| R9.1 | Profile photo | ✅ | `src/components/tutor/TutorCard.jsx:53-76` | 11 of 12 seeded tutors have no avatar (initials shown). | — |
| R9.2 | First name + last initial | ✅ | `src/lib/utils/format.js:101-104` | — | — |
| R9.3 | Star rating and review count | ✅ | `TutorCard.jsx:92-96` | Count is zero-padded "(02)". | — |
| R9.4 | Verification badge(s) | ✅ | `TutorCard.jsx:84,399` | — | — |
| R9.5 | Top courses/subjects | ✅ | `TutorCard.jsx:129,404-434` | — | — |
| R9.6 | Years of experience | ✅ | `TutorCard.jsx:375-380` | — | — |
| R9.7 | Approximate distance | ✅ | Before the fix: `src/lib/geo/index.js:17-25` | Fixed: distance shown only for in-person tutors with a known location and a resolved search location. | — |
| R9.8 | Online / in-person status | ✅ | `TutorCard.jsx:278-340` | — | — |
| R9.9 | Hourly rate | ✅ | `TutorCard.jsx:342-366` | — | — |
| R9.10 | Next available time | ✅ | Before the fix: `TutorCard.jsx:384-389` | Fixed: next available is computed live from the booking calendar for every card and for the "soonest" sort (`availability.service.nextAvailableFor`); a booking or group session moves it immediately (`05-search`). | — |
| R9.11 | View Profile button | ✅ | `TutorCard.jsx:67-69` | — | — |
| R9.12 | View Availability button | ✅ | Before the fix: `TutorCard.jsx` | Implemented: "View availability" on every card (`#availability` on the profile). | — |
| R9.13 | Optional Message and Book buttons | ✅ | Before the fix: `TutorCard.jsx` | Implemented: "Message" and "Book" on every card. | — |
| R10.1 | Professional profile photo | ✅ | `src/components/tutor/TutorProfileHeader.jsx:24-29` | — | — |
| R10.2 | First name + last initial | ✅ | `TutorProfileHeader.jsx:34-36` | — | — |
| R10.3 | Rating and review count | ✅ | `TutorProfileHeader.jsx:55-59` | — | — |
| R10.4 | Number of completed lessons | ✅ | `TutorProfileHeader.jsx:63-69` | Hidden when 0. | — |
| R10.5 | Hourly rate | ✅ | `TutorProfileHeader.jsx:118-125` | — | — |
| R10.6 | Approximate location | ✅ | `TutorProfileHeader.jsx:77-85` | — | — |
| R10.7 | Online/in-person status | ✅ | `TutorProfileHeader.jsx:87-97` | — | — |
| R10.8 | Response time | ✅ | Before the fix: `message.service.js:263-288` | Fixed: the measured response time is shown, or nothing. | — |
| R10.9 | Verification badges | ✅ | `TutorProfileHeader.jsx:47-49` | — | — |
| R10.10 | Introduction/bio | ✅ | `TutorProfileBody.jsx:31` | — | — |
| R10.11 | Education | ✅ | `TutorProfileBody.jsx:105-160` | Per-entry "Verified" tag never shows (`TutorProfile.education[].verified` is never set). | — |
| R10.12 | Teaching/tutoring experience | ✅ | `TutorProfileBody.jsx:160+` | — | — |
| R10.13 | Specific courses taught | ✅ | `TutorProfileBody.jsx:47-100` | — | — |
| R10.14 | Availability calendar | ✅ | Before the fix: `BookingWidget.jsx:70` | Fixed: signed-out visitors get the full week-paged picker; a chosen slot survives sign-in (`lib/booking/widget-params.js`). | — |
| R10.15 | Reviews | ✅ | `GET /api/tutors/[slug]/reviews` | — | — |
| R10.16 | Book button | ✅ | `BookingWidget.jsx:161` | Signed-out visitors see "Sign in to book". | — |
| R10.17 | Message button | ✅ | `MessageTutorPanel.jsx:22` | For a tutor or admin viewer the `#message` anchor points to nothing. | — |
| R10.18 | Save/Favourite button | ✅ | `TutorProfileHeader.jsx:39-44` | — | — |
| R10.19 | Exact residential address never public | ✅ | `tutor.service.js:49-129` | The profile's JSON-LD block is an XSS sink (S1). | — |
| R11.1 | Identity Verified (government ID reviewed) | ✅ | `src/constants/domain.js:38-63` | Upload → admin decision → `TutorProfile.verifiedTypes` → public badge. | — |
| R11.2 | OCT Verified | ✅ | `src/constants/domain.js:38-63` | — | — |
| R11.3 | Education Verified | ✅ | `src/constants/domain.js:38-63` | — | — |
| R11.4 | University Student Verified | ✅ | `src/constants/domain.js:38-63` | — | — |
| R11.5 | Background Check Verified (recent police/VSC) | ✅ | Before the fix: `src/models/Verification.js:59-60` | Fixed: background-check badges always get an expiry (setting `backgroundCheckValidityMonths`, overridable); expiry job still runs on re-uploads (`20-onboarding`). | — |
| R11.6 | Clearly define what each badge means | ✅ | `src/app/(public)/verification/page.js:15-42,108-161` | — | — |
| R11.7 | Avoid implying verification guarantees performance or safety | ✅ | Before the fix: `src/constants/legal.js:80` | Fixed: `VERIFICATION_DISCLAIMER` on /verification, /safety, the profile trust card and the help centre. | — |
| R12.1 | How the platform works | ✅ | Before the fix: `src/app/(public)/become-a-tutor/page.js:202-235` | Fixed: an "After you apply" section covers verification → approval → bookings → teaching → payout → reviews. | — |
| R12.2 | Benefits of joining | ✅ | `page.js:91-146` | — | — |
| R12.3 | Platform commission/fees | ✅ | Before the fix: `page.js:65-67,78,164` | Fixed: every number on the page comes from settings (commission, minimum rate, review time, payout hold, cancellation). | — |
| R12.4 | Tutor requirements | ✅ | `page.js:175-196` | — | — |
| R12.5 | Verification process | ✅ | Before the fix: `page.js:113-115,191-194,250-257` | Fixed: the verification step is described concretely (ID required before approval, badges one at a time). | — |
| R12.6 | How tutors get paid | ✅ | `page.js:40-42,150-173` | — | — |
| R12.7 | Tutor FAQs | ✅ | `page.js:22-55,262` | — | — |
| R12.8 | "Create Your Tutor Profile" call to action | ✅ | `page.js:70-71,82-84,231-233,247-249` | Labelled "Start my application". | — |
| R13.1 | Personal information: name, email, phone, city, province | ✅ | `tutors.js:54-61` | — | — |
| R13.2 | Profile photo | ✅ | Before the fix: `ProfileStep.jsx` | Fixed: photo uploaded in the Profile step, required to submit, shown to the reviewer. | — |
| R13.3 | Biography, languages, years of experience | ✅ | `tutors.js:63-82,98` | — | — |
| R13.4 | Education: institution, degree/program, field, graduation year | ✅ | `tutors.js:18-30` | — | — |
| R13.5 | Teaching qualifications: OCT or other credentials | ✅ | Before the fix: `tutors.js:88-100` | Fixed: spec qualification list plus free-text "other credentials". | — |
| R13.6 | Subjects/courses: province → grade → subject → course | ✅ | Before the fix: `CoursesStep.jsx:18,33,180-199` | Fixed: province → grade → subject → course picker driven by the curriculum APIs; server validates every course id (`CoursesStep.jsx`, `20-onboarding`). | — |
| R13.7 | Lesson type: online, in person or both | ✅ | `tutors.js:106-121` | — | — |
| R13.8 | Location: city, general area, travel radius | ✅ | `tutors.js:123-128` | General area is the postal prefix plus a centroid. | — |
| R13.9 | Pricing: hourly rate | ✅ | `tutors.js:130-140` | The minimum is not enforced on later profile edits or per-course rates (`tutors.js:48,202`). | — |
| R13.10 | Availability: recurring weekly schedule | ✅ | `tutors.js:142-160` | — | — |
| R13.11 | Verification documents: secure upload | ✅ | Before the fix: `DocumentsStep.jsx:77-83,126` | Fixed: documents upload against a profile id reserved on the application, are held out of the queue until submission, then promoted; the reviewer sees them (`verification.service.uploadTargetFor`, `20-onboarding`). | — |
| R13.12 | Submit application for administrator review | ✅ | `src/app/api/tutor/onboarding/submit/route.js` | — | — |
| R13.13 | Not searchable until approved by an administrator | ✅ | `tutor.service.js:697-713` | Re-approving a suspended user's application makes them searchable again, because `deriveSearchable` ignores account status. | — |
| R14.1 | Recurring weekly availability | ✅ | `src/models/Availability.js:7-14` | — | — |
| R14.2 | Specific date blocking | ✅ | `Availability.js:17-30` | The UI blocks whole days, computed in the browser's time zone. | — |
| R14.3 | Vacation/unavailable periods | ✅ | `Availability.js:25` | The `EXTRA` kind is accepted but does nothing (`slots.js:47`). | — |
| R14.4 | Prevent double-booking | ✅ | Before the fix: `src/lib/booking/slots.js:110-170` | Fixed: one busy-time definition (bookings + published group sessions + external calendars) for display, claim, reschedule and group publish; DST minutes read from the zone (`busyPeriodsForTutors`, `slots.js`). | — |
| R14.5 | Edit future availability | ✅ | `availability.service.js:90-104,128-166` | Edits apply to all future weeks; refused if they would strand a booking. | — |
| R14.6 | Support future Google Calendar / Outlook integrations | ✅ | `src/services/external/calendar-provider.js:107,212,539` | Real adapters exist (Phase Two, §6). | — |
| R15.1 | Book directly from tutor profile | ✅ | `src/app/(public)/tutors/[slug]/page.js:89` | — | — |
| R15.2 | Select course | ✅ | `BookingWidget.jsx:33` | — | — |
| R15.3 | Select online or in-person | ✅ | `BookingWidget.jsx:34` | — | — |
| R15.4 | Choose date | ✅ | `AvailabilityPicker` (21 days) | — | — |
| R15.5 | Choose available time | ✅ | `booking.service.js:349` | — | — |
| R15.6 | Choose duration | ✅ | `src/lib/validation/bookings.js:40-44` | — | — |
| R15.7 | Display full lesson price | ✅ | `src/lib/booking/pricing.js:23-40` | Price is server-derived. | — |
| R15.8 | Continue to secure payment | 🟡 | `src/app/(dashboard)/bookings/checkout/[paymentId]/page.js` | Works end to end only with the mock provider. The Stripe path is code-only; the configured account cannot take charges. | See §0.5 |
| R15.9 | Receive confirmation | ✅ | Before the fix: `booking.service.js:1168-1213` | Fixed: confirmations carry location/online details, the amount actually paid and the live cancellation policy; tutor link goes to the tutor page (`45-booking-lifecycle`). | — |
| R15.10 | One-time and recurring lessons | ✅ | `domain.js:1032` | Packages cannot pay for a series. | — |
| R16.1 | Marketplace-capable provider (Stripe Connect or equivalent) | 🟡 | `src/services/external/payment-provider.js:256-500` | Real code, not exercisable: test account `charges_enabled:false`. | See §0.5 |
| R16.2 | Student pays through APlus Learn | 🟡 | `payment.service.js:41-100` | Code-verified only. | See §0.5 |
| R16.3 | Platform commission deducted automatically | ✅ | `pricing.js:23-40` | The platform collects 100 % and transfers the tutor share later. | — |
| R16.4 | Tutor portion tracked automatically | ✅ | Before the fix: `payout.service.js:160-168` | Fixed: payable share is net of refunds on the booking; atomic payout claim; refunds after payout carried as deductions (`PayoutAdjustment`, `40-money`). | — |
| R16.5 | Commission percentage configurable by administrators | ✅ | `src/lib/validation/admin.js:323` | DB value 15. | — |
| R16.6 | Payment status visible to relevant users and admin | ✅ | Before the fix: `src/app/(dashboard)/payments/*` | Fixed: tutors see the payment status (no card details) on their booking. | — |
| R16.7 | Refund support | ✅ | Before the fix: `payment.service.js:328-404` | Fixed: refunds are planned from what was collected (cash + re-credited account credit) before any booking is saved as cancelled (`payment.service.planLessonRefund`). | — |
| R16.8 | Tutor payout onboarding | 🟡 | `payout.service.js:36-152` | Connect accounts are created with `payouts.schedule.interval: "manual"` (`payment-provider.js:430`) and nothing creates Stripe Payouts, so transferred funds may stay… | See §0.5 |
| R16.9 | Tutor earnings dashboard | ✅ | Before the fix: `src/app/tutor/earnings/page.js` | Fixed: "owed to you" is all-time and net of refunds; earnings use the payout rule (`tutorEarnings`). | — |
| R16.10 | Example $50 → 15 % = $7.50 → $42.50 | ✅ | `pricing.js:24-26` | 5000 × 15 / 100 = 750; 5000 − 750 = 4250. | — |
| R17.1 | Private parent/student ↔ tutor conversations | ✅ | `src/models/Messaging.js:10-60` | Only a learner can start a thread (`:115-117`). | — |
| R17.2 | Time and date stamps | ✅ | `Messaging.js:122` | — | — |
| R17.3 | Booking-related messages | ✅ | Before the fix: `Messaging.js:21-22,106-108` | Fixed: confirmation, cancellation and reschedule are narrated in the thread as SYSTEM messages, once each (`booking-messages.service.js`). | — |
| R17.4 | Website notifications | ✅ | `message.service.js:201-213` | Unread counts per user; realtime hints only. | — |
| R17.5 | Optional future file attachments | ✅ | `/api/messages/attachments/*` | — | — |
| R17.6 | Report/block | ✅ | `message.service.js:126-132,460-471` | Block is one-way. Admins get no notification of reports, only a queue badge. | — |
| R17.7 | Anti-circumvention against moving payment off-platform | ✅ | Before the fix: `message.service.js:93` | Implemented: contact details are masked before storage, off-platform payment language flagged, risk signal recorded (`lib/messaging/contact-detection.js`, `e2e-journeys` M). | — |
| R18.1 | Course | ✅ | `src/lib/validation/engagement.js:149-155` | — | — |
| R18.2 | Location | ✅ | `engagement.js:118-121,145-146` | — | — |
| R18.3 | Online/in-person | ✅ | `TutorRequest.js:45-50` | — | — |
| R18.4 | Preferred schedule | ✅ | `engagement.js:122-126` | Named windows. | — |
| R18.5 | Budget | ✅ | `engagement.js:127-128,143` | — | — |
| R18.6 | Goal | ✅ | `engagement.js:138` | — | — |
| R18.7 | Desired start date | ✅ | `engagement.js:139` | — | — |
| R18.8 | Optional notes | ✅ | `engagement.js:140` | — | — |
| R18.9 | Matching tutors indicate interest | ✅ | Before the fix: `/api/requests/[id]/interest` | Fixed: only eligible tutors can express interest (`30-requests-reviews`). | — |
| R18.10 | Parent compares interested tutors and chooses one | ✅ | Before the fix: `/api/requests/[id]/matches` | Fixed: booking from a request is validated server-side and closes the request on payment (`45-booking-lifecycle`). | — |
| R18.11 | Requests expire automatically or are closable | ✅ | `request.service.js:334,819-888,990-1071` | Read paths check only `status`, so a request stays open up to about 24 h after `expiresAt`. | — |
| R19.1 | MVP rules-based matching on course, location, budget, availability | ✅ | `src/lib/matching/eligibility.js:22-108` | Course and location are hard gates; budget and availability are scored. | — |
| R19.2 | Future: teaching style, student goals, ratings, repeat booking rate, response rate, availability | 🟡 | `src/lib/matching/weights.js:19-44` | Ratings and availability are used. Response *time*, not rate. | See §0.5 |
| R20.1 | Save tutors to a personal list | ✅ | `/api/favourites` | — | — |
| R20.2 | Return later to compare or book | ✅ | Before the fix: `src/app/(dashboard)/favourites/page.js` | Fixed: only searchable tutors are listed or can be saved. | — |
| R21.1 | 1–5 star rating | ✅ | `engagement.js:77-83` | — | — |
| R21.2 | Optional written review | ✅ | Before the fix: `engagement.js:85-89` | Fixed: written review optional. | — |
| R21.3 | Categories: knowledge, communication, reliability, teaching ability | ✅ | `engagement.js:79-82` | — | — |
| R21.4 | Only users with completed bookings can leave verified reviews | ✅ | `review.service.js:35-49` | A rejected dispute can turn an unpaid or cancelled booking into COMPLETED, which then becomes reviewable (S4). | — |
| R21.5 | Admin moderation and reporting workflow | ✅ | Before the fix: `/api/reviews/[id]/report` | Fixed: any member can report; pending-approval queue; moderation audited (`30-requests-reviews`). | — |
| R22.1 | Upcoming lessons | ✅ | `src/app/(dashboard)/bookings/page.js:14-19` | Runtime: page renders for the seeded parent at all 4 viewports. | — |
| R22.2 | Past lessons | ✅ | Before the fix: `booking.service.js:1242-1251` | Fixed: Past/Upcoming split on the lesson's end by the clock; `lesson-completion` job completes unmarked lessons after the no-show window (`40-money`). | — |
| R22.3 | My Tutors | ✅ | Before the fix: `src/app/(dashboard)/tutors/page.js:18` | Fixed: only real lesson relationships. | — |
| R22.4 | Saved Tutors | ✅ | `src/app/(dashboard)/favourites/page.js` | — | — |
| R22.5 | Messages | ✅ | `src/app/(dashboard)/messages/*` | — | — |
| R22.6 | Tutor Requests | ✅ | `src/app/(dashboard)/requests/*` | — | — |
| R22.7 | Payments/receipts | ✅ | Before the fix: `src/app/(dashboard)/payments/page.js` | Fixed: an unsettled payment has no receipt; totals are account-wide, not the page. | — |
| R22.8 | Children/student profiles | ✅ | `src/app/(dashboard)/children/page.js` | Field gaps are in §4.5. | — |
| R22.9 | Profile and account settings | ✅ | `src/app/(dashboard)/settings/page.js` | — | — |
| R23.1 | Dashboard overview | ✅ | `src/app/tutor/dashboard/page.js:9-29` | — | — |
| R23.2 | Next lesson | ✅ | `tutor/dashboard/page.js:166,425-441` | `Avatar` gets the full `lastName` without `name`, so its `sr-only` label prints a minor's surname (S5). | — |
| R23.3 | Calendar | ✅ | `src/app/tutor/calendar/page.js` | Full student `lastName` is passed to the client `TutorCalendar` (S5). | — |
| R23.4 | Bookings / booking requests | 🟡 | `src/app/tutor/bookings/page.js:14-18` | Bookings: yes. There is no request-to-book or accept/decline step; a booking is confirmed by payment. | See §0.5 |
| R23.5 | Students | ✅ | Before the fix: `src/app/tutor/students/page.js:26-52,98-100,160` | Fixed: roster from real lesson relationships; earned = completed lessons net of refunds (`10-learners`). | — |
| R23.6 | Messages | ✅ | `src/app/tutor/messages/*` | A tutor cannot start a thread with a family who booked (`message.service.js:115-117`). | — |
| R23.7 | Earnings and payouts | ✅ | Before the fix: `src/app/tutor/earnings/page.js` | Fixed with R16.9. | — |
| R23.8 | Reviews | ✅ | `src/app/tutor/reviews/page.js` | — | — |
| R23.9 | Tutor request opportunities | ✅ | `src/app/tutor/requests/page.js:15` | — | — |
| R23.10 | Profile editing | ✅ | `src/app/tutor/profile/page.js:43` | — | — |
| R23.11 | Verification status | ✅ | `src/app/tutor/verification/page.js:47` | — | — |
| R24.1 | Both parties receive confirmation after payment | ✅ | `booking.service.js:1168-1213` | The tutor email CTA links to learner-only `/bookings/:id` (`email-templates.js:249`), which redirects tutors away. | — |
| R24.2 | Tutor | ✅ | `src/services/external/email-templates.js:243` | — | — |
| R24.3 | Course | ✅ | `email-templates.js:242` | — | — |
| R24.4 | Date | ✅ | `email-templates.js:244` | — | — |
| R24.5 | Time | ✅ | `email-templates.js:244` | — | — |
| R24.6 | Format | ✅ | `email-templates.js:246` | — | — |
| R24.7 | Location or online details | ✅ | Before the fix: `booking.service.js:1215-1229` | Fixed with R15.9. | — |
| R24.8 | Amount paid | ✅ | Before the fix: `booking.service.js:1226` | Fixed: the Payment's total (series and credit correct). | — |
| R24.9 | Cancellation policy | ✅ | Before the fix: `BookingDetail.jsx:328` | Fixed: policy text from settings. | — |
| R24.10 | MVP: email + in-site notifications | 🟡 | `src/services/notification.service.js:48-87` | In-site works. Email goes to the development console: no Resend/SMTP is configured. | See §0.5 |
| R24.11 | Future: SMS and mobile push | 🟡 | `notification.service.js:84` | Future scope; noted for completeness. | See §0.5 |
| R25.1 | Zoom / Google Meet / Teams links stored against the booking | 🟡 | Before the fix: `src/models/Booking.js:188-189` | Production no longer fabricates join links (no link; the tutor pastes one). Real Zoom/Meet/Teams rooms need the excluded meeting providers. | See §0.5 |
| R26.1 | Student's home | ✅ | `src/constants/domain.js:122-128` | — | — |
| R26.2 | Tutor's location | ✅ | `src/constants/domain.js:122-128` | — | — |
| R26.3 | Library | ✅ | `src/constants/domain.js:122-128` | No detail captured. | — |
| R26.4 | Public location | ✅ | `src/constants/domain.js:122-128` | No detail captured. | — |
| R26.5 | Other agreed location | ✅ | Before the fix: `src/constants/domain.js:122-128` | Fixed: OTHER requires a description, kept private until confirmation; the type must be one the tutor offers. | — |
| R26.6 | Private addresses shared only after booking, never on profiles | ✅ | `Booking.js:103` | — | — |
| R27.1 | Configurable cancellation window | ✅ | `src/lib/booking/policy.js:53` | Legal and marketing pages hard-code "24 hours" or read `DEFAULT_SETTINGS`, so they can contradict the enforced value. | — |
| R27.2 | Student cancellation workflow | ✅ | Before the fix: `/api/bookings/[id]/cancel` | Fixed: an unpaid cancellation refunds nothing, voids the checkout and returns credit; a late payment is refunded. | — |
| R27.3 | Tutor cancellation workflow | ✅ | `/api/bookings/[id]/cancel` | — | — |
| R27.4 | Full/partial refund rules | ✅ | `policy.js:40-90` | — | — |
| R27.5 | No-show reporting | ✅ | Before the fix: `booking.service.js:1665,1750-1800` | Fixed: a learner's tutor-no-show report opens a dispute (no self-refund); only CONFIRMED, ended, unpaid-out lessons inside `noShowReportWindowHours`; learner UI added (`40-money`). | — |
| R27.6 | Administrator dispute review | ✅ | Before the fix: `src/app/admin/disputes/*` | Fixed: disputes only on eligible, paid lessons inside `disputeWindowDays`; decisions restore the interrupted status or the decided outcome; partial refunds net the payout (`40-money`). | — |
| R27.7 | Track repeated no-shows/cancellations | ✅ | Before the fix: `booking.service.js:1583-1620` | Fixed: every no-show path records the pattern signal. | — |
| R27.8 | Warnings, suspension or removal for repeated abuse | ✅ | Before the fix: `policy.js:220-235` | Fixed: warning/review at the configured no-show threshold, as for cancellations. | — |
| R28.1 | View parents, students and tutors | ✅ | `src/app/admin/users/page.js:19-22,53` | Children appear under the parent's detail page. | — |
| R28.2 | Suspend/ban/restore accounts | ✅ | Before the fix: `validation/admin.js:20-28` | Fixed: distinct BAN, audited restore, no self/last-admin action; search state kept in step (`60-admin-security`). | — |
| R28.3 | View user history as permitted | ✅ | Before the fix: `src/app/admin/users/[id]/page.js` | Fixed: account detail lists bookings, payments and conversations (no bodies); spend from payments. | — |
| R28.4 | Review applications | ✅ | `src/app/admin/applications/*` | No DRAFT tab, so an info-requested application disappears from every tab once edited. | — |
| R28.5 | View secure documents | ✅ | `ApplicationReview.jsx:188-205` | Views are logged as `VERIFICATION_BADGE_GRANTED` (`verification.service.js:154-160`). | — |
| R28.6 | Approve/reject | ✅ | `tutor.service.js:590-690` | The note "included in their approval email" is never sent (`tutor.service.js:646`). | — |
| R28.7 | Request more information | ✅ | `tutor.service.js:630-634` | — | — |
| R28.8 | Assign/remove verification badges | ✅ | Before the fix: `TutorRowActions.jsx:134-221` | Fixed: expiry on grants; restore-to-search works (`20-onboarding`). | — |
| R28.9 | Add/edit provinces | ✅ | `/api/admin/curriculum/provinces/*` | — | — |
| R28.10 | Grades | ✅ | Before the fix: `/api/admin/curriculum/grades/*` | Fixed: deactivated grades stay listed for admins; renames cascade with slug aliases. | — |
| R28.11 | Subjects | ✅ | Before the fix: `/api/admin/curriculum/subjects/*` | Fixed: same for subjects. | — |
| R28.12 | Courses | ✅ | `/api/admin/curriculum/courses/*` | Delete blocked while tutors teach it. Admin list caps at 100 per province. | — |
| R28.13 | Course codes | ✅ | Course `code` field | Renaming a code doesn't update tutors' copied `courseCodes`. | — |
| R28.14 | View upcoming/completed/cancelled bookings | ✅ | Before the fix: `src/app/admin/bookings/page.js:22-28` | Fixed: Upcoming / Past / Cancelled / No-shows / Disputed / Unpaid / Expired views; money from collected payments. | — |
| R28.15 | Transactions | ✅ | `src/app/admin/payments/page.js` | — | — |
| R28.16 | Commissions | ✅ | Before the fix: Per row on admin payments and bookings | Fixed: totals over the whole filtered set (`paymentTotals`). | — |
| R28.17 | Tutor earnings | ✅ | Before the fix: `src/app/admin/payouts/page.js` | Fixed: per-tutor earnings table (earned net, paid, in flight, deductions, owed). | — |
| R28.18 | Refunds | ✅ | `admin/payments/page.js:151` | Doesn't adjust the booking or payout (R16.4). | — |
| R28.19 | Payout status | ✅ | Before the fix: `admin/payouts/page.js:164` | Fixed: payout state machine enforced server-side and in the UI; FAILED is final (`40-money`). | — |
| R28.20 | Review complaints | ✅ | Before the fix: `review.service.js:171-253` | Fixed: support enquiries are stored tickets with an admin queue. | — |
| R28.21 | No-shows | ✅ | Before the fix: ` (audited); dispute reasons TUTOR_NO_SHOW/STUDENT_NO_SHOW (` | Fixed: No-shows view on admin bookings. | — |
| R28.22 | Refund disputes | ✅ | Before the fix: `src/app/admin/disputes/*` | Fixed with R27.6. | — |
| R28.23 | Reported reviews | ✅ | `admin/reviews/page.js:17-32` | — | — |
| R28.24 | Reported tutor requests | ✅ | Before the fix: `request.service.js` | Implemented: members report requests; admin report queue; dismiss/remove audited. | — |
| R28.25 | Analytics: registered and approved tutors | ✅ | Before the fix: `analytics.service.js:261-262` | Fixed: registered vs approved tutors reported separately. | — |
| R28.26 | Analytics: active students | ✅ | Before the fix: `analytics.service.js:265` | Fixed: distinct learners with a confirmed/completed lesson in the period. | — |
| R28.27 | Analytics: bookings | ✅ | `analytics.service.js:179-240` | — | — |
| R28.28 | Analytics: gross tutoring sales | ✅ | `analytics.service.js:102-170` | — | — |
| R28.29 | Analytics: platform revenue | ✅ | `analytics.service.js:166-167` | — | — |
| R28.30 | Analytics: average booking value | ✅ | Before the fix: `analytics.service.js:313-315` | Fixed: per booked lesson, from payments. | — |
| R28.31 | Analytics: most searched subjects/courses | ✅ | Before the fix: No implementation found (areas inspected: §4/§7) | Implemented: anonymous `SearchEvent` per search (curriculum meaning, mode, resolved city — no text, postal code or identity); admin report from `searchDemand` (`05-search`, `60-admin-security`). | — |
| R28.32 | Analytics: most active cities | ✅ | Before the fix: `analytics.service.js:369-375` | Fixed: cities by activity in the period. | — |
| R28.33 | Analytics: online vs in-person bookings | ✅ | `analytics.service.js:376-379` | — | — |
| R28.34 | Analytics: new registrations | ✅ | `analytics.service.js:270-271` | — | — |
| R29.1 | Postal code/city search via a mapping/geocoding service | 🟡 | Before the fix: `geocoding-provider.js` | The application defect is fixed: no province-centroid fallback; unknown places are reported and answered from tutor data (`geocoding-provider.js`, `search.service.resolveLocation`). A real geocoding service (Google) is an excluded external provider. | See §0.5 |
| R29.2 | Approximate distance calculations | ✅ | Before the fix: `TutorProfile.js:203` | Fixed: closest-first over the whole set. | — |
| R29.3 | Never expose exact tutor residential addresses in search results | ✅ | `/api/search/tutors` | — | — |
| R30.1 | HTTPS | 🟡 | `next.config.mjs:95,163` | No app-level redirect; TLS depends on the host. | See §0.5 |
| R30.2 | Secure password hashing | ✅ | `src/lib/auth/password.js:4` | Policy allows 128 characters; bcrypt reads 72 bytes (Info). | — |
| R30.3 | Role-based access controls | ✅ | `src/lib/api/handler.js` | 21 protected routes returned 401 unauthenticated. | — |
| R30.4 | Secure authentication | 🟡 | `current-user.js` | IP limits trust a spoofable `X-Forwarded-For` (S11). | See §0.5 |
| R30.5 | Secure verification document storage | 🟡 | `storage-provider.js:139-147,223-229` | Production falls back to unencrypted local disk when S3 is not configured (S10). | See §0.5 |
| R30.6 | Payment details handled by the payment provider | ✅ | Before the fix: `payment-provider.js:300` | Fixed: the card-capture route answers 404 before reading a body when hosted checkout is in use. | — |
| R30.7 | Privacy controls for minors | ✅ | Before the fix: `format.js:119` | Fixed: minors' surnames removed in the services; Avatar labels use the masked name (`10-learners`). | — |
| R30.8 | Secure administrator dashboard | 🟡 | `enforceRole` on all admin pages; `permission:` on all admin APIs | One all-powerful role; no 2FA or step-up; 14-day sessions. | See §0.5 |
| R30.9 | Audit logging for important admin actions | ✅ | Before the fix: `src/services/audit.service.js` | Fixed: distinct action names; audit-write failures logged loudly. | — |
| R30.10 | Defined data retention/deletion processes | ✅ | Before the fix: `user.service.js:113-183` | Fixed: one anonymisation routine for self and admin deletion; verification-document retention job (`verificationDocumentRetentionDays`) (`60-admin-security`, `20-onboarding`). | — |
| R30.11 | Canadian privacy/legal review before launch | ⚪ | `src/constants/legal.js` | No evidence of a review; the text contains claims the code contradicts. | See §0.5 |
| R31.1 | Fully responsive on desktop, tablet and smartphone | ✅ | `/login` | Data tables scroll inside their card on phone and tablet (columns cut off until scrolled). | — |
| R31.2 | Backend usable by future iOS/Android apps | 🟡 | `src/lib/api/response.js` | Auth is cookie-only (`session.js:86-122`, audience `apluslearn:web`): no bearer tokens or refresh tokens. | See §0.5 |
| R32.1 | Public tutor and course pages indexable and optimised | ✅ | `/ontario/grade-12/mathematics/mhf4u` | Invalid dynamic URLs return 200 with both `index, follow` and `noindex` meta (soft 404, from root `src/app/loading.js`). | — |
| R32.2 | "MHF4U tutor Toronto" | ✅ | `/tutors/mhf4u/toronto` | — | — |
| R32.3 | "Grade 12 math tutor Scarborough" | ✅ | Before the fix: `src/app/(public)/tutors/[slug]/[city]/page.js:35-41` | Implemented: `/tutors/grade-12-math/scarborough` and subject/alias + city pages, data-driven, in-person tutors for that place (`50-public`). | — |
| R32.4 | "ENG4U tutor Toronto" | ✅ | `/tutors/eng4u/toronto` | — | — |
| R32.5 | "Ontario math tutor" | ✅ | Before the fix: `/ontario` | Implemented: `/ontario`, `/ontario/math`, `/british-columbia/mathematics`, grade + subject pages; unknown/inactive → 404. | — |
| R32.6 | "Calculus tutor near me" | ✅ | Before the fix: `/tutors/mcv4u/toronto` | Fixed: course aliases (`/tutors/calculus/toronto`). | — |
| R32.7 | URL structure `/ontario/grade-12/math/mhf4u` | ✅ | Before the fix: `src/app/(public)/[province]/[grade]/[subject]/[course]/page.js` | Fixed: slugs, aliases and codes resolve; non-canonical forms redirect permanently to the canonical URL. | — |
| R32.8 | URL structure `/tutors/mhf4u/scarborough` | ✅ | curl 200, "MHF4U tutors in Scarborough", canonical | No JSON-LD. | — |
| R32.9 | Shareable public tutor profile URL | ✅ | `/tutors/[slug]` | — | — |
| R33.1 | Help Centre | ✅ | Before the fix: `/help` | Implemented: `/help-centre`, built from live settings and policies. | — |
| R33.2 | Contact Support | ✅ | Before the fix: `/support` | Fixed: enquiries stored and worked from an admin queue; no placeholder phone. | — |
| R33.3 | About Us | ✅ | `/about` | Same placeholder phone. | — |
| R33.4 | How It Works | ✅ | `/how-it-works` | Hard-codes "24 hours". | — |
| R33.5 | Find a Tutor | ✅ | `/find-a-tutor` | — | — |
| R33.6 | Become a Tutor | ✅ | `/become-a-tutor` | — | — |
| R33.7 | Pricing/Fees | ✅ | `/pricing` | Hard-codes "24 hours" (`pricing/page.js:33,82`). | — |
| R33.8 | Tutor Verification | ✅ | `/verification` | — | — |
| R33.9 | Safety | ✅ | `/safety` | — | — |
| R33.10 | FAQ | ✅ | `/faq` | — | — |
| R33.11 | Terms of Service | ✅ | Before the fix: `/legal/terms` | Fixed: operator name and governing law from settings; numbers from live settings. Legal review itself remains R30.11. | — |
| R33.12 | Privacy Policy | ✅ | Before the fix: `/legal/privacy` | Fixed: retention statement matches the code (setting-driven); deletion discards documents. Legal review remains R30.11. | — |
| R33.13 | Cookie Policy | ✅ | Before the fix: `/legal/cookies` | Fixed: every cookie the app sets plus browser storage and service-worker caches. | — |
| R33.14 | Cancellation/Refund Policy | ✅ | Before the fix: `/legal/cancellation` | Fixed: numbers from live settings. | — |
| R33.15 | Community Standards | ✅ | Before the fix: `/legal/community-standards` | Implemented: `/legal/community-standards`. | — |
| R33.16 | Tutor Agreement | ✅ | Before the fix: `/legal/tutor-agreement` | Implemented: `/legal/tutor-agreement`. | — |
| P2.1 | Advanced Post a Tutor Request workflow | ✅ | `request.service.js:278-1071` | See R18.9–R18.10 for gaps that also affect the MVP. | — |
| P2.2 | Advanced tutor matching | 🟡 | `src/lib/matching/weights.js:19-44` | Rules-based scoring. Teaching style, student goals and repeat-booking rate are not used. | Phase K — Phase Two |
| P2.3 | Google/Outlook calendar synchronisation | 🟡 | `calendar-provider.js:212` | Code is complete for busy-pull and event-push. | Phase K — Phase Two |
| P2.4 | SMS notifications | 🟡 | `sms-provider.js:98-107` | Delivery receipts are never processed: the help text tells operators to point the status callback at `/api/webhooks/sms`, which ignores it… | Phase K — Phase Two |
| P2.5 | Referral program | ✅ | `src/models/Referral.js` | Reward amounts default to 0 (`config.js:536-543`) until an admin sets them. | — |
| P2.6 | Tutor packages | ✅ | `src/models/Package.js` | — | — |
| P2.7 | Group tutoring | ✅ | `src/models/GroupSession.js` | Can overlap 1:1 bookings (R14.4). | — |
| P2.8 | Progress reports | ✅ | `src/models/ProgressReport.js` | — | — |
| P2.9 | Promoted tutor profiles | 🟡 | `src/models/Promotion.js` | Admin-granted only: tutors cannot buy a promotion; no price or payment exists. | Phase K — Phase Two |
| P2.10 | Advanced analytics | ✅ | `analytics.service.js:242-841` | No export. Shares the MVP analytics gaps (R28.25–R28.32). | — |
| P2.11 | Fraud/risk tools | ✅ | `src/models/Risk.js` | 5 signals (cancellations, no-shows, payment failures, disputes, referral abuse). | — |
| P3.1 | iOS app | 🔴 | `ios/` | A PWA exists (`src/app/manifest.js`, `public/sw.js`, `src/components/pwa/*`, `docs/PWA.md`), but it is not a native app and has no push. | Phase L — Phase Three |
| P3.2 | Android app | 🔴 | `ios/` | No TWA wrapper. | Phase L — Phase Three |
| P3.3 | Integrated video classroom | 🔴 | No implementation found (areas inspected: §4/§7) | External links only (R25.1). | Phase L — Phase Three |
| P3.4 | Interactive whiteboard | 🔴 | No implementation found (areas inspected: §4/§7) | — | Phase L — Phase Three |
| P3.5 | Homework/document sharing | ✅ | `src/models/Attachment.js` | File sharing only, by design: no submission or grading. | — |
| P3.6 | AI tutor recommendations | 🔴 | `src/` | Rules-based matcher only. | Phase L — Phase Three |
| P3.7 | AI search | 🔴 | `tutor-query.js:27` | — | Phase L — Phase Three |
| P3.8 | AI lesson summaries | 🔴 | `progress.service.js:207-218` | — | Phase L — Phase Three |
| P3.9 | Student learning analytics | ✅ | `analytics.service.js:938` | Scoped to owner, admin or a tutor with a completed booking. | — |
| P3.10 | Tutor subscriptions | 🔴 | No implementation found (areas inspected: §4/§7) | Marketing copy says "no subscription" (`become-a-tutor/page.js:53,78`). | Phase L — Phase Three |
| P3.11 | Group courses | 🔴 | `GroupSession.js:73-75` | No multi-session course entity. | Phase L — Phase Three |
| P3.12 | Exam-preparation marketplace | 🔴 | No implementation found (areas inspected: §4/§7) | Pricing label only. | Phase L — Phase Three |
| P3.13 | Other Canadian provinces | 🟡 | `curriculum.js:10-17` | No curriculum data outside Ontario; PE, NL and the territories not seeded; geocoding table Ontario-only; no provincial sales-tax handling (`pricing.js:35`); Ontario… | Phase L — Phase Three |
| P3.14 | University tutoring | 🔴 | `Curriculum.js:33` | — | Phase L — Phase Three |

**Matrix totals:** 353 items — ✅ 196 · 🟡 113 · 🟠 15 · 🔴 28 · ⚪ 1.

---

## 18. Final Conclusion

APlus Learn at commit `1cb362b` has a real implementation of most of the original brief. It has a persisted, server-enforced backend behind each MVP area, and it reaches into Phase Two.

**Counts.** Of 353 audited requirement items:

- 196 (55.5 %) fully implemented;
- 113 (32.0 %) partially implemented;
- 15 (4.2 %) broken or defective;
- 28 (7.9 %) not implemented;
- 1 unverified.

Formula: count ÷ 353. The denominator includes all Phase Two and Phase Three items. On the base requirements alone (§1–§33, 328 items), 187 (57.0 %) are fully implemented.

**MVP.** The application is not MVP-ready. Of 22 MVP items, 3 are fully implemented, 14 are partial and 5 are defective: location filtering, tutor payouts, cancellations/refunds, secure verification document uploads, and dispute management. None is missing outright.

**Journeys.**

- Parent journey (18 steps): 7 fully implemented; step 6 (location) is defective.
- Tutor journey (16 steps): 10 fully implemented; step 8 (document upload) is defective.

**What stands between this codebase and an initial launch:**

1. **Defects affecting money and safety.** Each was verified in the source:
   - stored XSS on tutor profiles;
   - payout double-pay;
   - the no-show self-refund;
   - dispute outcomes that leave a full payout.
2. **Search accuracy (§40 priority 1).** Geocoding fallback, course-code detection, missing date filters and stale "next available".
3. **Explicitly listed items that do not exist.** Anti-circumvention in messaging; four child-profile fields; four availability filters; two SEO landing-page shapes; Community Standards and Tutor Agreement pages; search-based analytics.
4. **Production providers.** None is production-configured. Stripe cannot take a charge on the configured account. Email, meeting links, geocoding, storage and social sign-in run on development implementations, and three of those are permitted to do so in production.
5. **Legal review.** The Canadian privacy and legal review required by §30, which has no evidence of having happened. The published policies currently make claims the code does not honour.

**Automated tests.** The repository has extensive custom API and integration suites (about 2,900 checks). Their latest recorded results are from 20 September 2026, before the current suite versions; there is no current pass/fail data. Several defects in this report sit exactly where those suites rely on seeded or pre-advanced state. Browser coverage of dashboards, booking, onboarding and admin screens does not exist.

**Recommended next phase:** Phase A (§16). It fixes the security, money-integrity, minor-privacy and onboarding-upload blockers. Phase B then takes on search and matching, the first item of the original Development Priority.
