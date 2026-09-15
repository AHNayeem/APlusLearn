"use client";

import { Field, Input, Select } from "@/components/ui";
import { CANADIAN_TIMEZONES } from "@/lib/utils/time";

/** Step 1 — personal information (§17). */
export function PersonalStep({ value, onChange, fieldErrors, provinces = [] }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="First name" htmlFor="ob-first" error={fieldErrors.firstName} required>
          <Input
            id="ob-first"
            value={value.firstName ?? ""}
            onChange={set("firstName")}
            error={fieldErrors.firstName}
            autoComplete="given-name"
          />
        </Field>
        <Field label="Last name" htmlFor="ob-last" error={fieldErrors.lastName} required>
          <Input
            id="ob-last"
            value={value.lastName ?? ""}
            onChange={set("lastName")}
            error={fieldErrors.lastName}
            autoComplete="family-name"
          />
        </Field>
      </div>

      <Field
        label="Phone number"
        htmlFor="ob-phone"
        hint="Used for booking reminders and, rarely, by our support team. Never shown publicly."
        error={fieldErrors.phone}
        required
      >
        <Input
          id="ob-phone"
          type="tel"
          value={value.phone ?? ""}
          onChange={set("phone")}
          error={fieldErrors.phone}
          placeholder="416 555 0142"
          autoComplete="tel"
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Province" htmlFor="ob-province" error={fieldErrors.province} required>
          <Select id="ob-province" value={value.province ?? "ON"} onChange={set("province")}>
            {provinces.map((p) => (
              <option key={p.code} value={p.code} disabled={!p.isActive}>
                {p.name}
                {p.isActive ? "" : " — not open yet"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="City" htmlFor="ob-city" error={fieldErrors.city} required>
          <Input
            id="ob-city"
            value={value.city ?? ""}
            onChange={set("city")}
            error={fieldErrors.city}
            placeholder="Toronto"
            autoComplete="address-level2"
          />
        </Field>
      </div>

      <Field
        label="Timezone"
        htmlFor="ob-tz"
        hint="Your availability and lesson times are stored in this timezone."
        error={fieldErrors.timeZone}
      >
        <Select id="ob-tz" value={value.timeZone ?? "America/Toronto"} onChange={set("timeZone")}>
          {CANADIAN_TIMEZONES.map((tz) => (
            <option key={tz.value} value={tz.value}>
              {tz.label}
            </option>
          ))}
        </Select>
      </Field>
    </div>
  );
}
