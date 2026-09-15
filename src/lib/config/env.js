import "server-only";

/**
 * Runtime configuration and provider selection (§38).
 *
 * Every external integration is chosen here and nowhere else. The rules are
 * deliberately blunt:
 *
 *   development  — a working fake. Money never moves, mail never leaves.
 *   production   — the real service, and it must have its credentials.
 *
 * In development the provider is auto-detected from whichever credentials
 * happen to be present, so a developer can switch one integration on without
 * touching the rest. In production nothing is auto-detected: each integration
 * must be named explicitly, and naming a real provider without its secrets is
 * a hard failure rather than a quiet downgrade to the fake.
 */

/** Deployment stage. Distinct from NODE_ENV so a staging build can opt in. */
export function appEnv() {
  return process.env.APP_ENV || (process.env.NODE_ENV === "production" ? "production" : "development");
}

export function isProduction() {
  return appEnv() === "production";
}

export const DEVELOPMENT = "development";

/**
 * Every integration, the env var that selects it, the production provider(s)
 * it understands, and the secrets each of those needs.
 *
 * `fakeAllowedInProduction: false` means the development implementation is
 * refused outright once APP_ENV=production — there is no configuration in
 * which the platform takes fake money or silently swallows a password-reset
 * email on a production deployment.
 */
export const INTEGRATIONS = {
  payment: {
    label: "Payments",
    selector: "PAYMENT_PROVIDER",
    fakeAllowedInProduction: false,
    providers: {
      stripe: { label: "Stripe", required: ["STRIPE_SECRET_KEY"], optional: ["STRIPE_WEBHOOK_SECRET", "STRIPE_CONNECT_WEBHOOK_SECRET"] },
    },
  },
  email: {
    label: "Email",
    selector: "EMAIL_PROVIDER",
    fakeAllowedInProduction: false,
    providers: {
      resend: { label: "Resend", required: ["RESEND_API_KEY", "EMAIL_FROM"], optional: ["EMAIL_REPLY_TO"] },
    },
  },
  oauth: {
    label: "OAuth",
    selector: "OAUTH_PROVIDER",
    // Social sign-in is additive: email + password still works without it.
    fakeAllowedInProduction: true,
    providers: {
      google: { label: "Google", required: ["GOOGLE_CLIENT_ID"], optional: ["APPLE_CLIENT_ID"] },
    },
  },
  geocoding: {
    label: "Geocoding",
    selector: "GEOCODING_PROVIDER",
    // A coarse centroid degrades distance search; it does not endanger anyone.
    fakeAllowedInProduction: true,
    providers: {
      google: { label: "Google Geocoding API", required: ["GOOGLE_MAPS_API_KEY"], optional: [] },
    },
  },
  meeting: {
    label: "Meeting links",
    selector: "MEETING_PROVIDER",
    // A deterministic room link is still a working link for a manual host.
    fakeAllowedInProduction: true,
    providers: {
      zoom: {
        label: "Zoom",
        required: ["ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"],
        optional: ["ZOOM_USER_ID"],
      },
    },
  },
};

/** Credentials that would make a given provider usable are all present. */
function hasCredentials(spec) {
  return spec.required.every((key) => Boolean(process.env[key]?.trim()));
}

/**
 * Resolve one integration.
 *
 * @returns {{ name: string, label: string, configured: boolean, missing: string[], error: string|null }}
 */
export function resolveIntegration(key) {
  const integration = INTEGRATIONS[key];
  if (!integration) throw new Error(`Unknown integration "${key}".`);

  const requested = process.env[integration.selector]?.trim().toLowerCase();
  const production = isProduction();

  // Explicitly asked for the fake.
  if (requested === DEVELOPMENT) {
    if (production && !integration.fakeAllowedInProduction) {
      return fail(key, `${integration.selector}=development is refused when APP_ENV=production.`);
    }
    return { name: DEVELOPMENT, label: "Development", configured: true, missing: [], error: null };
  }

  if (requested) {
    const spec = integration.providers[requested];
    if (!spec) {
      return fail(
        key,
        `${integration.selector}="${requested}" is not a provider this build knows. Supported: ${Object.keys(integration.providers).join(", ")}, development.`,
      );
    }
    const missing = spec.required.filter((k) => !process.env[k]?.trim());
    if (missing.length) {
      return fail(key, `${integration.selector}=${requested} needs ${missing.join(", ")}.`);
    }
    return { name: requested, label: spec.label, configured: true, missing: [], error: null };
  }

  // Nothing requested. Production never guesses.
  if (production) {
    return fail(
      key,
      `${integration.selector} is not set. Name a provider (${Object.keys(integration.providers).join(", ")}) or ${DEVELOPMENT} explicitly.`,
    );
  }

  // Development: light up whatever has credentials.
  for (const [name, spec] of Object.entries(integration.providers)) {
    if (hasCredentials(spec)) {
      return { name, label: spec.label, configured: true, missing: [], error: null };
    }
  }

  const firstProvider = Object.values(integration.providers)[0];
  return {
    name: DEVELOPMENT,
    label: "Development",
    configured: true,
    missing: firstProvider?.required.filter((k) => !process.env[k]?.trim()) ?? [],
    error: null,
  };
}

function fail(key, message) {
  return {
    name: DEVELOPMENT,
    label: "Unconfigured",
    configured: false,
    missing: [],
    error: `${INTEGRATIONS[key].label}: ${message}`,
  };
}

/** True when this integration is running against the real external service. */
export function usesProductionProvider(key) {
  const resolved = resolveIntegration(key);
  return resolved.configured && resolved.name !== DEVELOPMENT;
}

/**
 * The provider name, or throw if the configuration is broken. Factories call
 * this, so a misconfigured deployment fails at the first use of the
 * integration instead of transacting through a fake.
 */
export function requireIntegration(key) {
  const resolved = resolveIntegration(key);
  if (!resolved.configured) throw new ConfigurationError(resolved.error);
  return resolved;
}

export class ConfigurationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigurationError";
    this.status = 503;
    this.code = "PROVIDER_MISCONFIGURED";
    // Safe to show: it names env vars, never their values.
    this.expose = true;
  }
}

/**
 * Whole-application configuration report. Used by the admin health panel and
 * by `assertConfiguration()` at boot. Contains names, never secret values.
 */
export function integrationStatus() {
  return Object.keys(INTEGRATIONS).map((key) => {
    const resolved = resolveIntegration(key);
    return {
      key,
      label: INTEGRATIONS[key].label,
      provider: resolved.name,
      providerLabel: resolved.label,
      mode: resolved.name === DEVELOPMENT ? "development" : "production",
      ok: resolved.configured,
      error: resolved.error,
      missing: resolved.missing,
    };
  });
}

/** Core secrets that are required regardless of which integrations are on. */
function baseConfigurationErrors() {
  const errors = [];
  if (!process.env.MONGODB_URI?.trim()) errors.push("MONGODB_URI is required.");
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret) errors.push("AUTH_SECRET is required.");
  else if (secret.length < 32) errors.push("AUTH_SECRET must be at least 32 characters.");

  if (isProduction()) {
    const url = process.env.NEXT_PUBLIC_APP_URL?.trim();
    if (!url) errors.push("NEXT_PUBLIC_APP_URL is required in production.");
    else if (!url.startsWith("https://")) errors.push("NEXT_PUBLIC_APP_URL must be https:// in production.");
  }
  return errors;
}

/**
 * Validate everything. Returns the list of problems rather than throwing, so
 * callers can decide between logging and refusing to start.
 */
export function configurationErrors() {
  return [
    ...baseConfigurationErrors(),
    ...integrationStatus().filter((s) => !s.ok).map((s) => s.error),
  ];
}

/**
 * Boot-time gate. A production deployment that cannot satisfy its own
 * configuration should not come up at all — a half-configured marketplace is
 * worse than an obviously dead one.
 */
export function assertConfiguration({ throwOnError = isProduction() } = {}) {
  const errors = configurationErrors();
  if (!errors.length) return { ok: true, errors: [] };

  const report = ["APlus Learn configuration problems:", ...errors.map((e) => `  • ${e}`)].join("\n");
  if (throwOnError) throw new ConfigurationError(report);
  console.warn(`\n${report}\n`);
  return { ok: false, errors };
}
