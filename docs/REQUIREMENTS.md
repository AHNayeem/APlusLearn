# APlus Learn — Requirement Coverage Matrix

Every numbered section of `docs/Project.md`, mapped to what implements it.

**Status key**
- **Implemented** — built, wired end to end, and exercised by `npm run qa`
- **Awaiting credentials** — the production integration is built and covered by
  `npm run test:integrations`, but no account credentials exist in this
  environment, so it has not been run against the live service (§38)
- **Partial** — working, with a named limitation
- **Phase 2/3** — deliberately deferred, with the architecture in place

Verified on a clean database: `npm run seed` → `npx eslint src scripts` (clean)
→ `npm run build` (passes) → `npm run test:integrations` (111/111) →
`npm run qa` (133/133).

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
| One Next.js app, no separate backend | `src/app/api/**` — 103 route handlers | Implemented |
| UI → Service → Database layering | `src/components` → `src/services/*.service.js` → `src/models` | Implemented |
| JavaScript only, no TypeScript | 384 `.js`/`.jsx` files, zero `.ts`/`.tsx` | Implemented |
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
| Stripe Connect | `StripePaymentProvider` — hosted Checkout for the charge, Connect Express with separate charges and transfers for payouts | Awaiting credentials |
| Card never touches this application | Hosted Checkout; `capturePayment()` is refused outright under Stripe, so the deployment stays outside PCI scope | Implemented |
| Booking confirmed only by a verified webhook | `/api/webhooks/payments` → `webhook.service.js`; the browser's return page polls and confirms nothing | Implemented |
| Webhook idempotency | Unique `(provider, eventId)` index on `WebhookEvent`; replays are acknowledged and dropped | Implemented |
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
| Uploads reuse the storage abstraction | `getStorageProvider()` gains a `branding` scope; nothing is written into `public/` | Implemented |
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
| Contact details reused | Footer, `/support`, `/about`, `/safety`, legal pages, payment receipts | Implemented |
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
| No secrets in settings | Provider credentials stay in the environment (`lib/config/env.js`) and are reported, never edited; QA asserts the payload carries no credentials | Implemented |
| Audit trail | `AUDIT_ACTIONS.SETTINGS_UPDATED` with a per-field old/new diff and the sections touched; uploads record dimensions and size, never bytes | Implemented |
| Change propagation | 30-second memo invalidated on every write; `router.refresh()` after a save; branding URLs versioned by upload time; `robots.txt` and `sitemap.xml` revalidate hourly | Implemented |

### Deliberately not configurable

| Excluded | Why |
|---|---|
| Provider API keys, webhook secrets, `AUTH_SECRET`, `MONGODB_URI` | Deployment configuration, not application settings (§36) |
| Tutor approval before appearing in search | `isSearchable` is derived; making it optional would let an unverified tutor surface (§16) |
| Password reset / verification / security-alert email | An operator who could disable these could lock people out of their own accounts |
| Rating scale | 1–5 is baked into the schema, indexes and every aggregate |
| Review eligibility window | No such rule exists today; adding one to expose a setting would be a new business rule, not a configuration of an existing one |
| Commission on existing bookings | Captured at creation; settings apply to new bookings only |
| Roles and permissions | `src/constants/roles.js`, enforced server-side |
| Terms / Privacy body text | Version-controlled; only the identity it names is substituted |
| Legal page structure, private-route disallow list | Properties of the application, not preferences |

## 27. Online / in-person

| Requirement | Implementation | Status |
|---|---|---|
| Zoom | `ZoomMeetingProvider` — Server-to-Server OAuth; waiting room on, join-before-host off, recording off | Awaiting credentials |
| Google Meet / Teams | Same `MeetingProvider` interface; both need a per-host OAuth grant rather than an account credential | Phase 2 |
| Meeting info on the booking | `Booking.meeting`; released only to the purchaser, tutor and admins — never on a public profile or in search | Implemented |
| Host credentials never stored | Zoom's `start_url` is dropped by the adapter; QA and the integration tests assert it | Implemented |
| Cancellation and reschedule | A reschedule moves the existing room so the join link keeps working; a cancellation tears it down | Implemented |
| Provider outage does not strand a paid lesson | Meeting creation failure is logged; the booking still confirms and the room is filled in later | Implemented |
| 5 in-person location types | `IN_PERSON_LOCATIONS` | Implemented |
| Addresses protected | `addressLine` is `select:false`, released only to parties on a confirmed booking | Implemented |

## 28. Notifications

| Requirement | Implementation | Status |
|---|---|---|
| All 10 notification types | `NOTIFICATION_TYPES` | Implemented |
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
| Payment information protected | Hosted Checkout — no PAN ever reaches this application; only brand + last4 are stored, from a verified webhook | Implemented |
| Webhook signature verification | Checked against the raw request body before any database access; unsigned and unverifiable calls are refused | Implemented |
| OAuth CSRF / replay protection | Single-use httpOnly nonce, required in the ID token; consumed whether the attempt succeeds or fails | Implemented |
| OAuth cannot escalate a role | Requested role applies only to a brand-new account; QA asserts an `ADMIN` request is refused | Implemented |
| No secrets in URLs, logs or responses | Provider API keys travel in headers; `integrationStatus()` reports names only; QA asserts settings carry no credentials | Implemented |
| Geocoding privacy | Coordinates coarsened to ~1 km before storage; failure diagnostics log no addresses | Implemented |
| Meeting-link authorization | Released to the two parties and admins only; Zoom host `start_url` never stored | Implemented |
| Minor privacy controls | `isMinor` + `shareFullNameWithTutor`; QA asserts masking | Implemented |
| Audit logging | `AuditLog` on every admin and security action | Implemented |
| Data retention / deletion | Account deletion anonymises and retains financial records | Implemented |
| Server-side validation everywhere | Zod schemas on body, query and params for every route | Implemented |
| Security headers | `next.config.mjs` — nosniff, frame options, referrer, permissions policy | Implemented |
| Rate limiting | `lib/security/rate-limit.js` on auth endpoints | Implemented |
| NoSQL injection guards | `stripOperators`, `escapeRegex` | Implemented |

## 38. External service strategy

See [docs/INTEGRATIONS.md](INTEGRATIONS.md) for setup, dashboard configuration
and webhook endpoints.

| Requirement | Development | Production implementation | Status |
|---|---|---|---|
| Payment abstraction | `MockPaymentProvider` | `StripePaymentProvider` — hosted Checkout, Connect Express, refunds, transfers, signed webhooks | Awaiting credentials |
| Email abstraction | `ConsoleEmailProvider` | `ResendEmailProvider` + 13 branded responsive templates | Awaiting credentials |
| Auth providers | `DevOAuthProvider` | `OpenIdOAuthProvider` — Google and Apple ID tokens | Awaiting credentials |
| Geocoding | `LocalTableGeocodingProvider` | `GoogleGeocodingProvider`, country-filtered, coarsened, with table fallback | Awaiting credentials |
| Video meetings | `MockMeetingProvider` | `ZoomMeetingProvider` — Server-to-Server OAuth, create / move / tear down | Awaiting credentials |
| Document storage | `LocalStorageProvider` | Interface declared; no object-store implementation | Phase 2 |
| Calendar | — | `CalendarProvider` interface declared | Phase 2 |
| Configuration-driven selection | `src/lib/config/env.js`; `APP_ENV` + one `*_PROVIDER` per integration | — | Implemented |
| Production never silently fakes | `PAYMENT_PROVIDER`/`EMAIL_PROVIDER=development` refused under `APP_ENV=production`; a named provider without credentials stops the boot | — | Implemented |
| Start-up validation | `src/instrumentation.js` — warns in development, refuses to boot in production | — | Implemented |
| Operator visibility | Admin → Platform settings → Integrations: provider, mode and recent webhook deliveries | — | Implemented |
| UI unchanged when the real provider lands | All access goes through `get*Provider()`; no service or component names a provider | — | Implemented |

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
| Route checks | 22 public + 40 authenticated pages | All 200 |
| Authorization checks | Anonymous 401, wrong-role 403, cross-account 403 | Enforced |
| Journey checks | `npm run qa` | 88/88 |
| Integration adapters | `npm run test:integrations` | 111/111 |

### Integration adapter coverage

`scripts/integration-tests.mjs` runs the real adapter classes with `fetch`
stubbed, Stripe webhooks signed with the genuine signing scheme, and OAuth
tokens signed by a key pair generated in process. It contacts no third party,
so it is safe to run in CI.

| Area | What is asserted |
|---|---|
| Configuration | Auto-detection in development; production refuses a development payment or email provider, refuses a named provider with missing secrets, and never guesses; the status report contains no secret values |
| Payments | The server-priced amount is what is charged; idempotency keys on checkout, refund and transfer; a raw card is refused; refund carries the policy outcome; Connect accounts start unpayable and are set to manual payouts; only masked bank details come back |
| Webhooks | A wrong secret is rejected; an hour-old signature is rejected; a duplicate delivery changes nothing and is counted as a retry; a mismatched amount is refused and leaves the payment unsettled; a late failure cannot un-pay a settled payment; only card brand and last4 are stored; a dashboard refund reconciles once; unknown events are acknowledged |
| Email | Key travels in a header not a URL; both HTML and text parts are sent; delivery is idempotent; a provider rejection surfaces its reason; an outage does not throw into the calling service; all 13 templates render; template input is HTML-escaped; a security notice carries no token |
| OAuth | A valid token verifies; wrong audience, wrong issuer, tampered signature and a mismatched nonce are all rejected; Apple's string booleans and one-time name are handled; an unconfigured provider refuses rather than trusting |
| Geocoding | A rooftop coordinate is coarsened before it leaves the module; an unknown location, a rejected key and a network failure all degrade to `null`; an outage falls back to the bundled table; distance maths is correct and symmetric |
| Meetings | Server-to-Server auth; correct start time, duration and safety settings; the host `start_url` is never returned or stored; a reschedule PATCHes rather than re-creates; the token is cached; cancellation deletes the room |

---

## Known limitations

Deliberately separated by *why* each one is still open.

### Implemented and verified

Everything above marked **Implemented** runs end to end and is covered by
`npm run qa` (88/88) or `npm run test:integrations` (111/111).

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

### Requires production infrastructure

1. **Rate limiting is in-process.** Adequate for a single instance; a
   multi-instance deployment should move the store to Redis. The call
   signature is designed not to change.
2. **Payouts are created manually by an administrator.** The logic is complete
   and idempotent; production would call `createPayout()` from a scheduled job.
3. **Webhook delivery needs a public URL.** Locally, use
   `stripe listen --forward-to localhost:3000/api/webhooks/payments`.

### Not implemented

1. **Object-store document storage.** Verification documents are written to
   `./.storage/documents` and served only through the audited admin route.
   `StorageProvider` is the interface a production implementation would satisfy;
   it is the one integration with no production adapter yet.
2. **Calendar sync.** `CalendarProvider` is declared and `Availability`
   already stores `externalCalendars`, but nothing implements it (Phase 2).
3. **SMS and push notifications.** The channels exist on the model and in
   `NOTIFICATION_CHANNELS`; only in-app and email are delivered (Phase 2).
4. **Google Meet and Microsoft Teams.** They reach the same `MeetingProvider`
   interface, but each needs a per-host OAuth grant rather than the account
   credential Zoom uses.

### Scope

1. **Only Ontario has curriculum data.** Seven other provinces exist and can
   be opened from the admin curriculum manager; they need course data before
   they are useful.
2. **Development geocoding covers 20 Ontario cities and ~30 forward sortation
   areas.** That is the *fallback* table now, not the only option — setting
   `GEOCODING_PROVIDER=google` removes the limit.
