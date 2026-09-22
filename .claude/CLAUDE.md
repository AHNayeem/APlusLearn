# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

Package manager is **bun** (`bun.lock`, `packageManager: bun@1.3.12`); npm works too.

| Command | Purpose |
|---|---|
| `bun run dev` | Dev server (Turbopack) on http://localhost:3000 |
| `bun run build` / `bun run start` | Production build / serve |
| `bun run lint` | ESLint (`eslint-config-next` core-web-vitals + React Compiler rules) |
| `bun run seed` | Wipe and reseed MongoDB with the Ontario marketplace fixture |
| `bun run seed:keep` | Add only missing seed data |
| `bun run qa` | End-to-end API suite over real HTTP — **requires `bun run dev` running in another terminal** |
| `bun run test:integrations` | Provider adapters and DB-backed service rules, with `fetch` stubbed — no third-party service is contacted |
| `node scripts/pwa-icons.mjs` | Regenerate `public/icons/*` from `public/icon.svg` after a rebrand. Outputs are committed; no build step runs this |

Two suites, no unit-test runner. Both are single sequential scripts with no filter flag —
to run one area, comment out `section(...)` blocks.

- [scripts/qa.mjs](scripts/qa.mjs) drives the real HTTP API against a running dev server
  (`QA_BASE_URL` points it elsewhere) and asserts both success paths and the authorization
  checks that must **fail**.
- [scripts/integration-tests.mjs](scripts/integration-tests.mjs) imports `src/` directly
  through a loader that teaches Node the `@/*` alias, and covers the Stripe/Resend/OAuth/
  geocoding/meeting/storage adapters plus the booking-hold rules. Sections needing MongoDB
  report as skipped without it.

**Both suites own the `integrations` collection for their duration.** Stored admin
configuration overrides the environment by design, so a module configured in the admin
panel would otherwise decide what these suites exercise — `PAYMENT_PROVIDER=development`
stops meaning anything, and the run makes real, billable calls to a real Stripe account.
`test:integrations` removes every stored module and puts it back exactly as it found it;
`qa` clears them before its first assertion and leaves them cleared, because no endpoint
can hand a secret back (that is the feature working), so it cannot restore them. **Run
`qa` against a development database.**

`qa` also consumes one seeded `COMPLETED` lesson per run for the no-show happy path and
cannot recreate one over HTTP — it leaves the last one for the risk section and tells you
to `bun run seed` when the pool runs down.

Setup: `cp .env.example .env.local`, then set `MONGODB_URI` and `AUTH_SECRET`
(≥32 chars, `openssl rand -base64 48`). Everything else has a dev fallback.
Seeded accounts all use password `AplusLearn2024!` (see [README.md](README.md)).

## Architecture

Single Next.js 16 App Router app — JavaScript only, no TypeScript. Import alias `@/*` → `src/*`.

```
Route handler   src/app/api/**/route.js   thin; delegates everything
routeHandler    src/lib/api/handler.js    db → auth → role → permission → validation
Service         src/services/*.service.js all business logic
Model           src/models/*.js           Mongoose schemas + indexes
```

### Two ways into a service — never fetch your own API

- **API routes** wrap the handler in `routeHandler(fn, { auth, roles, permission, bodySchema, querySchema, paramsSchema, database })` from [src/lib/api/handler.js](src/lib/api/handler.js). The options *are* the endpoint's contract; do not hand-roll checks inside the handler body.
- **Server Component pages** call the same services directly after `enforceRole(...)` / `enforceAuth(...)` from [src/lib/auth/guards.js](src/lib/auth/guards.js), plus `connectToDatabase()`. See [src/app/(dashboard)/bookings/page.js](src/app/(dashboard)/bookings/page.js) for the canonical shape.
- **Client components** use the browser client in [src/lib/api/client.js](src/lib/api/client.js), which unwraps the envelope and throws `ApiError` (with `.fieldErrors` ready for forms), usually via the `useAsync` hook.

Guard naming: `require*` throws typed errors (API/services); `enforce*` redirects (pages).

### Response envelope and errors

Every endpoint returns `{ ok: true, data, meta? }` or `{ ok: false, error: { code, message, details? } }`
via [src/lib/api/response.js](src/lib/api/response.js) (`ok`, `created`, `noContent`, `fail`, `paginationMeta`).
Services throw the typed errors in [src/lib/api/errors.js](src/lib/api/errors.js)
(`NotFoundError`, `AuthorizationError`, `ConflictError`, `BusinessRuleError`, …);
`failFromError` maps those plus Mongo duplicate-key/CastError to statuses. Never build
ad-hoc JSON responses, and never let a raw driver error reach the client.

### Rules the code holds to

- **Single implementation of each business rule.** Pricing only in [src/lib/booking/pricing.js](src/lib/booking/pricing.js); every cancellation path (student, tutor, admin, dispute) resolves through [src/lib/booking/policy.js](src/lib/booking/policy.js), which also owns whether an unpaid booking may give its slot back (`shouldReleaseHold`, `failureReleasesHold`). Don't add a second calculation.
- **`PENDING_PAYMENT` holds a slot; `EXPIRED` does not.** An unpaid booking blocks the tutor's calendar for `Settings.checkoutHoldMinutes` (default [`CHECKOUT_HOLD`](src/constants/config.js)), after which the `booking-expiry` job releases it. Anything that adds a booking status must decide deliberately whether it belongs in `BLOCKING_BOOKING_STATUSES`.
- **Scheduled work is one registry.** Jobs are registered in [src/services/scheduler.service.js](src/services/scheduler.service.js) and invoked through `/api/cron/<job>`; each claims its work atomically so overlapping runs are safe. Add to the registry and to `vercel.json`, not to a second scheduler. No read path may *depend* on a job having run — `promotion-expiry` is the clearest case: discovery derives whether a promotion is live from the clock on every request, and the job only settles the stored record.
- **Promotion reorders discovery; it never widens it.** [src/lib/search/promotion.js](src/lib/search/promotion.js) is the whole rule. A promoted read applies the identical filter the visitor's search built, so an ineligible tutor can never be promoted into results. Promotion applies to the default `RELEVANCE` ordering only — an explicit sort is the visitor's instruction — and every promoted result is labelled. Neither of those two is a setting.
- **Analytics are aggregated in MongoDB, from payments.** Money comes from `Payment` on `paidAt`, never from summing booking prices (which counts abandoned checkouts as revenue). Refunds are subtracted pro rata per payment, and referral credit is a platform cost, not a discount. Periods are half-open and time-zone aware via [src/lib/analytics/range.js](src/lib/analytics/range.js). Never reduce a figure from a paged array.
- **Risk detects; it never punishes.** [src/services/risk.service.js](src/services/risk.service.js) is the only place fraud logic lives. Every signal carries a `dedupeKey` derived from the event, so replays record once, and every call site uses `safelyRecordRiskSignal` so detection can never break the action being taken. No score restricts an account — an administrator does, from user management.
- **The client supplies intent, never state.** Amounts, commission and statuses are derived server-side from stored data. `bun run qa` asserts an injected `price` or `status` is ignored.
- **Ownership is checked against the loaded DB record**, never a request field (`requireOwnership`, `requireParticipant`, `ownsOrAdmin`).
- **`isSearchable` is derived**, not client-set — it gates every public tutor query, so an unapproved profile cannot surface in search.
- **Privacy defaults:** public pages show first name + last initial (`publicName`), learner surnames are masked from tutors unless opted in, in-person addresses release only after confirmation, verification documents are served only through the audited admin route.
- Roles and permissions live in [src/constants/roles.js](src/constants/roles.js) and are enforced server-side; frontend guards are UX only.
- Services and anything under `lib/auth`, `lib/db` start with `import "server-only"`.

### Data boundary

Mongoose results must pass through `toPlain()` ([src/lib/utils/serialize.js](src/lib/utils/serialize.js))
before crossing to Client Components — it converts ObjectIds/Dates/Decimal128 and adds `id`.
Services already do this; keep it that way. Import models from `@/models` (the barrel) so every
schema is registered before any `populate()`. The Mongo connection is memoised on `globalThis`
in [src/lib/db/connect.js](src/lib/db/connect.js).

### Validation

Zod 4 schemas live in [src/lib/validation/](src/lib/validation/) and are shared between route
options and the page-level `searchParams` parsing. Add the schema there rather than validating inline.

### External services

Each integration in [src/services/external/](src/services/external/) is an abstract class + a
working development implementation + an **async** `get*Provider()` factory
(`MockPaymentProvider`, `ConsoleEmailProvider`, deterministic meeting links, bundled Canadian
geocoding table, `LocalStorageProvider` under `.storage/`). Wiring a real provider means
implementing the interface and returning it from the factory — no service or UI change.

**Two layers of configuration, and they answer different questions.**
[src/lib/config/env.js](src/lib/config/env.js) is the deployment-level truth — which providers
this build knows, and which may run as a fake: production never guesses, and `development` is
refused for payments, email and storage. [src/lib/config/integrations.js](src/lib/config/integrations.js)
is the runtime, database-aware view that every factory resolves through:

```
built-in defaults  →  environment variables  →  stored admin configuration
```

merged **per field**, so a deployment that has never opened the admin panel behaves exactly as
before. The guards do not bend: no stored row can select a fake for payments/email/storage in
production, and a credential that will not decrypt is an explicit error state — never a silent
fallback to the environment.

The factories are `async` because of this. Five of them — email, payment, sms, calendar, storage
— so every call site does `await (await getXProvider()).method()`. `env.js` stays synchronous for
the boot gate, which must not depend on a database round-trip.

### Admin-configurable modules

Five integrations are operator-editable at `/admin/settings/integrations`: email (Resend or SMTP),
payment (Stripe), calendar (Google/Outlook app registration), SMS (Twilio), storage (S3/MinIO).

- **One registry drives everything** — [src/constants/integrations.js](src/constants/integrations.js)
  declares each module, provider, field, kind, secrecy and env fallback. The Zod schemas, the
  Mongoose sub-documents, the masking and the admin form are all derived from it. Add a provider
  there, not in eight files.
- **Credentials live in their own collection**, never in `Settings` — that document is memoised
  and reaches client components as branding, so a key kept there would be one prop from a browser.
  `Integration.secrets` is AES-256-GCM encrypted under the `aplus:integration-secret` label and
  `select: false`.
- **Secrets are write-only.** No endpoint returns one. An omitted secret on PATCH keeps what is
  stored; `null` clears it. Only the Stripe secret key reveals a last-4.
- **Status is a claim, and it is narrow.** Filled-in fields get `CONFIGURED`; only a real provider
  round-trip gets `CONNECTED`, recorded against the provider it ran for.
- **`enabled` has runtime teeth** — payments refuse checkout, email/SMS record a skip, calendar
  sync no-ops, storage refuses uploads **but still serves reads** (breaking retrieval of identity
  documents is an incident, not a setting).
- `DELETE` hands a module back to the environment; `POST` imports the environment's values.
- Permission is `ADMIN_INTEGRATION_MANAGE`, held apart from `ADMIN_SETTINGS_MANAGE`.

Two integrations are shaped slightly differently and it matters:

- **Meeting links** may have several adapters live at once, because §27 lets a learner pick a
  platform per booking. `MEETING_PROVIDER` takes a comma-separated list and
  `getMeetingProvider(provider)` takes the `MEETING_PROVIDERS` value stored on the booking.
- **Storage** has two scopes (`documents`, `branding`) and never returns a URL — bytes are
  fetched server-side and streamed through an authorised route.

Dev test cards: `4242 4242 4242 4242` succeeds, anything ending `0002` is declined.

Run the dev server with `PAYMENT_PROVIDER=development` when working on Phase 2
features — the repository's Stripe test credentials are not valid, and a real
Stripe call failing mid-suite takes `bun run qa` down with it rather than
failing one assertion.

### UI

Tailwind v4 with design tokens in [src/app/globals.css](src/app/globals.css); primitives in
[src/components/ui/](src/components/ui/) (import from the barrel). React Compiler is on
(`reactCompiler: true`), so avoid manual memoisation and respect the compiler lint rules —
e.g. no ref writes during render (see the note in [src/hooks/useAsync.js](src/hooks/useAsync.js)).

## Documentation

[docs/Project.md](docs/Project.md) is the source requirement document; its numbered sections
(`§6`, `§42`, …) are cited throughout the code comments.
[docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) is the coverage matrix mapping each requirement to
its implementation and status — update it when behaviour changes.
[APLUS_LEARN_PHASE2_IMPLEMENTATION_AUDIT.md](APLUS_LEARN_PHASE2_IMPLEMENTATION_AUDIT.md) audits all
twelve §41 Phase 2 features, and is where the specification gaps and their
configurable defaults are listed.
[docs/PWA.md](docs/PWA.md) covers the service worker: its caching allowlist,
what is deliberately never cached, offline behaviour and the update strategy.

**The service worker is an allowlist, and `/api/**` is refused first and
unconditionally.** A request matching no rule is never passed to `respondWith`
at all. Navigations are network-only and never stored; `/offline` is the single
HTML document in any cache, and it is fetched with `credentials: "omit"`.
Anything that would cache a new kind of response has to answer why it is not
somebody's booking, payment, message or verification document. The API envelope
(`ok`/`fail`/`noContent`) sends `Cache-Control: no-store` for the same reason;
the binary routes that build a `Response` directly keep their own headers.
