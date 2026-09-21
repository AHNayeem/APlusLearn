import { z } from "zod";
import {
  INTEGRATION_REGISTRY,
  INTEGRATION_MODULE_KEYS,
  FIELD_KINDS,
  fieldsForProviders,
  isMultiModule,
  providersFor,
} from "@/constants/integrations";

/**
 * External-module configuration schemas (§37).
 *
 * Built from `INTEGRATION_REGISTRY` rather than typed out, so a provider
 * gaining a field gains its validation at the same moment. The schemas are
 * strict in both directions: a field the chosen provider does not declare is
 * a field error, not a silently ignored key, because an operator who typed a
 * value into the wrong place deserves to be told rather than to watch it
 * vanish on save.
 *
 * Two layers, because they can see different things:
 *
 *   • `integrationPatchEnvelopeSchema` is what `routeHandler` applies. It
 *     bounds the *shape* — that `config` is an object of scalars, that
 *     `secrets` maps names to strings or null — before any of it is trusted.
 *
 *   • `validateModulePatch(module, body)` then applies the strict, provider
 *     specific schema. It cannot live in the route options because the module
 *     arrives as a path parameter, and a union across five modules would
 *     report a failure in one as a failure in all five.
 *
 * Rules that depend on what is already *stored* — "you switched to live mode
 * but did not give me a live key" — are not here. They belong to
 * `integration.service`, which is the only layer that can see both the patch
 * and the record it is being applied to.
 */

/** E.164, the only phone format a carrier API will accept. */
const E164 = /^\+[1-9]\d{6,14}$/;

const trimmed = z.string().trim();

/** One registry field's value schema. */
function schemaForField(field) {
  switch (field.kind) {
    case FIELD_KINDS.BOOLEAN:
      return z.boolean();

    case FIELD_KINDS.PORT:
      return z.coerce
        .number()
        .int("A port is a whole number.")
        .min(1, "A port is between 1 and 65535.")
        .max(65535, "A port is between 1 and 65535.");

    case FIELD_KINDS.EMAIL:
      return trimmed.toLowerCase().pipe(z.email("Enter a valid email address."));

    case FIELD_KINDS.URL:
      return trimmed
        .max(500)
        .refine(
          (value) => /^https?:\/\/\S+$/i.test(value),
          "Enter a full URL, starting with http:// or https://.",
        );

    case FIELD_KINDS.PHONE:
      return trimmed
        .max(20)
        .refine((value) => E164.test(value), "Use the international format, like +16475550123.");

    case FIELD_KINDS.SELECT:
      return z.enum(
        field.options.map((option) => option.value),
        { message: `Choose one of: ${field.options.map((o) => o.label).join(", ")}.` },
      );

    case FIELD_KINDS.SECRET:
      // Bounded, but otherwise unconstrained: a provider's key format is the
      // provider's business, and a length rule invented here would reject a
      // valid credential some future rotation produces. Format checks that
      // genuinely matter — a live key in test mode — are provider rules and
      // live in the service.
      return trimmed.min(1, "Enter a value, or clear the field to remove it.").max(500);

    default:
      return trimmed.max(500);
  }
}

/**
 * A blank non-secret field means "unset this", not "fail validation".
 *
 * An operator clearing an optional reply-to address is doing something
 * reasonable, and making them delete a row to express it would be silly.
 * Required fields are caught after the merge, in the service, where the
 * stored value is also in view.
 */
function optionalOrBlank(schema) {
  return z.union([z.literal(""), z.null(), schema]);
}

/**
 * The strict config schema for one module and the providers it is running.
 *
 * A list rather than one name, because a `multi` module saves every platform
 * an operator has switched on in a single request — the form renders a
 * fieldset per platform. Validating against only the first would reject the
 * second's fields as unrecognised keys, which is precisely what stops an
 * operator from configuring Outlook alongside Google.
 */
function configSchemaFor(moduleKey, providers) {
  const shape = {};
  for (const field of fieldsForProviders(moduleKey, providers)) {
    if (field.kind === FIELD_KINDS.SECRET) continue;
    shape[field.name] = optionalOrBlank(schemaForField(field)).optional();
  }
  return z.object(shape).strict();
}

/**
 * The strict secrets schema for one module + provider pair.
 *
 * `null` is how a secret is cleared. *Omitting* a secret is how it is kept —
 * which is what lets the form save a configuration change without ever having
 * held the existing credential, and is the whole reason the admin panel can
 * be useful without being a credential-disclosure surface (§36).
 */
function secretsSchemaFor(moduleKey, providers) {
  const shape = {};
  for (const field of fieldsForProviders(moduleKey, providers)) {
    if (field.kind !== FIELD_KINDS.SECRET) continue;
    shape[field.name] = z.union([z.null(), schemaForField(field)]).optional();
  }
  return z.object(shape).strict();
}

/**
 * The outer envelope, applied by `routeHandler` before anything is trusted.
 *
 * Deliberately shallow. It exists to stop a nested object, an array or a
 * hundred-megabyte string reaching the strict schema, not to know what any
 * particular module's fields mean.
 */
export const integrationPatchEnvelopeSchema = z
  .object({
    enabled: z.boolean().optional(),
    provider: trimmed.max(60).optional(),
    providers: z.array(trimmed.max(60)).max(8).optional(),
    config: z.record(z.string().max(60), z.union([z.string().max(500), z.number(), z.boolean(), z.null()])).optional(),
    secrets: z.record(z.string().max(60), z.union([z.string().max(500), z.null()])).optional(),
  })
  .strict()
  .refine(
    (value) => Object.keys(value).length > 0,
    { message: "Nothing to change." },
  );

/** Which module a request is about. */
export const integrationParamsSchema = z.object({
  module: z.enum(INTEGRATION_MODULE_KEYS),
});

/**
 * Test-endpoint input.
 *
 * Email and SMS tests take a destination, because a credential check that
 * does not deliver anything is not what an operator means by "test email".
 * The other modules take nothing.
 */
export const integrationTestSchema = z
  .object({
    recipient: z.union([z.literal(""), z.email("Enter a valid email address.")]).optional(),
    phone: z
      .union([
        z.literal(""),
        trimmed.refine((v) => E164.test(v), "Use the international format, like +16475550123."),
      ])
      .optional(),
    message: trimmed.max(280).optional(),
  })
  .strict();

/**
 * Apply the strict, provider-specific schema.
 *
 * @param {string} moduleKey
 * @param {string} provider   The provider the patch will be stored against.
 * @param {object} body       Already through the envelope schema.
 * @param {string[]} [activeProviders]  Every provider the module will be
 *   running once this patch lands. Only a `multi` module has more than one;
 *   omitted means "just `provider`".
 * @returns {{ success: true, data: object } | { success: false, fieldErrors: object }}
 */
export function validateModulePatch(moduleKey, provider, body, activeProviders) {
  const registry = INTEGRATION_REGISTRY[moduleKey];
  if (!registry) return { success: false, fieldErrors: { module: ["Unknown module."] } };

  const known = providersFor(moduleKey);
  if (!known.includes(provider)) {
    return {
      success: false,
      fieldErrors: {
        provider: [`Choose one of: ${known.map((name) => registry.providers[name].label).join(", ")}.`],
      },
    };
  }

  const fieldErrors = {};
  const result = { enabled: body.enabled, provider, config: {}, secrets: {} };

  if (body.providers !== undefined) {
    if (!isMultiModule(moduleKey)) {
      fieldErrors.providers = ["This module runs one provider at a time."];
    } else {
      const unknown = body.providers.filter((name) => !known.includes(name));
      if (unknown.length) fieldErrors.providers = [`Not a provider this build knows: ${unknown.join(", ")}.`];
      else result.providers = body.providers;
    }
  }

  // Which providers' fields this patch may legally carry. The caller works it
  // out, because it is the only layer that can see the stored record as well
  // as the request; falling back to the named provider keeps an ordinary
  // single-provider module behaving exactly as before.
  const scope = (activeProviders?.length ? activeProviders : [provider]).filter((name) =>
    known.includes(name),
  );

  const configResult = configSchemaFor(moduleKey, scope).safeParse(body.config ?? {});
  if (configResult.success) result.config = configResult.data;
  else collect(fieldErrors, configResult.error, "config");

  const secretsResult = secretsSchemaFor(moduleKey, scope).safeParse(body.secrets ?? {});
  if (secretsResult.success) result.secrets = secretsResult.data;
  else collect(fieldErrors, secretsResult.error, "secrets");

  if (Object.keys(fieldErrors).length) return { success: false, fieldErrors };
  return { success: true, data: result };
}

/**
 * Zod issues into the `group.field` shape the admin forms already resolve —
 * `useSettingsSection` keys its field errors the same way, so the integration
 * panels get the same behaviour without a second convention.
 */
function collect(target, error, prefix) {
  for (const issue of error.issues) {
    const path = [prefix, ...issue.path].join(".");
    (target[path] ??= []).push(issue.message);
  }
}

/**
 * Provider-format rules that are worth refusing a save over (§37).
 *
 * Kept narrow on purpose. These are the mistakes that are both easy to make
 * and expensive to discover later — a live Stripe key in a deployment that
 * believes it is testing being the obvious one. A rule that merely guessed at
 * a provider's key format would eventually reject a valid credential, so
 * nothing here fires unless the format is documented and stable.
 */
export const PROVIDER_FORMAT_RULES = {
  payment: {
    stripe: {
      secretKey: (value) =>
        /^(sk|rk)_(test|live)_/.test(value)
          ? null
          : "A Stripe secret key starts with sk_test_, sk_live_, rk_test_ or rk_live_.",
      publishableKey: (value) =>
        /^pk_(test|live)_/.test(value)
          ? null
          : "A Stripe publishable key starts with pk_test_ or pk_live_.",
      webhookSecret: (value) =>
        value.startsWith("whsec_") ? null : "A Stripe webhook signing secret starts with whsec_.",
      connectWebhookSecret: (value) =>
        value.startsWith("whsec_") ? null : "A Stripe webhook signing secret starts with whsec_.",
    },
  },
  sms: {
    twilio: {
      accountSid: (value) =>
        /^AC[0-9a-f]{32}$/i.test(value) ? null : "A Twilio account SID starts with AC and is 34 characters.",
      messagingServiceSid: (value) =>
        /^MG[0-9a-f]{32}$/i.test(value) ? null : "A Twilio messaging service SID starts with MG and is 34 characters.",
    },
  },
};

/** Which Stripe mode a key belongs to, read from the key itself. */
export function stripeModeOf(secretKey) {
  if (/^(sk|rk)_live_/.test(String(secretKey ?? ""))) return "live";
  if (/^(sk|rk)_test_/.test(String(secretKey ?? ""))) return "test";
  return null;
}
