"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import { useToast } from "@/components/ui";

/**
 * One settings section's form state (§26).
 *
 * `group` is the settings group this panel edits, or `null` for the
 * marketplace rules, which live at the top level of the document.
 *
 * Each panel PATCHes only its own group, so saving the contact details cannot
 * overwrite a colour someone else changed in another tab, and a validation
 * failure in one section leaves the rest untouched.
 *
 * Server-side field errors come back keyed by their full path
 * (`contact.supportEmail`), which is what `errorFor` resolves — the form never
 * decides for itself whether a value was acceptable.
 */
export function useSettingsSection(group, initial, { coerce, serialize } = {}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState(initial ?? {});

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    // `serialize` exists for the few fields the form holds in a friendlier
    // shape than the API takes — keywords are one comma-separated line here
    // and an array on the wire.
    const payload = serialize ? serialize(form) : form;
    await api.patch("/api/admin/settings", group ? { [group]: payload } : payload);
    toast.success("Settings saved", "The change is live across the platform.");
    // Re-renders the server tree, so the header, footer and page metadata pick
    // the new values up immediately rather than on the next navigation (§18).
    router.refresh();
  });

  /**
   * Field binding. Checkboxes give a boolean, numeric fields are coerced by
   * the caller, everything else stays the string the administrator typed —
   * the old blanket `Number()` here silently turned every text field into NaN.
   */
  const set = (key) => (event) => {
    const target = event?.target ?? {};
    const raw = target.type === "checkbox" ? target.checked : target.value;
    setForm((current) => ({ ...current, [key]: coerce?.[key] ? coerce[key](raw) : raw }));
  };

  const setValue = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  return {
    form,
    set,
    setValue,
    setForm,
    submit,
    pending,
    error,
    fieldErrors,
    errorFor: (key) => fieldErrors[group ? `${group}.${key}` : key],
  };
}

/** Numbers arrive from `<input type="number">` as strings. */
export const toNumber = (value) => (value === "" ? "" : Number(value));
