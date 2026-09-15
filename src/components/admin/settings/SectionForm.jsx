"use client";

import { Save } from "lucide-react";
import { Button, FormErrorSummary } from "@/components/ui";

/**
 * The shell every settings panel shares: an error summary at the top, the
 * fields, and one save button. Keeping it in one place means each section is
 * just its fields, and the submit affordance is in the same spot on every tab.
 */
export function SectionForm({ onSubmit, pending, error, fieldErrors, children, label = "Save changes" }) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="space-y-6"
      noValidate
    >
      <FormErrorSummary error={error} fieldErrors={fieldErrors} />
      {children}
      <Button type="submit" loading={pending} iconLeft={<Save className="size-4" />}>
        {label}
      </Button>
    </form>
  );
}
