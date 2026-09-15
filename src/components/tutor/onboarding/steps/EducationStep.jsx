"use client";

import { Plus, Trash2, GraduationCap } from "lucide-react";
import { Button, Checkbox, EmptyState, Field, Input, Select } from "@/components/ui";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 60 }, (_, i) => CURRENT_YEAR + 6 - i);

/** Step 3 — education (§17). At least one entry is required. */
export function EducationStep({ value, onChange, fieldErrors }) {
  const entries = value.education ?? [];

  const update = (index, patch) =>
    onChange({
      ...value,
      education: entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    });

  const add = () =>
    onChange({
      ...value,
      education: [...entries, { institution: "", credential: "", inProgress: false }],
    });

  const remove = (index) =>
    onChange({ ...value, education: entries.filter((_, i) => i !== index) });

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-500">
        Add every degree, diploma or certification relevant to what you teach. You&rsquo;ll upload
        proof later — these are the ones our team verifies.
      </p>

      {entries.length === 0 && (
        <EmptyState
          compact
          icon={<GraduationCap className="size-6" />}
          title="No qualifications added yet"
          description="Add at least one to continue."
          action={<Button onClick={add} iconLeft={<Plus className="size-4" />}>Add education</Button>}
        />
      )}

      {entries.map((entry, index) => (
        <div key={index} className="rounded-xl border border-ink-200 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold text-ink-900">Qualification {index + 1}</h3>
            <button
              type="button"
              onClick={() => remove(index)}
              aria-label={`Remove qualification ${index + 1}`}
              className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
            >
              <Trash2 className="size-4" />
            </button>
          </div>

          <div className="space-y-4">
            <Field
              label="Credential"
              htmlFor={`edu-credential-${index}`}
              error={fieldErrors[`education.${index}.credential`]}
              required
            >
              <Input
                id={`edu-credential-${index}`}
                value={entry.credential ?? ""}
                onChange={(e) => update(index, { credential: e.target.value })}
                placeholder="BSc (Honours), Bachelor of Education, PhD…"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Institution"
                htmlFor={`edu-institution-${index}`}
                error={fieldErrors[`education.${index}.institution`]}
                required
              >
                <Input
                  id={`edu-institution-${index}`}
                  value={entry.institution ?? ""}
                  onChange={(e) => update(index, { institution: e.target.value })}
                  placeholder="University of Toronto"
                />
              </Field>
              <Field label="Field of study" htmlFor={`edu-field-${index}`}>
                <Input
                  id={`edu-field-${index}`}
                  value={entry.fieldOfStudy ?? ""}
                  onChange={(e) => update(index, { fieldOfStudy: e.target.value })}
                  placeholder="Mathematics"
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Start year" htmlFor={`edu-start-${index}`}>
                <Select
                  id={`edu-start-${index}`}
                  value={entry.startYear ?? ""}
                  onChange={(e) =>
                    update(index, { startYear: e.target.value ? Number(e.target.value) : undefined })
                  }
                >
                  <option value="">Select</option>
                  {YEARS.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </Select>
              </Field>
              <Field
                label="End year"
                htmlFor={`edu-end-${index}`}
                error={fieldErrors[`education.${index}.endYear`]}
              >
                <Select
                  id={`edu-end-${index}`}
                  value={entry.endYear ?? ""}
                  onChange={(e) =>
                    update(index, { endYear: e.target.value ? Number(e.target.value) : undefined })
                  }
                  disabled={entry.inProgress}
                >
                  <option value="">Select</option>
                  {YEARS.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </Select>
              </Field>
            </div>

            <Checkbox
              label="Still studying"
              checked={entry.inProgress ?? false}
              onChange={(e) =>
                update(index, {
                  inProgress: e.target.checked,
                  endYear: e.target.checked ? undefined : entry.endYear,
                })
              }
            />
          </div>
        </div>
      ))}

      {entries.length > 0 && (
        <Button variant="secondary" onClick={add} iconLeft={<Plus className="size-4" />}>
          Add another
        </Button>
      )}
    </div>
  );
}
