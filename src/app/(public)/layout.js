import { SiteHeader } from "@/components/layout/SiteHeader";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * Public marketplace shell. The header needs the signed-in user, which is why
 * this layout is a Server Component — the session never reaches the client
 * except as the small, safe subset the header renders.
 */
export default async function PublicLayout({ children }) {
  const user = await getCurrentUser();

  return (
    <>
      <SiteHeader
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
      <SiteFooter />
    </>
  );
}
