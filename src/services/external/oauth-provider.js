import "server-only";
import { createHash, createPrivateKey } from "node:crypto";
import { createRemoteJWKSet, importPKCS8, jwtVerify, SignJWT } from "jose";
import { AUTH_PROVIDERS } from "@/constants";
import {
  CONFIG_SOURCES,
  FIELD_KINDS,
  INTEGRATION_MODULES,
  fieldsFor,
} from "@/constants/integrations";
import { AppError } from "@/lib/api/errors";
import { isProduction } from "@/lib/config/env";
import { resolveIntegrationConfig } from "@/lib/config/integrations";

/**
 * Sign in with Google and Sign in with Apple (§9, §38).
 *
 * Both run the OAuth 2.0 authorization-code flow on the server. The browser is
 * sent to the provider with a `state`, a `nonce` and (for Google) a PKCE
 * challenge; the provider sends it back to our callback with a code; the code
 * is redeemed here with a credential only this server holds; and the ID token
 * that comes back is verified against the provider's published keys before
 * any account is looked at.
 *
 * Configuration comes from the `oauth` integration module — the admin panel,
 * with the environment as an optional bootstrap beneath it — and is read on
 * every attempt, so enabling, disabling or rotating a credential takes effect
 * on the next sign-in without a deploy.
 *
 * What this module deliberately does *not* do is decide anything about the
 * account. Role, status and linking rules stay in `auth.service`, where the
 * existing RBAC lives.
 */

/** Registry key and label for each sign-in provider. */
export const SIGN_IN_PROVIDERS = {
  [AUTH_PROVIDERS.GOOGLE]: { key: "google", label: "Google" },
  [AUTH_PROVIDERS.APPLE]: { key: "apple", label: "Apple" },
};

/** `google` → `GOOGLE`, or null for anything that is not a sign-in provider. */
export function signInProviderFromKey(key) {
  const wanted = String(key ?? "").toLowerCase();
  return (
    Object.entries(SIGN_IN_PROVIDERS).find(([, value]) => value.key === wanted)?.[0] ?? null
  );
}

export class OAuthProvider {
  async verifyCredential() {
    throw new Error("not implemented");
  }
}

/**
 * A local identity for development, so the sign-in path stays exercisable
 * with no Google or Apple account at all.
 *
 * Offered only when nothing is configured and the deployment is not
 * production (`signInAvailability`), and inert in production regardless.
 */
export class DevOAuthProvider extends OAuthProvider {
  get name() {
    return "DEVELOPMENT";
  }
  get configured() {
    return false;
  }

  /** Accepts a base64url-encoded JSON identity produced by the dev sign-in button. */
  async verifyCredential({ provider, credential }) {
    if (process.env.NODE_ENV === "production" || isProduction()) {
      throw new AppError(
        `${label(provider)} sign-in is not available on this platform. Use your email and password.`,
        { status: 403, code: "PROVIDER_DISABLED" },
      );
    }

    let identity;
    try {
      identity = JSON.parse(Buffer.from(credential, "base64url").toString("utf8"));
    } catch {
      throw new AppError("That sign-in response could not be read.", {
        status: 400,
        code: "INVALID_CREDENTIAL",
      });
    }

    if (!identity?.email) {
      throw new AppError("The provider did not share an email address.", {
        status: 400,
        code: "INVALID_CREDENTIAL",
      });
    }

    return {
      provider,
      providerAccountId: identity.sub ?? `dev-${identity.email}`,
      email: String(identity.email).toLowerCase(),
      emailVerified: identity.email_verified ?? true,
      firstName: identity.given_name ?? identity.firstName ?? "New",
      lastName: identity.family_name ?? identity.lastName ?? "User",
      avatarUrl: identity.picture,
    };
  }
}

// --- OpenID Connect ID-token verification ----------------------------------

/**
 * Each provider's published signing keys. `createRemoteJWKSet` caches the key
 * set and refetches on rotation, so this is one network round trip per key
 * rollover rather than one per sign-in.
 */
const JWKS = {
  [AUTH_PROVIDERS.GOOGLE]: createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs")),
  [AUTH_PROVIDERS.APPLE]: createRemoteJWKSet(new URL("https://appleid.apple.com/auth/keys")),
};

const ISSUERS = {
  [AUTH_PROVIDERS.GOOGLE]: ["https://accounts.google.com", "accounts.google.com"],
  [AUTH_PROVIDERS.APPLE]: ["https://appleid.apple.com"],
};

/**
 * Verifies an ID token and turns it into an identity.
 *
 * The token arrives straight from the provider's token endpoint over TLS, so
 * checking its signature is belt and braces — but it is cheap, and it means
 * the audience, issuer, expiry and nonce checks below are made against claims
 * nobody could have edited.
 */
export class OpenIdOAuthProvider extends OAuthProvider {
  constructor({ googleClientId, appleClientId, jwks = JWKS } = {}) {
    super();
    this.clientIds = {
      [AUTH_PROVIDERS.GOOGLE]: googleClientId,
      [AUTH_PROVIDERS.APPLE]: appleClientId,
    };
    this.jwks = jwks;
  }

  get name() {
    return "OPENID";
  }

  supports(provider) {
    return Boolean(this.clientIds[provider]);
  }

  /**
   * Verify a provider ID token.
   *
   * @param {object} args
   * @param {string} args.provider       GOOGLE | APPLE
   * @param {string} args.credential     The raw ID token (a JWT).
   * @param {string} [args.expectedNonce] The nonce this server issued for
   *   this sign-in attempt. Always supplied by the code flow; it is what stops
   *   a token minted for another attempt being accepted for this one.
   * @param {object} [args.profile]      Apple sends the name once, outside
   *   the token, on first sign-in only.
   */
  async verifyCredential({ provider, credential, expectedNonce, profile }) {
    const audience = this.clientIds[provider];
    if (!audience) {
      throw new AppError(
        `${label(provider)} sign-in is not configured. Use your email and password.`,
        { status: 503, code: "PROVIDER_UNAVAILABLE" },
      );
    }

    let payload;
    try {
      ({ payload } = await jwtVerify(credential, this.jwks[provider], {
        issuer: ISSUERS[provider],
        audience,
        // Tokens are minted seconds before they reach us; anything older is
        // being replayed.
        maxTokenAge: "10 minutes",
        clockTolerance: 60,
      }));
    } catch (error) {
      throw new AppError("That sign-in could not be verified. Please try again.", {
        status: 401,
        code: "INVALID_CREDENTIAL",
        details: process.env.NODE_ENV === "production" ? undefined : { reason: error.message },
      });
    }

    // Replay / CSRF: the token must carry the nonce we minted for this
    // attempt. Apple hashes the nonce for some client types, so accept both
    // the raw value and its SHA-256.
    if (expectedNonce) {
      const hashed = createHash("sha256").update(expectedNonce).digest("hex");
      if (payload.nonce !== expectedNonce && payload.nonce !== hashed) {
        throw new AppError("That sign-in has expired. Please try again.", {
          status: 401,
          code: "NONCE_MISMATCH",
        });
      }
    }

    const email = payload.email ? String(payload.email).toLowerCase() : null;
    if (!email) {
      throw new AppError(
        "Your provider didn't share an email address, so we can't create your account. Sign up with an email and password instead.",
        { status: 400, code: "EMAIL_NOT_SHARED" },
      );
    }

    return {
      provider,
      providerAccountId: String(payload.sub),
      email,
      // Google sends a boolean; Apple sends the string "true".
      emailVerified: payload.email_verified === true || payload.email_verified === "true",
      // Apple never puts a name in the token — it arrives once, alongside it.
      firstName: payload.given_name ?? profile?.firstName ?? null,
      lastName: payload.family_name ?? profile?.lastName ?? null,
      avatarUrl: provider === AUTH_PROVIDERS.GOOGLE ? (payload.picture ?? null) : null,
      // Apple marks relay addresses; useful when explaining bounces later.
      isPrivateRelay: payload.is_private_email === true || payload.is_private_email === "true",
    };
  }
}

// --- Token endpoint ----------------------------------------------------------

const TOKEN_TIMEOUT_MS = 10_000;

/**
 * POST a form to a token endpoint and read the JSON answer.
 *
 * Never throws for an HTTP failure — the callers decide what each documented
 * OAuth error means — and never returns the provider's `error_description`
 * to a caller who might show it: only the short, documented `error` code.
 */
async function postTokenForm(fetchImpl, url, params) {
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    const payload = await response.json().catch(() => ({}));
    return { reachable: true, status: response.status, ok: response.ok, payload };
  } catch (error) {
    return { reachable: false, reason: error?.name === "TimeoutError" ? "timed out" : "unreachable" };
  }
}

/** What a failed code exchange means, in words a person can act on. */
function exchangeFailure(provider, result) {
  if (!result.reachable) {
    return new AppError(`${label(provider)} could not be reached. Please try again in a moment.`, {
      status: 502,
      code: "PROVIDER_UNREACHABLE",
    });
  }
  if (result.payload?.error === "invalid_client" || result.status === 401) {
    // The operator's problem, not the visitor's. Logged by name only.
    console.error(`[oauth] ${label(provider)} rejected this platform's client credentials.`);
    return new AppError(
      `${label(provider)} sign-in is not working right now. Use your email and password.`,
      { status: 503, code: "PROVIDER_MISCONFIGURED" },
    );
  }
  // invalid_grant: the code was used, expired or issued to someone else.
  return new AppError("That sign-in has expired. Please try again.", {
    status: 400,
    code: "CODE_REJECTED",
  });
}

/**
 * The credential probe both admin tests use.
 *
 * Each provider reports the two failures differently, and the difference is
 * exactly the question being asked:
 *
 *   invalid_client → the client credentials are wrong
 *   invalid_grant  → the client is fine; only the deliberately bogus grant
 *                    was rejected
 *
 * So `invalid_grant` is the success case. No person is involved and no
 * session is created.
 */
function probeVerdict(provider, result, successMessage) {
  if (!result.reachable) {
    return { ok: false, code: "UNREACHABLE", message: `${label(provider)} could not be reached (${result.reason}).` };
  }
  const error = result.payload?.error;
  if (error === "invalid_grant") return { ok: true, code: "OK", message: successMessage };
  if (error === "invalid_client" || result.status === 401) {
    return {
      ok: false,
      code: "INVALID_CREDENTIALS",
      message:
        provider === AUTH_PROVIDERS.APPLE
          ? "Apple rejected these credentials. Check that the Services ID, Team ID, Key ID and private key all belong to the same Apple Developer account, and that the key has Sign in with Apple enabled."
          : "Google rejected the client ID or client secret.",
    };
  }
  if (result.status === 429) {
    return { ok: false, code: "RATE_LIMITED", message: `${label(provider)} is rate limiting this client. Try again shortly.` };
  }
  return {
    ok: false,
    code: "PROVIDER_ERROR",
    // `error` is a short, documented OAuth code — never a credential.
    message: `${label(provider)} answered unexpectedly (${error ?? `HTTP ${result.status}`}).`,
  };
}

// --- Google ------------------------------------------------------------------

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";

export class GoogleSignInProvider {
  static SCOPES = ["openid", "email", "profile"];

  constructor({ clientId, clientSecret, fetchImpl, jwks } = {}) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.verifier = new OpenIdOAuthProvider({ googleClientId: clientId, jwks });
  }

  get name() {
    return AUTH_PROVIDERS.GOOGLE;
  }

  get configured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  /** Where to send the person. Carries no secret — only public identifiers. */
  authorizationUrl({ redirectUri, state, nonce, codeChallenge }) {
    const url = new URL(GOOGLE_AUTHORIZE);
    url.searchParams.set("client_id", this.clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", GoogleSignInProvider.SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    url.searchParams.set("code_challenge", codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    // Lets somebody with several Google accounts pick the right one rather
    // than being signed in silently with whichever is current.
    url.searchParams.set("prompt", "select_account");
    return url.toString();
  }

  /** Redeem the code and return a verified identity. */
  async exchangeCode({ code, redirectUri, codeVerifier, expectedNonce }) {
    const result = await postTokenForm(this.fetch, GOOGLE_TOKEN, {
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
      code_verifier: codeVerifier,
    });

    if (!result.reachable || !result.ok) throw exchangeFailure(AUTH_PROVIDERS.GOOGLE, result);
    if (!result.payload?.id_token) {
      throw new AppError("Google did not return an identity. Please try again.", {
        status: 502,
        code: "NO_ID_TOKEN",
      });
    }

    return this.verifier.verifyCredential({
      provider: AUTH_PROVIDERS.GOOGLE,
      credential: result.payload.id_token,
      expectedNonce,
    });
  }

  /** Probe with a refresh grant that cannot succeed (see `probeVerdict`). */
  async verify() {
    if (!this.configured) {
      return { ok: false, code: "NOT_CONFIGURED", message: "A client ID and client secret are required." };
    }
    const result = await postTokenForm(this.fetch, GOOGLE_TOKEN, {
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "refresh_token",
      refresh_token: "aplus-credential-probe",
    });
    return probeVerdict(
      AUTH_PROVIDERS.GOOGLE,
      result,
      "Google accepted the client ID and secret. Make sure the redirect URI above is listed on the client.",
    );
  }
}

// --- Apple -------------------------------------------------------------------

const APPLE_AUTHORIZE = "https://appleid.apple.com/auth/authorize";
const APPLE_TOKEN = "https://appleid.apple.com/auth/token";
const APPLE_AUDIENCE = "https://appleid.apple.com";

/**
 * A pasted .p8 key, rebuilt into the PEM a parser expects.
 *
 * Operators paste keys every way there is: into a single-line box that drops
 * the line breaks, from an `.env` file with literal `\n`s, with Windows line
 * endings. The base64 body between the markers is the key; everything else is
 * layout, so the layout is rebuilt rather than trusted.
 *
 * @returns {string|null} a canonical PEM, or null when there is no key here.
 */
export function normalizePrivateKey(raw) {
  const text = String(raw ?? "").replace(/\\n/g, "\n");
  const match = text.match(/-----BEGIN PRIVATE KEY-----([\s\S]*?)-----END PRIVATE KEY-----/);
  if (!match) return null;
  const body = match[1].replace(/\s+/g, "");
  if (!body || !/^[A-Za-z0-9+/]+=*$/.test(body)) return null;
  return `-----BEGIN PRIVATE KEY-----\n${body.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`;
}

/**
 * Whether a pasted value is a key Apple can use: a PKCS#8 P-256 EC key.
 *
 * Checked when it is saved, so a truncated paste is refused on the admin
 * screen instead of surfacing as `invalid_client` on somebody's first sign-in.
 * Returns a sentence, never any part of the key.
 */
export function checkApplePrivateKey(raw) {
  const pem = normalizePrivateKey(raw);
  if (!pem) {
    return "Paste the whole .p8 file, including the -----BEGIN PRIVATE KEY----- and -----END PRIVATE KEY----- lines.";
  }
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      return "That is a private key, but not a Sign in with Apple key. Apple issues P-256 (ES256) keys as .p8 files.";
    }
    return null;
  } catch {
    return "That key could not be read. Paste the .p8 file again, exactly as Apple issued it.";
  }
}

export class AppleSignInProvider {
  static SCOPES = ["name", "email"];

  constructor({ serviceId, teamId, keyId, privateKey, fetchImpl, jwks } = {}) {
    this.serviceId = serviceId;
    this.teamId = teamId;
    this.keyId = keyId;
    this.privateKey = privateKey;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.verifier = new OpenIdOAuthProvider({ appleClientId: serviceId, jwks });
  }

  get name() {
    return AUTH_PROVIDERS.APPLE;
  }

  get configured() {
    return Boolean(this.serviceId && this.teamId && this.keyId && this.privateKey);
  }

  /**
   * Where to send the person.
   *
   * `form_post` is not a choice: Apple requires it whenever the name or email
   * scope is requested, so the callback receives a cross-site POST — which is
   * why the transaction cookie for Apple is `SameSite=None`.
   */
  authorizationUrl({ redirectUri, state, nonce }) {
    const url = new URL(APPLE_AUTHORIZE);
    url.searchParams.set("client_id", this.serviceId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("response_mode", "form_post");
    url.searchParams.set("scope", AppleSignInProvider.SCOPES.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("nonce", nonce);
    return url.toString();
  }

  /**
   * Apple's client secret: a short-lived ES256 JWT signed with the .p8 key.
   *
   * Apple allows up to six months; five minutes is plenty for one request and
   * means a secret captured from a log is useless almost immediately. It is
   * minted per request rather than cached, so a rotated key is picked up at
   * once.
   */
  async clientSecret() {
    const pem = normalizePrivateKey(this.privateKey);
    if (!pem) throw new AppError("The Apple private key is not a .p8 key.", { status: 503, code: "INVALID_KEY" });
    const key = await importPKCS8(pem, "ES256");
    return new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: this.keyId })
      .setIssuer(this.teamId)
      .setSubject(this.serviceId)
      .setAudience(APPLE_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);
  }

  /** Redeem the code and return a verified identity. */
  async exchangeCode({ code, redirectUri, expectedNonce, profile }) {
    let clientSecret;
    try {
      clientSecret = await this.clientSecret();
    } catch {
      console.error("[oauth] the stored Apple private key could not be used to sign a client secret.");
      throw new AppError("Apple sign-in is not working right now. Use your email and password.", {
        status: 503,
        code: "PROVIDER_MISCONFIGURED",
      });
    }

    const result = await postTokenForm(this.fetch, APPLE_TOKEN, {
      client_id: this.serviceId,
      client_secret: clientSecret,
      code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri,
    });

    if (!result.reachable || !result.ok) throw exchangeFailure(AUTH_PROVIDERS.APPLE, result);
    if (!result.payload?.id_token) {
      throw new AppError("Apple did not return an identity. Please try again.", {
        status: 502,
        code: "NO_ID_TOKEN",
      });
    }

    return this.verifier.verifyCredential({
      provider: AUTH_PROVIDERS.APPLE,
      credential: result.payload.id_token,
      expectedNonce,
      profile,
    });
  }

  /**
   * Sign a real client secret and present it with a code that cannot succeed.
   *
   * This proves all four values together — a Team ID from one account and a
   * key from another sign a perfectly valid JWT that Apple then refuses — which
   * no format check can.
   */
  async verify({ redirectUri } = {}) {
    if (!this.configured) {
      return { ok: false, code: "NOT_CONFIGURED", message: "The Services ID, Team ID, Key ID and private key are all required." };
    }

    const keyProblem = checkApplePrivateKey(this.privateKey);
    if (keyProblem) return { ok: false, code: "INVALID_KEY", message: keyProblem };

    const result = await postTokenForm(this.fetch, APPLE_TOKEN, {
      client_id: this.serviceId,
      client_secret: await this.clientSecret(),
      code: "aplus-credential-probe",
      grant_type: "authorization_code",
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
    });
    return probeVerdict(
      AUTH_PROVIDERS.APPLE,
      result,
      "Apple accepted the Services ID, Team ID, Key ID and private key. Make sure the domain and return URL above are registered on the Services ID.",
    );
  }
}

// --- Runtime configuration -------------------------------------------------

function isSet(value) {
  return value !== undefined && value !== null && value !== "";
}

/** Required fields of one provider that the resolved configuration lacks. */
function missingFieldsFor(key, resolved) {
  return fieldsFor(INTEGRATION_MODULES.OAUTH, key)
    .filter((field) => field.required)
    .filter((field) =>
      !isSet(field.kind === FIELD_KINDS.SECRET ? resolved.secrets?.[field.name] : resolved.config?.[field.name]),
    )
    .map((field) => field.label);
}

/**
 * Build the adapter for one provider from a resolved configuration.
 *
 * The resolved object holds plaintext secrets, so this is called only by the
 * sign-in flow and by the admin connection test — never on a path that renders.
 */
export function buildSignInProvider(provider, resolved, { fetchImpl, jwks } = {}) {
  const { config = {}, secrets = {} } = resolved ?? {};
  if (provider === AUTH_PROVIDERS.GOOGLE) {
    return new GoogleSignInProvider({
      clientId: config.googleClientId,
      clientSecret: secrets.googleClientSecret,
      fetchImpl,
      jwks,
    });
  }
  if (provider === AUTH_PROVIDERS.APPLE) {
    return new AppleSignInProvider({
      serviceId: config.appleServiceId,
      teamId: config.appleTeamId,
      keyId: config.appleKeyId,
      privateKey: secrets.applePrivateKey,
      fetchImpl,
      jwks,
    });
  }
  throw new AppError("That sign-in method is not supported.", { status: 404, code: "PROVIDER_UNKNOWN" });
}

/**
 * Which sign-in methods are offered, and why the others are not.
 *
 * The one answer every surface uses: the sign-in and registration pages to
 * decide which buttons to render, and the endpoints to decide whether to let
 * an attempt start or finish. A provider is `live` only when the module is on,
 * the provider is ticked, and every credential it needs is present and
 * readable.
 *
 * `development` is the local test identity, and only when nothing has been
 * configured anywhere on a non-production deployment. The moment an operator
 * saves this module, what they saved is the whole answer — a provider they
 * left unticked stays hidden in development too, so "disabled" can be tested
 * locally and means the same thing everywhere.
 */
function availabilityFrom(resolved) {
  const development = !isProduction() && process.env.NODE_ENV !== "production";
  const nothingConfigured = resolved.source === CONFIG_SOURCES.DEFAULT;

  return Object.entries(SIGN_IN_PROVIDERS).map(([provider, { key, label: name }]) => {
    const unavailable = (reason) => ({ provider, label: name, available: false, mode: null, reason });

    if (!resolved.enabled) return unavailable("DISABLED");
    if (nothingConfigured) {
      return development
        ? { provider, label: name, available: true, mode: "development", reason: null }
        : unavailable("NOT_CONFIGURED");
    }
    if (!(resolved.providers ?? []).includes(key)) return unavailable("DISABLED");
    if (resolved.code === "SECRET_UNREADABLE") return unavailable("MISCONFIGURED");
    if (missingFieldsFor(key, resolved).length) return unavailable("INCOMPLETE");

    return { provider, label: name, available: true, mode: "live", reason: null };
  });
}

/** Every provider's availability. Holds no credential; safe to render from. */
export async function signInAvailability() {
  return availabilityFrom(await resolveIntegrationConfig(INTEGRATION_MODULES.OAUTH));
}

/**
 * The buttons the sign-in and registration pages render: provider and mode,
 * nothing else — the pages hand this to a client component.
 */
export async function offeredSignInMethods() {
  return (await signInAvailability())
    .filter((entry) => entry.available)
    .map(({ provider, mode }) => ({ provider, mode }));
}

/** The refusal for a provider that is not being offered. */
function unavailableError({ provider, reason }) {
  const name = label(provider);
  if (reason === "INCOMPLETE" || reason === "MISCONFIGURED") {
    return new AppError(`${name} sign-in is not working right now. Use your email and password.`, {
      status: 503,
      code: "PROVIDER_UNAVAILABLE",
    });
  }
  return new AppError(`${name} sign-in is not available on this platform. Use your email and password.`, {
    status: 403,
    code: "PROVIDER_DISABLED",
  });
}

/**
 * The availability of one provider, or throw if it is not being offered.
 *
 * Called at both ends of the flow — when an attempt starts and again when the
 * provider sends the person back — so switching a method off also stops an
 * attempt that was already in flight.
 */
export async function requireSignInAvailability(provider) {
  if (!SIGN_IN_PROVIDERS[provider]) {
    throw new AppError("That sign-in method is not supported.", { status: 404, code: "PROVIDER_UNKNOWN" });
  }
  const resolved = await resolveIntegrationConfig(INTEGRATION_MODULES.OAUTH);
  const availability = availabilityFrom(resolved).find((entry) => entry.provider === provider);
  if (!availability.available) throw unavailableError(availability);
  return { availability, resolved };
}

/** A live adapter for the code flow, or throw. */
export async function requireSignInProvider(provider) {
  const { availability, resolved } = await requireSignInAvailability(provider);
  if (availability.mode !== "live") {
    // The development identity has no provider to redirect to.
    throw new AppError(`${label(provider)} sign-in is running in development mode on this deployment.`, {
      status: 409,
      code: "DEVELOPMENT_MODE",
    });
  }
  return buildSignInProvider(provider, resolved);
}

function label(provider) {
  return provider === AUTH_PROVIDERS.APPLE ? "Apple" : "Google";
}
