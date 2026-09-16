You are now responsible for REMEDIATING the APlus Learn project based on the completed requirements-compliance audit.

The audit report is the primary remediation checklist:

`APLUS_LEARN_REQUIREMENTS_AUDIT.md`

The original product requirements remain the ultimate source of truth:

`docs/Project.md`

Your objective is to take EVERY requirement currently marked as:

* PARTIALLY IMPLEMENTED
* BROKEN
* NOT IMPLEMENTED
* CRITICAL
* HIGH
* MEDIUM

and make it fully implemented and working END-TO-END.

Do not stop at fixing the immediately visible defect. Trace each issue through the complete application architecture and make the implementation production-correct.

---

# PHASE 0 — READ BEFORE CHANGING ANYTHING

Before modifying code:

1. Read `.claude/CLAUDE.md`.
2. Read all applicable `.claude/rules/*`.
3. Read `docs/Project.md`.
4. Read `APLUS_LEARN_REQUIREMENTS_AUDIT.md` completely.
5. Inspect the current architecture.
6. Inspect the existing services, API routes, models, authorization helpers, notification system, scheduler-related code, payment/payout logic and QA suite.
7. Inspect `docs/REQUIREMENTS.md` if it exists.
8. Understand the existing implementation before making changes.

Do NOT blindly implement based only on the audit wording.

Verify every finding against the actual current code.

---

# CRITICAL RULE — PRESERVE EXISTING FUNCTIONALITY

This is a remediation task, NOT a rewrite.

DO NOT:

* rewrite working modules
* replace the architecture
* introduce unnecessary libraries
* redesign unrelated UI
* change working business logic without reason
* remove existing functionality
* replace working services with abstractions that are unnecessary
* introduce TypeScript
* create a separate backend
* break existing API contracts unnecessarily

The existing application is already substantially implemented.

Make focused, minimal, production-quality changes.

---

# REMEDIATION SCOPE

You MUST address all of the following findings from the audit.

---

# PHASE 1 — CRITICAL SECURITY FIXES

## 1. Booking reschedule authorization

Current issue:

`POST /api/bookings/:id/reschedule`

does not properly verify that the authenticated user is a participant in the booking.

An unrelated authenticated user can currently reschedule another user's confirmed booking.

### Required implementation

Trace the complete flow:

route
→ authentication
→ booking lookup
→ authorization
→ service
→ booking mutation
→ notifications
→ response

Ensure only legitimate booking participants can perform the operation.

Use the existing authorization infrastructure where appropriate.

The authorization MUST be based on the authenticated actor and the actual database booking record.

Never trust:

* client-supplied user ID
* client-supplied role
* client-supplied booking ownership
* client-supplied participant information

Use the existing `requireParticipant` mechanism if it is the correct abstraction.

Also review `actorRoleFor()`.

If `actorRoleFor()` currently fails open by treating unrelated users as `"STUDENT"`, change it to fail closed.

An unrelated authenticated user MUST receive an authorization error.

Verify both:

* valid participant → allowed
* unrelated authenticated user → rejected

---

# 2. Booking no-show authorization

Current issue:

`POST /api/bookings/:id/no-show`

treats non-tutor callers as the student.

This allows unrelated users to report another tutor's no-show and potentially trigger a refund / earnings reversal.

This is a financial-integrity vulnerability.

### Required implementation

Implement strict authorization.

Verify:

1. Caller is authenticated.
2. Caller is actually a participant in the booking.
3. Caller is authorized to report the specified no-show party.
4. The reported party is actually the opposite participant.
5. Booking state permits a no-show report.
6. Refund logic is only executed after authorization succeeds.
7. Tutor earnings/payout state cannot be manipulated by unrelated users.

Do NOT simply check whether the caller is "not a tutor".

Use actual booking participant identity.

Test at minimum:

* learner reports tutor no-show → valid
* tutor reports learner no-show → valid if supported by requirements
* unrelated learner → rejected
* unrelated tutor → rejected
* admin behavior → follow documented requirements
* invalid booking → rejected
* invalid party → rejected
* repeated no-show report → correctly handled/idempotent

---

# 3. Fix the shared authorization root cause

Audit all usages of:

`actorRoleFor()`

and any similar helper.

The helper must fail closed.

Never silently convert an unknown/unrelated actor into a valid booking participant role.

Search the entire codebase for similar fail-open authorization patterns.

Look for patterns such as:

* fallback role assignment
* `user ? role : "STUDENT"`
* default ownership
* missing participant checks
* authorization based only on role
* authorization based on request body IDs

Fix any equivalent vulnerability discovered during this audit.

Do not expand scope into unrelated speculative refactoring; only fix concrete authorization weaknesses.

---

# PHASE 2 — HIGH PRIORITY

## 4. Implement real scheduler/cron execution

Audit finding:

No scheduler currently invokes:

`expireStaleVerifications()`

and booking reminders are never emitted.

The schema contains reminder-related state such as:

`Booking.remindersSent`

but no actual scheduled execution exists.

### Required implementation

Implement a production-appropriate scheduler mechanism compatible with the existing Next.js architecture and deployment model.

First inspect the project and determine the intended deployment environment.

Do NOT introduce an unnecessarily complex queue system.

The scheduler must support at minimum:

### Verification expiry

Automatically execute:

`expireStaleVerifications()`

according to the documented verification expiry rules.

Ensure expired verification badges cannot remain valid indefinitely.

### Booking reminders

Implement the documented `BOOKING_REMINDER` notification behavior.

The job should:

1. find eligible upcoming bookings
2. determine which reminder(s) are due
3. prevent duplicate reminders
4. create/send the notification
5. update reminder state
6. remain safe if executed repeatedly

The implementation must be idempotent.

If the same scheduled job runs twice, it must not generate duplicate reminders or corrupt state.

### Payout scheduling

The audit also notes that payout initiation currently requires manual admin initiation because the scheduled execution path is missing.

Inspect the existing payout logic.

If the requirements expect automatic/scheduled payout processing, connect the existing payout service to the scheduler.

Do not rewrite the payout subsystem if the required business logic already exists.

---

# 5. Conversation reporting → Admin moderation workflow

Current implementation stores:

* `reportedAt`
* `reportedBy`
* `reportReason`

but no admin surface consumes these reports.

Therefore reports effectively disappear.

### Required implementation

Build the complete E2E moderation flow:

User/Tutor
→ report conversation
→ persist report
→ admin report queue
→ admin views report
→ admin reviews conversation/context
→ admin takes moderation action
→ report status updates
→ audit log

The admin must be able to see at minimum:

* reporter
* reported conversation
* participants
* report reason
* report timestamp
* relevant booking context
* report status
* moderation action/history

Support appropriate states such as:

* OPEN
* REVIEWING
* RESOLVED
* DISMISSED

Use the project's existing conventions if equivalent states already exist.

Ensure only authorized administrators can access reports.

Because the platform serves minors, do not expose sensitive conversation data to unauthorized users.

Add audit logging for meaningful admin moderation actions if consistent with the existing audit architecture.

---

# 6. Expand QA/E2E coverage

The audit found an important blind spot:

The existing QA suite has 135 passing assertions but does NOT test the two broken endpoints:

* reschedule
* no-show

This MUST be fixed.

Add E2E/API tests for:

### Reschedule

* participant can reschedule
* unrelated user cannot reschedule
* invalid booking rejected
* invalid state rejected
* authorization is enforced server-side

### No-show

* valid participant can perform valid action
* unrelated user cannot perform it
* wrong party cannot be reported
* refund is NOT triggered for unauthorized requests
* tutor earnings are NOT altered by unauthorized requests
* repeated requests behave safely

### Scheduler

Add deterministic tests for:

* verification expiry
* reminder creation
* duplicate reminder prevention
* payout scheduling if applicable

### Conversation reports

Test:

* user reports conversation
* report persists
* admin can see report
* unauthorized user cannot access admin report
* admin resolves/dismisses report
* status changes persist

Do NOT make tests pass by weakening assertions.

The tests must protect the actual business rules.

---

# PHASE 3 — MEDIUM PRIORITY

## 7. Enforce email verification

Current issue:

Email verification exists but is not required before sensitive account actions.

An unverified account can currently sign in, book and pay.

### Required implementation

Determine from `docs/Project.md` exactly where email verification is required.

Implement enforcement at the correct authorization/business-logic boundary.

Do not rely only on UI.

Server-side enforcement must prevent unverified users from performing protected actions.

At minimum verify:

* unverified registration
* login behavior
* verification status
* booking attempt
* payment attempt
* verified user flow
* resend verification
* expired verification token
* already-used token
* invalid token

Do not create an authorization loophole where users can bypass verification through another API route.

Audit all sensitive endpoints that should respect verification status.

---

# 8. Fix review self-suppression

Current issue:

A tutor can report a review about themselves and immediately cause that review to disappear from the public average pending moderation.

This allows a reviewed tutor to suppress unfavorable reviews.

### Required behavior

Preserve the existing reporting/moderation capability but prevent the reviewed tutor from unilaterally suppressing a legitimate review.

The correct flow should be:

Review exists
→ report submitted
→ report/moderation state recorded
→ review remains visible unless documented moderation rules say otherwise
→ authorized admin/moderator reviews
→ admin decides whether to hide/remove/restore
→ moderation decision audited

Review the original requirements carefully before choosing the exact behavior.

Do not remove review reporting entirely.

Do not allow the subject of the review to bypass moderation.

Test:

* learner creates valid review
* tutor can report it if allowed
* report does not automatically manipulate public rating
* admin can moderate
* approved/visible review remains in rating
* moderated/removed review is handled correctly
* unauthorized users cannot moderate reviews

---

# 9. Eliminate double-booking race condition

Current issue:

Availability is checked and then booking is written separately.

This creates a race window where two concurrent requests can potentially book the same time.

### Required implementation

Make booking creation concurrency-safe.

Inspect the existing MongoDB/Mongoose architecture and implement the safest approach compatible with the current schema.

Possible approaches may include:

* MongoDB transaction
* atomic conditional update
* appropriate unique constraint/index
* reservation/slot model
* another concurrency-safe mechanism

Choose based on the actual existing data model.

Do NOT blindly add an index that would break recurring bookings or legitimate overlapping schedules.

The final implementation must guarantee the business rule:

A tutor cannot have two conflicting bookings.

Test with concurrent booking attempts.

At least one request must succeed and conflicting requests must be rejected safely.

Also verify:

* recurring bookings
* cancellation
* rescheduling
* different days
* adjacent non-overlapping lessons
* timezone handling

---

# 10. Re-derive tutor `isSearchable` after profile updates

Current issue:

`updateTutorProfile` does not re-derive `isSearchable` after profile changes.

A tutor could potentially remain searchable after editing their profile into an incomplete state.

### Required implementation

Find the canonical rule that determines tutor search eligibility.

Centralize or reuse it rather than duplicating logic.

After relevant profile updates:

1. validate new data
2. save changes
3. recompute search eligibility
4. persist the correct `isSearchable` value
5. ensure public search immediately respects the new state

Verify that admin approval/verification requirements are still enforced.

Do NOT allow profile editing to bypass:

* approval
* verification
* required fields
* searchable eligibility rules

Test transitions:

complete → incomplete
incomplete → complete
approved → edited
unapproved → edited
verified → changed
searchable → non-searchable
non-searchable → searchable

---

# PHASE 4 — AUDIT FOR RELATED REGRESSIONS

After implementing the above fixes, perform a targeted security/business-rule audit around the affected modules.

Especially inspect:

### Booking

* create
* reschedule
* cancel
* no-show
* complete
* recurring booking
* payment
* refund
* payout
* review eligibility

### Authorization

* participant checks
* ownership checks
* role checks
* admin checks
* user-to-user data access

### Reviews

* create
* report
* moderation
* visibility
* rating calculation

### Notifications

* booking confirmation
* reminder
* cancellation
* reschedule
* no-show
* payout-related notifications

### Tutor verification

* submission
* approval
* expiry
* re-verification
* search visibility

Do not expand this into a generic security audit. Focus on concrete regressions and related vulnerabilities caused by the audited findings.

---

# PHASE 5 — E2E VERIFICATION

After implementation, run the complete project validation suite.

At minimum:

* existing tests
* new E2E tests
* `bun run qa`
* `bun run lint`
* build/type/static checks that exist in the project
* relevant route/API checks

If a command fails:

1. investigate the real cause
2. fix it if caused by your changes
3. rerun the command

Do not hide failures.

---

# REQUIRED E2E SCENARIOS

You must verify these real user journeys after implementation.

## Journey A — Parent/Learner

Search
→ tutor profile
→ availability
→ booking
→ payment
→ confirmation
→ messaging
→ lesson
→ review
→ rebook

Verify that all existing functionality still works.

---

## Journey B — Tutor

Tutor onboarding
→ verification
→ approval
→ searchable profile
→ availability
→ booking
→ lesson
→ completion
→ review
→ payout

Verify that the fixes do not break this flow.

---

## Journey C — Security

User A
→ attempts to access/change User B's booking
→ MUST fail

User A
→ attempts to trigger no-show/refund on User B's booking
→ MUST fail

User A
→ attempts to access User B's private data
→ MUST fail

Unverified user
→ attempts protected booking/payment action
→ MUST fail according to requirements.

---

## Journey D — Admin Moderation

User reports conversation
→ report appears in admin queue
→ admin reviews
→ admin resolves/dismisses
→ audit trail exists.

---

## Journey E — Automated Jobs

Upcoming booking
→ scheduler runs
→ reminder generated once

Expired verification
→ scheduler runs
→ verification expires

Eligible payout
→ scheduler runs
→ payout processing follows existing business rules.

Repeated scheduler execution
→ MUST remain idempotent.

---

# DATA SAFETY

Be extremely careful with existing development data.

Before running destructive tests:

* understand the current database
* use isolated test records where possible
* do not delete real project data
* do not corrupt seed data
* do not trigger real external financial transactions

If Stripe/dev payment infrastructure exists, use the project's existing test/development provider.

Never use real production payment operations during testing.

---

# IMPLEMENTATION QUALITY

Prefer existing project patterns.

Before creating new utilities/services:

Search for existing:

* authorization helpers
* participant helpers
* notification services
* scheduler abstractions
* payment services
* payout services
* moderation patterns
* audit logging
* transaction helpers
* MongoDB utilities
* test factories

Reuse them where appropriate.

Do not duplicate existing business logic.

---

# REQUIREMENT TRACEABILITY UPDATE

After implementation, update:

`docs/REQUIREMENTS.md`

ONLY if necessary to reflect actual implementation state.

Do not manipulate documentation to claim compliance without evidence.

Then update:

`APLUS_LEARN_REQUIREMENTS_AUDIT.md`

with a remediation section containing:

| Finding | Previous Status | New Status | Implementation | E2E Verification |
| ------- | --------------- | ---------- | -------------- | ---------------- |

Every previously incomplete requirement must now have evidence.

Target:

* PARTIALLY IMPLEMENTED → FULLY IMPLEMENTED
* BROKEN → FULLY IMPLEMENTED
* NOT IMPLEMENTED → FULLY IMPLEMENTED

If something genuinely cannot be completed because the requirement itself depends on unavailable infrastructure, document the exact reason instead of pretending it is complete.

---

# FINAL ACCEPTANCE CRITERIA

Do NOT consider this task complete until:

### Security

* reschedule authorization is fixed
* no-show authorization is fixed
* fail-open actor resolution is eliminated
* unauthorized financial/refund manipulation is prevented

### Automation

* verification expiry is actually scheduled/executed
* booking reminders are actually generated
* duplicate reminders are prevented
* scheduled payout processing is connected where required

### Moderation

* conversation reports reach admins
* admin can review reports
* moderation actions work E2E
* moderation is authorization-protected
* audit trail is preserved

### Account security

* email verification is enforced where required
* unverified users cannot bypass restrictions through alternate APIs

### Reviews

* tutors cannot unilaterally suppress reviews
* admin moderation remains functional
* rating calculations respect moderation state

### Booking integrity

* concurrent booking attempts cannot double-book a tutor
* booking/reschedule/cancel flows remain correct

### Tutor discovery

* `isSearchable` is correctly recalculated after profile changes
* approval/verification rules cannot be bypassed

### QA

* all newly fixed vulnerabilities have regression tests
* full existing QA suite passes
* lint passes
* build/static checks pass
* critical user journeys pass

---

# FINAL REPORT

At the end, produce a concise implementation report containing:

## Completed Fixes

List every audit finding fixed.

## E2E Verification

For every finding show:

* endpoint/flow tested
* expected result
* actual result
* test location

## Before vs After

| Area                  | Before | After |
| --------------------- | ------ | ----- |
| Critical              |        |       |
| High                  |        |       |
| Medium                |        |       |
| MVP fully implemented |        |       |
| MVP partial           |        |       |
| MVP broken            |        |       |

## Remaining Issues

List ONLY genuine remaining issues.

Do not hide anything.

## Validation Results

Report exact results for:

* QA
* E2E
* lint
* build
* other project quality gates

## Files Changed

List the files modified and explain briefly why each was changed.

---

# ABSOLUTE RULES

1. Do not rewrite the application.
2. Do not weaken existing security.
3. Do not remove tests to make the suite pass.
4. Do not change requirements to match implementation.
5. Do not mark a feature complete because the UI exists.
6. Do not rely on client-side authorization.
7. Do not trust client-supplied user IDs, roles, prices or booking state.
8. Do not introduce unnecessary dependencies.
9. Do not leave TODOs for any Critical, High or Medium finding.
10. Every fix must have E2E/regression verification.
11. Preserve all currently working functionality.
12. Prefer the smallest correct change that fully satisfies the requirement.
13. If you discover a related concrete security/business-rule defect while fixing these issues, fix it rather than knowingly leaving an equivalent bypass.
14. Do not stop after the first successful test. Run the complete validation suite.

Start by reading the audit and requirements documents, then inspect the relevant implementation and create a concise remediation plan.

Proceed to implementation after the analysis; this is an execution task, not an audit-only task.
