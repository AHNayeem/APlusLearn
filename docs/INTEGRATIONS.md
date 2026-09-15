# Production integrations

How APlus Learn talks to the outside world, and what has to be configured
before it can.

Every integration sits behind an interface in
[`src/services/external/`](../src/services/external/). No service, route or
component names a provider — they call `getPaymentProvider()`,
`getEmailProvider()` and so on, and
[`src/lib/config/env.js`](../src/lib/config/env.js) decides what those return.
Connecting a different provider means writing one class and adding one branch
to one factory.

---

## At a glance

| Integration | Development | Production | Selector |
|---|---|---|---|
| Payments | `MockPaymentProvider` | **Stripe** — Checkout + Connect Express | `PAYMENT_PROVIDER` |
| Email | `ConsoleEmailProvider` | **Resend** | `EMAIL_PROVIDER` |
| OAuth | `DevOAuthProvider` | **Google**, **Apple** — OIDC ID tokens | `OAUTH_PROVIDER` |
| Geocoding | `LocalTableGeocodingProvider` | **Google Geocoding API** | `GEOCODING_PROVIDER` |
| Meeting links | `MockMeetingProvider` | **Zoom** — Server-to-Server OAuth | `MEETING_PROVIDER` |
| Document storage | `LocalStorageProvider` | *(not implemented — see below)* | — |

## How a provider is chosen

```
APP_ENV=development   →  auto-detect. Whatever has credentials is used;
                         everything else falls back to a working fake.

APP_ENV=production    →  nothing is auto-detected. Every selector must name a
                         provider explicitly, and naming a real one without
                         its secrets stops the server starting.
```

Two selectors refuse `development` outright once `APP_ENV=production`:
`PAYMENT_PROVIDER` and `EMAIL_PROVIDER`. There is no configuration in which a
production deployment takes fake money or silently swallows a password-reset
email. The other three may be set to `development` deliberately — a coarse
geocode or a manually-hosted meeting is a degradation, not a fraud — and the
admin panel at **Admin → Platform settings → Integrations** shows plainly
which ones are running that way.

Validation runs once at start-up from
[`src/instrumentation.js`](../src/instrumentation.js): a warning in
development, a refusal to boot in production.

---

## 1. Payments — Stripe

### Model

Charges use **hosted Stripe Checkout**. The card is entered on Stripe's page
and never reaches this application, which keeps the deployment out of PCI
scope. Payouts use **Connect Express with separate charges and transfers**:
the platform takes the whole lesson total, and the tutor's share is
transferred later, once the booking has cleared the hold period set in
platform settings. That is exactly the flow
[`payout.service.js`](../src/services/payout.service.js) already implements.

```
Parent            Book → hosted Checkout → pay → webhook → booking confirmed
Platform          Student payment → commission → tutor earnings → payout
Tutor             Connect onboarding → earnings → transfer
```

Every amount comes from the `Payment` document, which was priced by
[`lib/booking/pricing.js`](../src/lib/booking/pricing.js). Every refund amount
comes from [`lib/booking/policy.js`](../src/lib/booking/policy.js). Stripe is
told what to charge; it is never asked what to charge.

### Environment

```
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_live_…            # or sk_test_… for test mode
STRIPE_WEBHOOK_SECRET=whsec_…          # account endpoint
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_…  # Connect endpoint (falls back to the above)
```

The key's own prefix decides live vs test mode — `APP_ENV` never does. Each
`Payment` records which mode it was taken in.

### Webhook endpoints

| Endpoint | Events |
|---|---|
| `POST https://<domain>/api/webhooks/payments` | `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.succeeded`, `charge.refunded`, `payout.paid`, `payout.failed` |
| `POST https://<domain>/api/webhooks/payments?connect=1` | `account.updated`, `transfer.created`, `transfer.reversed` |

**A booking is confirmed only by a verified webhook.** The browser returning
from Stripe lands on `/bookings/checkout/<id>/complete`, which shows a waiting
state and polls — it cannot confirm anything itself.

Processing guarantees, in [`webhook.service.js`](../src/services/webhook.service.js):

- **Verified** — the signature is checked against the raw request body before
  the database is touched. The route reads `request.text()`, never
  `request.json()`; re-serialising would break every signature.
- **Idempotent** — a unique index on `(provider, eventId)` in the
  `WebhookEvent` collection claims each event once. Retries and manual replays
  are acknowledged and dropped.
- **Order-independent** — handlers assert state rather than transition it. A
  late `payment_intent.payment_failed` cannot un-pay a settled payment.
- **Amount-checked** — an event whose amount disagrees with the priced total
  is refused outright.

### Stripe dashboard setup

1. **Connect → Settings** — enable Express accounts, set the platform name,
   branding, and support contact.
2. **Connect → Onboarding** — set the return and refresh URLs to
   `https://<domain>/tutor/payouts`.
3. **Developers → Webhooks** — add the two endpoints above and copy each
   signing secret into the matching environment variable.
4. **Settings → Payouts** — connected accounts are created on a *manual*
   payout schedule so the platform's own hold period governs when money moves.

### Testing

Stripe test mode: `4242 4242 4242 4242` succeeds, `4000 0000 0000 0002` is
declined, `4000 0025 0000 3155` requires 3-D Secure. Replay webhooks locally
with `stripe listen --forward-to localhost:3000/api/webhooks/payments`.

---

## 2. Email — Resend

Chosen over SES, SendGrid and Postmark because it needs nothing but an API key
and a verified sending domain: no SDK, no IAM policy, no sub-account model.
The adapter is one `fetch` call.

```
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_…
EMAIL_FROM="APlus Learn <no-reply@apluslearn.ca>"
EMAIL_REPLY_TO="support@apluslearn.ca"
```

### Domain setup

Verify the sending domain in Resend and publish the DNS records it gives you —
SPF, DKIM, and a DMARC policy. `EMAIL_FROM` must be on that domain. Until it
is, Resend rejects the message and the adapter surfaces its reason.

### What gets sent

| Flow | Template | Trigger |
|---|---|---|
| Email verification | `verifyEmail` | Registration, resend |
| Password reset | `resetPassword` | Forgot password |
| Password changed | `passwordChanged` | Reset or change — a security notice, carries no token |
| Booking confirmed | `bookingConfirmed` | Payment settles — to purchaser *and* tutor |
| Booking cancelled | `bookingCancelled` | Any cancellation path |
| Booking rescheduled | `bookingRescheduled` | Reschedule |
| Refund issued | `refundIssued` | Refund |
| Application received / approved / needs attention | `applicationSubmitted`, `applicationApproved`, `applicationNeedsAttention` | Tutor lifecycle |
| Payouts enabled / paused | `payoutsEnabled`, `payoutOnboardingRequired` | Connect account state change |
| Payout sent | `payoutSent` | Payout marked paid |

In-app messages do **not** generate email. Notification email respects the
per-user channel preference on `User.notificationPreferences`.

Templates live in
[`email-templates.js`](../src/services/external/email-templates.js). Each is a
pure function of an already-prepared payload — amounts and policy outcomes
arrive pre-formatted, so a copy change cannot move a business rule. Every
template renders a branded, responsive, table-based HTML part *and* a real
plain-text part from the same description, so the two cannot drift.

Delivery is best-effort by design: `sendEmail()` logs and returns rather than
throwing, so a bounced confirmation never undoes the booking it announces. The
password-reset path relies on this — surfacing a delivery error there would
turn the endpoint into an account-enumeration oracle, because it only ever
sends for an address that exists.

---

## 3. OAuth — Google and Apple

### Model

The browser obtains an **ID token** from the provider's own client library and
posts it to `/api/auth/oauth`. The server verifies the signature against the
provider's published JWKS and checks issuer, audience, expiry and nonce. There
is no authorization-code exchange and therefore no client secret and no
redirect callback to defend.

```
OAUTH_PROVIDER=google
GOOGLE_CLIENT_ID=….apps.googleusercontent.com
APPLE_CLIENT_ID=ca.apluslearn.web     # the Services ID, not the App ID
```

### CSRF and replay protection

`GET /api/auth/oauth/nonce` mints a single-use nonce, returns it for the
client library, and stores it in an httpOnly cookie. The ID token's `nonce`
claim must match that cookie. A token captured elsewhere, or replayed later,
cannot satisfy both. The cookie is consumed whether the attempt succeeds or
fails.

### External configuration

**Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application)**

- Authorised JavaScript origins: `https://<domain>`
- Authorised redirect URIs: *none needed* — the One Tap / popup flow uses no redirect.
- Configure the OAuth consent screen (app name, support email, logo, scopes: `openid email profile`).

**Apple Developer → Certificates, Identifiers & Profiles**

- Create an **App ID**, then a **Services ID** — the Services ID is `APPLE_CLIENT_ID`.
- Under the Services ID → Sign in with Apple → Configure:
  - Domains: `<domain>`
  - Return URLs: `https://<domain>/login`
- Apple requires a paid Developer Program membership. `APPLE_TEAM_ID`,
  `APPLE_KEY_ID` and a private key are needed only for the
  authorization-code flow, which this integration does not use.

### Account rules

Enforced in [`auth.service.js`](../src/services/auth.service.js):

- **Linking by email requires a provider-verified address.** An unverified
  `email` claim cannot attach an identity to an existing account.
- **One identity, one account.** If a provider identity already belongs to
  someone else, the sign-in is refused rather than re-pointed.
- **Role is never granted by OAuth.** The requested role applies only when
  creating a brand-new account. An existing user's role and status are
  untouched; RBAC stays server-side.
- **Protected fields are not overwritten.** A provider-supplied name or
  avatar fills a blank and nothing more.
- Suspended and soft-deleted accounts are refused, exactly as on the password
  path.

---

## 4. Geocoding — Google Geocoding API

```
GEOCODING_PROVIDER=google
GOOGLE_MAPS_API_KEY=…
```

Restrict the key to the **Geocoding API** and to your servers' IP addresses.
It is read only in
[`geocoding-provider.js`](../src/services/external/geocoding-provider.js) and
must never be given a `NEXT_PUBLIC_` name.

### Privacy

A tutor's exact address is never geocoded, stored or published. Lookups are
built from a postal code, city and province — never a street address — and
every coordinate is passed through `coarsenCoordinates()` before it leaves the
module, rounding it to roughly a kilometre. Public pages expose city, province,
approximate distance, service radius and online/in-person availability, and
nothing finer. An in-person street address lives on the booking with
`select: false` and is released only to the two parties, only once the lesson
is confirmed.

Diagnostics log the provider's status and nothing else — never the postal code
or address that produced them.

### Failure handling

Lookups are component-filtered to Canada and time out after four seconds.
A failure, a rejected key, or a zero-result response degrades to the bundled
Ontario centroid table and then to `null`; search falls back to
non-geographic matching rather than erroring. Stored location data is never
overwritten with a failed lookup.

---

## 5. Meeting links — Zoom

```
MEETING_PROVIDER=zoom
ZOOM_ACCOUNT_ID=…
ZOOM_CLIENT_ID=…
ZOOM_CLIENT_SECRET=…
ZOOM_USER_ID=me          # host account email or id; "me" is the app owner
```

**Zoom App Marketplace → Develop → Build App → Server-to-Server OAuth.**
Scopes: `meeting:write:admin`, `meeting:read:admin`, `user:read:admin`. The
platform owns the meetings, so tutors need no Zoom account of their own.

Meetings are created with the waiting room on, join-before-host off, and
recording off. Rescheduling PATCHes the existing meeting so a join link
already in someone's calendar keeps working; cancelling deletes it so a stale
link stops resolving.

**The Zoom host `start_url` is never returned, stored or logged** — it
authenticates the host and would hand control of the meeting to anyone who saw
it. Only the meeting id, join URL and passcode are kept, on the booking, and
`getBooking()` releases them to the purchaser, the tutor and an administrator
and to nobody else. Public tutor profiles and search results never carry one.

Google Meet and Microsoft Teams reach the same `MeetingProvider` interface but
need a per-host OAuth grant (Google Calendar, Microsoft Graph) rather than an
account credential, so they are a configuration and consent exercise rather
than a code one.

---

## 6. Document storage

Verification documents are written outside `public/` to `./.storage/documents`
and served only through the audited admin route. The storage key is
`select: false` on the model so it cannot leak through a serialised document.

A production deployment should implement `StorageProvider` against an object
store with private ACLs and short-lived signed URLs. The interface is in
[`storage-provider.js`](../src/services/external/storage-provider.js); this is
the one integration with no production implementation yet.

---

## Secrets

Only `NEXT_PUBLIC_*` values reach the browser, and the only one that exists is
`NEXT_PUBLIC_APP_URL`. Client identifiers that a browser legitimately needs —
the Google and Apple client IDs — are served by `/api/auth/oauth/nonce` rather
than inlined at build time, so rotating one does not require a rebuild.

Server secrets (`MONGODB_URI`, `AUTH_SECRET`, `STRIPE_*`, `RESEND_API_KEY`,
`GOOGLE_MAPS_API_KEY`, `ZOOM_*`) are read only inside `server-only` modules.
`integrationStatus()` reports provider *names* and missing variable *names*;
it never reports a value, and the QA suite asserts that.

---

## Verifying a deployment

```bash
npx eslint src scripts     # lint
npm run build              # production build
npm run test:integrations  # adapter tests — no network, no third party
npm run dev & npm run qa   # end-to-end API suite over real HTTP
```

`npm run test:integrations` stubs `fetch`, signs Stripe webhooks with the real
signing scheme, and verifies OAuth tokens against a key pair generated in
process. It never contacts a third party, so it is safe in CI. The webhook
section needs MongoDB and reports as skipped without one.

Once real credentials are in place, smoke-test in sandbox mode: a test-mode
Stripe checkout and refund, a Connect onboarding run, an email to a controlled
address, a full Google sign-in and sign-out, a handful of Ontario postal codes,
and one online booking end to end.
