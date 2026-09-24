import mongoose from "mongoose";
import {
  INTEGRATION_MODULE_KEYS,
  INTEGRATION_REGISTRY,
  FIELD_KINDS,
  fieldsFor,
  providersFor,
} from "../constants/integrations.js";

/**
 * One external module's operator-set configuration (§26, §36, §38).
 *
 * A document per module — email, payment, calendar, sms, storage — rather
 * than a group inside `Settings`, and that separation is load-bearing rather
 * than tidy-minded. `getSettings()` is memoised and its value feeds
 * `getAppConfig()`, which server components pass into *client* components for
 * branding. A credential stored in that document would be one careless prop
 * away from a browser. Keeping credentials in their own collection means no
 * existing settings path can leak one, however it is refactored later.
 *
 * ## How secrets are held
 *
 * Every secret field is encrypted with AES-256-GCM before it reaches Mongo
 * (`lib/security/crypto`, the same module that protects calendar refresh
 * tokens) and the whole `secrets` sub-document is `select: false`. The
 * ordinary read — the admin panel listing modules and their status — never
 * loads a ciphertext at all, let alone a plaintext. Only
 * `resolveIntegrationConfig` asks for them, and only to hand them straight to
 * a provider adapter.
 *
 * `secretMeta` carries what the panel actually needs in order to render a
 * secret field: that one is set, when it last changed, and — for the Stripe
 * secret key alone — its last four characters. None of that is sensitive, so
 * it loads normally.
 *
 * ## Structure, and where it is enforced
 *
 * The sub-schemas are generated from `INTEGRATION_REGISTRY` rather than typed
 * out, so a provider gains a field by gaining a registry entry and there is no
 * second list to forget. Each is the *union* of every field across every
 * module, because Mongoose cannot type one path differently per document —
 * which module a field belongs to is enforced in two places above this one:
 *
 *   1. `lib/validation/integrations.js` builds a strict Zod schema per
 *      module+provider, so a payload naming another module's field is
 *      rejected at the API boundary with a field error.
 *   2. `integration.service` writes only the fields `fieldsFor(module,
 *      provider)` declares, so even a payload that somehow got past
 *      validation cannot place a value the provider does not use.
 *
 * Defaults are deliberately *not* declared here. A union schema would inject
 * storage's `region` default into the payment document. They live in the
 * registry and are applied when a module is resolved, which keeps one answer
 * to "what is this field's default".
 */

/** Mongoose type for one registry field kind. */
function typeForField(field) {
  switch (field.kind) {
    case FIELD_KINDS.BOOLEAN:
      return { type: Boolean };
    case FIELD_KINDS.PORT:
      return { type: Number, min: 1, max: 65535 };
    case FIELD_KINDS.EMAIL:
      return { type: String, trim: true, lowercase: true, maxlength: 254 };
    default:
      // URLs, phone numbers, identifiers, selects and free text. Bounded
      // generously: an S3 endpoint carrying a path prefix is longer than it
      // looks. Select values are constrained by Zod, not by an enum here,
      // because the same path serves several modules.
      return { type: String, trim: true, maxlength: 500 };
  }
}

/** Every distinct field across every module, by kind. */
function unionOf(predicate) {
  const shape = {};
  for (const moduleKey of INTEGRATION_MODULE_KEYS) {
    for (const provider of providersFor(moduleKey)) {
      for (const field of fieldsFor(moduleKey, provider)) {
        if (!predicate(field)) continue;
        shape[field.name] ??= typeForField(field);
      }
    }
  }
  return shape;
}

const isSecret = (field) => field.kind === FIELD_KINDS.SECRET;

/** Non-secret configuration. Readable, editable, shown in full. */
const ConfigSchema = new mongoose.Schema(unionOf((field) => !isSecret(field)), {
  _id: false,
  minimize: false,
});

/** Ciphertexts. `select: false` on the parent path, so never loaded by accident. */
const SecretsSchema = new mongoose.Schema(
  Object.fromEntries(Object.keys(unionOf(isSecret)).map((name) => [name, { type: String }])),
  { _id: false, minimize: false },
);

/** What the panel may show about a stored secret. No part of this is sensitive. */
const SecretMetaEntrySchema = new mongoose.Schema(
  {
    set: { type: Boolean, default: false },
    /** Last four characters — populated only where the registry allows it. */
    last4: { type: String, trim: true, maxlength: 4 },
    updatedAt: { type: Date },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false },
);

const SecretMetaSchema = new mongoose.Schema(
  Object.fromEntries(
    Object.keys(unionOf(isSecret)).map((name) => [
      name,
      { type: SecretMetaEntrySchema, default: () => ({}) },
    ]),
  ),
  { _id: false, minimize: false },
);

/**
 * The outcome of the last real provider round-trip.
 *
 * `message` is a sanitised, operator-readable sentence. Provider responses
 * are never stored verbatim: a 401 body from Twilio or Stripe can echo the
 * credential that was presented, and this document is read by the admin panel
 * (§36).
 *
 * `provider` is recorded alongside, so a passing result cannot outlive the
 * adapter it passed against — switching from Resend to SMTP must not leave
 * the module still claiming it is connected.
 */
/**
 * One platform's verdict inside a `multi` module's test — Google passed,
 * Apple did not. Same sanitised shape as the module-level result.
 */
const ProviderTestResultSchema = new mongoose.Schema(
  {
    provider: { type: String, trim: true, maxlength: 60 },
    ok: { type: Boolean },
    code: { type: String, trim: true, maxlength: 60 },
    message: { type: String, trim: true, maxlength: 400 },
  },
  { _id: false },
);

const LastTestSchema = new mongoose.Schema(
  {
    at: { type: Date },
    ok: { type: Boolean },
    /** A stable code — `OK`, `INVALID_CREDENTIALS`, `TIMEOUT`, … */
    code: { type: String, trim: true, maxlength: 60 },
    message: { type: String, trim: true, maxlength: 400 },
    provider: { type: String, trim: true, maxlength: 60 },
    /** Per platform, for a module that runs several at once. */
    results: { type: [ProviderTestResultSchema], default: undefined },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false },
);

const IntegrationSchema = new mongoose.Schema(
  {
    module: {
      type: String,
      enum: INTEGRATION_MODULE_KEYS,
      required: true,
      unique: true,
      index: true,
    },

    /**
     * The operator switch, with real runtime consequences.
     *
     * `false` makes the provider factory refuse rather than hand back an
     * adapter, so a disabled module cannot be reached by any code path — not
     * a page, not a cron job, not a service that forgot to check (§39).
     */
    enabled: { type: Boolean, default: false },

    /** Which adapter, for a module that has exactly one live at a time. */
    provider: { type: String, trim: true, maxlength: 60 },
    /**
     * Every adapter an operator has turned on, for a `multi` module —
     * calendar (a tutor connects Google or Outlook) and social sign-in
     * (Google, Apple, or both).
     */
    providers: { type: [String], default: undefined },

    config: { type: ConfigSchema, default: () => ({}) },
    secrets: { type: SecretsSchema, default: () => ({}), select: false },
    secretMeta: { type: SecretMetaSchema, default: () => ({}) },

    lastTest: { type: LastTestSchema, default: null },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

export const Integration =
  mongoose.models.Integration || mongoose.model("Integration", IntegrationSchema);

export { INTEGRATION_REGISTRY };
export default Integration;
