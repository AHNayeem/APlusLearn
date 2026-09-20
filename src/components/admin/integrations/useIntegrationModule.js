"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { useToast } from "@/components/ui";

/**
 * One external module's form state (§26, §36).
 *
 * Shaped like `useSettingsSection` — same field-error convention, same toast
 * and `router.refresh()` on save — so the integration panels read like the
 * rest of the settings console rather than like a separate application.
 *
 * The difference that matters is how secrets are held.
 *
 * ## Secrets are write-only, in the form as well as on the wire
 *
 * A secret input starts empty and *stays* empty unless the administrator
 * types into it. The stored value is never fetched, so there is nothing for
 * the form to hold, and a blank field therefore means "leave it alone" rather
 * than "clear it". Clearing is a separate, explicit act — the Remove button —
 * which sends `null`.
 *
 * This is what lets an operator change an SMTP port without knowing the
 * password, and it is why an accidental save can never blank a credential.
 */
export function useIntegrationModule(initial) {
  const router = useRouter();
  const toast = useToast();

  const [module, setModule] = useState(initial);
  const [provider, setProvider] = useState(initial.provider ?? initial.providerOptions[0]?.value);
  const [providers, setProviders] = useState(initial.providers ?? []);
  const [config, setConfig] = useState(() => ({ ...initial.config }));
  /** Only the secrets that have been typed into, or explicitly removed. */
  const [secrets, setSecrets] = useState({});
  const [enabled, setEnabled] = useState(initial.enabled);
  const [testResult, setTestResult] = useState(null);

  /** True once anything differs from what came back from the server. */
  const dirty =
    enabled !== module.enabled ||
    provider !== (module.provider ?? module.providerOptions[0]?.value) ||
    JSON.stringify(providers) !== JSON.stringify(module.providers ?? []) ||
    JSON.stringify(config) !== JSON.stringify(module.config) ||
    Object.keys(secrets).length > 0;

  /** Adopt a fresh module payload as the new baseline. */
  const adopt = (next) => {
    setModule(next);
    setProvider(next.provider ?? next.providerOptions[0]?.value);
    setProviders(next.providers ?? []);
    setConfig({ ...next.config });
    setSecrets({});
    setEnabled(next.enabled);
  };

  const save = useSubmit(async () => {
    const next = await api.patch(`/api/admin/integrations/${module.module}`, {
      enabled,
      provider,
      ...(module.multi ? { providers } : {}),
      config,
      // Omitted entirely when nothing was typed, which is what tells the
      // server to keep every stored credential exactly as it is.
      ...(Object.keys(secrets).length ? { secrets } : {}),
    });

    adopt(next.module);
    setTestResult(null);
    toast.success(`${module.label} saved`, "The new configuration is live immediately.");
    router.refresh();
  });

  const test = useSubmit(async (input = {}) => {
    const { result } = await api.post(`/api/admin/integrations/${module.module}/test`, input);
    setTestResult(result);

    // The module's status moves on the strength of this result, so the panel
    // re-reads rather than guessing what the server concluded.
    const { module: fresh } = await api.get(`/api/admin/integrations/${module.module}`);
    setModule(fresh);

    if (result.ok) toast.success(`${module.label} connected`, result.message);
    else toast.error(`${module.label} test failed`, result.message);

    // The tab strip's labels are rendered from the server payload, so without
    // this the card would say "Failing" while its own tab still said
    // "untested" — two parts of one screen disagreeing about what just
    // happened.
    router.refresh();
  });

  const importEnv = useSubmit(async () => {
    const next = await api.post(`/api/admin/integrations/${module.module}`, {});
    adopt(next.module);
    setTestResult(null);
    toast.success(
      "Imported from the environment",
      "The values this deployment already had are now stored and editable here.",
    );
    router.refresh();
  });

  /**
   * Hand the module back to the deployment environment.
   *
   * Separate from Reset, which only discards what is on screen. This destroys
   * the stored record and its credentials, which is why the panel asks first.
   */
  const clear = useSubmit(async () => {
    const { module: next } = await api.delete(`/api/admin/integrations/${module.module}`);
    adopt(next);
    setTestResult(null);
    toast.success(
      `${module.label} configuration removed`,
      "The module is back to whatever the deployment environment provides.",
    );
    router.refresh();
  });

  const reset = () => {
    adopt(module);
    setTestResult(null);
  };

  const setField = (name) => (event) => {
    const target = event?.target ?? {};
    const raw = target.type === "checkbox" ? target.checked : target.value;
    setConfig((current) => ({ ...current, [name]: raw }));
  };

  /** Typing into a secret field; blank means "no change", not "clear". */
  const setSecret = (name) => (event) => {
    const value = event?.target?.value ?? "";
    setSecrets((current) => {
      const next = { ...current };
      if (value === "") delete next[name];
      else next[name] = value;
      return next;
    });
  };

  /** The explicit act of removing a stored credential. */
  const clearSecret = (name) =>
    setSecrets((current) => ({ ...current, [name]: null }));

  const undoClearSecret = (name) =>
    setSecrets((current) => {
      const next = { ...current };
      delete next[name];
      return next;
    });

  const toggleProvider = (name) =>
    setProviders((current) =>
      current.includes(name) ? current.filter((p) => p !== name) : [...current, name],
    );

  return {
    module,
    enabled,
    setEnabled,
    provider,
    setProvider,
    providers,
    toggleProvider,
    config,
    setField,
    secrets,
    setSecret,
    clearSecret,
    undoClearSecret,
    dirty,
    reset,
    clear,
    save,
    test,
    importEnv,
    testResult,
    /** Field errors arrive keyed `config.host` / `secrets.apiKey`. */
    errorFor: (group, name) => save.fieldErrors?.[`${group}.${name}`],
  };
}
