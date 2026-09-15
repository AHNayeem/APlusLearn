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

`scripts/qa.mjs` is the only test suite; there is no unit-test runner. It is a single
sequential script with no filter flag — to run one area, comment out `section(...)`
blocks in [scripts/qa.mjs](scripts/qa.mjs) or point it elsewhere with `QA_BASE_URL`.
It asserts both success paths and the authorization checks that must **fail**.

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

- **Single implementation of each business rule.** Pricing only in [src/lib/booking/pricing.js](src/lib/booking/pricing.js); every cancellation path (student, tutor, admin, dispute) resolves through [src/lib/booking/policy.js](src/lib/booking/policy.js). Don't add a second calculation.
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
working development implementation + a `get*Provider()` factory that picks based on env vars
(`MockPaymentProvider`, `ConsoleEmailProvider`, deterministic meeting links, bundled Canadian
geocoding table, local document storage under `.storage/`). Wiring a real provider means
implementing the interface and returning it from the factory — no service or UI change.
Dev test cards: `4242 4242 4242 4242` succeeds, anything ending `0002` is declined.

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
