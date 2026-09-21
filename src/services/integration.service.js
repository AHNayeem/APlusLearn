import "server-only";
import { Integration, CalendarConnection } from "@/models";
import { encryptSecret } from "@/lib/security/crypto";
import {
  resolveIntegrationConfig,
  invalidateIntegrationCache,
  SECRET_LABEL,
} from "@/lib/config/integrations";
import { resolveIntegration, DEVELOPMENT, appEnv } from "@/lib/config/env";
import { ValidationError, NotFoundError, BusinessRuleError } from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import {
  INTEGRATION_REGISTRY,
  INTEGRATION_MODULES,
  INTEGRATION_MODULE_KEYS,
  INTEGRATION_STATUS,
  SECRET_HINTS,
  FIELD_KINDS,
  CONFIG_SOURCES,
  activeProvidersFor,
  fieldsFor,
  fieldsForProviders,
  isMultiModule,
  providersFor,
} from "@/constants/integrations";
import {
  validateModulePatch,
  PROVIDER_FORMAT_RULES,
  stripeModeOf,
} from "@/lib/validation/integrations";
import { CALENDAR_CONNECTION_STATUS } from "@/constants";
import { buildEmailProvider, resetEmailProvider } from "./external/email-provider";
import { buildPaymentProvider, resetPaymentProvider } from "./external/payment-provider";
import { buildSmsProvider, resetSmsProvider } from "./external/sms-provider";
import { buildCalendarProvider, resetCalendarProviders } from "./external/calendar-provider";
import { buildStorageProvider, resetStorageProvider } from "./external/storage-provider";

/**
 * External module administration (§26, §36, §38, §39).
 *
 * The admin-facing half of the integration system. Everything here is written
 * to be safe to send to a browser: this module never returns a decrypted
 * credential, never puts one in an audit record, and never lets a provider's
 * own error text through unedited.
 *
 * The runtime half — turning stored configuration into a working provider —
 * is `lib/config/integrations`, which does hold plaintext and is never
 * reachable from a route.
 *
 * ## The secret contract
 *
 * A secret can be **set** or **replaced** but never **read back**:
 *
 *   • `GET` returns `{ set, updatedAt }` and, for the one field the registry
 *     marks `LAST4`, four characters. Nothing else.
 *   • `PATCH` treats an *omitted* secret as "keep what is stored" and an
 *     explicit `null` as "clear it". This is what lets the form save a
 *     changed port number without ever having held the password.
 *
 * ## What a "test" means
 *
 * `testModule` makes a real call to the real provider. Filled-in fields are
 * never treated as evidence of anything: a module reaches `CONNECTED` only
 * after a round-trip succeeded, and the result is recorded against the
 * provider it was run for, so switching provider drops the claim (§39).
 */

/* --- Reading ---------------------------------------------------------------- */

/**
 * Every module, as the admin panel sees it.
 *
 * Built module by module rather than in one aggregate because each needs its
 * own resolved view, and there are five of them — the readability is worth
 * more here than five saved round-trips against a memoised cache.
 */
export async function listIntegrationModules() {
  const modules = await Promise.all(INTEGRATION_MODULE_KEYS.map((key) => getIntegrationModule(key)));
  return { modules, appEnv: appEnv() };
}

/** One module, with every secret reduced to the fact that it exists. */
export async function getIntegrationModule(moduleKey) {
  const registry = INTEGRATION_REGISTRY[moduleKey];
  if (!registry) throw new NotFoundError("That module does not exist.");

  const [record, resolved] = await Promise.all([
    Integration.findOne({ module: moduleKey }).lean(),
    resolveIntegrationConfig(moduleKey, { fresh: true }),
  ]);

  const provider = resolved.provider && registry.providers[resolved.provider] ? resolved.provider : null;
  const providers = registry.multi
    ? (resolved.providers ?? []).filter((name) => registry.providers[name])
    : [];

  /** Every provider this module is running, which is what its config spans. */
  const active = activeProvidersFor(moduleKey, { provider, providers });

  return {
    module: moduleKey,
    label: registry.label,
    description: registry.description,
    multi: Boolean(registry.multi),
    disableWarning: registry.disableWarning ?? null,

    enabled: resolved.enabled,
    provider,
    providers,

    /** Where the live values came from, so an operator is never guessing. */
    source: resolved.source,
    configured: resolved.configured,
    missing: resolved.missing,
    error: resolved.error,
    usesDevelopment: resolved.usesDevelopment,

    status: deriveStatus(resolved, record),

    /** Non-secret values only. Every secret field is absent from this object. */
    config: publicConfig(moduleKey, active, resolved.config),
    secrets: publicSecrets(moduleKey, record),

    lastTest: record?.lastTest
      ? {
          at: record.lastTest.at ?? null,
          ok: Boolean(record.lastTest.ok),
          code: record.lastTest.code ?? null,
          message: record.lastTest.message ?? null,
          provider: record.lastTest.provider ?? null,
          /** A pass against a provider you have since left proves nothing. */
          stale: record.lastTest.provider !== (provider ?? null),
        }
      : null,

    /** The form's own description of itself — labels, kinds, help, options. */
    providerOptions: providersFor(moduleKey).map((name) => ({
      value: name,
      label: registry.providers[name].label,
      description: registry.providers[name].description,
      fields: fieldsFor(moduleKey, name).map((field) => ({
        name: field.name,
        label: field.label,
        kind: field.kind,
        required: Boolean(field.required),
        placeholder: field.placeholder ?? null,
        help: field.help ?? null,
        options: field.options ?? null,
        env: field.env ?? null,
      })),
    })),

    /** What a one-click import from the environment would pick up. */
    environment: environmentOffer(moduleKey),

    /** What the test button asks for. Empty for a credentials-only check. */
    testLabel: registry.testLabel ?? "Test connection",
    testFields: (registry.testFields ?? []).map((field) => ({
      name: field.name,
      label: field.label,
      kind: field.kind,
      placeholder: field.placeholder ?? null,
      help: field.help ?? null,
    })),

    updatedAt: record?.updatedAt ?? null,
  };
}

/**
 * The four-state answer to "is this working", plus the two edge states.
 *
 * `CONFIGURED` and `CONNECTED` are deliberately different, and the gap
 * between them is the whole point: fields being filled in is not evidence
 * that a credential works, and a panel that said otherwise would be reporting
 * something nobody checked.
 */
function deriveStatus(resolved, record) {
  if (!resolved.enabled) return INTEGRATION_STATUS.DISABLED;
  // A credential that will not decrypt is its own state — it is neither
  // missing nor wrong, and the fix is specific.
  if (resolved.error?.includes("cannot be read")) return INTEGRATION_STATUS.NEEDS_ATTENTION;
  // `configured` is true for the development fallback, because a fake that
  // works is a valid runtime answer. It is not a valid answer to "has an
  // operator set this module up", which is what this panel asks — so a
  // module running the development implementation reads as not configured.
  if (!resolved.configured || resolved.usesDevelopment) return INTEGRATION_STATUS.NOT_CONFIGURED;

  const test = record?.lastTest;
  if (test?.provider && test.provider === resolved.provider) {
    return test.ok ? INTEGRATION_STATUS.CONNECTED : INTEGRATION_STATUS.FAILING;
  }
  return INTEGRATION_STATUS.CONFIGURED;
}

/**
 * Non-secret values for the providers this module is running, and nothing else.
 *
 * A list, because a `multi` module holds a set of fields per platform and the
 * form renders all of them at once.
 */
function publicConfig(moduleKey, providers, config) {
  const shown = {};
  for (const field of fieldsForProviders(moduleKey, providers)) {
    if (field.kind === FIELD_KINDS.SECRET) continue;
    if (config[field.name] !== undefined) shown[field.name] = config[field.name];
  }
  return shown;
}

/**
 * What may be said about each stored secret.
 *
 * Every secret field the module has across every provider, so switching the
 * provider dropdown in the browser does not blank out the indicator for a
 * credential that is still stored.
 */
function publicSecrets(moduleKey, record) {
  const shown = {};
  for (const provider of providersFor(moduleKey)) {
    for (const field of fieldsFor(moduleKey, provider)) {
      if (field.kind !== FIELD_KINDS.SECRET || shown[field.name]) continue;
      const meta = record?.secretMeta?.[field.name];
      shown[field.name] = {
        set: Boolean(meta?.set),
        // Present only where the registry allows it, and only ever four
        // characters of a value the provider's own dashboard also shows.
        last4: field.hint === SECRET_HINTS.LAST4 ? (meta?.last4 ?? null) : null,
        updatedAt: meta?.updatedAt ?? null,
      };
    }
  }
  return shown;
}

/**
 * Which environment variables this module could be seeded from.
 *
 * Names and a boolean — never a value, not even a masked one. An operator
 * adopting the admin panel on an existing deployment should not have to
 * re-type credentials they already deployed, but they also should not be able
 * to read them out of the screen.
 */
function environmentOffer(moduleKey) {
  const resolved = resolveIntegration(moduleKey);
  const live =
    resolved.configured && resolved.name !== DEVELOPMENT
      ? resolved.names.filter((name) => providersFor(moduleKey).includes(name))
      : [];
  if (!live.length) return { available: false, provider: null, providers: [], fields: [] };

  // Every platform the environment names, not just the first: a deployment
  // running Google *and* Outlook has two sets of variables to adopt.
  const providers = isMultiModule(moduleKey) ? live : [live[0]];

  const fields = fieldsForProviders(moduleKey, providers)
    .filter((field) => field.env && process.env[field.env]?.trim())
    .map((field) => ({ name: field.name, label: field.label, env: field.env }));

  return { available: fields.length > 0, provider: providers[0], providers, fields };
}

/* --- Writing ---------------------------------------------------------------- */

/**
 * Save one module's configuration.
 *
 * @param {string} moduleKey
 * @param {object} body    Already through `integrationPatchEnvelopeSchema`.
 * @param {object} actor   The administrator making the change.
 * @returns {Promise<{ module: object, changes: object }>}
 */
export async function updateIntegrationModule(moduleKey, body, actor) {
  const registry = INTEGRATION_REGISTRY[moduleKey];
  if (!registry) throw new NotFoundError("That module does not exist.");

  const existing = await Integration.findOne({ module: moduleKey }).lean();

  // The provider a patch applies to: what it names, else what is stored, else
  // whatever the environment already resolved to. Choosing it before
  // validation is what lets the strict schema know which fields are legal.
  const provider =
    body.provider ??
    existing?.provider ??
    (registry.multi ? body.providers?.[0] : null) ??
    environmentOffer(moduleKey).provider ??
    providersFor(moduleKey)[0];

  // Every provider the module will be running once this lands. A `multi`
  // module saves all of its platforms at once, so the patch may legitimately
  // carry each one's fields — validating against the primary alone is what
  // made a second platform impossible to configure.
  const active = activeProvidersFor(moduleKey, {
    provider,
    providers: body.providers ?? existing?.providers ?? [],
  });

  const validated = validateModulePatch(moduleKey, provider, body, active);
  if (!validated.success) throw new ValidationError({ fieldErrors: validated.fieldErrors });

  const { config, secrets } = validated.data;

  const formatErrors = checkProviderFormats(moduleKey, active, config, secrets);
  if (Object.keys(formatErrors).length) throw new ValidationError({ fieldErrors: formatErrors });

  await checkProviderRules(moduleKey, provider, { config, secrets, existing });

  const update = { $set: { module: moduleKey, provider, updatedBy: actor?.id ?? null }, $unset: {} };

  if (body.enabled !== undefined) update.$set.enabled = body.enabled;
  // A module that exists only because it was just saved must not be born
  // switched off. `enabled` defaults to false in the schema and Mongoose
  // applies defaults on upsert, so a first save that says nothing about the
  // switch would silently take a working environment-configured module down.
  // Whatever it resolved to a moment ago is the answer to keep.
  else update.$setOnInsert = { enabled: await currentlyEnabled(moduleKey) };
  if (registry.multi && validated.data.providers) update.$set.providers = validated.data.providers;

  // Non-secret fields, dotted so a partial save never wipes a sibling the
  // form did not send — the same rule the platform settings write follows.
  for (const [name, value] of Object.entries(config)) {
    if (value === "" || value === null) update.$unset[`config.${name}`] = "";
    else update.$set[`config.${name}`] = value;
  }

  const rotated = [];
  const cleared = [];
  for (const [name, value] of Object.entries(secrets)) {
    if (value === null) {
      update.$unset[`secrets.${name}`] = "";
      update.$set[`secretMeta.${name}`] = { set: false };
      cleared.push(name);
      continue;
    }
    if (value === undefined) continue;

    update.$set[`secrets.${name}`] = encryptSecret(value, SECRET_LABEL);
    update.$set[`secretMeta.${name}`] = {
      set: true,
      last4: last4For(moduleKey, active, name, value),
      updatedAt: new Date(),
      updatedBy: actor?.id ?? null,
    };
    rotated.push(name);
  }

  // A configuration change invalidates the last test: the credentials that
  // passed may not be the credentials that are now stored (§39).
  if (rotated.length || cleared.length || Object.keys(config).length || body.provider) {
    update.$set.lastTest = null;
  }

  if (!Object.keys(update.$unset).length) delete update.$unset;

  await Integration.findOneAndUpdate({ module: moduleKey }, update, {
    upsert: true,
    runValidators: true,
    returnDocument: "after",
  });

  refreshRuntime(moduleKey);

  return {
    module: await getIntegrationModule(moduleKey),
    changes: describeChanges({ existing, body, provider, config, rotated, cleared }),
  };
}

/**
 * Seed a module from the environment variables it already has.
 *
 * Exists so adopting the admin panel on a running deployment is one click
 * rather than a credential-copying exercise — which would mean an operator
 * pasting live keys around, and is exactly the handling this feature is
 * supposed to reduce. The values move server-side and are encrypted on the
 * way in; none of them passes through a browser.
 */
export async function importIntegrationFromEnvironment(moduleKey, actor) {
  const registry = INTEGRATION_REGISTRY[moduleKey];
  if (!registry) throw new NotFoundError("That module does not exist.");

  const offer = environmentOffer(moduleKey);
  if (!offer.available) {
    throw new BusinessRuleError(
      `There are no ${registry.label.toLowerCase()} credentials in this deployment's environment to import.`,
    );
  }

  const config = {};
  const secrets = {};
  for (const field of fieldsForProviders(moduleKey, offer.providers)) {
    if (!field.env) continue;
    const raw = process.env[field.env]?.trim();
    if (!raw) continue;
    if (field.kind === FIELD_KINDS.SECRET) secrets[field.name] = raw;
    else if (field.kind === FIELD_KINDS.BOOLEAN) config[field.name] = raw !== "false" && raw !== "0";
    else if (field.kind === FIELD_KINDS.PORT) config[field.name] = Number(raw);
    else config[field.name] = raw;
  }

  // Stripe's declared mode is not an environment variable — it is read from
  // the key, which is the only thing that actually decides it.
  if (moduleKey === INTEGRATION_MODULES.PAYMENT && secrets.secretKey) {
    config.environment = stripeModeOf(secrets.secretKey) ?? "test";
  }

  return updateIntegrationModule(
    moduleKey,
    {
      provider: offer.provider,
      // Every platform the environment configures, not just the first — this
      // is the whole point of the import on a `multi` module.
      ...(registry.multi ? { providers: offer.providers } : {}),
      config,
      secrets,
    },
    actor,
  );
}

/**
 * Remove a module's stored configuration entirely.
 *
 * The way back. Without it, opening this screen once would be irreversible:
 * the stored record wins over the environment, so a module saved by mistake —
 * or configured against the wrong account — would have no route back to the
 * deployment's own configuration short of a database edit.
 *
 * The encrypted credentials go with the record. That is the point: an
 * operator who is removing a provider is usually removing it *because* they
 * no longer want those credentials held.
 */
export async function clearIntegrationModule(moduleKey) {
  const registry = INTEGRATION_REGISTRY[moduleKey];
  if (!registry) throw new NotFoundError("That module does not exist.");

  const existing = await Integration.findOneAndDelete({ module: moduleKey }).lean();
  refreshRuntime(moduleKey);

  return {
    module: await getIntegrationModule(moduleKey),
    changes: {
      cleared: true,
      hadProvider: existing?.provider ?? null,
      // Which credentials were destroyed, by name. An operator reading the log
      // later needs to know what they have to re-enter.
      secretsCleared: Object.keys(existing?.secretMeta ?? {}).filter(
        (name) => existing.secretMeta[name]?.set,
      ),
    },
  };
}

/* --- Provider rules --------------------------------------------------------- */

/** Documented, stable credential formats. Nothing here guesses. */
function checkProviderFormats(moduleKey, providers, config, secrets) {
  const fields = fieldsForProviders(moduleKey, providers);
  const errors = {};

  for (const provider of providers) {
    const rules = PROVIDER_FORMAT_RULES[moduleKey]?.[provider] ?? {};
    for (const [name, rule] of Object.entries(rules)) {
      const isSecretField = fields.find((f) => f.name === name)?.kind === FIELD_KINDS.SECRET;
      const value = isSecretField ? secrets[name] : config[name];
      if (value === undefined || value === null || value === "") continue;

      const problem = rule(value);
      if (problem) errors[`${isSecretField ? "secrets" : "config"}.${name}`] = [problem];
    }
  }

  return errors;
}

/**
 * Cross-field rules that need the stored record as well as the patch.
 *
 * These are the ones a schema cannot express, because half the information is
 * already in the database.
 */
async function checkProviderRules(moduleKey, provider, { config, secrets, existing }) {
  if (moduleKey === INTEGRATION_MODULES.PAYMENT && provider === "stripe") {
    await checkStripeMode({ config, secrets, existing });
  }

  if (moduleKey === INTEGRATION_MODULES.SMS && provider === "twilio") {
    // Either sender identifies the account to the carrier; neither means
    // every message fails at Twilio rather than here.
    const from = pick(config.fromNumber, existing?.config?.fromNumber);
    const service = pick(config.messagingServiceSid, existing?.config?.messagingServiceSid);
    if (!from && !service) {
      throw new ValidationError({
        fieldErrors: {
          "config.fromNumber": ["Give either a from number or a messaging service SID."],
        },
      });
    }
  }

  if (moduleKey === INTEGRATION_MODULES.EMAIL && provider === "smtp") {
    const port = pick(config.port, existing?.config?.port);
    const secure = pick(config.secure, existing?.config?.secure);
    // Not an error — plenty of servers do unusual things — but 465 without
    // implicit TLS hangs rather than failing, which is a miserable way to
    // spend an afternoon.
    if (port === 465 && secure === false) {
      throw new ValidationError({
        fieldErrors: {
          "config.secure": ["Port 465 expects implicit TLS. Turn it on, or use port 587 for STARTTLS."],
        },
      });
    }
  }
}

/**
 * The declared Stripe environment and the key's own mode must agree (§36).
 *
 * This is the rule that stops a live key being saved into a deployment that
 * believes it is testing — the mistake that charges a real card during a
 * rehearsal. The key is authoritative; the dropdown is a statement of intent
 * that has to match it.
 *
 * Switching the dropdown without supplying a matching key is refused too,
 * because the stored key would then be silently wrong for the declared mode.
 */
async function checkStripeMode({ config, secrets, existing }) {
  const declared = pick(config.environment, existing?.config?.environment) ?? "test";

  if (secrets.secretKey) {
    const actual = stripeModeOf(secrets.secretKey);
    if (actual && actual !== declared) {
      throw new ValidationError({
        fieldErrors: {
          "secrets.secretKey": [
            `That is a ${actual} mode key, but this module is set to ${declared} mode. ` +
              `Change the environment above, or paste a ${declared} mode key.`,
          ],
        },
      });
    }
  } else if (config.environment && config.environment !== existing?.config?.environment) {
    // The dropdown moved and no new key came with it. The stored key is for
    // the old mode, so accepting this would leave the module claiming a mode
    // its credentials cannot serve.
    const resolved = await resolveIntegrationConfig(INTEGRATION_MODULES.PAYMENT, { fresh: true });
    const storedMode = stripeModeOf(resolved.secrets?.secretKey);
    if (storedMode && storedMode !== config.environment) {
      throw new ValidationError({
        fieldErrors: {
          "config.environment": [
            `The stored secret key is a ${storedMode} mode key. Paste a ${config.environment} mode key at the same time as switching.`,
          ],
        },
      });
    }
  }

  if (secrets.publishableKey === undefined && config.publishableKey) {
    const pubMode = /^pk_live_/.test(config.publishableKey) ? "live" : "test";
    if (pubMode !== declared) {
      throw new ValidationError({
        fieldErrors: {
          "config.publishableKey": [`That is a ${pubMode} mode publishable key, but this module is set to ${declared} mode.`],
        },
      });
    }
  }
}

/**
 * What the module resolves to right now, before this write lands.
 *
 * Used only to seed `enabled` on an insert, so adopting a module that the
 * environment already configures does not take it down.
 */
async function currentlyEnabled(moduleKey) {
  const resolved = await resolveIntegrationConfig(moduleKey, { fresh: true });
  return resolved.enabled !== false;
}

function pick(...values) {
  for (const value of values) if (value !== undefined && value !== null && value !== "") return value;
  return undefined;
}

/** Four characters, only where the registry says they may be shown. */
function last4For(moduleKey, providers, name, value) {
  const field = fieldsForProviders(moduleKey, providers).find((f) => f.name === name);
  return field?.hint === SECRET_HINTS.LAST4 ? String(value).slice(-4) : undefined;
}

/* --- Testing ---------------------------------------------------------------- */

/**
 * Make a real call to the real provider, and record what came back.
 *
 * Always uses the *stored* configuration rather than anything in the request,
 * so "test" means "test what is saved" and a passing result cannot be
 * produced by posting credentials that were never persisted.
 *
 * A disabled module refuses. Testing is cheap but "Send Test SMS" is not a
 * test, it is a send, and §39's rule against a switch that does nothing cuts
 * both ways: a module an operator has switched off must not be reachable,
 * including from this screen.
 */
export async function testIntegrationModule(moduleKey, input, actor) {
  const registry = INTEGRATION_REGISTRY[moduleKey];
  if (!registry) throw new NotFoundError("That module does not exist.");

  const resolved = await resolveIntegrationConfig(moduleKey, { fresh: true });

  if (!resolved.enabled) {
    throw new BusinessRuleError(
      `${registry.label} is switched off. Turn the module on and save before testing it.`,
    );
  }
  if (!resolved.configured) {
    throw new BusinessRuleError(
      resolved.error ?? `${registry.label} is not configured yet. Save a configuration first.`,
    );
  }

  const result = await runTest(moduleKey, resolved, input ?? {});

  await Integration.findOneAndUpdate(
    { module: moduleKey },
    {
      // Recording a test result must never be the thing that switches a module
      // off. There may be no stored document yet — the common case, where the
      // configuration comes from the environment — and `enabled` defaults to
      // false, which Mongoose applies on upsert. Seeding it with what the
      // module resolved to keeps a diagnostic read-only.
      $setOnInsert: { enabled: resolved.enabled },
      $set: {
        module: moduleKey,
        lastTest: {
          at: new Date(),
          ok: result.ok,
          code: result.code,
          // Bounded and already sanitised by the adapter; truncated here as a
          // second guard against a provider returning an essay.
          message: String(result.message ?? "").slice(0, 400),
          provider: resolved.provider,
          actorId: actor?.id ?? null,
        },
      },
    },
    { upsert: true },
  );

  invalidateIntegrationCache(moduleKey);

  return { ...result, module: moduleKey, provider: resolved.provider, at: new Date() };
}

/** Dispatch to the right adapter. Every branch performs a real round-trip. */
async function runTest(moduleKey, resolved, input) {
  switch (moduleKey) {
    case INTEGRATION_MODULES.EMAIL:
      return testEmail(resolved, input);
    case INTEGRATION_MODULES.PAYMENT:
      return buildPaymentProvider(resolved).verify();
    case INTEGRATION_MODULES.SMS:
      return testSms(resolved, input);
    case INTEGRATION_MODULES.CALENDAR:
      return testCalendar(resolved);
    case INTEGRATION_MODULES.STORAGE:
      return testStorage(resolved);
    default:
      return { ok: false, code: "NOT_SUPPORTED", message: "That module cannot be tested." };
  }
}

/**
 * Credentials first, then — if a recipient was given — an actual message.
 *
 * The order matters: an operator who typed the wrong API key should be told
 * that, not left wondering why a message they can see in the log never
 * arrived.
 */
async function testEmail(resolved, { recipient }) {
  const provider = buildEmailProvider(resolved);

  const verified = await provider.verify();
  if (!verified.ok) return verified;
  if (!recipient) return verified;

  try {
    const sent = await provider.send({
      to: recipient,
      subject: "APlus Learn — email configuration test",
      text: [
        "This is a test message from the APlus Learn admin panel.",
        "",
        `Provider: ${provider.name}`,
        `Sent: ${new Date().toISOString()}`,
        "",
        "If you received this, transactional email is working.",
      ].join("\n"),
    });

    return sent.delivered
      ? {
          ok: true,
          code: "OK",
          message: `${verified.message} A test message was accepted for delivery to ${recipient}.`,
        }
      : {
          ok: false,
          code: "NOT_DELIVERED",
          message: "The provider accepted the credentials but did not accept the message.",
        };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? "SEND_FAILED",
      message: safeProviderMessage(error, "The message could not be sent."),
    };
  }
}

/** Same shape as email: prove the account, then optionally text a number. */
async function testSms(resolved, { phone, message }) {
  const provider = buildSmsProvider(resolved);

  const verified = await provider.verify();
  if (!verified.ok) return verified;
  if (!phone) return verified;

  try {
    const sent = await provider.send({
      to: phone,
      body: message?.trim() || "APlus Learn: this is a test message from the admin panel.",
      // Distinct per attempt, so an operator pressing the button twice really
      // does get two messages rather than a silent de-duplication.
      idempotencyKey: `aplus-test-${Date.now()}`,
    });

    return sent.delivered
      ? { ok: true, code: "OK", message: `${verified.message} A test message was queued to ${phone} (${sent.status}).` }
      : { ok: false, code: "NOT_DELIVERED", message: "The carrier did not accept the message." };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? "SEND_FAILED",
      message: safeProviderMessage(error, "The message could not be sent."),
    };
  }
}

/**
 * Every calendar platform the operator has turned on, plus the fact that
 * matters most: how many tutors are actually connected.
 *
 * Reported side by side because they are different claims and the panel must
 * not blur them — valid client credentials mean tutors *can* connect, not
 * that any of them has (§39).
 */
async function testCalendar(resolved) {
  const results = await Promise.all(
    (resolved.providers ?? []).map(async (name) => {
      const platform = name === "microsoft" ? "OUTLOOK" : "GOOGLE";
      const provider = buildCalendarProvider(platform, resolved);
      const result = await provider.verify();
      return { name, label: name === "microsoft" ? "Outlook" : "Google", ...result };
    }),
  );

  if (!results.length) {
    return { ok: false, code: "NOT_CONFIGURED", message: "No calendar platform is turned on." };
  }

  const connections = await CalendarConnection.countDocuments({
    status: CALENDAR_CONNECTION_STATUS.CONNECTED,
  });

  const failed = results.filter((r) => !r.ok);
  const summary = results.map((r) => `${r.label}: ${r.ok ? "ok" : r.message}`).join(" · ");
  const tutors = `${connections} tutor ${connections === 1 ? "calendar is" : "calendars are"} connected.`;

  return failed.length
    ? { ok: false, code: failed[0].code, message: `${summary} — ${tutors}` }
    : {
        ok: true,
        code: "OK",
        message: `${summary}. Tutors can connect their own calendars. ${tutors}`,
      };
}

/**
 * The storage adapter throws on failure rather than returning a verdict — it
 * predates this panel and its other caller is a CLI that wants the stack.
 * Normalised here rather than changed there.
 */
async function testStorage(resolved) {
  const provider = buildStorageProvider(resolved);
  try {
    const result = await provider.verify();
    return { ok: true, code: "OK", message: result.detail ?? "The store is reachable." };
  } catch (error) {
    return {
      ok: false,
      code: error?.code ?? "UNREACHABLE",
      message: safeProviderMessage(error, "The store could not be reached."),
    };
  }
}

/**
 * A provider error, made safe to show.
 *
 * Adapter-thrown messages are already written for this, but an error escaping
 * from a client library is not — it can carry a request URL with a signature
 * on it, or the credential that was refused. Anything not recognisably ours
 * is replaced rather than trimmed.
 */
function safeProviderMessage(error, fallback) {
  const message = String(error?.message ?? "");
  if (!message) return fallback;
  if (/sk_(test|live)|whsec_|Bearer |AC[0-9a-f]{32}|password|authToken/i.test(message)) return fallback;
  return message.slice(0, 300);
}

/* --- Audit ------------------------------------------------------------------ */

/**
 * What changed, for the audit record (§35).
 *
 * Names and transitions only. A rotated secret is recorded as the *fact* of a
 * rotation — which field, by whom, when — and never as a value, not even a
 * masked or hashed one. That is the whole of what an audit reader needs: they
 * are reconstructing who did what, not recovering a key.
 */
function describeChanges({ existing, body, provider, config, rotated, cleared }) {
  const changes = {};

  if (body.enabled !== undefined && body.enabled !== (existing?.enabled ?? false)) {
    changes.enabled = { from: existing?.enabled ?? false, to: body.enabled };
  }
  if (existing?.provider && provider !== existing.provider) {
    changes.provider = { from: existing.provider, to: provider };
  }
  if (body.providers) {
    changes.providers = { from: existing?.providers ?? [], to: body.providers };
  }

  const configChanges = {};
  for (const [name, value] of Object.entries(config)) {
    const before = existing?.config?.[name];
    if (JSON.stringify(before) === JSON.stringify(value)) continue;
    configChanges[name] = { from: before ?? null, to: value === "" ? null : value };
  }
  if (Object.keys(configChanges).length) changes.config = configChanges;

  if (rotated.length) changes.secretsRotated = rotated;
  if (cleared.length) changes.secretsCleared = cleared;

  return changes;
}

/* --- Runtime ---------------------------------------------------------------- */

/**
 * Drop everything memoised about this module, in both caches.
 *
 * Without this a saved credential would not take effect for up to thirty
 * seconds, and the provider instance built from the old one could outlive it
 * indefinitely — which is the difference between a settings screen and a
 * settings screen that works (§39).
 */
function refreshRuntime(moduleKey) {
  invalidateIntegrationCache(moduleKey);

  const reset = {
    [INTEGRATION_MODULES.EMAIL]: resetEmailProvider,
    [INTEGRATION_MODULES.PAYMENT]: resetPaymentProvider,
    [INTEGRATION_MODULES.SMS]: resetSmsProvider,
    [INTEGRATION_MODULES.CALENDAR]: resetCalendarProviders,
    [INTEGRATION_MODULES.STORAGE]: resetStorageProvider,
  }[moduleKey];

  reset?.();
}

/**
 * The integration rows for the admin dashboard's health strip.
 *
 * Deliberately thinner than `listIntegrationModules` — it answers "is
 * anything wrong" without loading five providers' worth of form metadata.
 */
export async function integrationHealthRows() {
  const { modules } = await listIntegrationModules();
  return toPlain(
    modules.map((m) => ({
      module: m.module,
      label: m.label,
      status: m.status,
      enabled: m.enabled,
      provider: m.provider,
      source: m.source,
      usesDevelopment: m.usesDevelopment,
    })),
  );
}

export { CONFIG_SOURCES, INTEGRATION_STATUS };
