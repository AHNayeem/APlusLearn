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
| `npm run qa` | End-to-end API test suite against a running dev server |
| `npm run test:integrations` | Provider adapter tests — no network, no third party |

`npm run qa` exercises the full parent, tutor and admin journeys over real
HTTP — including the authorization checks that must *fail*. Run `npm run dev`
in one terminal and `npm run qa` in another.

`npm run test:integrations` runs the Stripe, Resend, OAuth, geocoding and Zoom
adapters with `fetch` stubbed, webhooks signed with the real signing scheme and
OAuth tokens signed by a key pair generated in process. It contacts nothing
external, so it is safe in CI.

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
│   └── api/           101 route handlers
├── components/
│   ├── ui/            18 design-system primitives
│   └── …              feature components by domain
├── lib/
│   ├── api/           request pipeline, typed errors, response envelope
│   ├── auth/          sessions, password hashing, guards
│   ├── booking/       pricing, cancellation policy, slot generation
│   ├── matching/      tutor ↔ request scoring
│   ├── search/        query construction
│   ├── config/        runtime configuration and provider selection
│   ├── security/      rate limiting, input sanitising
│   └── db/            cached MongoDB connection
├── services/          20 domain services + external provider abstractions
├── models/            15 model files
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
reachable and served only through an audited admin route.

---

## External services

Every integration sits behind an interface with both a working development
implementation and a production adapter. The application is fully functional
with no third-party credentials, and connecting a real provider is
configuration rather than code.

| Service | Development | Production | Selector |
|---|---|---|---|
| Payments | `MockPaymentProvider` — models every state transition | **Stripe** — hosted Checkout + Connect Express | `PAYMENT_PROVIDER` |
| Email | `ConsoleEmailProvider` — prints links to the server log | **Resend** | `EMAIL_PROVIDER` |
| OAuth | Local identity (non-production only) | **Google / Apple** — verified ID tokens | `OAUTH_PROVIDER` |
| Geocoding | Bundled Canadian city & FSA table | **Google Geocoding API** | `GEOCODING_PROVIDER` |
| Meetings | Deterministic room links | **Zoom** — Server-to-Server OAuth | `MEETING_PROVIDER` |
| Document storage | Private local directory | *(interface only)* | — |

```
APP_ENV=development   auto-detect: whatever has credentials is used,
                      everything else falls back to a working fake.

APP_ENV=production    nothing is auto-detected. Every selector must name a
                      provider, and naming a real one without its secrets
                      stops the server starting.
```

`PAYMENT_PROVIDER=development` and `EMAIL_PROVIDER=development` are refused
outright once `APP_ENV=production`: there is no configuration in which a
production deployment takes fake money or silently swallows a password-reset
email. Which mode each integration is running in is shown at
**Admin → Platform settings → Integrations**, alongside recent webhook
deliveries.

Setup, credentials, webhook endpoints and external dashboard configuration:
**[`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)**.

**Test cards** (development payment provider): `4242 4242 4242 4242` succeeds;
any number ending `0002` exercises the declined-card path. Under Stripe the
card is entered on Stripe's own page — use their test cards instead.

---

## Documentation

- [`docs/Project.md`](docs/Project.md) — the original requirement document
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — coverage matrix mapping every
  requirement to its implementation, with status and known limitations
- [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md) — production integrations:
  providers, environment variables, webhook endpoints, OAuth callback
  configuration and deployment requirements

---

## Tech

Next.js 16 (App Router, Turbopack) · React 19.2 with the React Compiler ·
JavaScript only · Tailwind CSS v4 · MongoDB with Mongoose 9 · Zod 4 ·
jose · bcrypt · motion · Stripe
