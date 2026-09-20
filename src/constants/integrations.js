/**
 * The external-module registry (§26, §36, §38).
 *
 * One declaration per operator-configurable integration, naming every field
 * an administrator can set, which of those fields are secret, and which
 * environment variable each falls back to. Everything else in the feature —
 * the Zod schemas, the Mongoose sub-documents, the masking, the "import from
 * environment" action, the admin form — is derived from this table, so adding
 * a provider means adding an entry here rather than editing eight files.
 *
 * This table is the *editable* surface. `INTEGRATIONS` in
 * `src/lib/config/env.js` remains the deployment-level truth: which providers
 * this build knows, and which of them may run as a fake in production. The two
 * are deliberately separate, because they answer different questions —
 * "what may an operator change?" is not "what will this deployment tolerate?".
 *
 * ## What is *not* here, and will not be
 *
 * `AUTH_SECRET`, `MONGODB_URI`, `CRON_SECRET` and `NEXT_PUBLIC_APP_URL` are
 * infrastructure: the application cannot read its own database or verify its
 * own sessions without them, so an administrator editing them through a
 * database-backed screen would be sawing the branch off. They stay in the
 * environment (§36).
 */

/** Module keys. These are the document `_id`-equivalent and the URL segment. */
export const INTEGRATION_MODULES = {
  EMAIL: "email",
  PAYMENT: "payment",
  CALENDAR: "calendar",
  SMS: "sms",
  STORAGE: "storage",
};

export const INTEGRATION_MODULE_KEYS = Object.values(INTEGRATION_MODULES);

/**
 * Field kinds. `secret` is the only one that changes how a value is handled:
 * it is encrypted at rest, never returned by any endpoint, and never logged.
 */
export const FIELD_KINDS = {
  TEXT: "text",
  EMAIL: "email",
  URL: "url",
  PORT: "port",
  PHONE: "phone",
  BOOLEAN: "boolean",
  SELECT: "select",
  SECRET: "secret",
};

/**
 * How much of a stored secret may be shown back.
 *
 * `NONE` is the default and the right answer almost everywhere: a password or
 * an auth token is not self-identifying, so revealing four characters of it
 * buys the operator nothing and costs them four characters.
 *
 * `LAST4` exists for the Stripe secret key alone. Stripe's own dashboard shows
 * the last four, operators recognise keys by them, and telling two keys apart
 * is a real task an operator has during a rotation.
 */
export const SECRET_HINTS = { NONE: "none", LAST4: "last4" };

const f = (name, label, kind, extra = {}) => ({ name, label, kind, ...extra });

/**
 * Every module, its providers, and each provider's fields.
 *
 * `env` on a field is the variable it falls back to when nothing is stored.
 * A field with no `env` has no environment equivalent and exists only here.
 */
export const INTEGRATION_REGISTRY = {
  [INTEGRATION_MODULES.EMAIL]: {
    key: INTEGRATION_MODULES.EMAIL,
    label: "Email",
    description:
      "Transactional mail — verification, password reset, booking confirmations and notifications.",
    envSelector: "EMAIL_PROVIDER",
    /**
     * Unlike the per-category notification switches, this one stops *all*
     * mail, security included — it is the module, not a preference, and
     * switching it off is equivalent to removing the credentials, which an
     * operator can do from this screen anyway. Pretending a disabled
     * transport could still deliver a password reset would be the fake
     * behaviour (§39), so the panel states the cost plainly instead.
     *
     * To silence notifications while keeping people able to recover their
     * accounts, the notification switches on the Settings screen are the
     * right control, and the panel says so.
     */
    disableWarning:
      "ALL email stops, including verification and password-reset links — nobody will be able to recover an account by email. To silence notifications while keeping account recovery working, use the notification switches on the Settings screen instead.",
    /**
     * What the test button asks for, so the panel can render it without
     * knowing which module it is looking at.
     *
     * Optional: leaving the recipient blank checks the credentials and sends
     * nothing, which is what an operator usually wants. Filling it in sends a
     * real message, because that is the only way to prove delivery.
     */
    testLabel: "Test email",
    testFields: [
      f("recipient", "Send a test message to", FIELD_KINDS.EMAIL, {
        placeholder: "you@example.com",
        help: "Leave blank to check the credentials without sending anything.",
      }),
    ],
    providers: {
      resend: {
        label: "Resend",
        description: "Transactional delivery over the Resend HTTP API. Needs a verified sending domain.",
        fields: [
          f("apiKey", "API key", FIELD_KINDS.SECRET, {
            env: "RESEND_API_KEY",
            required: true,
            placeholder: "re_...",
            hint: SECRET_HINTS.NONE,
            help: "From the Resend dashboard under API Keys.",
          }),
          f("from", "From address", FIELD_KINDS.TEXT, {
            env: "EMAIL_FROM",
            required: true,
            placeholder: "APlus Learn <no-reply@apluslearn.ca>",
            help: "Either a bare address or a Name <address> pair. The domain must be verified with Resend.",
          }),
          f("replyTo", "Reply-to address", FIELD_KINDS.EMAIL, {
            env: "EMAIL_REPLY_TO",
            placeholder: "support@apluslearn.ca",
            help: "Optional. Where replies go. Defaults to the platform support address.",
          }),
        ],
      },
      smtp: {
        label: "SMTP",
        description: "Any standards-compliant mail server, over SMTP with TLS or STARTTLS.",
        fields: [
          f("host", "SMTP host", FIELD_KINDS.TEXT, {
            env: "SMTP_HOST",
            required: true,
            placeholder: "smtp.example.com",
          }),
          f("port", "Port", FIELD_KINDS.PORT, {
            env: "SMTP_PORT",
            required: true,
            placeholder: "587",
            help: "587 for STARTTLS, 465 for implicit TLS, 25 for an unauthenticated relay.",
          }),
          f("secure", "Use implicit TLS", FIELD_KINDS.BOOLEAN, {
            env: "SMTP_SECURE",
            help: "On for port 465. Off for 587, where the connection is upgraded with STARTTLS instead.",
          }),
          f("username", "Username", FIELD_KINDS.TEXT, {
            env: "SMTP_USER",
            placeholder: "admin@example.com",
            help: "Leave blank for a relay that authenticates by IP.",
          }),
          f("password", "Password", FIELD_KINDS.SECRET, {
            env: "SMTP_PASSWORD",
            hint: SECRET_HINTS.NONE,
          }),
          f("from", "From address", FIELD_KINDS.TEXT, {
            env: "EMAIL_FROM",
            required: true,
            placeholder: "APlus Learn <no-reply@apluslearn.ca>",
          }),
          f("replyTo", "Reply-to address", FIELD_KINDS.EMAIL, {
            env: "EMAIL_REPLY_TO",
            placeholder: "support@apluslearn.ca",
          }),
          f("rejectUnauthorized", "Require a valid certificate", FIELD_KINDS.BOOLEAN, {
            env: "SMTP_REJECT_UNAUTHORIZED",
            default: true,
            help: "Leave on. Turning it off accepts self-signed certificates and any server that presents one.",
          }),
        ],
      },
    },
  },

  [INTEGRATION_MODULES.PAYMENT]: {
    key: INTEGRATION_MODULES.PAYMENT,
    label: "Payments",
    description: "Checkout, refunds and tutor payouts.",
    envSelector: "PAYMENT_PROVIDER",
    disableWarning:
      "No new checkout can be opened and no refund can be issued. Bookings already paid for are unaffected.",
    testLabel: "Test connection",
    testFields: [],
    providers: {
      stripe: {
        label: "Stripe",
        description: "Hosted Checkout plus Connect Express payouts. Cards never touch this application.",
        fields: [
          /**
           * A declared intent, not the source of truth. The mode a Stripe key
           * actually runs in is carried by the key itself, and the service
           * refuses a save where the two disagree — which is what stops a
           * live key being pasted into a deployment that believes it is
           * testing.
           */
          f("environment", "Stripe environment", FIELD_KINDS.SELECT, {
            required: true,
            default: "test",
            options: [
              { value: "test", label: "Test mode" },
              { value: "live", label: "Live mode" },
            ],
            help: "Checked against the secret key you provide. A live key saved in test mode is refused, and the other way round.",
          }),
          f("publishableKey", "Publishable key", FIELD_KINDS.TEXT, {
            env: "STRIPE_PUBLISHABLE_KEY",
            placeholder: "pk_test_...",
            help: "Not a secret — safe to show and safe to ship to a browser.",
          }),
          f("secretKey", "Secret key", FIELD_KINDS.SECRET, {
            env: "STRIPE_SECRET_KEY",
            required: true,
            placeholder: "sk_test_...",
            hint: SECRET_HINTS.LAST4,
          }),
          f("webhookSecret", "Webhook signing secret", FIELD_KINDS.SECRET, {
            env: "STRIPE_WEBHOOK_SECRET",
            placeholder: "whsec_...",
            hint: SECRET_HINTS.NONE,
            help: "From the webhook endpoint in your Stripe dashboard. Without it, incoming events are refused rather than trusted.",
          }),
          f("connectWebhookSecret", "Connect webhook signing secret", FIELD_KINDS.SECRET, {
            env: "STRIPE_CONNECT_WEBHOOK_SECRET",
            hint: SECRET_HINTS.NONE,
            help: "Optional. Only if payout account events use a separate endpoint. Falls back to the signing secret above.",
          }),
          f("currency", "Currency", FIELD_KINDS.SELECT, {
            default: "CAD",
            options: [
              { value: "CAD", label: "Canadian dollar (CAD)" },
              { value: "USD", label: "US dollar (USD)" },
            ],
          }),
        ],
      },
    },
  },

  [INTEGRATION_MODULES.CALENDAR]: {
    key: INTEGRATION_MODULES.CALENDAR,
    label: "Calendar",
    description:
      "The application registration tutors authorise when they connect their own calendar. This is not a platform calendar account.",
    envSelector: "CALENDAR_PROVIDER",
    /** Both adapters may be live at once — a tutor picks (§41 Phase 2). */
    multi: true,
    disableWarning:
      "Busy periods stop being pulled in and lessons stop being written out. Existing tutor connections are kept, not deleted, and resume when this is switched back on.",
    testLabel: "Test credentials",
    testFields: [],
    providers: {
      google: {
        label: "Google Calendar",
        description: "An OAuth client from the Google Cloud console, with the Calendar API enabled.",
        fields: [
          f("clientId", "Client ID", FIELD_KINDS.TEXT, {
            env: "GOOGLE_CALENDAR_CLIENT_ID",
            required: true,
            placeholder: "....apps.googleusercontent.com",
          }),
          f("clientSecret", "Client secret", FIELD_KINDS.SECRET, {
            env: "GOOGLE_CALENDAR_CLIENT_SECRET",
            required: true,
            hint: SECRET_HINTS.NONE,
          }),
        ],
      },
      microsoft: {
        label: "Outlook Calendar",
        description: "An app registration in Microsoft Entra ID with delegated Calendars.ReadWrite.",
        fields: [
          f("clientId", "Application (client) ID", FIELD_KINDS.TEXT, {
            env: "MICROSOFT_CALENDAR_CLIENT_ID",
            required: true,
          }),
          f("clientSecret", "Client secret", FIELD_KINDS.SECRET, {
            env: "MICROSOFT_CALENDAR_CLIENT_SECRET",
            required: true,
            hint: SECRET_HINTS.NONE,
          }),
          f("tenantId", "Directory (tenant) ID", FIELD_KINDS.TEXT, {
            env: "MICROSOFT_CALENDAR_TENANT_ID",
            default: "common",
            help: "`common` lets any Microsoft account connect. A tenant GUID restricts it to one organisation.",
          }),
        ],
      },
    },
  },

  [INTEGRATION_MODULES.SMS]: {
    key: INTEGRATION_MODULES.SMS,
    label: "SMS",
    description: "Text-message notifications and phone-number verification.",
    envSelector: "SMS_PROVIDER",
    disableWarning:
      "No text message is sent. Every notification still reaches people in the app and by email.",
    testLabel: "Test SMS",
    testFields: [
      f("phone", "Send a test message to", FIELD_KINDS.PHONE, {
        placeholder: "+16475550123",
        help: "Leave blank to check the credentials without sending anything. A real message costs real money.",
      }),
      f("message", "Message", FIELD_KINDS.TEXT, {
        placeholder: "APlus Learn: this is a test message from the admin panel.",
        help: "Optional. The default is used when this is blank.",
      }),
    ],
    providers: {
      twilio: {
        label: "Twilio",
        description: "Delivery over the Twilio REST API, with signed inbound status and opt-out callbacks.",
        fields: [
          f("accountSid", "Account SID", FIELD_KINDS.TEXT, {
            env: "TWILIO_ACCOUNT_SID",
            required: true,
            placeholder: "AC...",
            help: "Not a secret. Identifies the account; the auth token below is what proves you own it.",
          }),
          f("authToken", "Auth token", FIELD_KINDS.SECRET, {
            env: "TWILIO_AUTH_TOKEN",
            required: true,
            hint: SECRET_HINTS.NONE,
            help: "Also signs inbound callbacks, so an unsigned delivery receipt or opt-out is refused.",
          }),
          f("fromNumber", "From number", FIELD_KINDS.PHONE, {
            env: "TWILIO_FROM_NUMBER",
            placeholder: "+16475550123",
            help: "In E.164 form. Either this or a messaging service is required.",
          }),
          f("messagingServiceSid", "Messaging service SID", FIELD_KINDS.TEXT, {
            env: "TWILIO_MESSAGING_SERVICE_SID",
            placeholder: "MG...",
            help: "Preferred if you have one — it handles number pooling and compliance for you.",
          }),
          f("statusCallbackUrl", "Status callback URL", FIELD_KINDS.URL, {
            env: "TWILIO_STATUS_CALLBACK_URL",
            help: "Optional. Where Twilio reports delivery. Usually {app}/api/webhooks/sms.",
          }),
        ],
      },
    },
  },

  [INTEGRATION_MODULES.STORAGE]: {
    key: INTEGRATION_MODULES.STORAGE,
    label: "File storage",
    description:
      "Where verification documents and branding assets are kept. Bytes are always streamed through an authorised route — no storage URL ever reaches a browser.",
    envSelector: "STORAGE_PROVIDER",
    disableWarning:
      "New uploads are refused. Files already stored stay readable, because breaking retrieval of a tutor's identity documents is an incident, not a setting.",
    testLabel: "Test connection",
    testFields: [],
    providers: {
      minio: {
        label: "S3-compatible (MinIO, S3, R2, B2, Spaces)",
        description: "Any endpoint that speaks the S3 API.",
        fields: [
          f("endpoint", "Endpoint", FIELD_KINDS.URL, {
            env: "STORAGE_ENDPOINT",
            required: true,
            placeholder: "https://storage.example.com",
          }),
          f("bucket", "Bucket", FIELD_KINDS.TEXT, { env: "STORAGE_BUCKET", required: true }),
          f("accessKey", "Access key", FIELD_KINDS.TEXT, { env: "STORAGE_ACCESS_KEY", required: true }),
          f("secretKey", "Secret key", FIELD_KINDS.SECRET, {
            env: "STORAGE_SECRET_KEY",
            required: true,
            hint: SECRET_HINTS.NONE,
          }),
          f("region", "Region", FIELD_KINDS.TEXT, { env: "STORAGE_REGION", default: "us-east-1" }),
          f("prefix", "Key prefix", FIELD_KINDS.TEXT, {
            env: "STORAGE_PREFIX",
            help: "Optional. Scopes every object under one folder, so one bucket can serve several deployments.",
          }),
          f("forcePathStyle", "Path-style addressing", FIELD_KINDS.BOOLEAN, {
            env: "STORAGE_FORCE_PATH_STYLE",
            default: true,
            help: "On for MinIO and most self-hosted endpoints. Off for virtual-hosted buckets.",
          }),
        ],
      },
    },
  },
};

/** Every field of one provider, or an empty list for an unknown pair. */
export function fieldsFor(moduleKey, provider) {
  return INTEGRATION_REGISTRY[moduleKey]?.providers?.[provider]?.fields ?? [];
}

/** Just the secret ones — the fields that are encrypted and never returned. */
export function secretFieldsFor(moduleKey, provider) {
  return fieldsFor(moduleKey, provider).filter((field) => field.kind === FIELD_KINDS.SECRET);
}

/** Every secret field name a module has across all of its providers. */
export function allSecretFieldNames(moduleKey) {
  const providers = INTEGRATION_REGISTRY[moduleKey]?.providers ?? {};
  return [
    ...new Set(
      Object.keys(providers).flatMap((provider) =>
        secretFieldsFor(moduleKey, provider).map((field) => field.name),
      ),
    ),
  ];
}

/** Provider names a module understands, excluding the development fake. */
export function providersFor(moduleKey) {
  return Object.keys(INTEGRATION_REGISTRY[moduleKey]?.providers ?? {});
}

/**
 * Connection states a module can be in (§39).
 *
 * `CONFIGURED` and `CONNECTED` are deliberately different. Fields being
 * filled in is not evidence that the credentials work, and a panel that
 * conflated the two would be telling an operator something it has not
 * checked. Only a successful provider round-trip moves a module to
 * `CONNECTED`.
 */
export const INTEGRATION_STATUS = {
  DISABLED: "DISABLED",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  CONFIGURED: "CONFIGURED",
  CONNECTED: "CONNECTED",
  FAILING: "FAILING",
  NEEDS_ATTENTION: "NEEDS_ATTENTION",
};

export const INTEGRATION_STATUS_LABELS = {
  DISABLED: "Disabled",
  NOT_CONFIGURED: "Not configured",
  CONFIGURED: "Configured, not tested",
  CONNECTED: "Connected",
  FAILING: "Failing",
  NEEDS_ATTENTION: "Needs attention",
};

/** Where a module's live configuration came from. */
export const CONFIG_SOURCES = {
  DATABASE: "database",
  ENVIRONMENT: "environment",
  DEFAULT: "default",
};
