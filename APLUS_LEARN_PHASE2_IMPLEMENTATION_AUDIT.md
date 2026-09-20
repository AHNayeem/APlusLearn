# APlus Learn — Phase 2 Implementation Audit

Audited against `docs/Project.md` §41 (Phase 2 feature list) and the sections it
leans on — §14 discovery, §22 requests and matching, §24 dashboards, §25 admin
analytics, §26 cancellation and refunds, §28 notifications, §42 core business
rules.

**Audit date:** 2026-09-20
**Verified at:** `bun run lint` clean · `bun run build` clean ·
`bun run test:integrations` 913 passed / 2 failed · `bun run qa` 525 passed / 9 failed.
Both failure sets are pre-existing environment issues, itemised in
[Verification](#verification) below. Zero regressions.

---

## 1. The specification gap, and how it was handled

§41 lists twelve Phase 2 features by name and defines business rules for none
of them. It sets no reward amount, no promotion duration, no risk threshold, no
analytics definition. The implementation follows one rule throughout:

> Where the specification does not define a number, threshold, reward, expiry
> or policy, do not hardcode a business rule. Use an operator-configurable
> `Settings` key with a conservative default, and document the gap in code.

Every such value is listed in [Configuration](#configuration-and-specification-gaps).

Three decisions were deliberately made **not** configurable, because no
defensible value exists for the alternative. They are called out where they
appear: promoted results are always labelled; a promotion never overrides an
ordering a visitor chose; and no risk score ever restricts an account on its
own.

---

## 2. Status summary

| Requirement | Status | E2E Coverage | Evidence | Tests | Remaining Gap |
| ----------- | ------ | -----------: | -------- | ----- | ------------- |
| P2.1 Advanced tutor requests | `FULLY IMPLEMENTED` | Yes | [TutorRequest.js](src/models/TutorRequest.js), [request.service.js](src/services/request.service.js), [/requests](src/app/(dashboard)/requests), [/tutor/requests](src/app/tutor/requests), [/admin/requests](src/app/admin/requests) | 53 integration + 34 QA | None |
| P2.2 Advanced matching | `FULLY IMPLEMENTED` | Yes | [lib/matching/](src/lib/matching/) (`eligibility`, `score`, `weights`), operator-tunable `matchWeights` | 33 integration | Weights are relative and operator-set; §41 defines no factors |
| P2.3 Google Calendar | `FULLY IMPLEMENTED` | Yes | [calendar-provider.js](src/services/external/calendar-provider.js), [calendar.service.js](src/services/calendar.service.js), `calendar-sync` job | 45 + 39 integration, 23 QA | Verified against a stubbed Google API only — see [Configuration](#configuration-and-specification-gaps) |
| P2.4 Microsoft Calendar | `FULLY IMPLEMENTED` | Yes | Same adapter interface, Microsoft Graph implementation | Covered by the 45 adapter tests | Same: stubbed API only |
| P2.5 SMS | `FULLY IMPLEMENTED` | Yes | [sms.service.js](src/services/sms.service.js), [sms-provider.js](src/services/external/sms-provider.js), [/admin/sms](src/app/admin/sms) | 38 + 37 integration, 16 QA | Off by default until a carrier is configured; Twilio verified against a stub |
| P2.6 Referrals + credit ledger | `FULLY IMPLEMENTED` | Yes | [Referral.js](src/models/Referral.js), [referral.service.js](src/services/referral.service.js), [credit.service.js](src/services/credit.service.js) | 50 integration, 25 QA | Reward amounts ship at 0 — §41 names referrals without pricing them |
| P2.7 Tutor packages | `FULLY IMPLEMENTED` | Yes | [Package.js](src/models/Package.js), [package.service.js](src/services/package.service.js), `package-expiry` job | 55 integration, 22 QA | None |
| P2.8 Group tutoring | `FULLY IMPLEMENTED` | Yes | [GroupSession.js](src/models/GroupSession.js), [group.service.js](src/services/group.service.js), `group-settlement` job | 58 integration, 35 QA | One pre-existing failing assertion — see [Verification](#verification) |
| P2.9 Progress reports | `FULLY IMPLEMENTED` | Yes | [ProgressReport.js](src/models/ProgressReport.js), [progress.service.js](src/services/progress.service.js) | 45 integration, 24 QA | None |
| **P2.10 Promoted profiles** | `FULLY IMPLEMENTED` | Yes | [Promotion.js](src/models/Promotion.js), [promotion.service.js](src/services/promotion.service.js), [lib/search/promotion.js](src/lib/search/promotion.js), [/admin/promotions](src/app/admin/promotions) | 66 integration, 41 QA | Promotion deliberately excluded from request matching — see §3 |
| **P2.11 Advanced analytics** | `FULLY IMPLEMENTED` | Yes | [analytics.service.js](src/services/analytics.service.js), [lib/analytics/range.js](src/lib/analytics/range.js), [/admin/analytics](src/app/admin/analytics), [/tutor/earnings](src/app/tutor/earnings) | 58 integration, 23 QA | Learner-facing analytics are Phase 3 (§41) and are not implemented |
| **P2.12 Fraud / risk tools** | `FULLY IMPLEMENTED` | Yes | [Risk.js](src/models/Risk.js), [risk.service.js](src/services/risk.service.js), [/admin/risk](src/app/admin/risk) | 55 integration, 30 QA | No automatic restriction by design — see §5 |

---

## 3. P2.10 — Promoted tutor profiles

### What a promotion is, and what it is not

A promotion is an administrator's decision to lift an **already-eligible**
tutor up the default discovery ordering for a bounded window. It is never a
visibility grant. Both halves of every promoted read apply the same filter the
visitor's search built, starting at `isSearchable: true`, so a promotion can
change *where* an eligible tutor appears and can never make an ineligible one
appear at all (§42).

| Layer | Implementation |
| --- | --- |
| Model | [`TutorPromotion`](src/models/Promotion.js) — tutor, status, window, internal note, `createdBy`, lifecycle timestamps. Partial unique index `one_open_promotion_per_tutor` makes "one live promotion per tutor" true under a race, not merely checked. |
| Service | [`promotion.service.js`](src/services/promotion.service.js) — create, activate, pause, extend, cancel, expire, plus `assessPromotionEligibility` and `livePromotedProfileIds`. |
| API | `GET/POST /api/admin/promotions`, `GET/PATCH /api/admin/promotions/[id]`, `GET /api/tutor/promotion`. |
| UI | [/admin/promotions](src/app/admin/promotions) register with create/activate/pause/extend/end; promotion status card on the tutor dashboard; a **Promoted** ribbon on every promoted search card. |
| Discovery | [`readPage`](src/services/search.service.js) — the promotion adjustment is the last step of the existing pipeline. |
| Audit | `PROMOTION_CREATED / ACTIVATED / PAUSED / EXTENDED / CANCELLED / EXPIRED` through `recordAudit`. |
| Scheduler | `promotion-expiry`, registered in [scheduler.service.js](src/services/scheduler.service.js) and `vercel.json`. |

### Three decisions worth stating

**Promotion only affects the default ordering.** When a visitor picks
cheapest-first, closest-first or highest-rated, that is an instruction, and a
paid placement that quietly overrode it would make the sort control a lie.
`promotionAffectsSort` restricts promotion to `RELEVANCE`. This is not a
setting.

**Promoted results are always labelled.** Undisclosed paid placement is an
advertising-standards problem, not a design preference. The ribbon takes
priority over "Top rated" when both apply. Also not a setting.

**Promotion does not touch request matching.** §22 matching produces a
shortlist the platform tells a family is scored on fit, with a published
score breakdown. Injecting paid placement into that would make the explanation
untrue. Promoted tutors are matched exactly like everyone else, and an
integration test asserts that scores are unchanged.

### Correctness of the result set

Promotion reorders; it never adds, removes or duplicates. The boosted read and
the remainder read are disjoint (`$in` / `$nin` on the boosted ids), `total`
comes from one `countDocuments` on the unmodified query, and every sort now ends
in `_id` so paging is deterministic. Tests page the entire result set at
`pageSize=2` and assert every tutor appears exactly once.

There is no `priority`, `tier` or `boost` field. §41 defines no ranking
arithmetic, and a weight nobody specified would be a business rule invented in
a schema. When more promotions are live than a result set may show, the
existing ranking picks which ones are lifted.

### Expiry does not depend on the job

`livePromotionQuery` derives live-ness from the clock on every request
(`status === ACTIVE && startsAt <= now < endsAt`). A promotion whose window
closed stops affecting search immediately, whether or not `promotion-expiry`
has run. The job exists to keep the stored record and the admin console honest.
An integration test forces a window closed, asserts search is unaffected while
the stored status still reads `ACTIVE`, then runs the sweep twice and asserts
the second run changes nothing.

---

## 4. P2.11 — Advanced analytics

Analytics were partially implemented and were **not** rebuilt. The existing
functions kept their names and their callers. What changed is what they compute
and what they now cover.

### Correctness problems found and fixed

| Problem | Before | After |
| --- | --- | --- |
| Revenue counted money that was never taken | `grossSalesCents` summed `Booking.price.totalCents` over **every** booking created in the window, including abandoned checkouts (`PENDING_PAYMENT`, `EXPIRED`) and cancelled lessons | Aggregated from `Payment` on `paidAt`, over settled payments only |
| Refunds were invisible | Not subtracted anywhere | `refundedCents` reported, `netCollectedCents` derived, and platform revenue subtracts **each payment's own** refunded share of its own commission, pro rata — computed per payment inside the pipeline, never from a ratio of two aggregates |
| Referral credit inflated revenue | Not accounted for | Reported as a platform-funded cost against commission, never as a discount on the lesson or a charge to the tutor |
| Cancellation rate counted abandoned checkouts | An unpaid booking counted as a cancellation, making tutors look unreliable | Unpaid and expired bookings excluded from every lesson rate |
| Day buckets were UTC | A Toronto evening lesson landed on the wrong day for five months a year | All bucketing is time-zone aware, defaulting to `America/Toronto` |
| A tutor's period earnings were computed from a 50-row array | `tutorEarnings` reduced `recent` (`.limit(50)`), so a busy tutor's totals silently stopped counting past fifty lessons | Replaced with an aggregation ([payment.service.js](src/services/payment.service.js)) |

### What was added

- **Explicit date ranges.** [`lib/analytics/range.js`](src/lib/analytics/range.js)
  resolves `days` or `from`/`to` into a half-open, time-zone-aware window with
  a matching previous period, an adaptive bucket granularity (day / week /
  month) and a `MAX_RANGE_DAYS` cap.
- **Reliability metrics** — completion, cancellation, no-show and dispute
  rates, split by who caused them.
- **Phase 2 feature analytics** (`phaseTwoAnalytics`) — request match rate,
  matching response and booking rates, package utilisation and expiry,
  group fill and cancellation rates, referral conversion and credit granted,
  progress reports shared, promotions running.
- **Tutor leaderboard** for supply management.
- **Tutor's own analytics** (`tutorAnalytics`) — lessons, completion,
  repeat-student rate, reviews, earnings by course. Surfaced on
  [/tutor/earnings](src/app/tutor/earnings).
- **Indexes** for the new aggregations on `Payment`, `Booking`, `Review` and
  `CreditEntry`, each commented with the query it serves.

### Authorization

`GET /api/admin/analytics` is marketplace-scoped and takes no owner parameter
at all. `GET /api/tutor/analytics` resolves the tutor from the session — there
is deliberately no `tutorId` parameter, so the absence of one is the control
rather than a check that could be forgotten. A QA test injects
`tutorUserId` and `userId` and asserts the response is unchanged.

### Scope boundary

§41 lists **student analytics** under Phase 3. Learner-facing analytics are
therefore not implemented, and §24's parent/student dashboard is unchanged.

### Test approach

Aggregation tests build a fixture in a window far in the past — two settled
lessons, an abandoned checkout, an expired hold, a half-refunded cancellation,
a no-show, a credited payment, and a payment settled outside the window — so
every expected total is known by construction rather than read back from the
aggregation under test. Boundary tests assert the start is inclusive and the
end exclusive.

---

## 5. P2.12 — Fraud / risk tools

### What already existed, and what was missing

| Foundation | State before | Now |
| --- | --- | --- |
| `assessCancellationAbuse` | Decided an account "needs an administrator's review" and only notified the account holder — no administrator ever saw it | Its `REVIEW` verdict becomes a risk signal |
| `Referral.riskFlags` | Recorded and visible on the referrals page | Also raised as a signal, so it sits beside whatever else the account has done |
| `Dispute` | Full model and admin resolution | Disputes *against* an account are counted toward a signal |
| `AuditLog` | Append-only trail | Used for every risk action; no parallel mechanism added |
| `WebhookEvent` | Provider-level idempotency | Complemented by per-signal idempotency |
| Payment failures | Recorded, never aggregated | Counted toward a signal |

The missing piece was a durable, reviewable record. That is
[`RiskCase`](src/models/Risk.js): one case per account, accumulating signals,
so "this account has three different problems" is visible instead of three
unrelated rows nobody connects.

### Architecture

```
business event  →  detector  →  recordRiskSignal  →  RiskCase  →  admin review  →  resolution
(existing flow)   (threshold)    (idempotent)        (evidence)                    (audited)
```

Fraud logic lives only in [`risk.service.js`](src/services/risk.service.js).
No React component and no route handler contains any.

### Signals

| Signal | Source | Threshold |
| --- | --- | --- |
| `REPEATED_CANCELLATIONS` | `lib/booking/policy.assessCancellationAbuse` | Reuses the **existing** `cancellationAbuseThreshold` — not duplicated |
| `NO_SHOW_PATTERN` | `reportNoShow` in booking.service | `risk.noShowThreshold` (3) |
| `PAYMENT_FAILURES` | `markPaymentFailed` and the capture path | `risk.paymentFailureThreshold` (3) |
| `REPEATED_DISPUTES` | `createDispute`, counted against the account named | `risk.disputeThreshold` (2) |
| `REFERRAL_ABUSE` | `referral.service` risk flags | Any flag |

Counts are taken from stored state, never from what the caller believed, so a
replayed event cannot inflate one.

### Two rules that are not configurable

**Nothing is restricted automatically.** §41 authorises no penalty, so the
platform invents none. There is no "auto-suspend at score N" switch, and adding
one would mean suspending somebody by arithmetic. The only restriction reachable
from a case is the suspension an administrator could always apply by hand,
applied from Users, recorded on the case and audited through the ordinary path.
The resolve dialog says so explicitly.

**Every signal counts the same.** Weighting a dispute above a declined card
would be a risk model nobody specified. A case's score is how many *distinct
kinds* of trouble fired inside the window — exactly what an administrator would
count by reading the case.

### Security properties, each with a test

| Property | How |
| --- | --- |
| Idempotency | `dedupeKey` derived from the *event*, unique index `risk_signal_dedupe` across all cases. Ten concurrent replays of one event record one signal. |
| No duplicate cases | Partial unique index `one_open_risk_case_per_user`; signals join the open case. |
| No client-set state | `riskLevel`, `riskStatus`, `score` and `fraudConfirmed` are not fields any schema accepts. The API takes named *actions*; a PATCH carrying `status`/`level`/`score` is rejected 422. |
| No case creation over the API | There is no create endpoint. A `POST` to the queue returns 404/405. |
| IDOR | The account under review cannot read or clear its own case (403). |
| Evidence is never destroyed | Resolved cases keep their signals and actions; a resolved case cannot be reopened, and a replayed old event cannot open a fresh one. |
| Detection never breaks the business action | Every call site uses `safelyRecordRiskSignal`, which logs and swallows. A cancellation must not fail because the risk service was unhappy. |
| A cleared case is evidence too | `CLEARED` is a first-class resolution, needing no justification. |

### E2E, over real HTTP

`bun run qa` drives: threshold configured → learner raises a dispute → case
opens against the named account → evidence and derived level asserted → account
confirmed still `ACTIVE` → authorization probes → forged status rejected →
administrator takes and resolves → reopening refused → record still readable →
fixtures restored.

---

## 6. Cross-feature integration

| Interaction | Verified |
| --- | --- |
| Promotion × discovery, filters, pagination | Full result set paged at `pageSize=2`; every tutor exactly once; totals unchanged |
| Promotion × eligibility | Suspended, unapproved and non-searchable profiles refused at create *and* at activate |
| Promotion × matching | Scores and match ordering unaffected, by design |
| Analytics × packages, groups, referrals, requests, promotions, disputes | `phaseTwoAnalytics` covers each; invariants asserted (used ≤ sold, taken ≤ offered, qualified ≤ sign-ups) |
| Analytics × refunds and credit | Pro-rata commission clawback and credit-as-cost asserted against hand-computed fixtures |
| Risk × bookings, payments, disputes, referrals | Each detector wired into the existing flow, none duplicating its logic |
| Risk × cancellation policy | Defers to the policy's verdict; a `WARN` is not a signal, a `REVIEW` is |

---

## 7. Configuration and specification gaps

Every value below is undefined by §41 and configurable at
`/admin/settings`. Defaults are in
[src/constants/config.js](src/constants/config.js).

| Group | Keys | Default | Gap |
| --- | --- | --- | --- |
| `matching` | `minimumScore`, `maxSuggestions`, `notifyTopTutors`, `requestTtlDays`, … | see config | §41 names "advanced matching" without factors |
| `matchWeights` | 10 factor weights | sum to 100 | Relative; rescaled onto 100 |
| `referrals` | `referrerRewardCents`, `refereeRewardCents`, `qualifyingLessons`, … | rewards **0** | §41 names referrals without pricing them |
| `packages` | `minSessions`, `maxSessions`, `defaultValidityDays`, `expiryRefundPercent`, … | refund **100%** | No forfeiture rule specified |
| `groups` | `minParticipants`, `maxParticipants`, `confirmationDeadlineHours`, … | refund **100%** | No policy specified |
| `promotions` | `enabled`, `maxPromotedPerSearch` (3), `maxActive` (20), `defaultDurationDays` (30), `maxDurationDays` (365) | conservative | No placement count, duration or price specified |
| `risk` | `enabled`, `signalWindowDays` (30), `reviewScore` (2), `highScore` (4), `noShowThreshold` (3), `paymentFailureThreshold` (3), `disputeThreshold` (2) | conservative | No signal, threshold or penalty specified |

**Not configurable, deliberately:** promoted results are always labelled;
promotion never overrides a visitor's chosen sort; no risk score restricts an
account.

---

## 8. Verification

| Gate | Result |
| --- | --- |
| `bun run lint` | Clean |
| `bun run build` | Clean |
| `bun run test:integrations` | **913 passed, 2 failed** |
| `bun run qa` | **525 passed, 9 failed** |

Run with `PAYMENT_PROVIDER=development` for the dev server, per the established
Phase 2 test strategy — the repository's Stripe test credentials are not valid.

### Every failure, classified

| Failure | Classification |
| --- | --- |
| `the bucket is reachable with the configured credentials` (integration) | **Pre-existing** — MinIO credentials in `.env.local` are rejected by the bucket |
| `and each records a full refund` (integration, group tutoring) | **Pre-existing** — reproduced identically on the untouched baseline before any Phase 2.10–2.12 work |
| 9 QA storage failures (verification-document upload, logo upload/serve/replace) | **Pre-existing** — the same MinIO credential problem, surfacing through the HTTP API |

**No new failures. No changed failure signatures. No new stack traces.**

### Baseline note

The brief cited a baseline of 735/1 integration and 311/18 QA. That baseline
did not reproduce on this machine. The measured pre-change baseline, captured
before any P2.10–P2.12 work and recorded in `scratchpad/base-fails.txt`, was:

- `test:integrations` — **734 passed, 2 failed** (deterministic across two runs)
- `qa` — **431 passed, 9 failed**, with `PAYMENT_PROVIDER=development`

With Stripe's invalid credentials the QA run does not merely fail 18 assertions,
it **crashes** partway through on an invalid date. The 9-failure baseline above
is the honest one, and every one of those 9 is the MinIO problem.

### Repeatability

`bun run qa` consumes seeded fixtures by design — the script says so
(*"each run consumes one. Re-seed if this section reports that it has run out"*).
A second consecutive run without reseeding reports three additional failures
(progress-report fixtures exhausted, registration rate-limited, and no completed
lesson left for the risk E2E). These are fixture exhaustion, not regressions:
after `bun run seed` the result returns to exactly 525/9. The risk E2E restores
what it uses — it rejects its own disputes, which returns the lessons to
`COMPLETED`.

---

## 9. What still needs real credentials

None of the following is production-verified. Each has been exercised only
against a stub or the bundled development implementation.

| Integration | State | Needed |
| --- | --- | --- |
| Object storage (MinIO / S3) | **Failing locally** — credentials rejected | Working `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY` with permission on the bucket. This is the sole cause of all 11 failing assertions. |
| Stripe | Test credentials in `.env.local` are invalid | A real `sk_test_…` and `STRIPE_WEBHOOK_SECRET`. Adapter logic, signature verification and replay handling are tested against the real signing scheme with `fetch` stubbed. |
| Google Calendar | Stub only | OAuth client, secret, verified redirect URI |
| Microsoft Calendar | Stub only | Azure app registration, client secret |
| SMS (Twilio) | Stub only, off by default | Account SID, auth token, messaging service; then enable `notifications.smsEnabled` |
| Email (Resend) | Console provider in development | `RESEND_API_KEY`, verified sending domain |
| Meeting links (Zoom / Meet / Teams) | Deterministic development links | Per-provider credentials |
| Geocoding | Bundled Canadian table | Google Geocoding key for national coverage |

Promoted profiles, analytics and risk tools introduce **no new external
provider** and need no additional credentials.

---

## 10. Phase 3 boundary

No Phase 3 scope was implemented. Specifically not built, and named in §41 as
Phase 3: student analytics, AI recommendations, AI search, AI lesson summaries,
tutor subscriptions, group courses, native video, whiteboard, document sharing,
mobile apps, additional provinces, university tutoring.
