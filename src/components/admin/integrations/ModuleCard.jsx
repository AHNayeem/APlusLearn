"use client";

import { useId, useState } from "react";
import {
  AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, Download, PlugZap,
  RotateCcw, Save, ShieldAlert, XCircle,
} from "lucide-react";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, Field, FormErrorSummary,
  Input, Select, Switch,
} from "@/components/ui";
import { INTEGRATION_STATUS, INTEGRATION_STATUS_LABELS, FIELD_KINDS } from "@/constants";
import { formatDateTime } from "@/lib/utils/format";
import { useIntegrationModule } from "./useIntegrationModule";
import { SecretField } from "./SecretField";

/**
 * One external module's panel (§26, §39).
 *
 * Generic on purpose. Every field, label, hint and provider option comes from
 * the module payload, which the server builds from `INTEGRATION_REGISTRY` —
 * so adding a provider adds its form, and no provider's name appears in this
 * file. The alternative, a component per integration, is four copies of the
 * same save button waiting to drift apart.
 *
 * ## Status is a claim, and the claim is narrow
 *
 * "Connected" appears only after a real provider round-trip succeeded against
 * the provider currently selected. Filled-in fields get "Configured, not
 * tested", which is the honest description of what the platform knows.
 * Changing anything clears the result, because credentials that passed are
 * not necessarily the credentials now stored.
 */

/**
 * Icon *and* words for every state — never colour alone, which is
 * unreadable to about one man in twelve (§34).
 */
const STATUS_PRESENTATION = {
  [INTEGRATION_STATUS.CONNECTED]: { tone: "success", Icon: CheckCircle2 },
  [INTEGRATION_STATUS.CONFIGURED]: { tone: "info", Icon: CircleDashed },
  [INTEGRATION_STATUS.NOT_CONFIGURED]: { tone: "neutral", Icon: CircleDashed },
  [INTEGRATION_STATUS.DISABLED]: { tone: "neutral", Icon: CircleSlash },
  [INTEGRATION_STATUS.FAILING]: { tone: "danger", Icon: XCircle },
  [INTEGRATION_STATUS.NEEDS_ATTENTION]: { tone: "warning", Icon: ShieldAlert },
};

export function ModuleCard({ module: initial }) {
  const m = useIntegrationModule(initial);
  const { module } = m;
  const headingId = useId();

  const [testInput, setTestInput] = useState({});
  const [confirmingDisable, setConfirmingDisable] = useState(false);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const presentation = STATUS_PRESENTATION[module.status] ?? STATUS_PRESENTATION[INTEGRATION_STATUS.NOT_CONFIGURED];
  const { Icon } = presentation;

  const chosen = module.providerOptions.find((option) => option.value === m.provider);
  const fields = chosen?.fields ?? [];

  /** Disabling is the one change worth stopping to confirm. */
  const onToggle = (event) => {
    const next = event.target.checked;
    if (!next && module.enabled && module.disableWarning) {
      setConfirmingDisable(true);
      return;
    }
    setConfirmingDisable(false);
    m.setEnabled(next);
  };

  return (
    <Card aria-labelledby={headingId}>
      <CardHeader
        title={<span id={headingId}>{module.label}</span>}
        description={module.description}
        action={
          <Badge tone={presentation.tone} size="md">
            <Icon className="mr-1 inline size-3.5" aria-hidden="true" />
            {INTEGRATION_STATUS_LABELS[module.status]}
          </Badge>
        }
      />

      <CardBody className="space-y-6">
        <FormErrorSummary error={m.save.error} fieldErrors={m.save.fieldErrors} />

        {module.status === INTEGRATION_STATUS.NEEDS_ATTENTION && (
          <Alert tone="warning" title="A stored credential cannot be read">
            {module.error}
          </Alert>
        )}

        {module.usesDevelopment && m.enabled && (
          <Alert tone="info" title="Running the development implementation">
            Nothing here reaches a real provider yet. Configure and test the module to change that.
          </Alert>
        )}

        {/* --- Availability ------------------------------------------------ */}
        <div className="rounded-xl border border-ink-200 p-4">
          <Switch
            label={`${module.label} is on`}
            description={
              m.enabled
                ? "Services may use this module."
                : `Switched off. ${module.disableWarning ?? ""}`
            }
            checked={m.enabled}
            onChange={onToggle}
          />

          {confirmingDisable && (
            <Alert tone="danger" title={`Switch ${module.label.toLowerCase()} off?`} className="mt-4">
              <p>{module.disableWarning}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    m.setEnabled(false);
                    setConfirmingDisable(false);
                  }}
                >
                  Yes, switch it off
                </Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingDisable(false)}>
                  Cancel
                </Button>
              </div>
            </Alert>
          )}
        </div>

        {/* --- Where the live values come from ------------------------------ */}
        <SourceNote module={module} onImport={m.importEnv.submit} importing={m.importEnv.pending} />

        {/* --- Provider ----------------------------------------------------- */}
        {module.multi ? (
          <Field
            label="Platforms"
            hint="Tutors choose from whichever of these you turn on. Each needs its own credentials below."
          >
            <div className="space-y-2">
              {module.providerOptions.map((option) => (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-ink-200 p-3 hover:bg-ink-50"
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4 rounded border-ink-300 text-brand-600"
                    checked={m.providers.includes(option.value)}
                    onChange={() => m.toggleProvider(option.value)}
                  />
                  <span>
                    <span className="block text-sm font-semibold text-ink-900">{option.label}</span>
                    <span className="block text-xs text-ink-600">{option.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </Field>
        ) : (
          module.providerOptions.length > 1 && (
            <Field label="Provider" htmlFor={`${module.module}-provider`} hint={chosen?.description}>
              <Select
                id={`${module.module}-provider`}
                value={m.provider ?? ""}
                onChange={(event) => m.setProvider(event.target.value)}
              >
                {module.providerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </Field>
          )
        )}

        {/* --- Configuration ------------------------------------------------ */}
        {module.multi ? (
          m.providers.map((name) => {
            const option = module.providerOptions.find((o) => o.value === name);
            if (!option) return null;
            return (
              <fieldset key={name} className="rounded-xl border border-ink-200 p-4">
                <legend className="px-2 text-sm font-semibold text-ink-900">{option.label}</legend>
                <div className="space-y-5">
                  {option.fields.map((field) => renderField(field, m))}
                </div>
              </fieldset>
            );
          })
        ) : (
          <div className="space-y-5">{fields.map((field) => renderField(field, m))}</div>
        )}

        {/* --- Save / reset ------------------------------------------------- */}
        <div className="flex flex-wrap items-center gap-3 border-t border-ink-100 pt-5">
          <Button
            type="button"
            onClick={m.save.submit}
            loading={m.save.pending}
            disabled={!m.dirty}
            iconLeft={<Save className="size-4" />}
          >
            Save changes
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={m.reset}
            disabled={!m.dirty || m.save.pending}
            iconLeft={<RotateCcw className="size-4" />}
          >
            Reset
          </Button>
          {m.dirty && (
            <span className="text-xs text-warning-700" role="status">
              Unsaved changes
            </span>
          )}
          {module.updatedAt && !m.dirty && (
            <span className="text-xs text-ink-500">
              Last saved {formatDateTime(module.updatedAt)}
            </span>
          )}
        </div>

        {/* --- Hand back to the environment --------------------------------- */}
        {module.source === "database" && (
          <div className="border-t border-ink-100 pt-5">
            {confirmingClear ? (
              <Alert tone="danger" title={`Remove the stored ${module.label.toLowerCase()} configuration?`}>
                <p>
                  Every credential saved here is destroyed. The module goes back to whatever the
                  deployment environment provides, which may be nothing at all.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    loading={m.clear.pending}
                    onClick={async () => {
                      await m.clear.submit();
                      setConfirmingClear(false);
                    }}
                  >
                    Yes, remove it
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmingClear(false)}>
                    Cancel
                  </Button>
                </div>
              </Alert>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingClear(true)}
                className="text-xs font-medium text-danger-700 underline underline-offset-2 hover:text-danger-800"
              >
                Remove this configuration and go back to the deployment environment
              </button>
            )}
          </div>
        )}

        {/* --- Test --------------------------------------------------------- */}
        <TestPanel
          module={module}
          dirty={m.dirty}
          testInput={testInput}
          setTestInput={setTestInput}
          onTest={() => m.test.submit(testInput)}
          pending={m.test.pending}
          error={m.test.error}
          result={m.testResult}
        />
      </CardBody>
    </Card>
  );
}

/**
 * One configuration field, chosen by its declared kind.
 *
 * Never disabled by the module switch. Setting a module up before turning it
 * on is the normal order — the alternative would be enabling an email module
 * with no credentials in it, which is a working switch attached to a broken
 * transport.
 */
function renderField(field, m) {
  const id = `${m.module.module}-${field.name}`;

  if (field.kind === FIELD_KINDS.SECRET) {
    return (
      <SecretField
        key={field.name}
        field={field}
        state={m.module.secrets[field.name]}
        value={m.secrets[field.name]}
        onChange={m.setSecret(field.name)}
        onClear={() => m.clearSecret(field.name)}
        onUndoClear={() => m.undoClearSecret(field.name)}
        error={m.errorFor("secrets", field.name)}
      />
    );
  }

  const error = m.errorFor("config", field.name);
  const value = m.config[field.name];

  if (field.kind === FIELD_KINDS.BOOLEAN) {
    return (
      <div key={field.name} className="rounded-xl border border-ink-200 p-4">
        <Switch
          label={field.label}
          description={field.help ?? undefined}
          checked={value === true}
          onChange={m.setField(field.name)}
        />
      </div>
    );
  }

  if (field.kind === FIELD_KINDS.SELECT) {
    return (
      <Field key={field.name} label={field.label} htmlFor={id} hint={field.help ?? undefined} error={error} required={field.required}>
        <Select id={id} value={value ?? ""} onChange={m.setField(field.name)} error={error}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>
    );
  }

  return (
    <Field key={field.name} label={field.label} htmlFor={id} hint={field.help ?? undefined} error={error} required={field.required}>
      <Input
        id={id}
        type={field.kind === FIELD_KINDS.PORT ? "number" : "text"}
        inputMode={field.kind === FIELD_KINDS.PORT ? "numeric" : undefined}
        value={value ?? ""}
        onChange={m.setField(field.name)}
        placeholder={field.placeholder ?? undefined}
        error={error}
        className={field.kind === FIELD_KINDS.PORT ? "max-w-32" : undefined}
      />
    </Field>
  );
}

/**
 * Where this module's live values come from, and the offer to adopt them.
 *
 * Worth its own block because "I changed it and nothing happened" is almost
 * always this: the module is still reading the environment, and the panel
 * should say so rather than let an operator infer it.
 */
function SourceNote({ module, onImport, importing }) {
  if (module.source === "database") {
    return (
      <p className="text-xs text-ink-500">
        Configured here. These values override anything set in the deployment environment.
      </p>
    );
  }

  if (module.environment.available) {
    return (
      <Alert tone="info" title="Currently reading the deployment environment">
        <p>
          {module.label} is configured by environment variables
          {" "}({module.environment.fields.map((f) => f.env).join(", ")}). Import them to manage this
          module here instead — the values are copied server-side and encrypted, and never pass
          through this browser.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={onImport}
          loading={importing}
          iconLeft={<Download className="size-4" />}
        >
          Import from environment
        </Button>
      </Alert>
    );
  }

  return (
    <p className="text-xs text-ink-500">
      Nothing is configured for this module, in the environment or here.
    </p>
  );
}

/**
 * The test affordance.
 *
 * Separated from Save because they are different promises: saving records
 * what you typed, testing proves it works. A module with unsaved changes says
 * so, because the test always runs against what is stored — never against
 * what is on screen — and an operator who did not know that would read a
 * stale pass as a fresh one.
 */
function TestPanel({ module, dirty, testInput, setTestInput, onTest, pending, error, result }) {
  const shown = result ?? (module.lastTest && !module.lastTest.stale ? module.lastTest : null);

  return (
    <div className="rounded-xl bg-ink-50 p-4">
      <h4 className="text-sm font-semibold text-ink-900">{module.testLabel}</h4>
      <p className="mt-1 text-xs text-ink-600">
        Makes a real call to the provider using the saved configuration. Nothing on this screen is
        sent as a credential.
      </p>

      {module.testFields.length > 0 && (
        <div className="mt-4 space-y-4">
          {module.testFields.map((field) => (
            <Field
              key={field.name}
              label={field.label}
              htmlFor={`${module.module}-test-${field.name}`}
              hint={field.help ?? undefined}
            >
              <Input
                id={`${module.module}-test-${field.name}`}
                type={field.kind === FIELD_KINDS.EMAIL ? "email" : "text"}
                value={testInput[field.name] ?? ""}
                onChange={(event) =>
                  setTestInput((current) => ({ ...current, [field.name]: event.target.value }))
                }
                placeholder={field.placeholder ?? undefined}
              />
            </Field>
          ))}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={onTest}
          loading={pending}
          disabled={!module.enabled}
          iconLeft={<PlugZap className="size-4" />}
        >
          {module.testLabel}
        </Button>
        {!module.enabled && (
          <span className="text-xs text-ink-500">Switch the module on and save before testing it.</span>
        )}
        {dirty && module.enabled && (
          <span className="text-xs text-warning-700">
            Save first — this tests the stored configuration, not what is on screen.
          </span>
        )}
      </div>

      {error && (
        <Alert tone="danger" title="The test could not be run" className="mt-4">
          {error}
        </Alert>
      )}

      {shown && (
        <Alert
          tone={shown.ok ? "success" : "danger"}
          title={shown.ok ? "Connected" : "Not connected"}
          className="mt-4"
          icon={shown.ok ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}
        >
          <p>{shown.message}</p>
          {shown.at && (
            <p className="mt-1 text-xs opacity-80">Tested {formatDateTime(shown.at)}</p>
          )}
        </Alert>
      )}
    </div>
  );
}
