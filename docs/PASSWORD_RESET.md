# Forgot password

How a member who has forgotten their password gets back in (§9, §36): an
emailed six-digit code, then a new password, then sign-in. One flow, one
service — [`password-reset.service.js`](../src/services/password-reset.service.js)
— and no difference between development and production except where the email
ends up.

## The flow

```
/login ── "Forgot password?" ──▶ /forgot-password
                                    │
  1. email ─────────────────────────┤  POST /api/auth/forgot-password
                                    │    → signed request handle (httpOnly cookie)
                                    │    → for a real account: code emailed
  2. code  ─────────────────────────┤  POST /api/auth/forgot-password/verify
       (resend)                     │  POST /api/auth/forgot-password/resend
                                    │    → single-use reset authorisation
  3. new password + confirmation ───┤  POST /api/auth/reset-password
                                    │    → password set, every session ended
  4. "Password updated" ──▶ /login?reset=1 ──▶ sign in with the new password
```

All four steps live on `/forgot-password`. A refresh on the code step resumes
there: the page reads the request handle from its cookie. `/reset-password`,
where an emailed link used to land, now redirects to `/forgot-password`.

Three secrets, each proving one thing:

| Secret | Proves | Lives | Lifetime |
|---|---|---|---|
| Request handle | "this browser asked for a reset for this address" | httpOnly cookie, HMAC-signed (`signState`, label `aplus:password-reset-request`) | 60 min |
| Code | "whoever is typing can read that inbox" | the email; stored only as an HMAC bound to account + request | 10 min |
| Reset authorisation | "a correct code was presented" | returned to the page after verification; stored as SHA-256 in `AuthToken` (`PASSWORD_RESET_AUTHORIZATION`) | 10 min, single use |

The browser never states that verification happened. The password step
accepts only the authorisation, which the server issued and will accept once.

## Limits

All defaults are in `PASSWORD_RESET` in [`constants/config.js`](../src/constants/config.js).

| Rule | Default | Keyed on |
|---|---|---|
| Code expiry | 10 minutes | the request |
| Wrong guesses before the code is burned | 5 | the request (rate limiter) and the stored code (`attempts`) |
| Resend cooldown | 60 seconds | the address |
| Codes per address | 5 an hour | the address |
| Requests + resends per client | 5 per 15 minutes | client IP |
| Verification attempts per client | 20 per 15 minutes | client IP |
| Reset authorisation expiry | 10 minutes | — |

A new code voids the previous code and any unspent authorisation. A
successful reset voids everything still outstanding, bumps `tokenVersion` (so
every existing session stops working), sends the `passwordChanged` notice and
records `USER_PASSWORD_RESET` in the audit log.

Keep the resend cooldown at 60 seconds or more. Resend de-duplicates on
recipient and subject within a clock minute, so a second code sent inside the
same minute would never arrive.

## Account enumeration

Nothing distinguishes an address with an account from one without:

- The request response is the same shape and numbers for both, and both get a
  request handle.
- The cooldown, hourly cap, five-guess lockout and expiry all hang off the
  handle or the address, never off whether an account exists. An unknown
  address is throttled, locked out and expired exactly like a real one. Its
  codes are simply never right.
- The account lookup, the code write and the email run in Next's `after()`,
  once the response has gone, so response time says nothing either.
- A delivery failure is logged, never surfaced: it could only ever happen for
  an address that exists.

A deleted account is treated as an unknown address.

## Email delivery

The service calls `sendEmail()` with the `passwordResetCode` template. Which
transport carries it is decided by the email module, exactly as for every
other email:

```
built-in default (console) → EMAIL_PROVIDER + credentials → admin panel
```

**Development, no mail server.** `ConsoleEmailProvider` prints the message
to the server log and keeps a copy in the **development mailbox**:

- `/dev/mail`: a page listing what was "sent" since the server started, with
  a recipient filter.
- `GET /api/dev/mail?to=<address>`: the same as JSON. The test suites read
  codes from it.

The code screen shows a "Development mode" notice linking to the mailbox. The
code is the real one, generated and checked by the production path. There is
no "any code works" mode, and the API never returns a code.

The mailbox has three locks, and all three must be open:

1. `NODE_ENV` is not `production`, which rules out any `next build`, including
   staging.
2. `APP_ENV` is not `production`.
3. The configured transport really is the console one.

Anywhere else, the page and the API return a 404 and nothing is recorded.

**Production.** Configure a real provider. No code change is needed:

```env
# Resend
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM="APlus Learn <no-reply@your-domain>"

# or SMTP
EMAIL_PROVIDER=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
EMAIL_FROM="APlus Learn <no-reply@your-domain>"
```

Either can also be set in the admin panel at `/admin/settings/integrations`,
which overrides the environment field by field. Production refuses the console
transport outright, so a production deployment cannot swallow a reset code.
See [INTEGRATIONS.md](INTEGRATIONS.md) for domain verification (SPF, DKIM,
DMARC).

## Testing

| Suite | Covers |
|---|---|
| `bun run test:integrations` → "Password reset" | storage (keyed hash, never plaintext), expiry, cooldown, hourly cap, five-guess burn for real *and* unknown addresses, resend voiding the old code, cross-account and forged handles, single-use code and authorisation, bcrypt hash, `tokenVersion`, audit, the mailbox's production locks, and a stubbed Resend receiving the code from the unchanged service |
| `bun run qa` → "Password reset" | the same rules over real HTTP: identical answers for real and unknown addresses, httpOnly handle, the code never in a response, a browser claiming "verified" refused, old session ended, old password refused, new password signs in |
| `bun run e2e` | a real browser: sign-in page → forgot password → code from the mailbox → a wrong code refused → a refresh resumes → new password → sign in with it |

`qa` and `e2e` need `bun run dev` running with no mail provider configured.
`e2e` needs Playwright, which is deliberately not a project dependency. It
uses the project's copy, then `PLAYWRIGHT_MODULE_DIR`, then any copy cached by
`npx playwright`, and drives system Chrome (`E2E_BROWSER_CHANNEL=""` switches
to Playwright's own Chromium). `E2E_SCREENSHOTS=<dir>` saves every step.
