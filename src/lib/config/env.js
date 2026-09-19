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
    // §27 names three platforms and a learner picks per booking, so this one
    // integration can have several adapters live at once. `MEETING_PROVIDER`
    // accordingly takes a comma-separated list.
    multi: true,
    providers: {
      zoom: {
        label: "Zoom",
        required: ["ZOOM_ACCOUNT_ID", "ZOOM_CLIENT_ID", "ZOOM_CLIENT_SECRET"],
        optional: ["ZOOM_USER_ID"],
      },
      google_meet: {
        label: "Google Meet",
        required: [
          "GOOGLE_MEET_CLIENT_EMAIL",
          "GOOGLE_MEET_PRIVATE_KEY",
          "GOOGLE_MEET_IMPERSONATE",
        ],
        optional: ["GOOGLE_MEET_CALENDAR_ID"],
      },
      microsoft_teams: {
        label: "Microsoft Teams",
        required: [
          "MS_TEAMS_TENANT_ID",
          "MS_TEAMS_CLIENT_ID",
          "MS_TEAMS_CLIENT_SECRET",
          "MS_TEAMS_USER_ID",
        ],
        optional: [],
      },
    },
  },
  calendar: {
    label: "Calendar sync",
    selector: "CALENDAR_PROVIDER",
    /**
     * Calendar sync is additive: a tutor who connects nothing still publishes
     * availability by hand and still receives bookings. So a production
     * deployment may run without either provider — and when it does, the
     * development implementation is a *working* calendar rather than a stub,
     * labelled as simulated everywhere a tutor can see it (§18, §41 Phase 2).
     *
     * §41 names both Google and Outlook, and a tutor may connect either or
     * both, so like meeting links this selector takes a comma-separated list.
     */
    fakeAllowedInProduction: true,
    multi: true,
    providers: {
      google: {
        label: "Google Calendar",
        required: ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET"],
        optional: [],
      },
      microsoft: {
        label: "Outlook Calendar",
        required: ["MICROSOFT_CALENDAR_CLIENT_ID", "MICROSOFT_CALENDAR_CLIENT_SECRET"],
        optional: ["MICROSOFT_CALENDAR_TENANT_ID"],
      },
    },
  },
  sms: {
    label: "SMS",
    selector: "SMS_PROVIDER",
    /**
     * SMS is an *additive* channel: in-app and email carry every notification
     * on their own, and nobody is locked out of their account without it. So
     * a production deployment may run without an SMS account — but the
     * development provider never claims a message was delivered, it records
     * that one was simulated, and the channel is reported as unconfigured
     * rather than working (§38, §41 Phase 2).
     */
    fakeAllowedInProduction: true,
    providers: {
      twilio: {
        label: "Twilio",
        required: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"],
        // One of these two is required at send time; the factory checks that,
        // because either is a valid way to configure Twilio.
        optional: ["TWILIO_FROM_NUMBER", "TWILIO_MESSAGING_SERVICE_SID", "TWILIO_STATUS_CALLBACK_URL"],
      },
    },
  },
  storage: {
    label: "File storage",
    selector: "STORAGE_PROVIDER",
    // The local filesystem is a development convenience, not a deployment
    // option: on an ephemeral host it accepts a tutor's identity document and
    // then loses it, which breaks verification and mishandles the document.
    fakeAllowedInProduction: false,
    providers: {
      minio: {
        // MinIO is what this platform deploys against; the adapter speaks the
        // S3 API, so the same selector serves S3, R2, B2 and Spaces.
        label: "MinIO (S3-compatible object storage)",
        required: [
          "STORAGE_ENDPOINT",
          "STORAGE_BUCKET",
          "STORAGE_ACCESS_KEY",
          "STORAGE_SECRET_KEY",
        ],
        optional: [
          "STORAGE_REGION",
          "STORAGE_PREFIX",
          "STORAGE_FORCE_PATH_STYLE",
          "STORAGE_SESSION_TOKEN",
          "STORAGE_SSE",
          "STORAGE_TIMEOUT_MS",
        ],
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
 * @returns {{ name: string, names: string[], label: string, configured: boolean, missing: string[], error: string|null }}
 *   `name` is the primary provider; `names` is every provider this
 *   integration has live, which is more than one only for a `multi`
 *   integration such as meeting links.
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
    return {
      name: DEVELOPMENT,
      names: [DEVELOPMENT],
      label: "Development",
      configured: true,
      missing: [],
      error: null,
    };
  }

  if (requested) {
    // A `multi` integration may name several adapters at once. Every one of
    // them is validated; naming a provider without its secrets is a hard
    // failure whether it was named alone or in a list.
    const names = integration.multi
      ? requested.split(",").map((n) => n.trim()).filter(Boolean)
      : [requested];

    for (const name of names) {
      const spec = integration.providers[name];
      if (!spec) {
        return fail(
          key,
          `${integration.selector}="${name}" is not a provider this build knows. Supported: ${Object.keys(integration.providers).join(", ")}, development.`,
        );
      }
      const missing = spec.required.filter((k) => !process.env[k]?.trim());
      if (missing.length) {
        return fail(key, `${integration.selector}=${name} needs ${missing.join(", ")}.`);
      }
    }

    return {
      name: names[0],
      names,
      label: names.map((n) => integration.providers[n].label).join(" + "),
      configured: true,
      missing: [],
      error: null,
    };
  }

  // Nothing requested. Production never guesses.
  if (production) {
    return fail(
      key,
      `${integration.selector} is not set. Name a provider (${Object.keys(integration.providers).join(", ")}) or ${DEVELOPMENT} explicitly.`,
    );
  }

  // Development: light up whatever has credentials.
  const live = Object.entries(integration.providers).filter(([, spec]) => hasCredentials(spec));
  if (live.length) {
    const names = integration.multi ? live.map(([name]) => name) : [live[0][0]];
    return {
      name: names[0],
      names,
      label: names.map((n) => integration.providers[n].label).join(" + "),
      configured: true,
      missing: [],
      error: null,
    };
  }

  const firstProvider = Object.values(integration.providers)[0];
  return {
    name: DEVELOPMENT,
    names: [DEVELOPMENT],
    label: "Development",
    configured: true,
    missing: firstProvider?.required.filter((k) => !process.env[k]?.trim()) ?? [],
    error: null,
  };
}

function fail(key, message) {
  return {
    name: DEVELOPMENT,
    names: [],
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
