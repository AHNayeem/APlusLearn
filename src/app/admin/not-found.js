import { DashboardPage } from "@/components/layout/DashboardShell";
import { NotFoundBody } from "@/components/layout/NotFoundBody";

export const metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/**
 * 404 inside the admin workspace — most often a record that was deleted, or
 * one belonging to somebody else (ownership failures 404 rather than admit the
 * record exists).
 *
 * `DashboardShell` in the layout above already draws the header and
 * `<main id="main">`, so this contributes the message only.
 */
export default function AdminNotFound() {
  return (
    <DashboardPage>
      <div className="flex min-h-[55vh] items-center">
        <NotFoundBody />
      </div>
    </DashboardPage>
  );
}
