"use client";

import { Globe, Search } from "lucide-react";
import { Alert, Card, CardBody, CardHeader, Field, Input, Switch, Textarea } from "@/components/ui";
import { useSettingsSection } from "./useSettingsSection";
import { SectionForm } from "./SectionForm";

/**
 * SEO and metadata (§29, §26).
 *
 * These are the *global* values — the floor every page starts from. A tutor
 * profile, a course landing page and a city page each generate their own
 * title, description and canonical, and those still win: nothing set here
 * overwrites page-specific metadata, it only fills in what a page does not
 * state for itself.
 */
export function SeoSettings({ settings, appName }) {
  const s = useSettingsSection(
    "seo",
    { ...settings.seo, keywords: (settings.seo.keywords ?? []).join(", ") },
    {
      // The textarea edits one comma-separated line; the API takes an array.
      serialize: (form) => ({
        ...form,
        keywords: form.keywords
          .split(",")
          .map((word) => word.trim())
          .filter(Boolean),
      }),
    },
  );

  return (
    <SectionForm onSubmit={s.submit} pending={s.pending} error={s.error} fieldErrors={s.fieldErrors}>
      <Alert tone="info" title="Page-specific SEO still wins">
        Tutor profiles, course pages and city pages generate their own titles, descriptions and
        canonical URLs. What you set here is the default for everything that doesn&rsquo;t.
      </Alert>

      <Card>
        <CardHeader title="Search listing" description="How the site appears in search results." />
        <CardBody className="space-y-5">
          <Field
            label="Site title"
            htmlFor="set-meta-title"
            hint={`Leave empty to use "${appName} — <tagline>".`}
            error={s.errorFor("metaTitle")}
          >
            <Input
              id="set-meta-title"
              value={s.form.metaTitle}
              onChange={s.set("metaTitle")}
              maxLength={70}
              error={s.errorFor("metaTitle")}
            />
          </Field>

          <Field
            label="Title suffix"
            htmlFor="set-title-suffix"
            hint={`Appended after every page title, as "Page · suffix". Defaults to "${appName}".`}
            error={s.errorFor("titleSuffix")}
          >
            <Input
              id="set-title-suffix"
              value={s.form.titleSuffix}
              onChange={s.set("titleSuffix")}
              maxLength={40}
              error={s.errorFor("titleSuffix")}
            />
          </Field>

          <Field
            label="Meta description"
            htmlFor="set-meta-description"
            hint="Leave empty to use the application description."
            error={s.errorFor("metaDescription")}
          >
            <Textarea
              id="set-meta-description"
              rows={3}
              value={s.form.metaDescription}
              onChange={s.set("metaDescription")}
              maxLength={200}
              error={s.errorFor("metaDescription")}
            />
          </Field>

          <Field
            label="Keywords"
            htmlFor="set-keywords"
            hint="Comma separated. Largely ignored by modern search engines — kept for completeness."
            error={s.errorFor("keywords")}
          >
            <Textarea
              id="set-keywords"
              rows={2}
              value={s.form.keywords}
              onChange={s.set("keywords")}
              error={s.errorFor("keywords")}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Social preview"
          description="Used when a link to the site is shared. The image itself is set under Branding."
        />
        <CardBody className="space-y-5">
          <Field
            label="Open Graph title"
            htmlFor="set-og-title"
            hint="Leave empty to reuse the site title."
            error={s.errorFor("ogTitle")}
          >
            <Input
              id="set-og-title"
              value={s.form.ogTitle}
              onChange={s.set("ogTitle")}
              maxLength={90}
              error={s.errorFor("ogTitle")}
            />
          </Field>

          <Field
            label="Open Graph description"
            htmlFor="set-og-description"
            hint="Leave empty to reuse the meta description."
            error={s.errorFor("ogDescription")}
          >
            <Textarea
              id="set-og-description"
              rows={2}
              value={s.form.ogDescription}
              onChange={s.set("ogDescription")}
              maxLength={200}
              error={s.errorFor("ogDescription")}
            />
          </Field>

          <Field label="X / Twitter handle" htmlFor="set-twitter" error={s.errorFor("twitterHandle")}>
            <Input
              id="set-twitter"
              value={s.form.twitterHandle}
              onChange={s.set("twitterHandle")}
              placeholder="@apluslearn"
              className="max-w-52"
              error={s.errorFor("twitterHandle")}
            />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Indexing" description="Applies to the whole deployment." />
        <CardBody className="space-y-5">
          <Field
            label="Canonical base URL"
            htmlFor="set-canonical"
            hint="Optional. Only needed when the public domain differs from the URL this server is deployed at."
            error={s.errorFor("canonicalBaseUrl")}
          >
            <Input
              id="set-canonical"
              type="url"
              placeholder="https://www.example.ca"
              value={s.form.canonicalBaseUrl}
              onChange={s.set("canonicalBaseUrl")}
              iconLeft={<Globe className="size-4" />}
              error={s.errorFor("canonicalBaseUrl")}
            />
          </Field>

          <div className="rounded-xl border border-ink-200 p-4">
            <Switch
              label="Allow search engines to index this site"
              description="Turn off on a staging deployment. robots.txt and the page metadata both follow this."
              checked={s.form.allowIndexing}
              onChange={s.set("allowIndexing")}
            />
          </div>

          {!s.form.allowIndexing && (
            <p className="flex items-start gap-2 text-xs font-medium text-warning-700">
              <Search className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              Every public page will be served with noindex and robots.txt will disallow crawling.
            </p>
          )}
        </CardBody>
      </Card>
    </SectionForm>
  );
}
