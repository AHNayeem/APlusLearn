# APlus Learn

A Canada-focused tutoring marketplace. Families search for tutors by the exact
provincial course on their child's timetable — MHF4U, not "math" — compare
verified tutors, message them free, and book lessons online or in person.

Built as a single Next.js application: frontend, API, business logic and
database access in one repository, with no separate backend.

---

## Quick start

Requires **Node 20+** and a **MongoDB** instance (local is fine).

```bash
npm install
cp .env.example .env.local     # then set AUTH_SECRET — see below
npm run seed                   # realistic Ontario marketplace data
npm run dev                    # http://localhost:3000
```

Generate a session signing key:

```bash
openssl rand -base64 48
```

### Seeded accounts

All use the password `AplusLearn2024!`

| Role | Email |
|---|---|
| Administrator | `admin@apluslearn.ca` |
| Parent | `jennifer.chen@example.com` |
| Tutor | `priya.sharma@example.com` |
| Student (self-serve) | `nadia.petrov@example.com` |
| Tutor awaiting approval | `james.oconnor@example.com` |

The seed creates 12 approved tutors, 38 real Ontario courses, 54 bookings, 18
written reviews, live conversations, an open tutor request and one application
sitting in the admin review queue.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | ESLint, including the React Compiler rules |
| `npm run seed` | Wipe and reseed the database |
| `npm run seed:keep` | Add missing seed data without wiping |
| `npm run storage:check` | Prove the MinIO credentials open the bucket (`--roundtrip` also writes, reads and deletes) |
| `npm run storage:migrate` | Copy `.storage/**` into the MinIO bucket (`--dry-run` to preview) |
| `npm run qa` | End-to-end API test suite against a running dev server (1,149 assertions) |
| `npm run e2e` | Forgot password in a real browser, against a running dev server — needs Playwright, see [docs/PASSWORD_RESET.md](docs/PASSWORD_RESET.md) |
| `npm run test:integrations` | Provider adapters and DB-backed service rules (1,719 assertions) — no network, no third party |

`npm run qa` exercises the full parent, tutor and admin journeys over real
HTTP — including the authorization checks that must *fail*. Run `npm run dev`
in one terminal and `npm run qa` in another.

`npm run test:integrations` runs the Stripe, Resend, Google/Apple sign-in, geocoding and Zoom
adapters with `fetch` stubbed, webhooks signed with the real signing scheme and
OAuth tokens signed by a key pair generated in process — plus the business
rules only a direct call can reach: the dispute lifecycle, curriculum,
booking slot claims, rate-limit windows and the audit log's redaction. It
contacts nothing external, so it is safe in CI.

Both suites take over the `integrations` collection for their duration, and
`qa` leaves it cleared, so point them at a development database.

---

## Architecture

```
Request
  ↓
Route handler          src/app/api/**/route.js      thin; delegates everything
  ↓
routeHandler pipeline  src/lib/api/handler.js       auth → role → permission → validation
  ↓
Service                src/services/*.service.js    all business logic lives here
  ↓
Model                  src/models/*.js              Mongoose schemas and indexes
  ↓
MongoDB
```

```
src/
├── app/
│   ├── (public)/      marketplace, marketing, SEO landing pages
│   ├── (auth)/        login, register, verification, password reset
│   ├── (dashboard)/   parent & student area
│   ├── tutor/         tutor workspace
│   ├── admin/         admin console
│   └── api/           103 route handlers
├── components/
│   ├── ui/            18 design-system primitives
│   └── …              feature components by domain
├── lib/
│   ├── api/           request pipeline, typed errors, response envelope
│   ├── auth/          sessions, password hashing, guards
│   ├── booking/       pricing, cancellation policy, slot generation
│   ├── images/        uploaded-image inspection and validation
│   ├── matching/      tutor ↔ request scoring
│   ├── search/        query construction
│   ├── theme/         configured colours → design-system tokens
│   ├── config/        runtime configuration and provider selection
│   ├── security/      rate limiting, input sanitising
│   └── db/            cached MongoDB connection
├── services/          21 domain services + external provider abstractions
├── models/            16 model files
└── constants/         roles, permissions, domain enums, platform defaults
```

### Principles the code holds to

**Business rules live in one place.** Pricing is only ever computed by
`lib/booking/pricing.js`; every cancellation — student, tutor, admin, dispute —
resolves through `lib/booking/policy.js`. There is no second implementation to
drift.

**The client supplies intent, never state.** A booking request carries who,
what and when. Prices, commission and status are derived server-side from
stored data. The QA suite asserts that an injected `price` or `status` is
ignored.

**Authorization is structural.** `isSearchable` is derived and gates every
public tutor query, so an unapproved profile cannot appear in search regardless
of what else is true. Ownership is always checked against the loaded database
record, never against a request field.

**Privacy is the default.** Public pages show a first name and last initial.
A learner's surname is masked from tutors unless a parent opts in. An
in-person address is released only to the two parties, only once the lesson is
confirmed. Verification documents are stored outside anything publicly
reachable and served only through an audited admin route. A learner's
analytics resolve one of three views — the family's, an administrator's, or a
tutor's own teaching — from stored records rather than from the request, so a
tutor is never shown what the household paid or which other tutors it uses.

**A shared file is reached by id, never by key.** Message attachments and the
worksheets a tutor attaches to a progress report are sub-documents of the
record that says who may read them, so the file and its audience load
together. The storage key is `select: false` and never leaves the server: a
reader asks for an attachment by id, through a route that checks them against
the conversation or the report. A file's type is decided by reading its bytes,
not by believing the browser.

**Configuration is not code, and secrets are not configuration.** Everything an
operator might reasonably change — the application's name, logo, colours,
metadata, contact details, marketplace rules and which features exist — lives
in one admin-editable document. Everything that is a credential lives in the
environment. The line between them is deliberate and one-directional: settings
never hold a secret, and the admin panel reports integration status without
ever being able to edit it.

---

## Platform settings

**Admin → Platform settings** (requires the `ADMIN_SETTINGS_MANAGE` permission)
configures the application without a deployment:

| Section | What it controls |
|---|---|
| General | Application name, short name, tagline, description |
| Branding | Logo, dark-background logo, favicon, Apple touch icon, social preview image |
| Appearance | Primary, accent, semantic, surface and footer colours |
| SEO | Site title, title suffix, meta description, keywords, Open Graph, canonical base URL, indexing switch |
| Contact | Support and general email, phone, address, business and support hours |
| Social | Facebook, Instagram, LinkedIn, YouTube, X |
| Footer | Description, copyright line, social / newsletter / app-badge visibility |
| Marketplace | Commission, cancellation and no-show policy, booking notice and horizon, rate guard rails, payout hold, search radius, review moderation |
| Features | Messaging, tutor requests, saved tutors, reviews, online / in-person lessons (Google / Apple sign-in are switched in **External modules → Social sign-in**) |
| Notifications | Master email switch plus booking, application, review, payout and announcement categories |

A few properties worth knowing:

- **Colours become design tokens, not inline styles.** A chosen colour is
  expanded into the same `@theme` scale names `globals.css` already declares,
  so components keep using `bg-brand-600` and never learn a colour was
  configured. An untouched palette emits no CSS at all.
- **Accessibility is enforced, not suggested.** The primary and footer colours
  must clear AA contrast against white text; accent and semantic colours must
  be legible against white *or* ink; page and card grounds must carry the dark
  body text. A colour that fails is refused server-side.
- **Feature flags are real.** A disabled feature is refused by its API
  endpoints — the flag is checked in the request pipeline, right after the
  permission check — not merely hidden in the navigation.
- **Page-specific SEO still wins.** Tutor, course and city pages generate their
  own titles, descriptions and canonicals; the global settings are only the
  default for what a page does not state for itself.
- **Everything has a safe fallback.** With no logo, the drawn wordmark renders.
  With no database, the shipped identity renders. A blank social link is not a
  broken icon; it is no icon.
- **Uploads are checked by their bytes.** Format comes from the file's magic
  number rather than its declared type, with size and dimension bounds per
  asset. SVG is refused — it is a script-capable document, not a picture.
- **Every change is audited**, field by field, old value beside new — and readable at
  Admin → Audit log, filtered by action, actor, entity or date. Credential values are
  redacted on the way out, so a rotation shows *which* key changed and who changed it.

What is deliberately *not* configurable — provider credentials, tutor approval
before appearing in search, security email, the rating scale, the legal text
itself — and why, is listed in
[`docs/REQUIREMENTS.md` §26b](docs/REQUIREMENTS.md).

---

## External services

Every integration sits behind an interface with both a working development
implementation and a production adapter. The application is fully functional
with no third-party credentials, and connecting a real provider is
configuration rather than code.

| Service | Development | Production | Selector |
|---|---|---|---|
| Payments | `MockPaymentProvider` — models every state transition | **Stripe** — hosted Checkout + Connect Express | `PAYMENT_PROVIDER` |
| Email | `ConsoleEmailProvider` — prints to the server log and keeps a development mailbox at `/dev/mail` | **Resend** / SMTP | `EMAIL_PROVIDER` |
| Social sign-in | Local identity (non-production only) | **Google / Apple** — authorization-code flow, configured in **Admin → External modules → Social sign-in** | none required |
| Geocoding | Bundled Canadian city & FSA table | **Google Geocoding API** | `GEOCODING_PROVIDER` |
| Meetings | Deterministic room links | **Zoom** — Server-to-Server OAuth | `MEETING_PROVIDER` |
| File storage | Private local directory under `.storage/` | **MinIO** — S3-compatible object storage | `STORAGE_PROVIDER` |

```
APP_ENV=development   auto-detect: whatever has credentials is used,
                      everything else falls back to a working fake.

APP_ENV=production    nothing is auto-detected. Every selector must name a
                      provider, and naming a real one without its secrets
                      stops the server starting.
```

`PAYMENT_PROVIDER`, `EMAIL_PROVIDER` and `STORAGE_PROVIDER` all refuse
`development` once `APP_ENV=production`: there is no configuration in which a
production deployment takes fake money, silently swallows a password-reset
email, or accepts a tutor's identity document onto a disk that will not exist
on the next request. Which mode each integration is running in is shown at
**Admin → Platform settings → Integrations**, alongside recent webhook
deliveries.

Setup, credentials, webhook endpoints and external dashboard configuration:
**[`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)**.

---

## Scheduled jobs

Lesson reminders, verification badge expiry, tutor payouts and tutor-request
expiry only happen because something calls them. They are reached through one
authenticated endpoint, so no queue or worker process is needed:

| Job | Path | Suggested schedule |
|---|---|---|
| Lesson reminders | `/api/cron/booking-reminders` | every 15 minutes |
| Verification expiry | `/api/cron/verification-expiry` | daily |
| Tutor payouts | `/api/cron/payouts` | daily |
| Tutor request expiry | `/api/cron/request-expiry` | daily |
| External calendar sync | `/api/cron/calendar-sync` | every 15 min |
| All of the above | `/api/cron/all` | daily |

Authenticate with `Authorization: Bearer $CRON_SECRET`; a signed-in
administrator can also run a job by hand. **Leaving `CRON_SECRET` unset closes
the token route rather than opening it** — but it also means nothing is
scheduled, so set it on any deployment you expect to behave.

Every job is idempotent: running one twice, or catching up after an outage,
produces the same result as running it once. Pick any scheduler —
[`vercel.json`](vercel.json) declares the Vercel Cron entries, and a crontab,
Kubernetes CronJob or CI workflow issuing the same request works identically.

```bash
# What is registered, and how often each one wants to run
curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/list
```

**Test cards** (development payment provider): `4242 4242 4242 4242` succeeds;
any number ending `0002` exercises the declined-card path. Under Stripe the
card is entered on Stripe's own page — use their test cards instead.

---

## Running the real integrations locally

The application is fully functional with no third-party credentials. These
steps are for exercising the two integrations that handle money and
identity documents against their actual services.

### MinIO file storage

```bash
# 1. .env.local — the S3 API root, not the MinIO console
STORAGE_PROVIDER="minio"
STORAGE_ENDPOINT="https://minio.example.com"
STORAGE_BUCKET="aplus-learn"
STORAGE_ACCESS_KEY="…"
STORAGE_SECRET_KEY="…"
STORAGE_PREFIX="dev"          # optional; keeps environments apart in one bucket
# STORAGE_SSE                 leave unset: MinIO refuses per-object SSE without a KMS

# 2. Prove it before trusting it with anything
bun run storage:check --roundtrip

# 3. If you already have files under .storage/, copy them across.
#    `storageKey` in the database is the object's filename, so nothing in
#    Mongo changes and nothing local is deleted.
bun run storage:migrate --dry-run
bun run storage:migrate

# 4. Restart, then exercise it through the UI:
#    Tutor → Verification → upload a PDF
#    Admin → Verification → open that document (streamed, never linked)
#    Admin → Platform settings → Branding → upload and replace a logo
```

The bucket must be private. Nothing in the application hands out an object
URL, and there is no presigned-URL path — bytes are streamed through routes
that have already authorised the caller.

### Stripe test mode

```bash
# 1. .env.local — test keys only; the key's prefix decides the mode, not APP_ENV
PAYMENT_PROVIDER="stripe"
STRIPE_SECRET_KEY="sk_test_…"

# 2. Forward Stripe's webhooks to the dev server. Copy the whsec_… it prints
#    into STRIPE_WEBHOOK_SECRET and restart.
stripe listen --forward-to localhost:3000/api/webhooks/payments

# 3. Book a lesson as a parent. Checkout is hosted by Stripe:
#    4242 4242 4242 4242   succeeds
#    4000 0000 0000 0002   declined
#    4000 0025 0000 3155   requires 3-D Secure
```

**Without a webhook secret a hosted payment cannot be confirmed at all.** The
browser returning from Stripe lands on a page that polls and waits; only the
verified webhook settles the payment and confirms the lesson. That is
deliberate — a browser saying "it worked" is not evidence that it did.

No publishable key is needed: the purchaser is redirected to Stripe's own
page, so no Stripe code runs in the browser.

---

## Documentation

- [`docs/Project.md`](docs/Project.md) — the original requirement document
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — coverage matrix mapping every
  requirement to its implementation, with status and known limitations
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — production integrations:
  providers, environment variables, webhook endpoints, OAuth callback
  configuration and deployment requirements
- [`docs/PWA.md`](docs/PWA.md) — installability, the service worker's caching
  allowlist, offline behaviour, the update strategy, and what is deliberately
  never cached

---

## Tech

Next.js 16 (App Router, Turbopack) · React 19.2 with the React Compiler ·
JavaScript only · Tailwind CSS v4 · MongoDB with Mongoose 9 · Zod 4 ·
jose · bcrypt · motion · Stripe
