"use client";

import { useState } from "react";
import { Tabs } from "@/components/ui";
import { GeneralSettings, ContactSettings, SocialSettings, FooterSettings } from "./IdentitySettings";
import { BrandingSettings } from "./BrandingSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { SeoSettings } from "./SeoSettings";
import { MarketplaceSettings } from "./MarketplaceSettings";
import { FeatureSettings } from "./FeatureSettings";
import { NotificationSettings } from "./NotificationSettings";

/**
 * The platform settings console (§26).
 *
 * One tab per concern, each saving only its own section, so a change to the
 * footer copy can never be rolled back by a stale colour picker in another
 * panel. The tabs are client-side rather than routes because the settings
 * document is already loaded — navigating between them should not re-fetch it.
 */
const TABS = [
  { value: "general", label: "General" },
  { value: "branding", label: "Branding" },
  { value: "appearance", label: "Appearance" },
  { value: "seo", label: "SEO" },
  { value: "contact", label: "Contact" },
  { value: "social", label: "Social" },
  { value: "footer", label: "Footer" },
  { value: "marketplace", label: "Marketplace" },
  { value: "features", label: "Features" },
  { value: "notifications", label: "Notifications" },
];

export function SettingsWorkspace({ settings, assetRules }) {
  const [tab, setTab] = useState("general");

  const panels = {
    general: <GeneralSettings settings={settings} />,
    branding: <BrandingSettings settings={settings} assetRules={assetRules} />,
    appearance: <AppearanceSettings settings={settings} />,
    seo: <SeoSettings settings={settings} appName={settings.branding.appName} />,
    contact: <ContactSettings settings={settings} />,
    social: <SocialSettings settings={settings} />,
    footer: <FooterSettings settings={settings} />,
    marketplace: <MarketplaceSettings settings={settings} />,
    features: <FeatureSettings settings={settings} />,
    notifications: <NotificationSettings settings={settings} />,
  };

  return (
    <Tabs tabs={TABS} value={tab} onChange={setTab} className="max-w-3xl">
      {panels[tab]}
    </Tabs>
  );
}
