# APlus Learn — Phase 3 implementation audit

**Date:** 2026-09-24
**Scope:** §41 Phase 3 of [docs/Project.md](docs/Project.md)

---

## 1. What Phase 3 actually specifies

This is the entire Phase 3 requirement, quoted in full from §41:

> Do not unnecessarily implement all future features now.
>
> However, architecture must allow:
>
> ### Phase 3
>
> * iOS
> * Android
> * native video classroom
> * interactive whiteboard
> * homework/document sharing
> * AI recommendations
> * AI search
> * AI lesson summaries
> * student analytics
> * tutor subscriptions
> * group courses
> * exam preparation marketplace
> * additional provinces
> * university tutoring

Fourteen feature names. No domain models, no business rules, no acceptance
criteria, no technology choices, and an explicit instruction not to build them
all now. Nothing elsewhere in `Project.md` adds to this.

That shapes everything below. A feature was implemented only where the
requirements *already in force* — §13 curriculum, §21 messaging, §24
dashboards, §25 analytics — say enough to build it without inventing a domain.
Everything else is recorded as deferred together with the specific decision it
is waiting on, rather than being half-built against a guess.

**Three features were implemented. Eight are deferred. Three of the fourteen
names collapse into one deferred AI item.**

---

## 1a. Verification

| Gate | Result |
|---|---|
| `bun run lint` | clean |
| `bun run test:integrations` | **1553 passed, 0 failed, 1 skipped** (the skip is the live-MinIO round trip, which needs `STORAGE_*` credentials) |
| `bun run qa` | **1057 passed, 0 failed** (dev server on `PAYMENT_PROVIDER=development`) |
| `bun run build` | compiled successfully; 4 Turbopack warnings, all pre-existing on `main` |

86 new service-level assertions and 41 new HTTP assertions cover the three
implemented features.

One non-reproducing incident is worth recording: a `qa` run started immediately
after `bun run seed`, with the dev server left running across the wipe, failed
six curriculum assertions with "Choose a valid province, grade and subject".
Every failure was downstream of one stale grade id served from the per-process
curriculum cache, which the reseed had no way to drop. It did not reproduce on
a re-run against the same seed, and none of the code involved was touched by
this work. `.claude/CLAUDE.md` now says to restart the dev server after a
reseed.

---

## 2. Status

| Feature | Status | Evidence |
|---|---|---|
| Additional provinces | `FULLY IMPLEMENTED` | Already built; one real gap found and fixed — see §3 |
| Homework / document sharing | `PARTIALLY IMPLEMENTED` | Document sharing E2E on both specified surfaces; assignment/grading domain deferred — see §4 |
| Student analytics | `FULLY IMPLEMENTED` | `studentAnalytics()`, `/insights`, `/tutor/students/[id]` — see §5 |
| iOS / Android | `NOT IMPLEMENTED` | API is app-consumable; two findings in §6 |
| Native video classroom | `DEFERRED` | `MeetingProvider` is the extension point; "native" names no technology |
| Interactive whiteboard | `NOT IMPLEMENTED` | Nothing in the specification to build against |
| AI recommendations / search / lesson summaries | `DEFERRED` | No AI abstraction exists; needs a data-handling decision first |
| Tutor subscriptions | `DEFERRED` | No recurring billing in the payment abstraction; conflicts with live product copy |
| Group courses | `DEFERRED` | `GroupSession` is a single session, not a course |
| Exam preparation marketplace | `DEFERRED` | No concrete domain named |
| University tutoring | `DEFERRED` | Curriculum is province-scoped K–12 by construction |

---

## 3. Additional provinces — verified, one defect fixed

The Phase 2 audit called multi-province support "ready now". That was
substantially right: `Province.isActive`, admin CRUD across all four levels of
the hierarchy, province-scoped grades and courses, `/[province]/[grade]/[subject]/[course]`
SEO routes, `CURRICULUM_UPDATED` audit entries at every level, "coming soon"
labelling in both the admin manager and the homepage search, and roughly thirty
existing assertions across the two suites. None of it was rebuilt.

**The gap.** `Province.isActive` stopped at the picker. A course carries its own
`isActive`, so deactivating a province left its courses fully live: they stayed
in `/courses`, `/api/curriculum/courses` returned them, and their SEO landing
pages kept rendering with real tutors on them. The platform would tell one
visitor a province was "coming soon" while showing another a page of tutors for
it.

**The fix.** `activeProvinceCodes()` — one cached lookup, dropped by the same
`invalidate()` every curriculum write already calls — gates the two public
reads:

- `listCourses()` when `activeOnly` (which is the public view; the admin passes
  `activeOnly: false` and still sees everything)
- `getCourseByPath()`, so the landing page 404s

No course's own `isActive` is touched, so nothing has to migrate and
reactivating a province restores its courses exactly as they were. Seven new
service assertions plus one HTTP assertion cover it.

---

## 4. Homework / document sharing

### What the requirements support

§21 says of messaging: *"Prepare the architecture for: attachments"*, and
`Message.attachments` has carried a four-field sub-schema since the MVP for
exactly this. `ProgressReport.homework` has always been the tutor's written
instruction for what to practise. Those two are the specified surfaces, and
both are now real.

### Implemented

One `AttachmentSchema` ([src/models/Attachment.js](src/models/Attachment.js))
used by `Message.attachments` — keeping its original four fields, so nothing
migrates — and by the new `ProgressReport.homeworkAttachments`.

- **Upload.** Multipart `POST /api/messages/attachments` (sends a message
  carrying files, through the same `sendMessage()` so blocking, unread counts,
  response-time tracking and notification all still apply once) and
  `POST /api/tutor/progress/[id]/attachments` (author only, capacity enforced in
  the same conditional update that writes).
- **Download.** `GET /api/messages/attachments/[id]` (conversation participants
  and admins) and `GET /api/progress/attachments/[id]` (the report's tutor, the
  family it was written for, and admins; a draft's files stay with their
  author). Both stream under `nosniff`, `default-src 'none'; … sandbox`,
  `no-store`, and `Content-Disposition: attachment` for anything that is not an
  image.
- **Removal.** `DELETE /api/tutor/progress/[id]/attachments/[attachmentId]`.
  Allowed after submission — the case that matters is a tutor who attached the
  wrong learner's work — and the existing revision mechanism preserves the
  history: a removal from a shared report snapshots the report first, so the
  record still says the file was there.
- **Validation.** Size checked against the declared length *and* the real one,
  count capped per parent, and the content type read from the bytes by
  `inspectDocument()`. A file whose contents disagree with its claimed type is
  refused. The accepted set is deliberately the same four formats verification
  documents may be (PDF, JPEG, PNG, WebP) — the list stops where the byte
  inspection stops, so nothing is accepted that has not been looked at.
- **Storage.** A fourth scope (`attachments`) on the existing abstraction. No
  second storage mechanism, no URL ever returned, `storageKey` is `select: false`
  and never crosses to a client.
- **Cleanup.** Files are stored before the row that will own them exists, so
  every failure path calls `discardAttachments()`. A batch where the second file
  is bad removes the first — a refused upload leaves nothing behind.

### Deliberately not built

A formal assignment domain: **due dates, submission states, grading, marks,
resubmission, late policy.** None of these appear anywhere in the
specification, and each is a product decision (see §8). A learner returns their
work the way they already can — in the message thread.

---

## 5. Student analytics

`studentAnalytics(studentProfileId, actor, options)` in
[src/services/analytics.service.js](src/services/analytics.service.js), built
on the same `lib/analytics/range.js` and the same discipline as the admin and
tutor figures: aggregated in MongoDB, half-open time-zone-aware windows, money
from `Payment` on `paidAt` and never from summing booking prices.

**Every figure comes from a record that already existed for another reason** —
a booking that was taught, a payment that settled, a report a tutor wrote, a
goal a family set. Nothing is estimated, and a period with no lessons renders
as an empty state rather than a flat line, because "nothing happened" and "we
have no data" are not the same thing. A rating nobody has given is `null`,
never `0`.

**Three scopes, resolved from stored records and never from a request:**

| Reader | Test | Sees |
|---|---|---|
| Owner | `StudentProfile.ownerId` matches the session | Everything, including household spend on that learner's lessons |
| Admin | Role, under existing RBAC | Everything |
| Tutor | Has a **completed** booking with that learner | Their own teaching only |

A tutor's view carries no spend, no lessons taught by anyone else, no other
tutor's ratings, and a surname masked per `shareFullNameWithTutor`. The scope is
applied once as a `$match` fragment carried into every pipeline, rather than in
eight places that each have to remember. A tutor with only a *future* booking is
refused: a lesson that has not happened is not teaching.

`STUDENT_ANALYTICS_VIEW` is a new permission held by families and tutors. Like
`BOOKING_MEETING_MANAGE`, it opens the door and does not name a learner.

**Spend excludes package purchases**, and the returned figure says so
(`excludesPackagePurchases: true`). A package is bought by the household and can
be drawn down by any of its learners, so attributing one to a single child would
be a guess — and a guess with a dollar sign in front of it is exactly the kind a
family would act on.

UI: `/insights` (family, with a learner picker for parents) and
`/tutor/students/[id]`, both server-rendered against the service.

---

## 6. Mobile applications — verification only

No native app was built; the specification provides no technology or product
requirement, and API readiness is not an implementation. What was verified:

**Sound.** One response envelope on every endpoint (`ok`/`fail`, `data`,
`meta`), pagination on every list, per-field validation detail, RBAC enforced
server-side in one pipeline, file access through authorised routes that check
the reader, no browser-only assumptions in any API contract.

**Two findings, neither a defect:**

1. **Authentication is cookie-only** — a signed JWT in an httpOnly cookie
   ([src/lib/auth/session.js](src/lib/auth/session.js)). Native HTTP clients can
   hold cookies, so the API *is* consumable; but there is no bearer-token grant.
   Adding one is a security decision (token lifetime, refresh, revocation, and
   what it does to the current CSRF posture), not a mechanical change.
2. **No CORS configuration.** Fine for a native client, which is not subject to
   it. It would matter for a web client on another origin.

Store badges continue to read "Coming soon", which is accurate.

---

## 7. Deferred, with the reason

| Feature | Why it cannot be built from the current specification |
|---|---|
| **Native video classroom** | `MeetingProvider` already abstracts Zoom, Google Meet and Microsoft Teams, and a fourth adapter would slot in behind it unchanged. But "native video classroom" names no technology, protocol or hosting model. Building WebRTC/SFU infrastructure would be inventing the requirement, and it is explicitly out of scope for this pass |
| **Interactive whiteboard** | Nothing exists in the code and nothing in the specification defines persistence, participants, permissions, the collaboration model, export or retention. A third-party SDK would be a product and vendor decision |
| **AI recommendations / search / lesson summaries** | There is no AI abstraction, provider contract or dependency in the repository. More importantly, every one of these would send learner or tutor data to a third party, and there is no architecture decision on record permitting that. Speculative infrastructure here would be worse than none |
| **Tutor subscriptions** | `PaymentProvider` has `createCheckout`/`capture`/`refund`/`transfer` and **no recurring method**, so this needs both a provider capability and a set of rules that do not exist: price, billing period, what a subscription entitles a tutor to, proration, dunning, grace period, cancellation. It also contradicts live product copy — `/become-a-tutor` currently tells tutors "no registration fee, no subscription" |
| **Group courses** | `GroupSession` is one tutor, one time, many learners, with `seatsTaken` as an atomic capacity guard. A *course* is a series, which changes enrolment (can a learner join at session three?), pricing (per course or per seat?), cancellation, and attendance. Reshaping group sessions into courses without those answers would break working marketplace behaviour |
| **Exam preparation marketplace** | The requirement is three words. Exam boards, exam definitions, question banks, scoring, pricing and how any of it relates to the existing subject/course hierarchy are all unspecified |
| **University tutoring** | The curriculum is province-scoped K–12 by construction — `Grade.stage` is `ELEMENTARY`/`MIDDLE`/`SECONDARY`, and courses carry provincial course codes. Post-secondary needs institutions, programs and a different course-code model. Forcing it into the K–12 grade and province fields to make the feature "appear implemented" is exactly what was avoided |

---

## 8. Product decisions required to continue

Each of these blocks a specific feature. None is a question the codebase can
answer.

1. **Is homework an assignment?** If tutors should set work with a due date that
   learners submit and tutors mark, that needs: submission states, whether a
   mark or grade exists and on what scale, whether resubmission is allowed, what
   late means, and who can see a submission. The file-sharing foundation is
   built and an assignment domain would sit on top of it.
2. **Do tutor subscriptions exist as a product?** If so: price, period, what is
   entitled (promoted placement? lower commission? more packages?), proration,
   dunning, grace period, cancellation and refund policy. `/become-a-tutor`
   would also need rewriting.
3. **What is a group course?** Specifically whether a learner may join part-way
   through, whether it is priced per course or per session, how cancellation
   refunds a partially-delivered course, and how attendance carries across
   sessions.
4. **What is an "exam preparation marketplace"?** Whether exams are curriculum
   records, a tutor specialisation, a product type, or something else.
5. **What does "native video classroom" mean?** A hosted provider behind the
   existing abstraction, or platform-owned WebRTC infrastructure. These are very
   different amounts of work and operational commitment.
6. **May learner data reach an AI provider, and which?** Required before any of
   the three AI items, and prior to choosing a vendor.
7. **Where does university tutoring live?** A separate post-secondary domain
   beside K–12, or an extension of the existing hierarchy.
8. **Should the API issue bearer tokens?** Needed only if a native app or a
   cross-origin web client is actually planned.

---

## 9. External dependencies

Cleanly separated from application code, and **no provider configuration was
touched in this pass**:

- **None of the implemented work needs a new provider.** Attachments use the
  existing storage abstraction and run on the local-filesystem fallback exactly
  as they run on S3/MinIO. Analytics touch no external service.
- **Deferred items that need a provider before any code is useful:** an AI
  vendor (AI features), Stripe Billing or equivalent (subscriptions), a video
  platform or SFU (native classroom), a whiteboard SDK (whiteboard), Apple and
  Google developer accounts (native apps).

---

## 10. Remaining work inside Phase 3

Only one item is genuinely unfinished rather than out of scope:

- **Homework as a graded assignment**, pending decision 1 above. Everything
  else on the deferred list is waiting on a product or provider decision, not on
  engineering.

Not remaining work: the eight deferred features are outside what the current
specification defines, and the mobile row is a verification result rather than a
gap.
