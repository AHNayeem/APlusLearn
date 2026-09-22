"use client";

import { Card, CardBody, CardHeader, Field, Input, Textarea, Switch, Select } from "@/components/ui";
import { useSettingsSection } from "./useSettingsSection";
import { SectionForm } from "./SectionForm";

/**
 * General — what the application calls itself (§26).
 *
 * These four strings reach further than anything else on this page: the
 * browser tab, the header wordmark, every transactional email, the legal
 * pages and the structured data search engines read.
 */
export function GeneralSettings({ settings }) {
  const s = useSettingsSection("branding", {
    appName: settings.branding.appName,
    shortName: settings.branding.shortName,
    tagline: settings.branding.tagline,
    description: settings.branding.description,
  });

  return (
    <SectionForm onSubmit={s.submit} pending={s.pending} error={s.error} fieldErrors={s.fieldErrors}>
      <Card>
        <CardHeader
          title="Application identity"
          description="Used in the browser tab, the header, emails and the legal pages."
        />
        <CardBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Application name" htmlFor="set-app-name" error={s.errorFor("appName")} required>
              <Input
                id="set-app-name"
                value={s.form.appName}
                onChange={s.set("appName")}
                maxLength={60}
                error={s.errorFor("appName")}
                autoComplete="off"
              />
            </Field>
            <Field
              label="Short name"
              htmlFor="set-short-name"
              hint="For tight spaces such as the app icon label."
              error={s.errorFor("shortName")}
            >
              <Input
                id="set-short-name"
                value={s.form.shortName}
                onChange={s.set("shortName")}
                maxLength={30}
                error={s.errorFor("shortName")}
                autoComplete="off"
              />
            </Field>
          </div>

          <Field
            label="Tagline"
            htmlFor="set-tagline"
            hint="One line, shown beside the name in the title and in link previews."
            error={s.errorFor("tagline")}
          >
            <Input
              id="set-tagline"
              value={s.form.tagline}
              onChange={s.set("tagline")}
              maxLength={120}
              error={s.errorFor("tagline")}
            />
          </Field>

          <Field
            label="Description"
            htmlFor="set-description"
            hint="The default meta description and the footer blurb. Aim for 150–160 characters."
            error={s.errorFor("description")}
          >
            <Textarea
              id="set-description"
              rows={3}
              value={s.form.description}
              onChange={s.set("description")}
              maxLength={300}
              error={s.errorFor("description")}
            />
          </Field>
        </CardBody>
      </Card>
    </SectionForm>
  );
}

/** Contact — the details the public pages, footer and help centre publish. */
export function ContactSettings({ settings }) {
  const s = useSettingsSection("contact", { ...settings.contact });

  return (
    <SectionForm onSubmit={s.submit} pending={s.pending} error={s.error} fieldErrors={s.fieldErrors}>
      <Card>
        <CardHeader
          title="Support and contact"
          description="Published on the support page, the footer and in transactional emails."
        />
        <CardBody className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Support email" htmlFor="set-support-email" error={s.errorFor("supportEmail")}>
              <Input
                id="set-support-email"
                type="email"
                value={s.form.supportEmail}
                onChange={s.set("supportEmail")}
                error={s.errorFor("supportEmail")}
              />
            </Field>
            <Field
              label="General contact email"
              htmlFor="set-contact-email"
              hint="Optional. For enquiries that are not support."
              error={s.errorFor("contactEmail")}
            >
              <Input
                id="set-contact-email"
                type="email"
                value={s.form.contactEmail}
                onChange={s.set("contactEmail")}
                error={s.errorFor("contactEmail")}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Support phone" htmlFor="set-support-phone" error={s.errorFor("supportPhone")}>
              <Input
                id="set-support-phone"
                type="tel"
                value={s.form.supportPhone}
                onChange={s.set("supportPhone")}
                error={s.errorFor("supportPhone")}
              />
            </Field>
            <Field
              label="WhatsApp number"
              htmlFor="set-whatsapp"
              hint="Optional. With the country code. Leave blank to hide the WhatsApp button from the support launcher."
              error={s.errorFor("whatsappNumber")}
            >
              <Input
                id="set-whatsapp"
                type="tel"
                placeholder="+1 416 555 0142"
                value={s.form.whatsappNumber}
                onChange={s.set("whatsappNumber")}
                error={s.errorFor("whatsappNumber")}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Website"
              htmlFor="set-website"
              hint="Optional. A marketing site outside the platform."
              error={s.errorFor("websiteUrl")}
            >
              <Input
                id="set-website"
                type="url"
                placeholder="https://"
                value={s.form.websiteUrl}
                onChange={s.set("websiteUrl")}
                error={s.errorFor("websiteUrl")}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Support hours" htmlFor="set-support-hours" error={s.errorFor("supportHours")}>
              <Input
                id="set-support-hours"
                value={s.form.supportHours}
                onChange={s.set("supportHours")}
                error={s.errorFor("supportHours")}
              />
            </Field>
            <Field label="Business hours" htmlFor="set-business-hours" error={s.errorFor("businessHours")}>
              <Input
                id="set-business-hours"
                value={s.form.businessHours}
                onChange={s.set("businessHours")}
                error={s.errorFor("businessHours")}
              />
            </Field>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Business address" description="Shown in the footer and on legal pages." />
        <CardBody className="space-y-5">
          <Field
            label="Address"
            htmlFor="set-address"
            hint="Optional. Street and unit."
            error={s.errorFor("addressLine")}
          >
            <Input
              id="set-address"
              value={s.form.addressLine}
              onChange={s.set("addressLine")}
              maxLength={160}
              error={s.errorFor("addressLine")}
              autoComplete="street-address"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="City" htmlFor="set-city" error={s.errorFor("city")}>
              <Input id="set-city" value={s.form.city} onChange={s.set("city")} error={s.errorFor("city")} />
            </Field>
            <Field label="Province" htmlFor="set-province" error={s.errorFor("province")}>
              <Select id="set-province" value={s.form.province} onChange={s.set("province")} error={s.errorFor("province")}>
                <option value="">—</option>
                {PROVINCES.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Postal code" htmlFor="set-postal" error={s.errorFor("postalCode")}>
              <Input
                id="set-postal"
                value={s.form.postalCode}
                onChange={s.set("postalCode")}
                placeholder="M5H 2N2"
                error={s.errorFor("postalCode")}
              />
            </Field>
          </div>
        </CardBody>
      </Card>
    </SectionForm>
  );
}

const PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];

/** Social — only profiles that exist are rendered anywhere public. */
export function SocialSettings({ settings }) {
  const s = useSettingsSection("social", { ...settings.social });

  const fields = [
    ["facebook", "Facebook", "https://www.facebook.com/…"],
    ["instagram", "Instagram", "https://www.instagram.com/…"],
    ["linkedin", "LinkedIn", "https://www.linkedin.com/company/…"],
    ["youtube", "YouTube", "https://www.youtube.com/@…"],
    ["x", "X", "https://x.com/…"],
  ];

  return (
    <SectionForm onSubmit={s.submit} pending={s.pending} error={s.error} fieldErrors={s.fieldErrors}>
      <Card>
        <CardHeader
          title="Social profiles"
          description="Leave a field empty to remove that icon — the footer never renders a link it doesn't have."
        />
        <CardBody className="space-y-5">
          {fields.map(([key, label, placeholder]) => (
            <Field key={key} label={label} htmlFor={`set-${key}`} error={s.errorFor(key)}>
              <Input
                id={`set-${key}`}
                type="url"
                inputMode="url"
                placeholder={placeholder}
                value={s.form[key] ?? ""}
                onChange={s.set(key)}
                error={s.errorFor(key)}
              />
            </Field>
          ))}
        </CardBody>
      </Card>
    </SectionForm>
  );
}

/** Footer — the platform-level copy and which optional bands appear. */
export function FooterSettings({ settings }) {
  const s = useSettingsSection("footer", { ...settings.footer });

  return (
    <SectionForm onSubmit={s.submit} pending={s.pending} error={s.error} fieldErrors={s.fieldErrors}>
      <Card>
        <CardHeader title="Footer" description="Only platform-level copy is configurable here." />
        <CardBody className="space-y-5">
          <Field
            label="Footer description"
            htmlFor="set-footer-description"
            hint="Leave empty to reuse the application description."
            error={s.errorFor("description")}
          >
            <Textarea
              id="set-footer-description"
              rows={3}
              value={s.form.description}
              onChange={s.set("description")}
              maxLength={400}
              error={s.errorFor("description")}
            />
          </Field>

          <Field
            label="Copyright line"
            htmlFor="set-copyright"
            hint="Use {year} where the current year should appear. Leave empty for the default."
            error={s.errorFor("copyrightText")}
          >
            <Input
              id="set-copyright"
              value={s.form.copyrightText}
              onChange={s.set("copyrightText")}
              maxLength={200}
              error={s.errorFor("copyrightText")}
            />
          </Field>

          <div className="space-y-4 rounded-xl border border-ink-200 p-4">
            <Switch
              label="Show social icons"
              description="Hides the whole row, whatever URLs are configured."
              checked={s.form.showSocial}
              onChange={s.set("showSocial")}
            />
            <Switch
              label="Show newsletter signup"
              description="The form hands the address to the registration page's marketing opt-in."
              checked={s.form.showNewsletter}
              onChange={s.set("showNewsletter")}
            />
            <Switch
              label="Show mobile app badges"
              description="Turn off until the apps actually ship."
              checked={s.form.showAppBadges}
              onChange={s.set("showAppBadges")}
            />
          </div>
        </CardBody>
      </Card>
    </SectionForm>
  );
}
