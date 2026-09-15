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

`npm run qa` exercises the full parent, tutor and admin journeys over real
HTTP — including the authorization checks that must *fail*. Run `npm run dev`
in one terminal and `npm run qa` in another.

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
│   └── api/           100 route handlers
├── components/
│   ├── ui/            18 design-system primitives
│   └── …              feature components by domain
├── lib/
│   ├── api/           request pipeline, typed errors, response envelope
│   ├── auth/          sessions, password hashing, guards
│   ├── booking/       pricing, cancellation policy, slot generation
│   ├── matching/      tutor ↔ request scoring
│   ├── search/        query construction
│   ├── security/      rate limiting, input sanitising
│   └── db/            cached MongoDB connection
├── services/          19 domain services + external provider abstractions
├── models/            14 model files
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

Every integration sits behind an interface with a working development
implementation, so the application is fully functional with no third-party
credentials:

| Service | Development fallback | Production |
|---|---|---|
| Payments | `MockPaymentProvider` — models every state transition | Stripe Connect |
| Email | `ConsoleEmailProvider` — prints links to the server log | Any transactional provider |
| OAuth | Local identity (non-production only) | Google / Apple |
| Meetings | Deterministic room links | Zoom / Meet / Teams |
| Geocoding | Bundled Canadian city & FSA table | Maps provider |
| Document storage | Private local directory | Object storage |

Connecting a real provider means implementing the interface and returning it
from the corresponding `get*Provider()`. No UI or service code changes.

**Test cards** (development payment provider): `4242 4242 4242 4242` succeeds;
any number ending `0002` exercises the declined-card path.

---

## Documentation

- [`docs/Project.md`](docs/Project.md) — the original requirement document
- [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) — coverage matrix mapping every
  requirement to its implementation, with status and known limitations

---

## Tech

Next.js 16 (App Router, Turbopack) · React 19.2 with the React Compiler ·
JavaScript only · Tailwind CSS v4 · MongoDB with Mongoose 9 · Zod 4 ·
jose · bcrypt · motion
