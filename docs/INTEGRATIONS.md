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
| Social sign-in | `DevOAuthProvider` (local identity, non-production only) | **Google**, **Apple** — authorization-code flow, configured in the admin panel | optional `OAUTH_PROVIDER` |
| Geocoding | `LocalTableGeocodingProvider` | **Google Geocoding API** | `GEOCODING_PROVIDER` |
| Meeting links | `MockMeetingProvider` | **Zoom**, **Google Meet**, **Microsoft Teams** — any combination | `MEETING_PROVIDER` |
| File storage | `LocalStorageProvider` (automatic fallback) | **MinIO** — S3-compatible object storage | the four `STORAGE_*` credentials |

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

Social sign-in is the exception to "every selector must name a provider":
it is additive and configured from the admin panel, so an unset or incomplete
`OAUTH_PROVIDER` is reported as a notice and never stops a production boot
(§3 below).

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
| `POST https://<domain>/api/webhooks/payments` | `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.succeeded`, `refund.created`, `refund.updated` |
| `POST https://<domain>/api/webhooks/payments?connect=1` | `account.updated`, `transfer.created`, `transfer.reversed`, `payout.paid`, `payout.failed` |

`refund.created` / `refund.updated` are what reconcile a refund issued from
Stripe's own dashboard. `charge.refunded` is still accepted, but from Stripe's
2022-11-15 API version it no longer arrives with its `refunds` list expanded,
so it no longer carries the refund id this application dedupes on — the
handler says so explicitly rather than reporting "already known" and losing
the refund.

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
- **Retryable** — a delivery that *failed* is reprocessed when Stripe
  redelivers it. A duplicate is only dropped once the first attempt actually
  succeeded; otherwise a one-minute Mongo blip would wedge that event forever,
  because the redelivery is the recovery mechanism. Re-claiming is safe
  precisely because the handlers assert state rather than transition it.

### When the webhook never arrives

A webhook can be lost: an endpoint that was down, a forwarder that was not
running, a signing secret rotated mid-flight. Unreconciled, that is the worst
outcome this application has — the purchaser is charged, no event arrives, and
the `booking-expiry` sweep releases the lesson they paid for.

So before releasing any hold, `expireStaleBookings()` asks Stripe directly
what happened to each unpaid payment
(`providerPaymentStatus()` → `paymentIntents.retrieve`). This is still the
backend as the source of truth — it is Stripe's API answering, not a browser:

| Stripe says | What happens |
|---|---|
| paid | settled and the lessons confirmed, exactly as the webhook would have, audited with `source: "reconciliation"` |
| not paid | the slot is released as normal |
| cannot be asked | **the hold is kept** and retried next run |

The last row is the important one. A slot held ten minutes too long is
recoverable; a paid lesson deleted because we guessed is not. An amount that
disagrees with the priced total also settles nothing and keeps the hold, for a
human to look at.

The development provider has no remote state and is never consulted — its
`getPaymentStatus()` refuses rather than returning a fabricated success.

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
declined, `4000 0025 0000 3155` requires 3-D Secure.

```bash
# 1. test keys in .env.local — the key's prefix decides the mode, not APP_ENV
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_…

# 2. forward Stripe's real deliveries to the dev server, and copy the
#    whsec_… it prints into STRIPE_WEBHOOK_SECRET before restarting
stripe listen --forward-to localhost:3000/api/webhooks/payments

# 3. replay a specific event to exercise a handler, or the same event twice
#    to prove idempotency
stripe trigger checkout.session.completed
stripe events resend evt_…
```

**No publishable key is required.** Checkout is hosted by Stripe and the
purchaser is redirected to it, so no Stripe code runs in the browser and there
is no client-side key to expose.

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
| Password reset code | `passwordResetCode` | Forgot password, resend — six digits, 10 min, no link |
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

### Without a mail server

`ConsoleEmailProvider` prints each message to the server log and keeps a copy
in the development mailbox — `/dev/mail` for a person, `GET /api/dev/mail?to=`
for a script — until the server restarts. That is how a forgot-password code is
read locally, and how `bun run qa` and `bun run e2e` read it. The mailbox is a
404 and records nothing unless `NODE_ENV` and `APP_ENV` are both
non-production and mail really is going to the console, so it cannot exist on
any `next build`. See [PASSWORD_RESET.md](PASSWORD_RESET.md).

---

## 3. Social sign-in — Google and Apple

**Continue with Google** and **Continue with Apple** are configured, switched
on and switched off entirely from the admin panel. Rotating a credential or
turning a method on or off needs no `.env` edit, no code change and no
redeploy: the change applies to the next sign-in attempt. Email and password
sign-in always keeps working, whatever this module says.

### Where

**Admin → Platform settings → External modules → Social sign-in**
(`/admin/settings/integrations`). Reaching it — reading, saving, validating
or clearing — requires `ADMIN_INTEGRATION_MANAGE`, the same permission as
every other external module; parents and tutors get 403, anonymous callers
401.

### One-time provider setup (outside APlus Learn)

Done once per provider, by whoever owns the Google Cloud project or the Apple
Developer account. The admin panel shows the exact redirect URI and domain to
register, with a copy button, under each provider — they are derived from
`NEXT_PUBLIC_APP_URL` and are not editable, because they are the routes this
build serves.

**Google Cloud Console → APIs & Services**

1. **OAuth consent screen**: app name, support email, logo, authorised domain;
   scopes `openid`, `email`, `profile`. Publish it (a consent screen left in
   *Testing* only admits the test users you list).
2. **Credentials → Create credentials → OAuth client ID → Web application.**
3. **Authorised redirect URIs**: `https://<domain>/api/auth/oauth/google/callback`
   (copy it from the panel). No JavaScript origin is needed — no Google
   script runs on the page.
4. Keep the **Client ID** and **Client secret** for the panel.

**Apple Developer → Certificates, Identifiers & Profiles** (requires a paid
Apple Developer Program membership)

1. **Identifiers → App IDs**: an App ID with *Sign in with Apple* enabled.
2. **Identifiers → Services IDs**: create one (e.g. `ca.apluslearn.web`) —
   this identifier is the *Services ID* the panel asks for, not the App ID.
   Enable *Sign in with Apple* → Configure → pick the App ID, then add
   - **Domains and Subdomains**: `<domain>` (no scheme)
   - **Return URLs**: `https://<domain>/api/auth/oauth/apple/callback`
3. **Keys → +**: a key with *Sign in with Apple* enabled, bound to that App ID.
   Download the `.p8` file — Apple lets you download it **once**. Note its
   **Key ID**.
4. Your **Team ID** is under *Membership details*.

Apple only redirects to `https://` return URLs on a registered domain, so
Apple sign-in cannot be completed against `localhost`. Test it on a staging
host with a real certificate.

### Ongoing configuration (in the admin panel)

| Provider | Field | Secret | Notes |
|---|---|---|---|
| Google | Client ID | no | Must end in `.apps.googleusercontent.com` |
| Google | Client secret | **yes** | Write-only |
| Apple | Services ID | no | Reverse-domain identifier |
| Apple | Team ID | no | 10 capital letters/digits |
| Apple | Key ID | no | 10 capital letters/digits |
| Apple | Private key (.p8) | **yes** | Paste the whole file including the `BEGIN`/`END` lines; line breaks lost in the paste are rebuilt. It is parsed on save — anything that is not a P-256 key is refused |

**Switching a method on and off.** A method appears on the sign-in and
registration pages only when *all three* hold:

1. the module switch **Social sign-in is on** is on,
2. the provider is **ticked** under *Platforms*, and
3. every required field is present and readable.

Each provider shows its own state: *Not configured*, *Configured, switched
off*, *Enabled* (with *· validated* after a passing check), or *Needs
attention* with the reason (missing fields, a credential that no longer
decrypts, or a failed validation). Unticking a provider switches it off but
keeps its credentials, so ticking it again restores it; **Remove this
configuration** destroys the stored credentials.

The server refuses to switch a provider on until its credentials are
complete — the save fails with the missing fields named against the fields
themselves. Saving an incomplete provider while the module is off is allowed,
so credentials can be entered before a method goes live.

**Validate credentials** makes a real, side-effect-free call to each ticked
provider's token endpoint with a code that cannot succeed: `invalid_grant`
means the credentials were accepted, `invalid_client` means they were not. For
Apple this signs a real client secret, so it proves the Services ID, Team ID,
Key ID and key belong together. It creates no user and no session, and it can
run while the module is still off. It cannot prove the redirect URI is
registered — only a real sign-in shows that.

**Rotating a credential**: type the new value into the secret field and save.
A blank secret field means "keep what is stored". The old value is never
shown.

### How a sign-in works

```
Browser                       APlus Learn                             Provider
  │ click "Continue with Google"   │                                      │
  ├── GET /api/auth/oauth/google ─▶│ module on? ticked? complete?        │
  │                                │ mint state, nonce, PKCE verifier     │
  │◀── 302 + encrypted cookie ─────┤                                      │
  ├──────────────────────── authorize (client_id, redirect_uri, state, nonce, PKCE) ─▶│
  │◀─────────────────────────────────────────── redirect with code + state ───────────┤
  ├── GET|POST …/callback ────────▶│ cookie opened, state compared        │
  │                                │ provider re-checked as still enabled │
  │                                ├── code + secret (+ verifier) ───────▶│ token endpoint
  │                                │◀───────────────────────── ID token ──┤
  │                                │ verify signature (JWKS), iss, aud,   │
  │                                │ exp, nonce → account rules below     │
  │◀── 303 + session cookie ───────┤                                      │
```

Google returns with a GET. Apple returns with a cross-site POST
(`response_mode=form_post`, mandatory when asking for name and email). Each
callback accepts only its provider's method. A failure — cancelled, expired,
forged, switched off meanwhile — lands back on the sign-in or registration
page with a fixed message and no session.

### Security

- **Secrets**: the Google client secret and the Apple private key are
  AES-256-GCM encrypted under `aplus:integration-secret` in the `Integration`
  collection (`select: false`), never in `Settings`. No endpoint returns them;
  the panel shows only whether one is stored and when it changed. Apple's
  client secret is an ES256 JWT minted per request with a five-minute life.
- **Nothing reaches the browser**: no provider script runs on the page, so
  neither secret nor client ID is sent to it. The authorization URL carries
  only public values. Content-Security-Policy needed no change.
- **State / CSRF**: the attempt's state, nonce and PKCE verifier live in the
  `aplus_oauth_tx` cookie — httpOnly, AES-256-GCM encrypted under its own
  label, scoped to `/api/auth/oauth`, ten-minute life, consumed on success
  and failure. A callback whose state does not match it is refused before
  the code is redeemed. Google's is `SameSite=Lax`; Apple's is
  `SameSite=None; Secure` so it survives Apple's cross-site POST.
- **Replay**: the ID token must carry the nonce minted for this attempt, and
  be under ten minutes old.
- **Redirect URI**: built from `NEXT_PUBLIC_APP_URL`, never from the request,
  so a forged `Host` header cannot redirect a code.
- **Enforced server-side**: a method that is off is refused by the start
  endpoint (no redirect to the provider), again by the callback (so an attempt
  already in flight is cut off), and by the development-identity endpoint.
  Hiding the button is presentation only.
- **Rate limits**: 20 starts and 20 callbacks per client per ten minutes.
- **Audit**: every save is `INTEGRATION_UPDATED`; each provider switched on or
  off is its own `INTEGRATION_ENABLED` / `INTEGRATION_DISABLED` entry naming
  the provider; a new client secret or key is `INTEGRATION_SECRET_ROTATED`
  naming the field; validations are `INTEGRATION_TESTED`. Values are never
  recorded, and the audit reader additionally redacts anything shaped like a
  PEM private key or a Google client secret.
- **Logs**: provider error bodies are never logged or shown; only the short
  OAuth error code is used.

### Environment variables

**No Google or Apple credential requires `.env`.** Two infrastructure values
matter, and neither is specific to social sign-in:

- `NEXT_PUBLIC_APP_URL` — the public `https://` origin. The redirect URIs are
  derived from it, so it must be the address users actually visit.
- `AUTH_SECRET` — the key the stored credentials and the transaction cookie
  are encrypted under. Rotating it makes stored credentials unreadable; the
  panel then shows *Needs attention* and they must be entered again.

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `APPLE_CLIENT_ID`, `APPLE_TEAM_ID`,
`APPLE_KEY_ID`, `APPLE_PRIVATE_KEY` and `OAUTH_PROVIDER=google,apple` remain an
**optional bootstrap**, like every other module: the panel's *Import from
environment* copies them into encrypted storage, after which the panel wins
field by field. `OAUTH_PROVIDER` is not required in production — social
sign-in is additive, so an unset or incomplete environment is a boot notice,
never a boot failure.

### Development

With nothing configured anywhere on a non-production deployment, the buttons
use a local test identity (a prompt for an email address) and say so under the
buttons. The moment the module is saved, what was saved is the whole answer —
a provider left unticked is hidden in development too. The test identity is
refused in production and whenever a real provider is configured.

### Upgrading from the ID-token flow

Earlier builds used Google Identity Services / Apple JS in the browser with
only a client ID, and a separate switch under *Settings → Features*. That
switch is gone — the module is the one control — and the code flow needs the
Google client secret and the Apple Team ID, Key ID and `.p8` key. A deployment
with only `GOOGLE_CLIENT_ID` in its environment will show Google as *Needs
attention — Missing: Client secret* until the secret is added in the panel.
Register the new redirect URIs above; the old `/login` Apple return URL can be
removed.

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

## 5pre. Meeting links — when there is no integration at all

Zoom, Google Meet and Microsoft Teams below are real adapters against real
APIs. They need credentials, and a deployment that has none for the platform a
learner chose falls back to the development provider's deterministic link.

That is fine for development and not fine for a family who has paid. So a room
can also be supplied by a **person**: the tutor teaching the lesson, or an
administrator, enters the joining details of a meeting they have already set up
in their own account, through the meeting panel on the lesson
(`POST /api/bookings/:id/meeting`, `POST /api/tutor/groups/:id/meeting`).

Such a room is stored with `source: "MANUAL"` and that distinction has teeth.
This application never calls a provider API about one — a reschedule does not
move it and clearing it does not delete it — because it is a resource in
somebody else's account and acting on it would destroy or move something the
platform does not own. The UI says so wherever a manual room is shown.

This is deliberately *not* a fake integration. Nothing claims to have created a
Zoom meeting. The application manages the configuration and the lifecycle, and
the same endpoint keeps working unchanged when real credentials arrive — at
which point `retry` asks the adapter for a room and stores it as `PROVIDER`.

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

---

## 5b. Meeting links — Google Meet

```
MEETING_PROVIDER=google_meet          # or "zoom,google_meet,microsoft_teams"
GOOGLE_MEET_CLIENT_EMAIL=rooms@<project>.iam.gserviceaccount.com
GOOGLE_MEET_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n"
GOOGLE_MEET_IMPERSONATE=rooms@your-domain.ca
GOOGLE_MEET_CALENDAR_ID=primary
```

Google has no API that mints a standalone Meet room — a Meet belongs to a
calendar event — so the adapter creates an event on a calendar the platform
owns, asks Google to attach a conference to it, and keeps the `hangoutLink`.

**Google Cloud → IAM → Service Accounts**, create a JSON key, and enable the
Google Calendar API on the project. Then **Workspace Admin → Security → API
controls → Domain-wide delegation**: add the service account's client id with
the scope `https://www.googleapis.com/auth/calendar.events`. The adapter signs
its own JWT assertion with that key and exchanges it for a bearer token — the
same shape as Zoom's Server-to-Server grant, and for the same reason.

`GOOGLE_MEET_PRIVATE_KEY` keeps the JSON file's literal `\n` escapes; the
adapter unescapes them. A malformed key fails with a clear error that never
echoes any of the key material.

**The event is created with no attendees.** Adding the learner and tutor would
be the obvious thing and is deliberately not done: it would put a child's
email address into Google's calendar, send invitations this application did
not ask for, and expose each participant's address to the other. The event is
`private`, guests cannot invite others or see each other, and the application
distributes the link itself. Only the event id and the Meet link are stored.

---

## 5c. Meeting links — Microsoft Teams

```
MEETING_PROVIDER=microsoft_teams      # or "zoom,google_meet,microsoft_teams"
MS_TEAMS_TENANT_ID=…
MS_TEAMS_CLIENT_ID=…
MS_TEAMS_CLIENT_SECRET=…
MS_TEAMS_USER_ID=…                    # the organiser account's object id
```

Graph's `onlineMeetings` resource is the closest of the three to what the
application wants: a standalone meeting with a join link, no calendar event
and no invitations.

**Entra ID → App registrations**, add a client secret, and grant the
*application* permission `OnlineMeetings.ReadWrite.All` with admin consent.
Then scope the app to one organiser account, so a leaked client secret cannot
create meetings as arbitrary users:

```powershell
New-CsApplicationAccessPolicy -Identity APlusLearn `
  -AppIds <client-id> -Description "APlus Learn meeting rooms"
Grant-CsApplicationAccessPolicy -PolicyName APlusLearn `
  -Identity <organiser-object-id>
```

That organiser is a service account and never attends, so the lobby is set to
let the two participants straight in — an empty lobby nobody can be admitted
from would simply mean no lesson. The link is the secret, and it is private to
the purchaser and the tutor.

**`audioConferencing` and `joinInformation` are dropped.** The first carries a
dial-in conference id that works as a credential; the second carries the
organiser's identity. Neither is returned, stored or logged. No participant is
named to Microsoft.

---

## 5d. Choosing between them

`MEETING_PROVIDER` is the one selector that takes a **comma-separated list**,
because §27 lets a learner pick a platform per booking from the ones their
tutor teaches on:

```
MEETING_PROVIDER=zoom,google_meet     # Teams bookings get a development link
```

A platform that is not listed falls back to the development provider's
deterministic room link rather than failing the booking. A platform that *is*
listed but is missing a secret is a hard startup failure, as everywhere else.

The learner's choice is stored on the booking at creation time — validated
against the tutor's own `onlineMeetingProviders` — and read back when the room
is created, which happens after payment, on a verified webhook that has no
access to the original request. No meeting provider is ever taken from a
request body at confirmation time.

All three behave identically from the application's point of view: create
after payment, PATCH on reschedule so an existing join link keeps working,
DELETE on cancellation, and a provider outage leaves the booking confirmed
with the link to be filled in later rather than losing a paid lesson.

---

## 6. File storage

### Two modes, chosen automatically

File storage always has somewhere to put a file. Which of the two stores is
live is decided in exactly one place — `describeStorageMode()` in
[`src/services/external/storage-provider.js`](../src/services/external/storage-provider.js)
— from one question:

| Are `STORAGE_ENDPOINT`, `STORAGE_BUCKET`, `STORAGE_ACCESS_KEY` and `STORAGE_SECRET_KEY` **all** set? | Mode | Where files go |
|---|---|---|
| Yes | `EXTERNAL` | Straight to that S3-compatible endpoint. Nothing is written locally first. |
| No — any one of them missing or blank | `LOCAL` | `.storage/` on the application's own filesystem (`STORAGE_LOCAL_DIR` moves it). |

`STORAGE_REGION` and `STORAGE_PREFIX` are optional and never affect the
choice: without a region the client default (`us-east-1`, which is also
MinIO's) applies, and without a prefix objects sit at the root of the bucket.

Local mode is a **real store**, not a stub: uploads, reads, metadata and
deletes all work, and the `storageKey` written to the database is the same
provider-independent value in both modes — a bare filename, never a path,
never a URL, never a bucket. A deployment can therefore move from one mode to
the other without touching a single stored document.

Nothing outside the provider reads a `STORAGE_*` variable or asks which mode
is live. Routes and services call `getStorageProvider()` and use the
interface:

```
StorageProvider   put · get · head · exists · remove · verify
  ├── LocalStorageProvider    .storage/<scope>/<uuid>.<ext>
  └── ObjectStorageProvider   <bucket>/<prefix>/<scope>/<uuid>.<ext>
```

Which mode is live is printed at boot and again on first use, with no
credential in either line:

```
  ● File storage   MinIO (S3-compatible object storage)
[storage] EXTERNAL — bucket "aplus-learn" at minio.example.com

  ○ File storage   Local filesystem (.storage/)
[storage] LOCAL — uploads are written to .storage/ because STORAGE_BUCKET … are not set.
```

`storageDiagnostics()` returns the same facts to the admin panel, and the
integrations **Test connection** button reports local mode as
`NOT_CONFIGURED` rather than as a passing object-store check — pressing it
asks about the bucket, and a green tick for the local disk would not be an
answer.

**Local mode in production is a real risk, and it is allowed anyway.** A host
with an ephemeral filesystem accepts a tutor's identity document and then
loses it on the next deploy, and nothing is shared between instances. The
platform warns loudly rather than refusing to boot, because a deployment that
has not been given a bucket yet is still a working application. A deployment
that would rather fail than store uploads on its own disk sets
**`STORAGE_REQUIRE_EXTERNAL=true`**, which turns the fallback back into a
start-up-time and point-of-use error naming the variables to set.

Two rules the fallback does **not** bend:

- **A stored credential that will not decrypt** — the usual consequence of
  rotating `AUTH_SECRET` — is an error state, never a fallback. Silently
  writing new uploads to disk while older ones sit in a bucket nobody can open
  would split one deployment's files across two stores and look like it had
  worked.
- **A provider name this build does not know** (`STORAGE_PROVIDER=s3`) is a
  typo with a correct value behind it, so it is refused by name. Absence falls
  back; a mistake does not.

### Scopes

Two scopes, both written outside `public/`. Nothing is ever written into the
served web root — a writable directory inside it is how an upload feature
becomes a remote-code-execution feature.

| Scope | Location | Audience |
|---|---|---|
| `documents` | `.storage/documents/` or `<bucket>/<prefix>/documents/` | Private. Verification paperwork, served only through the audited admin route. The storage key is `select: false` on the model so it cannot leak through a serialised document. |
| `branding` | `.storage/branding/` or `<bucket>/<prefix>/branding/` | Public *content*, private *files*. Logos and icons uploaded at Admin → Platform settings, served by `/api/branding/[asset]`. |

Branding assets are addressed by **setting name**, never by storage key: the
route resolves `logo`, `favicon`, `appleTouchIcon`, `logoDark` or `ogImage`
against the settings document, so the only files it can ever return are the
five an administrator chose. There is no key to guess and nothing to enumerate.
Uploads are identified from their own magic bytes rather than the declared
content type, bounded by size and dimensions per asset, and SVG is refused
outright — it is a script-capable document, not a picture. Responses carry
`X-Content-Type-Options: nosniff` and, when versioned, an immutable cache
policy; replacing an asset changes the `?v=` every page emits, so a new file is
a new URL.

Verification documents get the same treatment and more. The content type is
read from the bytes and must agree with what the upload claimed, so a script
relabelled `application/pdf` is refused rather than stored. The uploader's
filename is kept only as a label — control characters, path separators and
quotes are stripped from it, because it is later echoed in a
`Content-Disposition` header — and the file is stored under a generated UUID.
The admin retrieval route answers with `nosniff`, a `sandbox` content-security
policy and `no-store`.

### Local mode

```
# nothing at all — this is the default
STORAGE_LOCAL_DIR=.storage    # optional; relative paths resolve against the project root
```

Keys are generated (`<uuid><ext>`), never derived from the uploader's
filename, and the original name is kept only as a label on the database
record — it is what an administrator sees and what the
`Content-Disposition` header carries, and it is re-sanitised on the way out.
Writes use `wx`, so an upload can never replace a file that is already there.
A stored key is reduced to a bare object name and then checked against
`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` before it reaches the filesystem, and the
resolved path is proved to be inside its scope directory, so `../`, `..\`,
a percent-escape, a NUL or an absolute path addresses nothing. A missing
object answers 404 with no filesystem path in the message — the directory is a
location the client is never told.

The directory is created on demand, sits outside `public/` and outside `src/`,
and is git-ignored, so an uploaded file can be neither served directly nor
committed.

### External mode — MinIO and any S3-compatible store

```
STORAGE_ENDPOINT=https://minio.example.com   # the S3 API root, not the console
STORAGE_BUCKET=aplus-learn
STORAGE_ACCESS_KEY=…
STORAGE_SECRET_KEY=…
STORAGE_REGION=us-east-1      # optional — MinIO's default, and the client's
STORAGE_PREFIX=prod           # optional — one bucket, several environments
STORAGE_FORCE_PATH_STYLE=true # MinIO serves path-style
STORAGE_SSE=                  # leave unset for MinIO — see below
STORAGE_TIMEOUT_MS=20000
```

`ObjectStorageProvider` speaks the S3 API directly — SigV4 signed with
`node:crypto`, no SDK — so the same adapter runs unchanged against MinIO,
Amazon S3, Cloudflare R2, Backblaze B2 and DigitalOcean Spaces. Adding tens of
megabytes of SDK to the server bundle for four operations would be the same
trade `lib/images/inspect.js` already declines. The SigV4 implementation is
tested against AWS's own published signature vector, which MinIO implements
identically.

**`STORAGE_SSE` must stay unset on MinIO.** MinIO answers `NotImplemented` to
a per-object `x-amz-server-side-encryption` header unless a KMS is configured,
which would fail every upload. Encrypt at the bucket or volume level instead.
On Amazon S3, set it to `AES256`.

**The bucket must be private, and no configuration makes it otherwise.**
Nothing in the application hands out an object URL, and **there is no
presigned-URL code path** — deliberately. A signed link is a bearer token for
a file: it can be forwarded, logged by an intermediary, and used after the
session that minted it has ended. Both scopes are instead fetched server-side
and streamed through a route that has already authorised the caller, which is
strictly stronger and is the model every consumer of the interface is written
against. The provider sets no ACL and generates every key as a UUID under its
scope prefix. Grant the credentials `GetObject`, `PutObject` and
`DeleteObject` on `<bucket>/<prefix>/*` and nothing else.

### Verifying the configuration

```bash
bun run storage:check              # credentials open the bucket
bun run storage:check --roundtrip  # and a file survives put → get → head → delete
```

The check reads the same `STORAGE_*` variables the application does, prints
the endpoint, bucket, prefix and addressing mode, and never prints a
credential. Failures are named rather than generic: a 403 says the credentials
are wrong or under-permissioned, a 404 distinguishes a missing object from a
missing bucket, a 501 names `STORAGE_SSE`, and a DNS or TLS failure is tagged
as a storage error with the endpoint host rather than escaping raw. Anything
the store echoes back has the access key and secret redacted out of it before
it reaches a log.

`STORAGE_PROVIDER` is optional: the four credentials above are what select
the object store. Setting it to `development` forces local mode even when a
bucket is configured, and the diagnostic then says *that* is the reason rather
than blaming variables the operator has already set.

### Migrating an existing deployment

`storageKey` in the database is the object's *filename* — never a URL, never a
bucket, never a path — so moving between providers changes nothing in Mongo.

```bash
bun run storage:migrate --dry-run   # list what would be copied
bun run storage:migrate             # copy .storage/** into the bucket
```

Filenames are preserved exactly, because they are the keys the database
already holds. Objects already present are skipped, so the command is safe to
re-run. The content type is re-derived from the bytes on the way in, exactly
as the upload path does it, rather than guessed from the extension. Nothing is
deleted from `.storage/` — set the four credentials, restart, confirm a
document opens under **Admin → Verification**, and remove the directory
yourself once you are satisfied. Files uploaded in either mode keep resolving,
because the key never encoded which store wrote it.


---

## Secrets

Only `NEXT_PUBLIC_*` values reach the browser, and the only one that exists is
`NEXT_PUBLIC_APP_URL`. Social sign-in runs entirely server-side, so not even
the Google and Apple client IDs are sent to a browser.

Server secrets (`MONGODB_URI`, `AUTH_SECRET`, `STRIPE_*`, `RESEND_API_KEY`,
`GOOGLE_MAPS_API_KEY`, `ZOOM_*`) are read only inside `server-only` modules.
`integrationStatus()` reports provider *names* and missing variable *names*;
it never reports a value, and the QA suite asserts that.

No secret is stored in, or reachable through, platform settings. The admin
settings console *reports* integration status and cannot edit it; the settings
document holds branding, metadata, contact details, marketplace rules and
feature flags, and nothing else. The QA suite asserts the settings payload
matches no credential pattern.

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
