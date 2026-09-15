"use client";

import { MapPin, ShieldCheck } from "lucide-react";
import { Alert, Field, Input, Select } from "@/components/ui";
import { LESSON_MODES } from "@/constants";

/** Step 7 — service area (§17, §15). */
export function LocationStep({ value, onChange, fieldErrors, application, provinces = [] }) {
  const set = (key) => (e) => onChange({ ...value, [key]: e.target.value });

  const offersInPerson = application?.data?.LESSON_TYPE?.lessonModes?.includes(
    LESSON_MODES.IN_PERSON,
  );

  return (
    <div className="space-y-5">
      <Alert tone="info" title="Your exact address is never public" icon={<ShieldCheck className="size-3" />}>
        We use the first three characters of your postal code to place you approximately on the
        map. Families see your city and a rough distance — never a street address.
      </Alert>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="City" htmlFor="loc-city" error={fieldErrors.city} required>
          <Input
            id="loc-city"
            value={value.city ?? ""}
            onChange={set("city")}
            error={fieldErrors.city}
            placeholder="Toronto"
            autoComplete="address-level2"
          />
        </Field>
        <Field label="Province" htmlFor="loc-province" error={fieldErrors.province} required>
          <Select id="loc-province" value={value.province ?? "ON"} onChange={set("province")}>
            {provinces.map((p) => (
              <option key={p.code} value={p.code} disabled={!p.isActive}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        label="Postal code"
        htmlFor="loc-postal"
        hint="Only the first three characters are stored and used for distance search."
        error={fieldErrors.postalCode}
        required
      >
        <Input
          id="loc-postal"
          value={value.postalCode ?? ""}
          onChange={(e) => onChange({ ...value, postalCode: e.target.value.toUpperCase() })}
          error={fieldErrors.postalCode}
          placeholder="M5V 2K3"
          autoComplete="postal-code"
          iconLeft={<MapPin className="size-4" />}
        />
      </Field>

      {offersInPerson ? (
        <Field
          label="How far will you travel?"
          htmlFor="loc-radius"
          hint="Families outside this radius won't see you in in-person search results."
          error={fieldErrors.travelRadiusKm}
        >
          <Select
            id="loc-radius"
            value={value.travelRadiusKm ?? 15}
            onChange={(e) => onChange({ ...value, travelRadiusKm: Number(e.target.value) })}
          >
            {[5, 10, 15, 20, 25, 30, 40, 50].map((km) => (
              <option key={km} value={km}>
                Up to {km} km
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <Alert tone="neutral">
          You&rsquo;re teaching online only, so travel radius doesn&rsquo;t apply. Your city still
          helps families find local tutors who also teach online.
        </Alert>
      )}
    </div>
  );
}
