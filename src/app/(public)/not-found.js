import { NotFoundBody } from "@/components/layout/NotFoundBody";

export const metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/**
 * 404 for the public marketplace — a retired tutor profile, an unknown course
 * slug (§16, §42).
 *
 * `PublicLayout` already renders `SiteHeader`, `<main id="main">` and
 * `SiteFooter` around this, so the message arrives without chrome of its own.
 */
export default function PublicNotFound() {
  return (
    <div className="container-page flex min-h-[60vh] items-center py-16">
      <NotFoundBody />
    </div>
  );
}
