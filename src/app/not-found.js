import { Logo } from "@/components/layout/Logo";
import { NotFoundBody } from "@/components/layout/NotFoundBody";

export const metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/**
 * Root 404, reached by a URL that matches no route at all.
 *
 * This renders inside the root layout, which draws no chrome, so it supplies
 * its own header and `<main>`. Route groups that already have a header get
 * their own `not-found.js` rendering `<NotFoundBody />` alone — otherwise this
 * file's header would stack underneath theirs.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="container-page py-6">
        <Logo />
      </header>

      <main id="main" className="container-page flex flex-1 items-center py-16">
        <NotFoundBody />
      </main>
    </div>
  );
}
