# APlus Learn — Requirement Coverage Matrix

Every numbered section of `docs/Project.md`, mapped to what implements it.

**Status key**
- **Implemented** — built, wired end to end, and exercised by `npm run qa`
- **Awaiting credentials** — the production integration is built and covered by
  `npm run test:integrations`, but no account credentials exist in this
  environment, so it has not been run against the live service (§38)
- **Partial** — working, with a named limitation
- **Phase 2/3** — deliberately deferred, with the architecture in place

Verified on a seeded database: `bun run lint` (clean) → `bun run build`
(clean) → `bun run test:integrations` (1222 passed, 0 failed, 1 skipped) →
`bun run qa` (813 passed, 0 failed).

`qa`'s assertion count varies by one or two between runs: several sections
assert conditionally on the fixtures still in the database, and the suite
consumes one seeded `COMPLETED` lesson per run for the no-show happy path. Zero
failures is the signal, not the total. Run `bun run seed` when the pool runs
down — the suite says so when it does.

`qa` was run against a server using the local storage fallback
(`STORAGE_PROVIDER=development`), which is what let the profile-photo section
exercise upload, retrieval and replacement end to end on this machine.

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
| One Next.js app, no separate backend | `src/app/api/**` — 158 route handlers | Implemented |
| UI → Service → Database layering | `src/components` → `src/services/*.service.js` → `src/models` | Implemented |
| JavaScript only, no TypeScript | 562 `.js`/`.jsx` files, zero `.ts`/`.tsx` | Implemented |
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
| Domain models | 16 model files covering all 25 entities in the spec | Implemented |
| Indexes on high-value fields | Compound indexes per model; 2dsphere for geo; text for course search | Implemented |
| Considered normalisation | Denormalised `courseCodes`/`subjectSlugs` on `TutorProfile` for single-query search | Implemented |

## 8. Data ownership & security

| Requirement | Implementation | Status |
|---|---|---|
| Ownership verified server-side | `requireOwnership`, `requireParticipant`, `requireVerifiedEmail` in `src/lib/auth/assert.js` — pure, record-level, no session or database, so a service can depend on them without pulling the request runtime in behind it. `guards.js` re-exports them alongside the session-resolving `require*`/`enforce*` families | Implemented |
| Booking writes assert participation | `requireBookingRole()` in `booking.service.js` fronts cancel, reschedule and no-show; `actorRoleFor()` returns `null` for a non-participant rather than defaulting them to "STUDENT". QA asserts an unrelated learner, parent and tutor are each refused on both endpoints, and that a refused call changes nothing | Implemented |
| Client-supplied identity never trusted | Actor comes from the session cookie only; QA asserts injected `price`/`status` are ignored | Implemented |
| Parent scoped to own data | `listStudents`, `listBookings` etc. filter by `ownerId`/`purchaserId` | Implemented |
| Tutor scoped to own data | Tutor services filter by `userId`/`tutorUserId` | Implemented |
| Own profile: view and edit | `GET`/`PATCH /api/users/me` → `getUser`/`updateProfile`; `SettingsPanels` is mounted by all three role shells (`/settings`, `/tutor/settings`, `/admin/account`) and leads with a read-only summary of name, email, phone, location, role and confirmation state | Implemented |
| Profile edits cannot escalate | `updateProfileSchema` names only the editable fields, so `role`, `status`, `email`, `emailVerifiedAt`, `phoneVerifiedAt`, `tokenVersion`, `creditBalanceCents` and `avatarUrl` are not heard at all. The account acted on is the session's, never an id in the request. QA posts every one of those in a single update and asserts each is ignored | Implemented |
| Profile photo | `uploadAvatar`/`removeAvatar`/`readAvatar` in `user.service.js`; `POST`/`DELETE /api/users/me/avatar`, served from `GET /api/avatars/[key]`. `User.avatar` holds the storage reference, `User.avatarUrl` stays the pointer every existing read path already uses | Implemented |
| Whose photo is public | Derived from the account, not the request: a tutor's photo is public because it is on search results anonymous visitors load; everybody else's needs a session. The key is an unguessable UUID either way, and the serve route resolves it back to the account holding it — so a replaced key, a stray file and a verification document's key are all 404 | Implemented |

## 9. Authentication

| Requirement | Implementation | Status |
|---|---|---|
| Email/password | `src/services/auth.service.js`, bcrypt cost 12 | Implemented |
| Email verification | `AuthToken` + `/verify-email`; SHA-256 hashed, single-use, 24h | Implemented |
| Email verification is enforced | `requireVerifiedEmail()` — declared as `verifiedEmail: true` in the route pipeline and re-asserted in `createBooking`, `capturePayment`, `sendMessage`, `createReview` and `createTutorRequest`, so a second route onto the same action is not a way round it. Signing in is deliberately not gated; `VerifyEmailBanner` tells the person what is blocked and resends the link | Implemented |
| Forgot / reset password | Emailed six-digit code on `/forgot-password` (email → code → new password → sign in), one service: `password-reset.service.js`. The code is `randomInt`, stored only as an HMAC bound to account + request, 10 min; a correct code is exchanged for a single-use 10-min reset authorisation, so the browser never asserts it verified. Reset bumps `tokenVersion`, voids every outstanding code, audits `USER_PASSWORD_RESET`. `/reset-password` redirects to the one flow. See [PASSWORD_RESET.md](PASSWORD_RESET.md) | Implemented |
| Reset-code abuse limits | 5 guesses per code (burned after), a new code voids the last, 60 s resend cooldown and 5 codes/hour per address, 5 requests and 20 verifications per 15 min per client — all in the shared rate-limit store | Implemented |
| Reset cannot enumerate accounts | The request handle, cooldown, hourly cap, lockout and expiry are issued and enforced identically for an unknown address; the account lookup and send run in `after()`; delivery errors are logged, never returned | Implemented |
| Reset without a mail server | `ConsoleEmailProvider` also keeps a development mailbox (`/dev/mail`, `GET /api/dev/mail`) holding the real code. Closed — 404, nothing recorded — unless `NODE_ENV` and `APP_ENV` are both non-production *and* mail is going to the console. Configuring Resend or SMTP needs no code change | Implemented |
| Google / Apple sign-in | `OpenIdOAuthProvider` — ID token verified against the provider's JWKS (issuer, audience, expiry) with a single-use nonce from `/api/auth/oauth/nonce` | Awaiting credentials |
| OAuth account safety | Email linking requires a provider-verified address; one identity maps to one account; role and protected fields are never changed by a sign-in | Implemented |
| Password-change security notice | `passwordChanged` template, sent after reset and change; carries no token | Implemented |
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
| All 12 required sections | `src/components/home/Sections.jsx` + `Hero`, `FeaturedTutors`; centred section headers with the shared wave ornament (`Section`), illustrated steps via `StepCards` and the shared `StepArt` scene kit, which also draws the online / in-person pair; verification is one divided ledger panel and grades one K-12 ladder rather than ragged card grids; popular course cards are tinted by the code's discipline letter and link by `courseCode`, falling back to `course` + `grade` slugs for the codeless elementary courses; testimonials run as a self-scrolling rail (`TestimonialRail`) that pauses on hover, focus and an explicit button | Implemented |
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
| Card actions | View profile / save. Message and book now live on the profile rather than the card — the redesigned card leads with one CTA | Changed |
| Card photo gallery | `TutorProfile.gallery` → `TutorGallery.jsx`; tutor-managed in `ProfileEditor` | Implemented |
| Weekly availability on the card | `attachAvailableWeekdays()` reads `Availability.weeklyRules` | Implemented |
| Filters shareable via URL | Filters write to the query string, not local state | Implemented |

## 15. Tutor profile

| Requirement | Implementation | Status |
|---|---|---|
| Trust → Expertise → Social proof → Availability → Booking | `src/app/(public)/tutors/[slug]/page.js` section order | Implemented |
| All required profile fields | `TutorProfileHeader` + `TutorProfileBody` | Implemented |
| Teaching photos | `GallerySection` reuses the search card's `TutorGallery` | Implemented |
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
| A storage outage is legible, not a crash | `failFromError` maps `STORAGE_PROVIDER_ERROR` to a 502 `STORAGE_UNAVAILABLE` with a plain message. The store's own wording names the bucket, the credentials or the endpoint, so it is logged for the operator and never sent to the browser, and the upstream status is not reused — a 403 from the bucket is not the caller's 403. Nothing is written before the object lands, so a refused upload leaves the existing photo in place | Implemented |
| A photo that cannot be drawn falls back | `renderableImageSrc()` is the single rule, and it reads the same host list `next.config.mjs` builds `remotePatterns` from. `next/image` throws `Invalid src prop` on an unconfigured host rather than showing a broken image, which took the surrounding page down; `Avatar` and `TutorGallery` now treat anything unrenderable as no photo and draw the initials or the monogram they already had. Both fields feeding it — `User.avatarUrl` and `TutorProfile.gallery` — are free text on records users control | Implemented |
| Uploaded images checked on their bytes | `lib/images/inspect.js` decides the format from the container's magic number and the extension from the format; SVG is refused outright. The same inspection covers branding assets and profile photos, so there is one place the rule lives. Profile photos write to their own `avatars` storage scope, so an avatar key can never address a document | Implemented |
| Badge expiry | `expireStaleVerifications()`, run by the `verification-expiry` scheduled job (§48). Expiring a badge takes it off the public profile and tells the tutor to re-verify | Implemented |
| Search eligibility re-derived on every write | `deriveSearchable()` — the single rule (approved **and** complete), applied by `reviewApplication()`, `setTutorSearchable()` and `updateTutorProfile()`. QA asserts a profile edit never grants search visibility to an unapproved tutor | Implemented |

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
| Double-booking prevention | Two layers. `isSlotBookable()` is re-checked at write time and produces the *useful* refusal ("outside the tutor's hours"). Behind it, `BookingSlotLock` gives each tutor-and-start-instant a unique `_id`, so of any number of simultaneous requests for one slot exactly one insert succeeds — decided by the database rather than by two reads racing, which is what makes it hold across several instances. The claim is self-healing: it names the booking holding the slot, and one whose booking has been cancelled, expired or withdrawn is inherited rather than wedging the calendar. Overlaps between lessons of *different* lengths share no start instant, so those are still settled by the write-then-read tie-break in `settleSlotRace` | Implemented |
| Ready for Google/Outlook | `Availability.externalCalendars` + `calendar-provider.js` interface | Phase 2 |

## 19. Booking

| Requirement | Implementation | Status |
|---|---|---|
| Full booking flow | `src/components/booking/BookingWidget.jsx` | Implemented |
| One-time and recurring | `RECURRENCE` weekly/biweekly; whole series reserved and paid together | Implemented |
| All display fields | `BookingDetail` | Implemented |
| Cancellation policy shown before paying | `cancellationPolicyText()` in the price summary | Implemented |
| An unpaid booking holds its slot | `PENDING_PAYMENT` ∈ `BLOCKING_BOOKING_STATUSES`; public availability drops the slot immediately | Implemented |
| An abandoned checkout releases it again | `BOOKING_STATUS.EXPIRED` (outside `BLOCKING_BOOKING_STATUSES`) + the `booking-expiry` job calling `expireStaleBookings()`; each release claims the booking's `PENDING_PAYMENT` status, so overlapping runs release it exactly once | Implemented |
| The hold window lives in one place | `CHECKOUT_HOLD` (default) → `Settings.checkoutHoldMinutes` (admin-configurable) → read by the sweep, the policy module and the hosted checkout session alike | Implemented |
| Whether a hold may be released is one rule | `shouldReleaseHold()` / `failureReleasesHold()` in `lib/booking/policy.js`; a settled payment is never released, whatever its age | Implemented |
| Payment failure releases the slot immediately where appropriate | `checkout.session.expired` always; `payment_intent.payment_failed` only when no live checkout session remains, so a declined card can still be retried | Implemented |
| A crash before the payment existed does not block forever | A booking with no `paymentId` is swept on the same rule | Implemented |
| A payment settling after its hold lapsed | `confirmBookings()` revives an `EXPIRED` booking when the slot is still free, and audits it as needing a refund when it is not | Implemented |

## 20. Payments & payouts

| Requirement | Implementation | Status |
|---|---|---|
| Stripe Connect | `StripePaymentProvider` — hosted Checkout for the charge, Connect Express with separate charges and transfers for payouts | Awaiting credentials |
| Card never touches this application | Hosted Checkout; `capturePayment()` is refused outright under Stripe, so the deployment stays outside PCI scope | Implemented |
| Booking confirmed only by a verified webhook or the provider's own API | `/api/webhooks/payments` → `webhook.service.js` is the normal path; `POST /api/payments/[id]/reconcile` is the other one, and it reads Stripe rather than the browser. The return page confirms nothing — it supplies an id and gets the server's answer | Implemented |
| The return from checkout does not depend on the webhook arriving | `CheckoutPending` calls `reconcile` immediately and then on a widening backoff for about two minutes. A webhook that is late, lost, rejected or never configured costs the purchaser a second instead of the whole hold window | Implemented |
| Delayed payment methods are a distinct state | A provider answer of `PROCESSING` is recorded as `PAYMENT_STATUS.PROCESSING`; the purchaser is told the money is clearing rather than being asked to pay again, and the slot stays held | Implemented |
| Webhook idempotency | Unique `(provider, eventId)` index on `WebhookEvent`; a replay of a *processed* event is acknowledged and dropped | Implemented |
| Webhook retryability | A delivery that failed, or whose process died holding the claim, is reprocessed when the provider redelivers — idempotency must not swallow the recovery mechanism. Safe because every handler asserts state rather than transitions it | Implemented |
| A lost webhook cannot destroy a paid lesson | Before releasing any hold, `expireStaleBookings()` asks the provider's API directly; paid ⇒ settled and confirmed, unpaid ⇒ released, unanswerable ⇒ **hold kept** and retried | Implemented |
| One implementation of "ask the provider and apply it" | `settlePaymentFromProvider()` in `booking.service.js`. The expiry sweep and the purchaser's return page are the same code with a different `source` on the audit entry | Implemented |
| Two authorities settling at once confirm once | `markPaymentPaid()` claims the row with a conditional update, so of a simultaneous webhook and reconciliation exactly one reaches `confirmBookings()` — one meeting room, one confirmation email | Implemented |
| A settled payment is never walked back | `markPaymentPaid()` treats `REFUNDED` and `PARTIALLY_REFUNDED` as settled alongside `PAID`, so a replayed success event cannot erase a refund | Implemented |
| Backing out of hosted checkout does not loop | `?cancelled=1` renders the hold and a "Continue to payment" button instead of redirecting straight back to the provider's page | Implemented |
| Webhook amount validation | An event whose amount disagrees with the priced total is refused | Implemented |
| Payment idempotency | Idempotency keys on checkout, refund and transfer creation | Implemented |
| Student payment, commission, tutor amount | `lib/booking/pricing.js`; QA asserts commission + earnings = subtotal exactly | Implemented |
| Refunds | `refundPayment()`, capped at the remaining balance | Implemented |
| Payout onboarding / earnings / status / receipts | `/tutor/payouts`, `/tutor/earnings`, `/payments/[id]`; hosted Connect onboarding, resumable, with provider-reported eligibility | Implemented |
| Payout eligibility is the provider's decision | `refreshPayoutAccount()` records what Stripe reports; it cannot declare an account complete | Implemented |
| A payout is never sent twice | `providerTransferId` short-circuits a repeated "mark as paid"; the transfer carries a stable idempotency key | Implemented |
| Commission configurable by admin | `/admin/settings` → Marketplace tab → `Settings.commissionPercent` (§26b) | Implemented |
| Calculations centralised server-side | Client never sends a price; QA asserts injected prices are ignored | Implemented |

## 21. Messaging

| Requirement | Implementation | Status |
|---|---|---|
| Parent/Student ↔ Tutor | `Conversation` (unique pair) + `Message` | Implemented |
| Timestamps, booking context, unread state | `ConversationView`, per-user `unreadCounts` | Implemented |
| Notifications | `notify()` on every message | Implemented |
| Block | `/api/messages/conversations/[id]/actions` | Implemented |
| Report | `/api/messages/conversations/[id]/actions` opens a case (`Conversation.reportStatus`) that reaches administrators | Implemented |
| Reports reach a moderator | `/admin/moderation` queue and `/admin/moderation/[id]`, behind `ADMIN_MESSAGE_MODERATE`: reporter, participants, reason, timestamp, booking context, status and history. Opening a thread writes a `CONVERSATION_REPORT_VIEWED` audit entry; a decision writes `CONVERSATION_MODERATED` | Implemented |
| Attachments | `Message.attachments` now populated: multipart `POST /api/messages/attachments`, authorised streaming at `GET /api/messages/attachments/[id]`, type decided from the bytes, storage key `select: false` (§41 Phase 3) | Implemented |
| Ready for realtime | Thread reads are paginated and stateless; nothing assumes a polling client | Phase 2 |

### Floating support launcher

Present on the public site, the dashboards, the tutor workspace and the auth
pages; absent from the admin console (an operator does not raise a ticket with
themselves) and from `/offline`, which has no network behind it.

| Requirement | Implementation | Status |
|---|---|---|
| Reach a human from any page | `components/support/` — a collapsed button that expands to WhatsApp and a support panel, bottom-right, clear of the iOS home indicator | Implemented |
| WhatsApp for everyone | `wa.me` deep link built from `contact.whatsappNumber`; offered to signed-in and signed-out visitors alike, and to neither when no number is configured | Implemented |
| Signed in → their own conversations | The panel leads with a link to `/messages` or `/tutor/messages`, chosen server-side from the session role; hidden when the `messaging` flag is off | Implemented |
| Signed out → a way to be answered | Name, email, topic and message, sent to the configured support inbox with the sender in `Reply-To`, plus a link back to sign-in | Implemented |
| Identity is never taken from the payload | `support.service.js` reads name and address from the session whenever one exists, and ignores whatever the body claims | Implemented |
| Not an open relay | Nothing is ever sent *to* the address in the form; only the support inbox is written to | Implemented |
| Abuse control | 4 enquiries per IP per 15 minutes (`enforceRateLimit`) plus a hidden honeypot field, which is answered with the same success the real path returns | Implemented |
| A lost message is reported | The email *is* the record here, so a delivery failure returns 503 naming the support address rather than thanking the sender for nothing | Implemented |
| Not persisted | Enquiries are relayed, not stored. There is no support inbox inside the admin console, and adding one would need a model, a queue and a moderator view | Not added, by design |

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
| Reporting cannot suppress a review | `Review.reportStatus` is the case; `Review.status` is the visibility. `reportReview()` opens the case and leaves the review published and counted, so the reviewed tutor cannot take an unfavourable review out of their own average. Only `moderateReview()` — administrators only — changes visibility | Implemented |

## 24. Dashboards

| Requirement | Implementation | Status |
|---|---|---|
| Parent/student — all 11 areas | 12 pages under `src/app/(dashboard)` | Implemented |
| Tutor — all 13 areas | 14 pages under `src/app/tutor` | Implemented |
| Admin — all 12 areas | 13 pages under `src/app/admin` | Implemented |
| Every role can manage its own account | `/settings`, `/tutor/settings` and `/admin/account` mount the same `SettingsPanels`. The admin page is new: the user menu previously pointed administrators at the learner route, whose layout enforces `LEARNER_ROLES` and bounced them back. Self-service deletion is hidden for administrators — another administrator removes an admin account from user management | Implemented |

## 25. Admin analytics

| Requirement | Implementation | Status |
|---|---|---|
| All 12 required metrics | `services/analytics.service.js`, `/admin/analytics` | Implemented |
| Decision-oriented, not decorative | Action queues first; supply gaps by city; period-over-period trends | Implemented |
| Money derived from settled payments | Aggregated from `Payment` on `paidAt`, never by summing booking prices — an abandoned checkout is not revenue. Refunds are subtracted pro rata per payment; referral credit is a platform cost, not a discount | Implemented |
| Reporting periods | `lib/analytics/range.js` — half-open windows, explicit `from`/`to` or a rolling `days`, time-zone aware bucketing that adapts day → week → month | Implemented |
| Phase 2 feature analytics | `phaseTwoAnalytics()` — request match rate, matching conversion, package utilisation, group fill rate, referral conversion, promotions | Implemented |
| Tutor's own analytics | `tutorAnalytics()` on `/tutor/earnings`; resolved from the session, with no owner parameter to tamper with | Implemented |
| Student analytics | `studentAnalytics()` on `/insights` (family) and `/tutor/students/[id]` (tutor). Aggregated in MongoDB from bookings, payments, progress reports and learning goals; three scopes resolved from the stored `StudentProfile.ownerId` and completed bookings (§41 Phase 3) | Implemented |

## 26. Cancellation / refund / no-show

| Requirement | Implementation | Status |
|---|---|---|
| Student / tutor cancellation | `cancelBooking()` resolves the actor's policy | Implemented |
| Configurable window | `Settings.freeCancellationWindowHours` | Implemented |
| Full / partial refund | `resolveCancellation()`; QA asserts the refund matches the policy for the actual notice given | Implemented |
| No-show handling | `reportNoShow()`, `resolveNoShow()` — authorized against the stored participants, and only ever against the opposite party. A lesson whose outcome is already settled is refused (`NOT_REPORTABLE`), so the same refund cannot be issued twice, and every report is audited | Implemented |
| Dispute & admin review | `/admin/disputes/[id]` with refund adjudication. **A decision is terminal**: `resolveDispute()` claims the dispute on its open statuses with a conditional update before any money moves, so a second decision — a double-submitted form, two administrators in the queue at once, a replayed request — finds nothing to claim and is refused with a conflict. If the refund itself is refused the claim is released, because a dispute that was never settled must stay decidable. What is still refundable accounts for earlier disputes on the same lesson as well as for any cancellation, so the dispute records can never describe more money than the payment ledger returned | Implemented |
| Abuse tracking, warnings, suspension | `assessCancellationAbuse()` decides; its "needs review" verdict now raises a risk signal so an administrator actually sees it (`risk.service.js`, `/admin/risk`). Suspension stays a deliberate admin act — no score restricts an account | Implemented |
| Rules centralised | All paths resolve through `src/lib/booking/policy.js` | Implemented |

## 26b. Platform settings & application configuration

One admin-editable document (`Settings`, key `PLATFORM`) holds everything an
operator can change without a deployment. Read through `getSettings()` for
business rules and `getAppConfig()` for presentation — the latter never throws,
so a slow or absent database degrades to the shipped identity rather than
taking a page down.

| Requirement | Implementation | Status |
|---|---|---|
| Single admin settings console | `/admin/settings` — ten sections in `src/components/admin/settings/` | Implemented |
| Application identity | `branding.appName / shortName / tagline / description`; reaches the header, emails, legal pages and metadata | Implemented |
| Logo upload, replace, remove, preview | `POST`/`DELETE /api/admin/settings/branding?asset=…` → `branding.service.js` | Implemented |
| Logo used consistently | `Logo.jsx` takes `branding`; public header, dashboard rail, auth pages, footer (dark variant) | Implemented |
| Favicon, Apple touch icon, social image | `branding.favicon / appleTouchIcon / ogImage`, referenced by `generateMetadata` | Implemented |
| Upload validation | Format from the file's own magic bytes, not its declared type; size, min/max dimensions, square where required; SVG refused outright (`lib/images/inspect.js`) | Implemented |
| Uploads reuse the storage abstraction | `getStorageProvider()` gains a `branding` scope; nothing is written into `public/`. The same call serves both storage modes — no route, service or component names a provider or reads a `STORAGE_*` variable | Implemented |
| Branding assets served publicly | `/api/branding/[asset]` — addressed by setting name, never a storage key; `nosniff`, immutable when versioned | Implemented |
| Brand colours configurable | `theme.*`; expanded into the existing `@theme` token names by `lib/theme/palette.js` (OKLab ramp) and emitted once in the root layout | Implemented |
| Colour choices cannot break accessibility | Primary and footer must clear AA against white; accent and semantic colours must be legible against white *or* ink; page/card grounds must carry the dark body text. Enforced server-side, mirrored in the picker | Implemented |
| Theme preview before saving | `AppearanceSettings` renders buttons, links, badges, tabs, cards and the footer band from the same `buildScale()` the server uses | Implemented |
| Untouched theme changes nothing | `buildThemeCss()` emits only roles that differ from the shipped palette; a default install renders from `globals.css` exactly as designed | Implemented |
| Light / dark | Light only, as shipped. The one dark surface (the footer band) is configurable. A full dark mode was **not** introduced — the design system has no dark token set | Not added, by design |
| Global SEO metadata | `seo.*` → root `generateMetadata`; title, suffix, description, keywords, OG/Twitter, canonical base URL | Implemented |
| Page-specific SEO still wins | Next merges each route's own `generateMetadata` over the root; QA asserts a tutor page keeps its own title and takes only the configured suffix | Implemented |
| Indexing switch | `seo.allowIndexing` drives both the page `robots` metadata and `robots.txt` | Implemented |
| Contact / platform information | `contact.*` — support and general email, phone, address, city, province, postal code, website, business and support hours | Implemented |
| Contact details reused | Footer, `/support`, `/about`, `/safety`, legal pages, payment receipts, the floating support launcher | Implemented |
| WhatsApp number | `contact.whatsappNumber` — stored digits-only with the country code. Blank by default and blank is the switch: no number, no WhatsApp button | Implemented |
| Social links | `social.*`; only configured profiles render — no dead icons | Implemented |
| Footer configuration | `footer.*` — description, copyright (with `{year}` substitution), social/newsletter/app-badge visibility | Implemented |
| Marketplace configuration | Commission, cancellation policy, no-show refunds, abuse thresholds, booking notice and horizon, rate guard rails, payout hold, search radius, review moderation | Implemented |
| Feature flags | `features.*` — messaging, tutor requests, favourites, reviews, online/in-person lessons, Google/Apple sign-in | Implemented |
| Flags enforced server-side | `feature` option on `routeHandler` (pipeline position: after permission, before validation); lesson modes enforced in `booking.service.js`; QA asserts a disabled feature returns 403 to a direct API call | Implemented |
| Platform notification controls | `notifications.*` — master email switch plus booking / application / review / payout / announcement categories, applied in `sendEmail()` | Implemented |
| Security email cannot be disabled | `EMAIL_CATEGORIES.SECURITY` has no setting and is never consulted against one | Implemented |
| Legal pages carry the configured identity | `buildLegalPages({ appName, supportEmail })`; the policy text itself stays in version control | Implemented |
| Emails carry the configured brand | `brandedEmailTemplates()` binds name, tagline, support address and accent colour | Implemented |
| Every setting has a safe default | `DEFAULT_SETTINGS`; `getSettings()` deep-merges each group so a document written before a setting existed still answers for it | Implemented |
| Server-side validation | `platformSettingsSchema` — colour contrast, email, http(s)-only URLs, postal code, commission range, length limits, min < max rate | Implemented |
| Admin-only | `PERMISSIONS.ADMIN_SETTINGS_MANAGE` on every settings and branding endpoint; QA asserts anonymous → 401 and parent/tutor → 403 on both | Implemented |
| No secrets in settings | Provider credentials are never stored in, or readable through, the Settings document — it is memoised and reaches client components as branding. They live in the separate `integrations` collection (§26 External modules below); QA asserts the settings payload carries no credentials | Implemented |
| Audit trail | `AUDIT_ACTIONS.SETTINGS_UPDATED` with a per-field old/new diff and the sections touched; uploads record dimensions and size, never bytes | Implemented |
| Change propagation | 30-second memo invalidated on every write; `router.refresh()` after a save; branding URLs versioned by upload time; `robots.txt` and `sitemap.xml` revalidate hourly | Implemented |

### Deliberately not configurable

| Excluded | Why |
|---|---|
| `AUTH_SECRET`, `MONGODB_URI`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL` | Infrastructure. The application cannot read its own database or verify its own sessions without them, so editing them through a database-backed screen would saw off the branch (§36) |
| Tutor approval before appearing in search | `isSearchable` is derived; making it optional would let an unverified tutor surface (§16) |
| Password reset / verification / security-alert email | No *notification* switch turns these off — an operator who could would lock people out of their own accounts. The email module's own on/off switch is a different control and does stop them, because it is the transport rather than a preference; the External modules panel states that cost before the switch is thrown (§26, §39) |
| Rating scale | 1–5 is baked into the schema, indexes and every aggregate |
| Review eligibility window | No such rule exists today; adding one to expose a setting would be a new business rule, not a configuration of an existing one |
| Commission on existing bookings | Captured at creation; settings apply to new bookings only |
| Roles and permissions | `src/constants/roles.js`, enforced server-side |
| Terms / Privacy body text | Version-controlled; only the identity it names is substituted |
| Legal page structure, private-route disallow list | Properties of the application, not preferences |

### External modules — admin-configurable integrations

Provider credentials were previously environment-only, and deliberately so. That was
reversed to give operators a way to configure and rotate integrations without a
deployment; the guard rails that made the original rule safe are preserved rather
than dropped.

| Requirement | Implementation | Status |
|---|---|---|
| One registry drives everything | `src/constants/integrations.js` — every module, provider, field, kind, secrecy and environment fallback. The Zod schemas, the Mongoose sub-documents, the masking and the admin form are all derived from it | Implemented |
| One set of credentials per provider | Calendar is the only `multi` module — §41 lets a tutor pick Google or Outlook, so both adapters are live at once. Their fields are provider-qualified (`googleClientId`, `microsoftClientId`, …) and resolution, validation and display all work from the whole active set rather than the first provider. A shared field name would be one stored path per credential, so one platform would overwrite the other's and be handed the other's client secret at token exchange. QA asserts each platform's authorize URL carries only its own client id | Implemented |
| A test never changes what it tests | Recording a connection-test result creates the stored document if there is none, and `enabled` defaults to false — so the write seeds `enabled` with whatever the module already resolved to. Otherwise pressing "Test" on a module configured by environment variables would switch it off, silently stopping password-reset mail, or checkout, or uploads. The same seeding applies to a first save that does not mention the switch. QA asserts both | Implemented |
| Persistence | `Integration` model, one document per module, in its own collection — never in `Settings`, which is memoised and reaches client components as branding | Implemented |
| Secrets encrypted at rest | `encryptSecret`/`decryptSecret` (AES-256-GCM, HKDF from `AUTH_SECRET`) under the `aplus:integration-secret` label, so a leaked calendar-token key does not open a Stripe key. `secrets` is `select: false` | Implemented |
| Secrets never returned | `GET` reduces each to `{ set, updatedAt }`; last four characters only for the Stripe secret key, which Stripe's own dashboard also shows. QA plants unique values and asserts they appear in no response, no rendered HTML and no audit record | Implemented |
| Update without disclosure | An omitted secret keeps what is stored, `null` clears it. A port can be changed without holding the password, and an accidental save cannot blank a credential | Implemented |
| Configuration precedence | defaults → environment → stored admin configuration, merged per field (`lib/config/integrations.js`). A deployment that has never opened the panel behaves exactly as before | Implemented |
| Precedence does not bend | `fakeAllowedInProduction: false` still refuses a development provider for payments and email under `APP_ENV=production`, whatever the database says. Storage degrades to its local fallback instead — but a stored credential that will not decrypt is still an error state there, never a silent fallback | Implemented |
| Undecryptable credential | Reported as `NEEDS_ATTENTION` with the `AUTH_SECRET` explanation. It never silently falls back to the environment — a configuration quietly reverting to different credentials would look like it worked | Implemented |
| Reversible | `DELETE` removes the stored record and its credentials, handing the module back to the environment. Without it, opening the screen once would be irreversible | Implemented |
| Adopting an existing deployment | `POST` imports the environment's values server-side, encrypted on the way in; nothing passes through the browser | Implemented |
| Configuration is consumed at runtime | The five provider factories became asynchronous and resolve through the merged view. A saved credential takes effect on the next call — both caches are dropped on write | Implemented |
| Enable/disable has teeth | Payments refuse checkout; email records a skip; SMS records `MODULE_DISABLED` in the delivery log; calendar sync and push no-op without touching existing connections; storage refuses uploads **but still serves reads**, because breaking retrieval of identity documents is an incident, not a setting | Implemented |
| Connection tests are real | Resend `GET /domains`, SMTP `transport.verify()`, Stripe `accounts.retrieve()`, Twilio `GET /Accounts/{sid}`, Google/Microsoft token-endpoint probe, storage `headBucket()`. A module reaches "Connected" only after a round-trip succeeds, and the result is recorded against the provider it ran for | Implemented |
| Test endpoints test what is stored | The body carries a destination only, never credentials, so a pass cannot be manufactured from an unsaved key | Implemented |
| Stripe mode cannot be got wrong | The key carries its own mode; a declared environment that disagrees is refused, as is switching mode without a matching key | Implemented |
| Provider errors are safe | Each adapter returns a sanitised verdict; `safeProviderMessage` replaces anything that still looks like a credential | Implemented |
| Validation | Strict per module *and* provider — a field belonging to another provider is a field error, not a dropped key. E.164 numbers, http(s) URLs, port range, Stripe/Twilio identifier formats, Twilio's either-or sender, SMTP 465-without-TLS | Implemented |
| Authorization | `ADMIN_INTEGRATION_MANAGE`, held apart from `ADMIN_SETTINGS_MANAGE` so a future limited-admin can edit branding without rotating a payment key. QA asserts anonymous → 401 and parent/tutor → 403 on every endpoint and method | Implemented |
| Audit | `INTEGRATION_UPDATED`, `_ENABLED`, `_DISABLED`, `_PROVIDER_CHANGED`, `_SECRET_ROTATED`, `_TESTED`, `_IMPORTED_FROM_ENV`. A rotation records which field changed and by whom — never a value, masked or otherwise | Implemented |
| Boot validation | `instrumentation.js` reports the merged view through `integration-report.js`, which cannot decrypt and so keeps `node:crypto` out of the Edge bundle. Stored problems are reported, not asserted — a broken stored record must not stop a deployment whose environment is still valid | Implemented |
| Accessibility | Status as icon + words, never colour alone; the state is part of each tab's own label; secret state in a live region; labelled switches; field-bound errors | Implemented |

### Deliberately not admin-configurable

| Excluded | Why |
|---|---|
| `AUTH_SECRET`, `MONGODB_URI`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL` | Infrastructure — the application cannot read its own database or verify its own sessions without them |
| `STORAGE_SSE`, `STORAGE_SESSION_TOKEN`, `STORAGE_TIMEOUT_MS` | Properties of the bucket's deployment, not preferences; getting them wrong fails every write rather than mis-saving one |
| OAuth sign-in, geocoding, meeting links | Not in this scope. The registry is built to take them without rework |
| A platform-level calendar connection | No such thing exists: OAuth here binds a *tutor's* account. The module configures the app registration; an admin "Connect" button would be a fake button (§39) |

## 27. Online / in-person

| Requirement | Implementation | Status |
|---|---|---|
| Zoom | `ZoomMeetingProvider` — Server-to-Server OAuth; waiting room on, join-before-host off, recording off | Awaiting credentials |
| Google Meet | `GoogleMeetProvider` — service-account JWT, Calendar conference creation; event carries no attendees | Awaiting credentials |
| Microsoft Teams | `MicrosoftTeamsMeetingProvider` — Graph client credentials, `onlineMeetings`; lobby bypassed for the two participants | Awaiting credentials |
| Platform chosen per booking | `Booking.meetingProvider`, validated against the tutor's `onlineMeetingProviders` and stored at creation; read back when the room is created — never taken from a confirmation request | Implemented |
| No participant identity sent to a meeting provider | No adapter sends a learner's or tutor's name or email; Meet events have no attendees, Teams meetings no participants | Implemented |
| Meeting info on the booking | `Booking.meeting`; released only to the purchaser, tutor and admins — never on a public profile or in search | Implemented |
| Meeting info on a group session | `GroupSession.meeting`, the same `MeetingSchema` a booking uses, copied onto every seat by `syncSeatMeetings()`; released to the tutor, admins and confirmed enrolees only | Implemented |
| A room is never carried by a session's public shape | `publicSession()` strips `meeting`. It spreads the whole document and is what `listOpenSessions()` maps over, so before that the join URL and passcode of every open session were on the public `/groups` listing | Implemented |
| Configuring a room by hand | `POST /api/bookings/:id/meeting` and `POST /api/tutor/groups/:id/meeting` — `retry`, `manual`, `disable`, `enable`, `clear`, all through `configureMeeting()` | Implemented |
| Who may configure one | `BOOKING_MEETING_MANAGE`, held by tutors and admins and by no learner role; *which* lesson is checked in the service against the loaded record, so a tutor reaches only their own | Implemented |
| Only a lesson still to happen | A booking must be `CONFIRMED`; a session must be in `ACTIVE_SESSION_STATUSES`. An unpaid, finished or cancelled lesson is refused | Implemented |
| A hand-entered room is never acted on at the provider | `MEETING_SOURCES.MANUAL` gates every adapter call — a reschedule does not move it and clearing it does not delete it, because it lives in somebody else's account | Implemented |
| A withdrawn link is kept from the people attending | `meetingForViewer()` strips `joinUrl`, `meetingId` and `passcode` for everyone but the host, who has to replace it | Implemented |
| Every read path releases the same amount of the room | `meetingOnBookingForViewer()` is the one rule, asked by `getBooking()`, `listBookings()` and `bookingSummary()`. The two list paths previously returned the stored sub-document untouched, so a withdrawn link and every finished lesson's credentials went out on `GET /api/bookings` and rendered a working Join button on both dashboards, while the lesson page correctly refused them | Implemented |
| Join credentials do not outlive the lesson | Cancelling clears them from the record as well as tearing the room down — `retireMeeting()`, used by both the one-to-one and the group cancellation paths; `meetingForViewer()` withholds them on any lesson that is not live. Previously `GET /api/bookings/:id` returned a dead `joinUrl` and a live passcode on a cancelled lesson, and a cancelled *group session* kept both on the session and on every seat while its provider room stayed live | Implemented |
| Two managers at once cannot duplicate a room | `configureMeeting()` writes under a guard on the version it read, and a `retry` that loses the race hands the room it just created back to the provider. Four simultaneous retries previously produced two live rooms, one of them referenced by nothing and torn down by nothing | Implemented |
| A room is given up only once the change is stored | The provider teardown for a replaced or cleared room runs after the write, not before, so a failed write cannot destroy the only working link | Implemented |
| Meeting credentials are never logged | `configureMeeting()` audits `hasJoinUrl` / `hasPasscode` and never the values; the `meetingUpdated` email states plainly that the link and passcode are only ever shown on the lesson page | Implemented |
| Joining details reach the people attending | `NOTIFICATION_TYPES.MEETING_UPDATED` on create, change and withdrawal — to the purchaser, or to every confirmed seat in a group | Implemented |
| Host credentials never stored | Zoom's `start_url`, Teams' `audioConferencing` conference id and `joinInformation`, and Meet's organiser are all dropped by their adapters; the integration tests assert each | Implemented |
| Cancellation and reschedule | A reschedule moves the existing room so the join link keeps working; a cancellation tears it down, for a group session as well as a one-to-one lesson | Implemented |
| A credential carries nothing invisible | The meeting ID and passcode refuse `\p{Cf}`, the non-ASCII space separators and lone surrogates as well as whitespace and controls — a zero-width space or a bidirectional override in a passcode is one that reads right and is wrong when it is typed back | Implemented |
| Provider outage does not strand a paid lesson | Meeting creation failure is logged and the booking still confirms; the tutor or an administrator then supplies a room from the meeting panel on the lesson — `retry` to ask the provider again, or `manual` to enter one they already own. Until this existed the promise of "filled in later" had no code behind it | Implemented |
| A lesson with no room says so | The meeting panel renders a `Room pending` state rather than nothing, on both the booking and the group session | Implemented |
| 5 in-person location types | `IN_PERSON_LOCATIONS` | Implemented |
| Addresses protected | `addressLine` is `select:false`, released only to parties on a confirmed booking | Implemented |

## 28. Notifications

| Requirement | Implementation | Status |
|---|---|---|
| All 10 notification types | `NOTIFICATION_TYPES` | Implemented |
| Lesson reminders | `sendBookingReminders()` emits `BOOKING_REMINDER` to both parties 24 hours and 1 hour before a confirmed lesson, driven by the `booking-reminders` scheduled job (§48). Each reminder is claimed on `Booking.remindersSent` with a conditional update before it is sent, so repeat runs cannot duplicate one | Implemented |
| Unread count, centre, read/unread | `/notifications`, `unreadNotificationCount()` | Implemented |
| Preferences | Per-channel toggles in Settings, beneath the platform-level switches in §26b | Implemented |
| Email / SMS / push ready | `NOTIFICATION_CHANNELS` + `deliveredChannels`; email wired through Resend, SMS/push declared | Partial — SMS/push are Phase 2 |
| Transactional templates | 13 templates in `email-templates.js`: auth, booking, cancellation, reschedule, refund, tutor lifecycle, payouts. Responsive HTML + a real plain-text twin, built from one description. Bound to the configured brand via `brandedEmailTemplates()` (§26b) | Implemented |
| No email for in-app messages | Messaging notifies in-app only, per the product requirement | Implemented |
| Delivery failure is contained | `sendEmail()` logs and returns; a bounced confirmation never undoes the booking it announces | Implemented |

## 29. SEO

| Requirement | Implementation | Status |
|---|---|---|
| Production geocoding | `GoogleGeocodingProvider`, component-filtered to Canada, 4s timeout, bundled-table fallback | Awaiting credentials |
| Exact addresses never geocoded or published | Lookups use postal code / city / province only; every coordinate is coarsened to ~1 km by `coarsenCoordinates()` | Implemented |
| Geocoding failure is not fatal | Degrades to the bundled table, then to `null`; search falls back to non-geographic matching | Implemented |
| Diagnostics leak no addresses | Failures log the provider's status only | Implemented |
| `/ontario/grade-12/math/mhf4u` | `src/app/(public)/[province]/[grade]/[subject]/[course]/page.js` | Implemented |
| `/tutors/mhf4u/scarborough` | `src/app/(public)/tutors/[slug]/[city]/page.js` | Implemented |
| Shareable tutor URLs | `/tutors/[slug]`, stable slug per profile | Implemented |
| Metadata, titles, descriptions, canonicals | `generateMetadata` on every public route, over an admin-configurable global default (§26b) | Implemented |
| Semantic markup | JSON-LD for Person, Course and FAQPage | Implemented |
| Indexable public pages | `sitemap.js` (308 URLs) + `robots.js` excluding private areas; both honour the configured canonical base URL and indexing switch | Implemented |

## 30. Design system

| Requirement | Implementation | Status |
|---|---|---|
| Reusable Tailwind design system | `globals.css` `@theme` tokens: colour, type, radii, elevation, motion. Admin-configured colours re-point the same token names rather than adding new ones (§26b) | Implemented |
| All 15 required primitives | 18 files in `src/components/ui` | Implemented |
| Consistent styling across pages | Every page composes the same primitives | Implemented |

## 31. Premium animation

| Requirement | Implementation | Status |
|---|---|---|
| Subtle animation across 13 surfaces | `Reveal`/`RevealGroup`, `motion` transitions on modals, tabs, toasts, dropdowns | Implemented |
| Fast and purposeful, not childish | 150–250ms, `ease-out-quint`, no bounce or parallax | Implemented |
| `prefers-reduced-motion` | Global CSS override + `useReducedMotion()` in motion components; the testimonial rail drops its duplicate set and becomes a plain horizontal scroller | Implemented |

## 32. Loading / error / empty states

| Requirement | Implementation | Status |
|---|---|---|
| Loading, skeleton, empty, error, success, retry | `src/components/ui/States.jsx` | Implemented |
| All 8 named empty states | Every list renders a purpose-written `EmptyState` | Implemented |
| Never a blank screen | `loading.js`, `error.js`, `not-found.js` at the app root | Implemented |
| 404 inherits one header | `NotFoundBody` is headerless; each chromed segment (`(public)`, `(dashboard)`, `admin`, `tutor`) has its own `not-found.js`, so a `notFound()` never stacks a second header under the layout's | Implemented |
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
| Payment information protected | Hosted Checkout — no PAN ever reaches this application; only brand + last4 are stored, from a verified webhook | Implemented |
| Webhook signature verification | Checked against the raw request body before any database access; unsigned and unverifiable calls are refused | Implemented |
| OAuth CSRF / replay protection | Single-use httpOnly nonce, required in the ID token; consumed whether the attempt succeeds or fails | Implemented |
| OAuth cannot escalate a role | Requested role applies only to a brand-new account; QA asserts an `ADMIN` request is refused | Implemented |
| No secrets in URLs, logs or responses | Provider API keys travel in headers; `integrationStatus()` reports names only; QA asserts settings carry no credentials | Implemented |
| Geocoding privacy | Coordinates coarsened to ~1 km before storage; failure diagnostics log no addresses | Implemented |
| Meeting-link authorization | Released to the two parties and admins only; Zoom host `start_url` never stored | Implemented |
| Minor privacy controls | `isMinor` + `shareFullNameWithTutor`; QA asserts masking | Implemented |
| Audit logging | `AuditLog` on every admin and security action, readable at **Admin → Audit log** (`ADMIN_AUDIT_VIEW`) filtered by action, actor, entity type, entity id and date. Append-only: no endpoint writes or deletes a row except `recordAudit`. Credential-shaped values are redacted on the way out | Implemented |
| Data retention / deletion | Account deletion anonymises and retains financial records | Implemented |
| Server-side validation everywhere | Zod schemas on body, query and params for every route | Implemented |
| Security headers | `next.config.mjs` — nosniff, frame options, referrer and permissions policy everywhere; a Content-Security-Policy on every document (not on `/api`, so the verification-document route keeps its own stricter `sandbox` policy); HSTS in production only. `'unsafe-eval'` is development-only; `'unsafe-inline'` is required by Next's streamed RSC payload and the inline theme, and the reasoning is written out in `next.config.mjs` | Implemented |
| Rate limiting | `lib/security/rate-limit.js` on auth, password-reset, support and reconciliation endpoints. Windows are counted **in MongoDB**, so a limit holds across every instance rather than per process; `RATE_LIMIT_STORE=memory` opts a single-instance deployment out. An unreachable store degrades to a per-process counter and logs loudly — never to no limit | Implemented |
| NoSQL injection guards | `stripOperators`, `escapeRegex` | Implemented |
| Post-sign-in destination is ours | `internalPath()` (`lib/utils/url.js`) reduces the `next` parameter to a path on this application. `//host` and `/\host` are another origin to a browser, so "starts with a slash" is not the test | Implemented |
| Stored links carry no executable scheme | `optionalUrl` / `mediaUrl` in `lib/validation/common.js` — the tutor intro video and profile gallery are http(s) (or a path this application serves) server-side, rather than relying on React refusing to render a `javascript:` href | Implemented |

## 38. External service strategy

See [docs/INTEGRATIONS.md](INTEGRATIONS.md) for setup, dashboard configuration
and webhook endpoints.

| Requirement | Development | Production implementation | Status |
|---|---|---|---|
| Payment abstraction | `MockPaymentProvider` | `StripePaymentProvider` — hosted Checkout, Connect Express, refunds, transfers, signed webhooks | Awaiting credentials |
| Email abstraction | `ConsoleEmailProvider` | `ResendEmailProvider` + 13 branded responsive templates | Awaiting credentials |
| Auth providers | `DevOAuthProvider` | `OpenIdOAuthProvider` — Google and Apple ID tokens | Awaiting credentials |
| Geocoding | `LocalTableGeocodingProvider` | `GoogleGeocodingProvider`, country-filtered, coarsened, with table fallback | Awaiting credentials |
| Video meetings | `MockMeetingProvider` | `ZoomMeetingProvider`, `GoogleMeetProvider`, `MicrosoftTeamsMeetingProvider` — create / move / tear down; several may be live at once. A deployment with no credentials for the platform a learner chose now has a first-class fallback rather than only a development link: an authorised human enters the room they already own, and it is labelled as such everywhere | Awaiting credentials |
| File storage | `LocalStorageProvider` — a real store under `.storage/`, used automatically whenever the four `STORAGE_*` credentials are not all present | `ObjectStorageProvider` — **MinIO**; SigV4 over `fetch`, also S3, R2, B2, Spaces. Selected automatically once endpoint, bucket, access key and secret key are all set | Implemented, both modes |
| Calendar | `MockCalendarProvider` | `GoogleCalendarProvider` (Calendar v3) and `MicrosoftCalendarProvider` (Graph) — two-way sync, busy periods, `calendar-sync` job | Awaiting credentials |
| Configuration-driven selection | `src/lib/config/env.js`; `APP_ENV` + one `*_PROVIDER` per integration | — | Implemented |
| Production never silently fakes | `PAYMENT_PROVIDER`/`EMAIL_PROVIDER=development` refused under `APP_ENV=production`; a named provider without credentials stops the boot. **File storage is the exception**: its fallback is a real store rather than a fake, so incomplete credentials degrade to the local filesystem with a warning instead of refusing to boot — `STORAGE_REQUIRE_EXTERNAL=true` restores the hard failure | — | Implemented |
| Start-up validation | `src/instrumentation.js` — warns in development, refuses to boot in production | — | Implemented |
| Operator visibility | Admin → Platform settings → Integrations: provider, mode and recent webhook deliveries | — | Implemented |
| UI unchanged when the real provider lands | All access goes through `get*Provider()`; no service or component names a provider | — | Implemented |

## 39–40. No fake buttons; realistic data

| Requirement | Implementation | Status |
|---|---|---|
| Every MVP interaction actually works | Every QA check exercises a real API; no "coming soon" on MVP paths | Implemented |
| Realistic Ontario seed data | 12 tutors with genuine biographies, 38 real course codes, 54 bookings, 18 written reviews | Implemented |

## 41. Phase 2 / Phase 3

All twelve Phase 2 features are built. The full audit — evidence, tests, the
specification gaps and the configurable default chosen for each — is
[APLUS_LEARN_PHASE2_IMPLEMENTATION_AUDIT.md](../APLUS_LEARN_PHASE2_IMPLEMENTATION_AUDIT.md).

| Phase 2 item | Implementation | Status |
|---|---|---|
| Advanced tutor requests | `TutorRequest`, `request.service.js` | Implemented |
| Advanced matching | `lib/matching/` + operator-tunable `matchWeights` | Implemented |
| Google Calendar | `CalendarProvider`, `calendar.service.js`, `calendar-sync` job | Implemented |
| Outlook / Microsoft Calendar | Same interface, Microsoft Graph adapter | Implemented |
| SMS | `sms.service.js`, Twilio adapter, off until a carrier is configured | Implemented |
| Referrals | `Referral`, `CreditEntry`, `credit.service.js` | Implemented |
| Tutor packages | `TutorPackage`, `PackagePurchase`, `package-expiry` job | Implemented |
| Group tutoring | `GroupSession`, `GroupEnrolment`, `group-settlement` job | Implemented |
| Progress reports | `ProgressReport`, `progress.service.js` | Implemented |
| Promoted profiles | `TutorPromotion`, `lib/search/promotion.js`, `promotion-expiry` job | Implemented |
| Advanced analytics | `analytics.service.js`, `lib/analytics/range.js` | Implemented |
| Fraud / risk tools | `RiskCase`, `risk.service.js`, `/admin/risk` | Implemented |

### Phase 3

§41 lists Phase 3 as fourteen feature names under the instruction *"Do not
unnecessarily implement all future features now. However, architecture must
allow…"*. That is the whole specification: there are no Phase 3 requirements,
domain models, or business rules anywhere in `Project.md`. Three items were
therefore implementable without inventing anything, and the rest are deferred
with the specific product or provider decision each one is waiting on. The
audit is
[APLUS_LEARN_PHASE3_IMPLEMENTATION_AUDIT.md](../APLUS_LEARN_PHASE3_IMPLEMENTATION_AUDIT.md).

| Phase 3 item | Status | Where it stands |
|---|---|---|
| Additional provinces | Implemented | `Province.isActive`, admin CRUD, province-scoped grades/courses, SEO routes. A course under a deactivated province now also leaves the public list and its landing page — `activeProvinceCodes()` in `curriculum.service.js` |
| Homework / document sharing | Implemented (sharing) | `AttachmentSchema` on `Message.attachments` and `ProgressReport.homeworkAttachments`, `attachment.service.js`, `attachments` storage scope. A graded assignment domain is deferred — see below |
| Student analytics | Implemented | `studentAnalytics()`, `/insights`, `/tutor/students/[id]`, `STUDENT_ANALYTICS_VIEW` |
| iOS / Android | Not implemented | The REST API is app-consumable — envelope, pagination, validation and RBAC are uniform — but auth is cookie-only and there is no CORS configuration. Store badges correctly read "Coming soon" |
| Native video classroom | Deferred | `MeetingProvider` with Zoom, Meet and Teams adapters is the extension point. "Native" names no technology; WebRTC/SFU infrastructure would be invention |
| Interactive whiteboard | Not implemented | Nothing in the specification defines persistence, participants, permissions, collaboration model, export or retention |
| AI recommendations / search / lesson summaries | Deferred | No AI abstraction, provider contract or data-handling rule exists. Sending learner data to a third party needs an explicit architecture decision |
| Tutor subscriptions | Deferred | `PaymentProvider` has no recurring method, and `/become-a-tutor` currently tells tutors there is no subscription. Needs pricing, billing period, entitlement, dunning and cancellation rules |
| Group courses | Deferred | `GroupSession` is one session at one time. A multi-session course is a different shape and needs its own enrolment, pricing and attendance rules |
| Exam preparation marketplace | Deferred | No concrete domain in the specification. Reusing subjects, packages and promotions is possible once someone says what an "exam" is here |
| University tutoring | Deferred | Curriculum is province-scoped K–12 (`Grade.stage` is `ELEMENTARY`/`MIDDLE`/`SECONDARY`). Needs a domain boundary decision before anything is modelled |

| Still deferred from Phase 2 | Architectural hook | Status |
|---|---|---|
| Realtime messaging | Stateless paginated thread reads | Phase 2 backlog |
| Push notifications | `NOTIFICATION_CHANNELS` carries the channel | Needs a mobile app |

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
| Lint | `bun run lint` | Clean |
| Build | `bun run build` | Passes |
| Database connectivity | `databaseStatus()` on the admin dashboard | Healthy |
| Route checks | 99 pages, 158 API route handlers | All reachable |
| Authorization checks | Anonymous 401, wrong-role 403, cross-account 403 | Enforced |
| Journey checks | `bun run qa` | 1,003 / 1,003 |
| Integration adapters | `bun run test:integrations` | 1,459 / 1,459 (1 skipped — the live object-store round trip, which needs credentials) |

Both suites own the `integrations` collection for their duration, and `qa`
leaves it cleared, so run it against a development database. See
[CLAUDE.md](../../CLAUDE.md) for why.

### Integration adapter coverage

`scripts/integration-tests.mjs` runs the real adapter classes with `fetch`
stubbed, Stripe webhooks signed with the genuine signing scheme, and OAuth
tokens signed by a key pair generated in process. It contacts no third party,
so it is safe to run in CI.

| Area | What is asserted |
|---|---|
| Configuration | Auto-detection in development; production refuses a development payment or email provider, refuses a named provider with missing secrets, and never guesses; the status report contains no secret values |
| Payments | The server-priced amount is what is charged; idempotency keys on checkout, refund and transfer; a raw card is refused; refund carries the policy outcome; Connect accounts start unpayable and are set to manual payouts; only masked bank details come back |
| Webhooks | A wrong secret is rejected; an hour-old signature is rejected; a duplicate of a processed event changes nothing; a *failed* delivery is reprocessed on redelivery and settles once the cause is gone; a claim abandoned by a dead process is reclaimed while a live one is not; a mismatched amount is refused and leaves the payment unsettled; a late failure cannot un-pay a settled payment; only card brand and last4 are stored; a dashboard refund reconciles once through either `charge.refunded` or `refund.*`; a pending refund is not counted as money returned; unknown events are acknowledged |
| Reconciliation | A payment paid at the provider whose webhook never arrived is settled by the sweep rather than released; an unreachable provider keeps the hold; a provider amount that disagrees with the priced total settles nothing |
| Checkout return | Webhook-before-redirect and redirect-before-webhook both end confirmed, and each confirms exactly once; a repeated reconciliation changes nothing; `PROCESSING` holds the slot and the later async success confirms it; an unpaid answer confirms nothing; an unreachable provider answers `UNKNOWN` rather than "unpaid"; a simultaneous webhook and reconciliation settle once between them; a refunded payment is not re-settled; the development provider is never asked, because it has no remote state to read |
| Storage — mode selection | No configuration at all selects local; a complete configuration selects the object store; each of the four required fields missing on its own falls back to local and names itself in the diagnostic; a missing region or key prefix does not; `STORAGE_REQUIRE_EXTERNAL=true` turns the fallback back into a hard failure; an unknown provider name is still refused by name |
| Storage — local mode | Upload, read-back, metadata, `exists`, scope separation and deletion against a real temporary directory; the uploader's filename never becomes a key; nine traversal keys (`../`, `..\`, `.`, `..`, empty, percent-escaped, NUL) each read and delete nothing outside the scope; a missing object is a 404 with no filesystem path; a key written by an earlier version still resolves, and resolves identically through the object provider |
| Storage | SigV4 reproduces AWS's published vector; upload/read/head/replace/delete round-trip; the uploader's filename never becomes a key; scopes cannot read each other; a traversal key is flattened; no URL is ever returned; no per-object SSE by default; credentials are redacted from provider errors; bad credentials, missing objects, unreachable hosts and timeouts are each named distinctly |
| Email | Key travels in a header not a URL; both HTML and text parts are sent; delivery is idempotent; a provider rejection surfaces its reason; an outage does not throw into the calling service; all 13 templates render; template input is HTML-escaped; a security notice carries no token |
| OAuth | A valid token verifies; wrong audience, wrong issuer, tampered signature and a mismatched nonce are all rejected; Apple's string booleans and one-time name are handled; an unconfigured provider refuses rather than trusting |
| Geocoding | A rooftop coordinate is coarsened before it leaves the module; an unknown location, a rejected key and a network failure all degrade to `null`; an outage falls back to the bundled table; distance maths is correct and symmetric |
| Meetings | Server-to-Server auth; correct start time, duration and safety settings; the host `start_url` is never returned or stored; a reschedule PATCHes rather than re-creates; the token is cached; cancellation deletes the room |
| Disputes | Raising is refused for a non-party and before the lesson ends; a second dispute cannot open while one runs; every one of the four decisions is terminal and a later decision of any kind is refused with a conflict; two simultaneous decisions produce one accepted, one refused, one refund and one audit record; a refund the ledger refuses releases the claim so the dispute stays decidable; disputes on one lesson never add up to more than the ledger returned; the booking, the payment and the notifications are asserted from the database, not from the return value |
| Curriculum | Province/grade/subject/course create and update; a course carries and *re-carries* its denormalised province, grade and subject when it is moved; deactivation removes something from every public read while an administrator still sees it; duplicate codes, slugs and grades are refused; two codeless courses do not collide; a course a tutor teaches cannot be deleted; every level is audited |
| Audit log | Credential-shaped keys and values are redacted while the *names* of rotated secrets survive; depth, array length and string length are bounded; filters by action, actor, entity type, entity id and period compose; a bare calendar day means the whole day; pagination does not repeat a row; a rejected write is swallowed rather than failing the action it records |
| Public surfaces | `javascript:`, `data:`, `vbscript:`, `file:` and malformed links are refused on the intro video and the gallery, at onboarding as well as on the edit form; the public app config carries no storage key, filename, size or uploader; the post-sign-in `next` cannot be `//host` or `/\host`; the password policy module imports nothing, so no form ships bcrypt |
| Booking slot claims | One of five simultaneous requests for a slot wins and the other four leave nothing behind; a claim left by a cancelled booking is inherited rather than wedging the slot; a genuinely held slot is refused; one instant never accumulates two claims |
| Rate limiting | The default store is the shared one and an unrecognised value falls back to it rather than to none; ten simultaneous attempts against a limit of four allow four; a lapsed window reopens once rather than once per caller; the client key reads the proxy header left-most first |

---

## Known limitations

Deliberately separated by *why* each one is still open.

### Implemented and verified

Everything above marked **Implemented** runs end to end and is covered by
`bun run qa` (1,003 assertions) or `bun run test:integrations` (1,459).

### Implemented, awaiting credentials

The production adapters for **Stripe**, **Resend**, **Google/Apple OAuth**,
**Google Geocoding** and **Zoom** are written, wired through the existing
interfaces and covered by the adapter test suite — but no account credentials
exist in this environment, so none has been exercised against the live
service. Each still needs a sandbox smoke test once keys are available:
a test-mode checkout and refund, a Connect onboarding run, an email to a
controlled address, a full Google sign-in, a handful of Ontario postal codes,
and one online booking end to end.
[docs/INTEGRATIONS.md](INTEGRATIONS.md) lists the external dashboard
configuration each one needs.

Apple additionally requires a paid Developer Program membership to create the
Services ID that `APPLE_CLIENT_ID` refers to.

### Known open items

Nothing below is a defect that reproduces; each is a bounded decision or a
deliberate deferral.

| Item | Why it is still open |
|---|---|
| No hard delete for subjects, grades and provinces | Deactivation is the removal path, and it is a real one: a deactivated record leaves every public read. A hard delete would have to answer what happens to the courses and tutor profiles pointing at it, which is a data-migration question rather than a missing endpoint. Courses *do* support delete, and refuse while a tutor still teaches them |
| `script-src` and `style-src` allow `'unsafe-inline'` | Next streams the RSC payload as inline `<script>`, and the operator's theme is an inline `<style>`. A per-request nonce would remove both, at the cost of opting every page — including the prerendered SEO pages — into dynamic rendering. The trade-off is written out in `next.config.mjs` |
| HSTS carries no `includeSubDomains` or `preload` | Both are one-way doors that depend on facts this repository cannot know about the deployment's other subdomains. A deployment that has checked should add them |
| Application and verification decisions are re-decidable | Deliberate, and the opposite of the dispute rule: re-approving a tutor who was rejected, or re-issuing a badge, is an ordinary administrative act and moves no money. A dispute decision is terminal because it has already issued an irreversible refund |
| Monitoring and error reporting | `console.*` only. Wiring a monitoring service is a deployment choice rather than an application gap |

## 48. Scheduled jobs

Some behaviour only happens because something calls it on a schedule. The jobs
live in `src/services/scheduler.service.js` and are reached through one
authenticated endpoint, so the platform stays a single Next.js application with
no queue or worker process.

| Job | Endpoint | Suggested schedule | What it does |
|---|---|---|---|
| Lesson reminders | `/api/cron/booking-reminders` | `*/15 * * * *` | Emits `BOOKING_REMINDER` 24h and 1h before a confirmed lesson (§28) |
| Verification expiry | `/api/cron/verification-expiry` | `0 3 * * *` | Expires lapsed badges and takes them off the public profile (§16) |
| Tutor payouts | `/api/cron/payouts` | `0 4 * * *` | Creates payouts for earnings past the hold period (§20) |
| Tutor request expiry | `/api/cron/request-expiry` | `0 5 * * *` | Closes tutor requests past their expiry date (§22) |
| All of them | `/api/cron/all` | — | One pass, for a single cron entry |

| Requirement | Implementation | Status |
|---|---|---|
| Authenticated | `Authorization: Bearer $CRON_SECRET`, compared in constant time, or a signed-in administrator. An unset `CRON_SECRET` closes the bearer route rather than opening it | Implemented |
| Idempotent | Every job recomputes what is due from stored state and claims the work atomically before acting: reminders via a conditional `$addToSet` on `Booking.remindersSent`, payouts via the existing `payoutId` claim. QA asserts a second run of each sends and pays nothing | Implemented |
| Independent | One job failing is reported, not propagated — `/api/cron/all` still runs the rest | Implemented |
| Deployment-agnostic | `vercel.json` declares the Vercel entries; crontab, Kubernetes CronJob or a CI workflow reach the same endpoint | Implemented |
| Audited | A run that changed something, or failed, writes `SCHEDULED_JOB_RUN`; a quiet sweep does not, so the trail stays readable | Implemented |

## 49. Progressive Web App

Not a numbered requirement of `docs/Project.md` — added so the marketplace
installs to a home screen and degrades honestly when the network goes. Full
design notes in [`docs/PWA.md`](PWA.md).

| Requirement | Implementation | Status |
|---|---|---|
| Web app manifest | `src/app/manifest.js` → `/manifest.webmanifest`. Name, description and theme colour come from `getAppConfig()`, so rebranding reaches an installed copy; revalidates hourly like `robots.js` | Implemented |
| Icons | `public/icons/*` — 192 and 512 in both `any` and `maskable`, plus a 180 opaque Apple touch icon. Generated from `public/icon.svg` by `scripts/pwa-icons.mjs`, which measures the mark's ink and centres it in the maskable safe zone | Implemented |
| Service worker | `public/sw.js` — hand-written allowlist, no package and no generated precache manifest. Registered by `src/components/pwa/ServiceWorkerManager.jsx` in production only | Implemented |
| Installability | Manifest, icons, `fetch` handler, scope `/`, `display: standalone`. HTTPS is already enforced for production by `lib/config/env.js` | Implemented |
| Offline fallback | `/offline`, pre-cached at install with `credentials: "omit"` so the stored copy was rendered for nobody. Works with no JavaScript; the worker also pre-caches the stylesheet the page names | Implemented |
| Static caching | Cache-first for `/_next/static/**`, `public/` files matched by extension, and `/_next/image` **only** when its `url=` is a local path. Capped at 160 entries, trimmed oldest-first | Implemented |
| Private-data protection | `/api/**` is refused unconditionally and first; navigations are network-only and never stored; RSC payloads fall through unhandled. A second gate inspects the *response* and refuses anything `no-store`, `private`, or varying on `Cookie` | Implemented |
| API cacheability | `ok`/`fail`/`noContent` now send `Cache-Control: no-store`, closing heuristic caching by a browser, proxy or CDN. The binary routes keep the headers they reason about individually (§16, §18) | Implemented |
| Update strategy | New workers wait; nothing calls `skipWaiting()` and nothing reloads. `activate` drops older `aplus-` caches and claims uncontrolled pages. The registrar re-checks hourly and on tab focus. Navigations are network-first, so a stale worker is a stale *policy*, never stale code | Implemented |
| Offline mutations | Deliberately absent. No offline database, no queued bookings or payments — a payment a person believes succeeded because it was queued locally is worse than one that plainly failed | Not applicable |
| iOS support | Apple touch icon, legacy `apple-mobile-web-app-capable` alongside Next's standardised tag, `status-bar-style: default` so no sticky header slides under the clock | Partial — see below |

**iOS limitations, not worked around because they cannot be:** no
`beforeinstallprompt`, so no custom install button on Safari; Web Push only for
a copy already on the home screen (iOS 16.4+); and Safari evicts all storage,
service-worker caches included, after roughly seven days without use, so an
installed copy re-downloads its shell after a quiet week.

---

### Requires production infrastructure

1. **Rate limiting is in-process.** Adequate for a single instance; a
   multi-instance deployment should move the store to Redis. The call
   signature is designed not to change.
2. **Scheduled jobs need something to call them.** The jobs themselves are
   built and idempotent (§48); what the deployment supplies is a scheduler and
   a `CRON_SECRET`. `vercel.json` declares the entries for Vercel; any cron,
   CronJob or workflow that can issue an authenticated HTTP request works
   equally well. Without one, reminders are not sent, badges do not expire,
   payouts stay administrator-initiated, **and abandoned checkouts never
   release the tutor's slot** — `booking-expiry` is the job that does it.
3. **Webhook delivery needs a public URL.** Locally, use
   `stripe listen --forward-to localhost:3000/api/webhooks/payments`. Without
   it the return page's reconciliation still settles the payment from Stripe's
   API, so a purchaser is not stranded — but `checkout.session.expired`,
   `charge.succeeded` (card brand and last four) and dashboard refunds are only
   ever delivered by webhook, so a deployment without one is incomplete.
4. **The signing secret must belong to the same Stripe account as the secret
   key.** Configuration merges per field across the environment and the admin
   panel, so a key saved in Admin → Integrations sitting beside a
   `STRIPE_WEBHOOK_SECRET` from a different account is a checkout that works
   and a webhook that can never verify. The panel now says which layer is
   answering for each credential rather than showing an environment-supplied
   secret as "Not set".

### Not implemented

1. **Push notifications.** The channel exists on the model and in
   `NOTIFICATION_CHANNELS`. In-app, email and SMS are delivered; push is not.
2. **Meeting credentials are not operator-editable.** Zoom, Google Meet and
   Microsoft Teams are configured from the environment only — they are the one
   integration missing from `INTEGRATION_MODULES`, so an operator cannot turn
   Zoom on from Admin → Integrations the way they can email, payments,
   calendar, SMS and storage. `getMeetingProvider()` is correspondingly the
   only **synchronous** provider factory, reading `lib/config/env.js` rather
   than the database-aware `lib/config/integrations.js`. Adding it means a
   sixth registry entry with three providers, encrypted secrets and a status
   round-trip, and making that factory `async` at every call site in
   `booking.service` and `group.service`. Nothing depends on it: a deployment
   that sets the environment variables gets real rooms today, and one that does
   not can have an authorised human enter a room by hand (§27).

Calendar sync (Google and Microsoft), SMS, and the Google Meet and Microsoft
Teams meeting adapters are all implemented. Each needs real provider
credentials before it does anything in production — see the audit's
"What still needs real credentials".

### Scope

1. **Only Ontario has curriculum data.** Seven other provinces exist and can
   be opened from the admin curriculum manager; they need course data before
   they are useful.
2. **Development geocoding covers 20 Ontario cities and ~30 forward sortation
   areas.** That is the *fallback* table now, not the only option — setting
   `GEOCODING_PROVIDER=google` removes the limit.
