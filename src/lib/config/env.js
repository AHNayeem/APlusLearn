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
      smtp: {
        label: "SMTP",
        required: ["SMTP_HOST", "SMTP_PORT", "EMAIL_FROM"],
        // A relay that authenticates by IP needs no username or password, so
        // neither can be required — the adapter simply omits AUTH.
        optional: ["SMTP_USER", "SMTP_PASSWORD", "SMTP_SECURE", "SMTP_REJECT_UNAUTHORIZED", "EMAIL_REPLY_TO"],
      },
    },
  },
  oauth: {
    label: "Social sign-in",
    selector: "OAUTH_PROVIDER",
    fakeAllowedInProduction: true,
    /**
     * Social sign-in is additive: email and password work without it, and
     * the admin panel is where it is normally configured (§26). So nothing
     * about it — an unset selector, or a provider named without its
     * credentials — may stop a production deployment from booting. It is
     * reported as a notice instead, and the sign-in page simply does not
     * offer a method that is not ready.
     *
     * These variables remain only as an optional bootstrap that the admin
     * panel can import from; none of them is required.
     */
    additive: true,
    multi: true,
    providers: {
      google: {
        label: "Google",
        required: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
        optional: [],
      },
      apple: {
        label: "Apple",
        required: ["APPLE_CLIENT_ID", "APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_PRIVATE_KEY"],
        optional: [],
      },
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
    /**
     * File storage always has somewhere to put a file.
     *
     * When the four credentials an S3-compatible endpoint needs are present,
     * uploads go straight to that endpoint. When any of them is missing the
     * platform writes to its own filesystem instead, rather than refusing the
     * upload or refusing to boot — a deployment that has not been given a
     * bucket yet is still a working application, and the fallback is a real
     * store rather than a stub.
     *
     * That is a deliberate reversal of the earlier rule, and it costs
     * something: a host with an ephemeral filesystem accepts a tutor's
     * identity document and then loses it on the next deploy. So local mode
     * announces itself loudly in production (`storage-provider.js`), and a
     * deployment that would rather fail than fall back sets
     * `STORAGE_REQUIRE_EXTERNAL=true` to restore the hard failure.
     */
    fakeAllowedInProduction: true,
    fallback: {
      label: "Local filesystem",
      // Missing configuration is not an error while this is declared; naming a
      // provider this build does not know still is, because that is a typo
      // rather than an absence.
      overrideEnv: "STORAGE_REQUIRE_EXTERNAL",
      warning:
        "File storage: no S3-compatible endpoint is configured, so uploads are written to the local filesystem. " +
        "That does not survive a redeploy on an ephemeral host and is not shared between instances. " +
        "Set STORAGE_ENDPOINT, STORAGE_BUCKET, STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY to use object storage.",
    },
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
  // A declared fallback turns "not configured" from a failure into a mode.
  // The deployment can insist on the external service instead, in which case
  // the fallback is unavailable — but the integration still *declares* one,
  // and that is what exempts it from production's no-guessing rule: a
  // complete set of credentials is a configuration whether or not the
  // selector names the provider. That exemption is not extended to payments
  // or email, where a provider must be named on purpose.
  const declaresFallback = Boolean(integration.fallback);
  const fallback =
    declaresFallback && !truthy(process.env[integration.fallback.overrideEnv])
      ? integration.fallback
      : null;

  // Explicitly asked for the fake.
  if (requested === DEVELOPMENT) {
    if (production && !integration.fakeAllowedInProduction) {
      return fail(key, `${integration.selector}=development is refused when APP_ENV=production.`);
    }
    if (fallback) {
      return fellBack(fallback, requiredFor(integration), `${integration.selector}=${DEVELOPMENT} was asked for`);
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
        // Incomplete, not wrong. With a fallback declared this is the local
        // mode rather than a dead integration; without one it stays fatal.
        if (fallback) return fellBack(fallback, missing, `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`);
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

  // Nothing requested, for an integration the platform works without. Not a
  // guess and not a failure: it is simply off until an operator configures it.
  if (production && integration.additive) {
    return {
      name: DEVELOPMENT,
      names: [],
      label: "Off",
      configured: true,
      missing: [],
      error: null,
    };
  }

  // Nothing requested. Production never guesses — unless the integration
  // declares somewhere to fall back to, which is a decision this file already
  // recorded rather than a guess made per request.
  if (production && !declaresFallback) {
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

  const missing = requiredFor(integration);
  if (fallback) {
    return fellBack(fallback, missing, `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} not set`);
  }

  // A fallback exists but this deployment has refused it, and there are no
  // credentials to use instead. Named variables rather than a selector, since
  // setting those four is what actually fixes it.
  if (declaresFallback) {
    return fail(
      key,
      `${integration.fallback.overrideEnv} is set, so the ${integration.fallback.label.toLowerCase()} fallback is refused. Set ${missing.join(", ")}.`,
    );
  }

  return {
    name: DEVELOPMENT,
    names: [DEVELOPMENT],
    label: "Development",
    configured: true,
    missing,
    error: null,
  };
}

/** Required variables of the first provider that are absent from the env. */
function requiredFor(integration) {
  const first = Object.values(integration.providers)[0];
  return first?.required.filter((k) => !process.env[k]?.trim()) ?? [];
}

function truthy(value) {
  const v = value?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/**
 * Configured, but on the declared fallback rather than the external service.
 *
 * `configured: true` because the integration works — files are stored, reads
 * succeed. `fellBack: true` and a `warning` so every surface that reports on
 * configuration can say which of the two modes is live, and say it without
 * having to re-derive the rule.
 */
function fellBack(fallback, missing, reason) {
  return {
    name: DEVELOPMENT,
    names: [DEVELOPMENT],
    label: fallback.label,
    configured: true,
    fellBack: true,
    missing,
    // Why this deployment is on the fallback, in the words of whatever
    // actually caused it. A diagnostic that says "STORAGE_BUCKET is not set"
    // to someone who has set STORAGE_BUCKET sends them looking in the wrong
    // place, and the two causes are not the same fix.
    reason,
    warning: fallback.warning,
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
      // An additive integration's problem is worth reading, never worth
      // refusing to start over.
      additive: Boolean(INTEGRATIONS[key].additive),
      // Working, but not on the external service it would prefer. Distinct
      // from both "ok" and "broken", because it is neither.
      fellBack: Boolean(resolved.fellBack),
      warning: resolved.warning ?? null,
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
    ...integrationStatus().filter((s) => !s.ok && !s.additive).map((s) => s.error),
  ];
}

/**
 * Problems that must be seen but must not stop a deployment.
 *
 * An integration running on its declared fallback is the only case so far:
 * file storage with no bucket configured works, and saying so at every boot is
 * the point — it is not a reason to refuse to start.
 */
export function configurationWarnings() {
  const status = integrationStatus();
  return [
    ...status.filter((s) => s.fellBack && s.warning).map((s) => s.warning),
    // Social sign-in named in the environment without its credentials: the
    // method is unavailable until it is completed here or in the admin panel.
    ...status.filter((s) => !s.ok && s.additive).map((s) => s.error),
  ];
}

/**
 * Boot-time gate. A production deployment that cannot satisfy its own
 * configuration should not come up at all — a half-configured marketplace is
 * worse than an obviously dead one.
 */
export function assertConfiguration({ throwOnError = isProduction() } = {}) {
  const errors = configurationErrors();
  const warnings = configurationWarnings();

  // Warnings are printed whether or not anything failed, and never throw:
  // "storage has no bucket, so files go to disk" is something an operator
  // needs to read on a healthy deployment, not only on a broken one.
  if (warnings.length) {
    console.warn(
      `\n${["APlus Learn configuration notices:", ...warnings.map((w) => `  • ${w}`)].join("\n")}\n`,
    );
  }

  if (!errors.length) return { ok: true, errors: [], warnings };

  const report = ["APlus Learn configuration problems:", ...errors.map((e) => `  • ${e}`)].join("\n");
  if (throwOnError) throw new ConfigurationError(report);
  console.warn(`\n${report}\n`);
  return { ok: false, errors, warnings };
}
