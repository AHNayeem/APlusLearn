import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getAppConfig } from "@/services/settings.service";

/**
 * Public marketplace shell. The header needs the signed-in user, which is why
 * this layout is a Server Component — the session never reaches the client
 * except as the small, safe subset the header renders.
 *
 * Platform branding is read once here and handed to both bars, so the header
 * and footer can never disagree about the application's name or logo, and the
 * settings document is read once per render rather than twice (§26).
 */
export default async function PublicLayout({ children }) {
  const [user, config] = await Promise.all([getCurrentUser(), getAppConfig()]);

  return (
    <>
      <SiteHeader
        branding={config.branding}
        user={
          user && {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            role: user.role,
            avatarUrl: user.avatarUrl,
          }
        }
      />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter config={config} />
    </>
  );
}
