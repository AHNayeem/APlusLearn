"use client";

import { Plus, Trash2 } from "lucide-react";
import {
  Button, Checkbox, Field, Input, OptionCard, Select, Textarea,
} from "@/components/ui";
import { QUALIFICATION_TYPES, QUALIFICATION_LABELS } from "@/constants";

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 50 }, (_, i) => CURRENT_YEAR - i);

/** Step 4 — teaching credentials and work history (§17). */
export function QualificationsStep({ value, onChange, fieldErrors }) {
  const qualifications = value.qualifications ?? [];
  const experience = value.experience ?? [];

  const set = (key, next) => onChange({ ...value, [key]: next });

  const toggle = (type) =>
    set(
      "qualifications",
      qualifications.includes(type)
        ? qualifications.filter((q) => q !== type)
        : [...qualifications, type],
    );

  const updateExperience = (index, patch) =>
    set(
      "experience",
      experience.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    );

  const isOct = qualifications.includes(QUALIFICATION_TYPES.OCT_MEMBER);

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="mb-2 block text-sm font-semibold text-ink-800">
          Which describe you? <span className="text-danger-600">*</span>
        </legend>
        <p className="mb-3 text-xs text-ink-500">
          Select every one that applies. These become filters parents search by.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.values(QUALIFICATION_TYPES).map((type) => (
            <OptionCard
              key={type}
              type="checkbox"
              checked={qualifications.includes(type)}
              onChange={() => toggle(type)}
              selected={qualifications.includes(type)}
              label={QUALIFICATION_LABELS[type]}
            />
          ))}
        </div>
        {fieldErrors.qualifications && (
          <p className="mt-2 text-xs font-medium text-danger-600">{fieldErrors.qualifications}</p>
        )}
      </fieldset>

      {isOct && (
        <Field
          label="OCT registration number"
          htmlFor="ob-oct"
          hint="Six digits. We check this against the Ontario College of Teachers public register."
          error={fieldErrors.octNumber}
        >
          <Input
            id="ob-oct"
            value={value.octNumber ?? ""}
            onChange={(e) => set("octNumber", e.target.value.replace(/\D/g, "").slice(0, 6))}
            error={fieldErrors.octNumber}
            placeholder="482915"
            inputMode="numeric"
          />
        </Field>
      )}

      <Field
        label="Years of teaching or tutoring experience"
        htmlFor="ob-years"
        error={fieldErrors.yearsExperience}
        required
      >
        <Select
          id="ob-years"
          value={value.yearsExperience ?? ""}
          onChange={(e) => set("yearsExperience", Number(e.target.value))}
        >
          <option value="">Select</option>
          {Array.from({ length: 41 }, (_, i) => i).map((n) => (
            <option key={n} value={n}>
              {n === 0 ? "Less than a year" : `${n} ${n === 1 ? "year" : "years"}`}
            </option>
          ))}
        </Select>
      </Field>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-ink-800">Relevant experience</h3>
            <p className="text-xs text-ink-500">Optional, but it builds trust quickly.</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => set("experience", [...experience, { title: "", current: false }])}
            iconLeft={<Plus className="size-3.5" />}
          >
            Add role
          </Button>
        </div>

        <div className="space-y-4">
          {experience.map((entry, index) => (
            <div key={index} className="rounded-xl border border-ink-200 p-4">
              <div className="mb-4 flex items-center justify-between">
                <h4 className="text-sm font-bold text-ink-900">Role {index + 1}</h4>
                <button
                  type="button"
                  onClick={() => set("experience", experience.filter((_, i) => i !== index))}
                  aria-label={`Remove role ${index + 1}`}
                  className="rounded-lg p-1.5 text-ink-400 transition-colors hover:bg-danger-50 hover:text-danger-600"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Job title" htmlFor={`exp-title-${index}`} required>
                    <Input
                      id={`exp-title-${index}`}
                      value={entry.title ?? ""}
                      onChange={(e) => updateExperience(index, { title: e.target.value })}
                      placeholder="Secondary Mathematics Teacher"
                    />
                  </Field>
                  <Field label="Organisation" htmlFor={`exp-org-${index}`}>
                    <Input
                      id={`exp-org-${index}`}
                      value={entry.organisation ?? ""}
                      onChange={(e) => updateExperience(index, { organisation: e.target.value })}
                      placeholder="Toronto District School Board"
                    />
                  </Field>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="From" htmlFor={`exp-start-${index}`}>
                    <Select
                      id={`exp-start-${index}`}
                      value={entry.startYear ?? ""}
                      onChange={(e) =>
                        updateExperience(index, {
                          startYear: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                    >
                      <option value="">Select</option>
                      {YEARS.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="To" htmlFor={`exp-end-${index}`}>
                    <Select
                      id={`exp-end-${index}`}
                      value={entry.endYear ?? ""}
                      onChange={(e) =>
                        updateExperience(index, {
                          endYear: e.target.value ? Number(e.target.value) : undefined,
                        })
                      }
                      disabled={entry.current}
                    >
                      <option value="">Select</option>
                      {YEARS.map((year) => (
                        <option key={year} value={year}>{year}</option>
                      ))}
                    </Select>
                  </Field>
                </div>

                <Checkbox
                  label="This is my current role"
                  checked={entry.current ?? false}
                  onChange={(e) =>
                    updateExperience(index, {
                      current: e.target.checked,
                      endYear: e.target.checked ? undefined : entry.endYear,
                    })
                  }
                />

                <Field label="What did you do?" htmlFor={`exp-desc-${index}`}>
                  <Textarea
                    id={`exp-desc-${index}`}
                    rows={2}
                    value={entry.description ?? ""}
                    onChange={(e) => updateExperience(index, { description: e.target.value })}
                    maxLength={600}
                    placeholder="Taught MHF4U, MCV4U and MDM4U; department lead for numeracy since 2019."
                  />
                </Field>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
