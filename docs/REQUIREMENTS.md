# APlus Learn — Requirement Coverage Matrix

Every numbered section of `docs/Project.md`, mapped to what implements it.

**Status key**
- **Implemented** — built, wired end to end, and exercised by `npm run qa`
- **Partial** — working, with a named limitation
- **Mocked provider** — fully functional behind a development implementation; the real provider is a constructor swap (§38)
- **Phase 2/3** — deliberately deferred, with the architecture in place

Verified on a clean database: `npm run seed` → `npm run build` → `npm run qa` (70/70 passing), `npx eslint src scripts` (clean).

---

## 1. Product overview & vision

| Requirement | Implementation | Status |
|---|---|---|
| Canada-focused tutoring marketplace | Whole application; Ontario curriculum seeded end to end | Implemented |
| Search → Compare → Match → Message → Book → Pay → Attend → Review → Rebook | Full journey covered by `scripts/qa.mjs` | Implemented |
| Modern / trustworthy / premium feel | `src/app/globals.css` design tokens, `src/components/ui/*`, motion via `Reveal` | Implemented |

## 2–4. Greenfield architecture

| Requirement | Implementation | Status |
|---|---|---|
| One Next.js app, no separate backend | `src/app/api/**` — 100 route handlers | Implemented |
| UI → Service → Database layering | `src/components` → `src/services/*.service.js` → `src/models` | Implemented |
| JavaScript only, no TypeScript | 355 `.js`/`.jsx` files, zero `.ts`/`.tsx` | Implemented |
| Tailwind CSS | Tailwind v4 via `@tailwindcss/postcss`, tokens in `globals.css` | Implemented |
| MongoDB | Mongoose 9, `src/lib/db/connect.js` (cached connection) | Implemented |

## 5–6. Project structure & API-first design

| Requirement | Implementation | Status |
|---|---|---|
| Clean folder structure | `app/`, `components/`, `lib/`, `services/`, `models/`, `hooks/`, `constants/` | Implemented |
| Consistent request pipeline | `src/lib/api/handler.js` — auth → role → permission → validation → service | Implemented |
| Consistent response envelope | `src/lib/api/response.js` — `{ ok, data, meta }` / `{ ok, error }` | Implemented |
| Correct HTTP status codes | `src/lib/api/errors.js` typed error classes | Implemented |
| No business logic in route handlers | Every route delegates to a service | Implemented |

## 7. MongoDB architecture

| Requirement | Implementation | Status |
|---|---|---|
| Centralised, reused connection | `connectToDatabase()` memoised on `globalThis` | Implemented |
| Domain models | 14 model files covering all 25 entities in the spec | Implemented |
| Indexes on high-value fields | Compound indexes per model; 2dsphere for geo; text for course search | Implemented |
| Considered normalisation | Denormalised `courseCodes`/`subjectSlugs` on `TutorProfile` for single-query search | Implemented |

## 8. Data ownership & security

| Requirement | Implementation | Status |
|---|---|---|
| Ownership verified server-side | `requireOwnership`, `requireParticipant` in `src/lib/auth/guards.js` | Implemented |
| Client-supplied identity never trusted | Actor comes from the session cookie only; QA asserts injected `price`/`status` are ignored | Implemented |
| Parent scoped to own data | `listStudents`, `listBookings` etc. filter by `ownerId`/`purchaserId` | Implemented |
| Tutor scoped to own data | Tutor services filter by `userId`/`tutorUserId` | Implemented |

## 9. Authentication

| Requirement | Implementation | Status |
|---|---|---|
| Email/password | `src/services/auth.service.js`, bcrypt cost 12 | Implemented |
| Email verification | `AuthToken` + `/verify-email`; SHA-256 hashed, single-use, 24h | Implemented |
| Forgot / reset password | `/forgot-password`, `/reset-password`; 1h expiry, bumps `tokenVersion` | Implemented |
| Google / Apple sign-in | `services/external/oauth-provider.js` behind a verified-identity interface | Mocked provider |
| Secure sessions | JWT (jose) in an httpOnly, SameSite=Lax cookie; `tokenVersion` enables revocation | Implemented |
| Logout | `/api/auth/logout` clears the cookie and audits | Implemented |

## 10. RBAC

| Requirement | Implementation | Status |
|---|---|---|
| Parent / Student / Tutor / Administrator | `src/constants/roles.js` | Implemented |
| Centralised authorization | `ROLE_PERMISSIONS` map + `requireRole` / `requirePermission` | Implemented |
| Server-enforced, not just UI guards | QA asserts 401 anonymous / 403 wrong-role on admin and tutor APIs | Implemented |
| Extensible for new roles | Adding a role means adding one array entry | Implemented |

## 12. Homepage

| Requirement | Implementation | Status |
|---|---|---|
| Hero search: province, grade, subject, course, code, mode, location | `src/components/search/HeroSearch.jsx` | Implemented |
| Search without an account | `/find-a-tutor` is public; QA asserts anonymous search works | Implemented |
| All 12 required sections | `src/components/home/Sections.jsx` + `Hero`, `FeaturedTutors` | Implemented |
| Primary CTAs | "Find a tutor" / "Become a tutor" in hero, header and footer | Implemented |

## 13. Canadian curriculum

| Requirement | Implementation | Status |
|---|---|---|
| Province → Grade → Subject → Course → Code | `src/models/Curriculum.js` (4 collections) | Implemented |
| Search by name *and* code | `suggest()` and `listCourses()` match both; QA asserts both | Implemented |
| Additional provinces supported | 8 provinces seeded; admin can open any of them | Implemented |

## 14. Tutor marketplace & search

| Requirement | Implementation | Status |
|---|---|---|
| All 13 search dimensions | `src/lib/search/tutor-query.js` + `tutorSearchSchema` | Implemented |
| All 6 filter groups | `src/components/search/SearchFilters.jsx` | Implemented |
| Result card fields | `src/components/tutor/TutorCard.jsx` — all 11 spec fields | Implemented |
| Card actions | View / availability / message / book / save | Implemented |
| Filters shareable via URL | Filters write to the query string, not local state | Implemented |

## 15. Tutor profile

| Requirement | Implementation | Status |
|---|---|---|
| Trust → Expertise → Social proof → Availability → Booking | `src/app/(public)/tutors/[slug]/page.js` section order | Implemented |
| All required profile fields | `TutorProfileHeader` + `TutorProfileBody` | Implemented |
| Book / Message / Save | `BookingWidget`, `MessageTutorPanel`, `FavouriteButton` | Implemented |
| Never expose exact addresses | `toPublicTutor()` returns city only; QA asserts no coordinates or surnames | Implemented |

## 16. Tutor verification

| Requirement | Implementation | Status |
|---|---|---|
| 5 badge types | `VERIFICATION_TYPES` | Implemented |
| Admin review / approve / reject / request info | `/admin/applications/[id]`, `/admin/verification` | Implemented |
| Assign & remove badges | `mutateBadge()`, `/api/admin/tutors/[id]/badges` | Implemented |
| Not searchable before approval | `isSearchable` derived, never client-set; verified by approving the seeded pending tutor | Implemented |
| Documents kept private | Stored outside `public/`, `select:false` key, admin-only audited route | Implemented |

## 17. Tutor onboarding

| Requirement | Implementation | Status |
|---|---|---|
| All 11 steps | `src/components/tutor/onboarding/steps/*` | Implemented |
| Progress indicator | `Stepper` | Implemented |
| Save progress | Each step persists independently to `TutorApplication` | Implemented |
| Per-step validation | `onboardingStepSchemas` — server-side, per step | Implemented |
| Review summary & submission confirmation | `ReviewStep` + `/tutor/verification?submitted=1` | Implemented |

## 18. Availability

| Requirement | Implementation | Status |
|---|---|---|
| Recurring weekly availability | `Availability.weeklyRules`, minutes-from-midnight in the tutor's zone | Implemented |
| Date blocking / vacation | `Availability.exceptions` with `BLOCKED` / `VACATION` kinds | Implemented |
| Future editing | `/tutor/calendar`; refuses edits that would strand a confirmed lesson | Implemented |
| Double-booking prevention | `isSlotBookable()` re-checked at write time; QA asserts the conflict | Implemented |
| Ready for Google/Outlook | `Availability.externalCalendars` + `calendar-provider.js` interface | Phase 2 |

## 19. Booking

| Requirement | Implementation | Status |
|---|---|---|
| Full booking flow | `src/components/booking/BookingWidget.jsx` | Implemented |
| One-time and recurring | `RECURRENCE` weekly/biweekly; whole series reserved and paid together | Implemented |
| All display fields | `BookingDetail` | Implemented |
| Cancellation policy shown before paying | `cancellationPolicyText()` in the price summary | Implemented |

## 20. Payments & payouts

| Requirement | Implementation | Status |
|---|---|---|
| Stripe Connect-shaped abstraction | `services/external/payment-provider.js` | Mocked provider |
| Student payment, commission, tutor amount | `lib/booking/pricing.js`; QA asserts commission + earnings = subtotal exactly | Implemented |
| Refunds | `refundPayment()`, capped at the remaining balance | Implemented |
| Payout onboarding / earnings / status / receipts | `/tutor/payouts`, `/tutor/earnings`, `/payments/[id]` | Implemented |
| Commission configurable by admin | `/admin/settings` → `Settings.commissionPercent` | Implemented |
| Calculations centralised server-side | Client never sends a price; QA asserts injected prices are ignored | Implemented |

## 21. Messaging

| Requirement | Implementation | Status |
|---|---|---|
| Parent/Student ↔ Tutor | `Conversation` (unique pair) + `Message` | Implemented |
| Timestamps, booking context, unread state | `ConversationView`, per-user `unreadCounts` | Implemented |
| Notifications | `notify()` on every message | Implemented |
| Report & block | `/api/messages/conversations/[id]/actions` | Implemented |
| Ready for attachments & realtime | `Message.attachments` schema present, unused in MVP | Phase 2 |

## 22. Tutor requests & matching

| Requirement | Implementation | Status |
|---|---|---|
| Request with all 8 fields | `createTutorRequestSchema` | Implemented |
| Tutors express interest | `/api/requests/[id]/interest` | Implemented |
| Compare interested tutors | `src/components/dashboard/MatchComparison.jsx` | Implemented |
| MVP matching: course, location, budget, availability | `src/lib/matching/score.js` with weighted factors | Implemented |
| Matching isolated in a service | `lib/matching/score.js` + `request.service.js` | Implemented |
| Future factors | `MATCH_WEIGHTS` is the single extension point | Phase 2 |

## 23. Reviews

| Requirement | Implementation | Status |
|---|---|---|
| 1–5 stars + 4 sub-scores | `Review` model, `ReviewModal` | Implemented |
| Only completed bookings | `canReview()`; QA asserts an incomplete lesson is rejected | Implemented |
| Admin moderation & reporting | `/admin/reviews`, `reportReview()`, `moderateReview()` | Implemented |

## 24. Dashboards

| Requirement | Implementation | Status |
|---|---|---|
| Parent/student — all 11 areas | 12 pages under `src/app/(dashboard)` | Implemented |
| Tutor — all 13 areas | 14 pages under `src/app/tutor` | Implemented |
| Admin — all 12 areas | 13 pages under `src/app/admin` | Implemented |

## 25. Admin analytics

| Requirement | Implementation | Status |
|---|---|---|
| All 12 required metrics | `services/analytics.service.js`, `/admin/analytics` | Implemented |
| Decision-oriented, not decorative | Action queues first; supply gaps by city; period-over-period trends | Implemented |

## 26. Cancellation / refund / no-show

| Requirement | Implementation | Status |
|---|---|---|
| Student / tutor cancellation | `cancelBooking()` resolves the actor's policy | Implemented |
| Configurable window | `Settings.freeCancellationWindowHours` | Implemented |
| Full / partial refund | `resolveCancellation()`; QA asserts the refund matches the policy for the actual notice given | Implemented |
| No-show handling | `reportNoShow()`, `resolveNoShow()` | Implemented |
| Dispute & admin review | `/admin/disputes/[id]` with refund adjudication | Implemented |
| Abuse tracking, warnings, suspension | `assessCancellationAbuse()` + admin suspend | Implemented |
| Rules centralised | All paths resolve through `src/lib/booking/policy.js` | Implemented |

## 27. Online / in-person

| Requirement | Implementation | Status |
|---|---|---|
| Zoom / Google Meet / Teams | `services/external/meeting-provider.js` | Mocked provider |
| Meeting info on the booking | `Booking.meeting` | Implemented |
| 5 in-person location types | `IN_PERSON_LOCATIONS` | Implemented |
| Addresses protected | `addressLine` is `select:false`, released only to parties on a confirmed booking | Implemented |

## 28. Notifications

| Requirement | Implementation | Status |
|---|---|---|
| All 10 notification types | `NOTIFICATION_TYPES` | Implemented |
| Unread count, centre, read/unread | `/notifications`, `unreadNotificationCount()` | Implemented |
| Preferences | Per-channel toggles in Settings | Implemented |
| Email / SMS / push ready | `NOTIFICATION_CHANNELS` + `deliveredChannels`; email wired, SMS/push declared | Partial — email via mocked provider; SMS/push are Phase 2 |

## 29. SEO

| Requirement | Implementation | Status |
|---|---|---|
| `/ontario/grade-12/math/mhf4u` | `src/app/(public)/[province]/[grade]/[subject]/[course]/page.js` | Implemented |
| `/tutors/mhf4u/scarborough` | `src/app/(public)/tutors/[slug]/[city]/page.js` | Implemented |
| Shareable tutor URLs | `/tutors/[slug]`, stable slug per profile | Implemented |
| Metadata, titles, descriptions, canonicals | `generateMetadata` on every public route | Implemented |
| Semantic markup | JSON-LD for Person, Course and FAQPage | Implemented |
| Indexable public pages | `sitemap.js` (308 URLs) + `robots.js` excluding private areas | Implemented |

## 30. Design system

| Requirement | Implementation | Status |
|---|---|---|
| Reusable Tailwind design system | `globals.css` `@theme` tokens: colour, type, radii, elevation, motion | Implemented |
| All 15 required primitives | 18 files in `src/components/ui` | Implemented |
| Consistent styling across pages | Every page composes the same primitives | Implemented |

## 31. Premium animation

| Requirement | Implementation | Status |
|---|---|---|
| Subtle animation across 13 surfaces | `Reveal`/`RevealGroup`, `motion` transitions on modals, tabs, toasts, dropdowns | Implemented |
| Fast and purposeful, not childish | 150–250ms, `ease-out-quint`, no bounce or parallax | Implemented |
| `prefers-reduced-motion` | Global CSS override + `useReducedMotion()` in motion components | Implemented |

## 32. Loading / error / empty states

| Requirement | Implementation | Status |
|---|---|---|
| Loading, skeleton, empty, error, success, retry | `src/components/ui/States.jsx` | Implemented |
| All 8 named empty states | Every list renders a purpose-written `EmptyState` | Implemented |
| Never a blank screen | `loading.js`, `error.js`, `not-found.js` at the app root | Implemented |
| Empty states suggest a next action | Search empty state proposes which filter to relax | Implemented |

## 33–34. Responsive & accessible

| Requirement | Implementation | Status |
|---|---|---|
| Mobile / tablet / desktop | Mobile-first throughout; filters and nav become sheets, not shrunken desktop | Implemented |
| No horizontal overflow | `overflow-x: hidden` on body; tables scroll in their own container | Implemented |
| Semantic HTML, labels, focus, contrast | `Field` wires label/description/error via ids; `:focus-visible` ring | Implemented |
| Accessible dialogs, dropdowns, tabs, calendar | Focus trap + restore, Escape, arrow-key tabs, radiogroup slots | Implemented |

## 35–37. Security & validation

| Requirement | Implementation | Status |
|---|---|---|
| Secure password hashing | bcrypt cost 12, `select:false` | Implemented |
| RBAC & API authorization | Enforced per route by the handler pipeline | Implemented |
| Secure verification documents | Private storage, audited admin-only access | Implemented |
| Payment information protected | Card data goes straight to the provider; only brand + last4 stored | Implemented |
| Minor privacy controls | `isMinor` + `shareFullNameWithTutor`; QA asserts masking | Implemented |
| Audit logging | `AuditLog` on every admin and security action | Implemented |
| Data retention / deletion | Account deletion anonymises and retains financial records | Implemented |
| Server-side validation everywhere | Zod schemas on body, query and params for every route | Implemented |
| Security headers | `next.config.mjs` — nosniff, frame options, referrer, permissions policy | Implemented |
| Rate limiting | `lib/security/rate-limit.js` on auth endpoints | Implemented |
| NoSQL injection guards | `stripOperators`, `escapeRegex` | Implemented |

## 38. External service strategy

| Requirement | Implementation | Status |
|---|---|---|
| Payment abstraction | `PaymentProvider` / `MockPaymentProvider` | Mocked provider |
| Email abstraction | `EmailProvider` / `ConsoleEmailProvider` | Mocked provider |
| Auth providers | `OAuthProvider` / `DevOAuthProvider` | Mocked provider |
| Geocoding | `lib/geo` with a bundled Canadian FSA/city table | Mocked provider |
| Calendar | `CalendarProvider` interface declared | Phase 2 |
| Video meetings | `MeetingProvider` / mock room links | Mocked provider |
| UI unchanged when the real provider lands | All access goes through `get*Provider()` | Implemented |

## 39–40. No fake buttons; realistic data

| Requirement | Implementation | Status |
|---|---|---|
| Every MVP interaction actually works | 70/70 QA checks exercise real APIs; no "coming soon" on MVP paths | Implemented |
| Realistic Ontario seed data | 12 tutors with genuine biographies, 38 real course codes, 54 bookings, 18 written reviews | Implemented |

## 41. Phase 2 / Phase 3 readiness

| Item | Architectural hook | Status |
|---|---|---|
| Calendar sync | `Availability.externalCalendars`, `CalendarProvider` | Phase 2 |
| SMS / push | `NOTIFICATION_CHANNELS`, `deliveredChannels` | Phase 2 |
| Message attachments | `Message.attachments` schema | Phase 2 |
| Advanced matching | `MATCH_WEIGHTS` extension point | Phase 2 |
| Additional provinces | Province/Grade/Course collections + admin curriculum manager | Ready now |
| Native apps | API-first design; every screen is backed by a JSON endpoint | Phase 3 |

## 42. Core business rules

| Rule | Enforcement | QA |
|---|---|---|
| Unapproved tutors cannot appear in search | `isSearchable` gate on every query | ✓ |
| Users cannot access another user's data | Ownership guards | ✓ |
| Exact addresses never public | `select:false` + `toPublicTutor` | ✓ |
| Only completed bookings create reviews | `canReview()` | ✓ |
| Availability cannot double-book | `isSlotBookable()` at write time | ✓ |
| Totals calculated server-side | `lib/booking/pricing.js` | ✓ |
| Commission calculated server-side | Same | ✓ |
| Payout eligibility follows booking/payment state | `payableBookings()` | ✓ |
| Cancellation follows centralised rules | `lib/booking/policy.js` | ✓ |
| Verification controlled server-side | Admin-only routes | ✓ |
| Admin permissions enforced server-side | `requirePermission` | ✓ |

## 43–44. Performance & code quality

| Requirement | Implementation | Status |
|---|---|---|
| Server Components by default | Client components only where interaction requires | Implemented |
| Caching where appropriate | `revalidate` on marketing pages; memoised settings and curriculum | Implemented |
| Pagination | Every list endpoint | Implemented |
| Database indexes | Per model, audited for parallel-array conflicts | Implemented |
| Small focused functions, clear boundaries | Services own logic; routes stay thin | Implemented |
| Centralised constants and rules | `src/constants`, `src/lib/booking` | Implemented |

## 45–47. Coverage, QA and quality gates

| Gate | Command | Result |
|---|---|---|
| Lint | `npx eslint src scripts` | Clean |
| Build | `npm run build` | Passes, no warnings |
| Database connectivity | `databaseStatus()` on the admin dashboard | Healthy |
| Route checks | 22 public + 39 authenticated pages | All 200 |
| Authorization checks | Anonymous 401, wrong-role 403, cross-account 403 | Enforced |
| Journey checks | `npm run qa` | 70/70 |

---

## Known limitations

1. **External providers are development implementations.** Payments, email, OAuth, geocoding and meeting links run through working mocks. Each sits behind an interface (§38) so connecting the real service is a constructor change, but no real money moves and no real email is sent until credentials are supplied.
2. **Geocoding covers 20 Ontario cities and ~30 forward sortation areas.** Outside that table, distance search falls back to the province's largest city. A real geocoder removes the limit.
3. **Rate limiting is in-process.** Adequate for a single instance; a multi-instance deployment should move the store to Redis. The call signature is designed not to change.
4. **Payouts are created manually by an administrator.** The logic is complete and idempotent; production would call `createPayout()` from a scheduled job.
5. **Only Ontario has curriculum data.** Seven other provinces exist and can be opened from the admin curriculum manager; they need course data before they are useful.
