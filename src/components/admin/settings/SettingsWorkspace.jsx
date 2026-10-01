"use client";

import Link from "next/link";
import { ArrowRight, Plug } from "lucide-react";
import { SideTabs } from "@/components/ui";
import { useSectionParam } from "@/hooks/useSectionParam";
import { GeneralSettings, ContactSettings, SocialSettings, FooterSettings } from "./IdentitySettings";
import { BrandingSettings } from "./BrandingSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { SeoSettings } from "./SeoSettings";
import { MarketplaceSettings } from "./MarketplaceSettings";
import { MatchingSettings } from "./MatchingSettings";
import { ReferralSettings } from "./ReferralSettings";
import { PromotionSettings } from "./PromotionSettings";
import { RiskSettings } from "./RiskSettings";
import { FeatureSettings } from "./FeatureSettings";
import { NotificationSettings } from "./NotificationSettings";

/**
 * The platform settings console (§26).
 *
 * One section per concern, each saving only its own part of the document, so
 * a change to the footer copy can never be rolled back by a stale colour
 * picker in another panel. Sections are client-side rather than routes
 * because the settings document is already loaded — moving between them
 * should not re-fetch it. The open section is still written to `?section=`
 * so a reload, or a link from elsewhere, lands on it.
 */
const SECTIONS = [
  {
    label: "Brand & site",
    items: [
      { value: "general", label: "General" },
      { value: "branding", label: "Branding" },
      { value: "appearance", label: "Appearance" },
      { value: "seo", label: "SEO" },
    ],
  },
  {
    label: "Public pages",
    items: [
      { value: "contact", label: "Contact" },
      { value: "social", label: "Social" },
      { value: "footer", label: "Footer" },
    ],
  },
  {
    label: "Marketplace",
    items: [
      { value: "marketplace", label: "Marketplace" },
      { value: "matching", label: "Matching" },
      { value: "referrals", label: "Referrals" },
      { value: "promotions", label: "Promotions" },
      { value: "risk", label: "Risk" },
    ],
  },
  {
    label: "Platform",
    items: [
      { value: "features", label: "Features" },
      { value: "notifications", label: "Notifications" },
    ],
  },
];

const SECTION_VALUES = SECTIONS.flatMap((group) => group.items.map((item) => item.value));

export function SettingsWorkspace({ settings, assetRules, smsProvider, initialSection }) {
  const [section, setSection] = useSectionParam("section", SECTION_VALUES, initialSection);

  const panels = {
    general: <GeneralSettings settings={settings} />,
    branding: <BrandingSettings settings={settings} assetRules={assetRules} />,
    appearance: <AppearanceSettings settings={settings} />,
    seo: <SeoSettings settings={settings} appName={settings.branding.appName} />,
    contact: <ContactSettings settings={settings} />,
    social: <SocialSettings settings={settings} />,
    footer: <FooterSettings settings={settings} />,
    marketplace: <MarketplaceSettings settings={settings} />,
    matching: <MatchingSettings settings={settings} />,
    referrals: <ReferralSettings settings={settings} />,
    promotions: <PromotionSettings settings={settings} />,
    risk: <RiskSettings settings={settings} />,
    features: <FeatureSettings settings={settings} />,
    notifications: <NotificationSettings settings={settings} smsProvider={smsProvider} />,
  };

  return (
    <SideTabs
      groups={SECTIONS}
      value={section}
      onChange={setSection}
      label="Settings sections"
      footer={
        <Link
          href="/admin/settings/integrations"
          className="group flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-ink-600 transition-colors hover:bg-ink-100 hover:text-ink-900"
        >
          <Plug className="size-4 shrink-0 text-ink-400 group-hover:text-ink-600" aria-hidden="true" />
          <span className="flex-1">External modules</span>
          <ArrowRight className="size-3.5 shrink-0 text-ink-400" aria-hidden="true" />
        </Link>
      }
    >
      {panels[section]}
    </SideTabs>
  );
}
