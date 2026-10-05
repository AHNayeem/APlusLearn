import { Spinner } from "@/components/ui";

/**
 * The loading fallback the signed-in workspaces show while a page renders.
 *
 * It is deliberately *not* mounted at the application root. A `loading.js`
 * is a Suspense boundary, and once its fallback has been sent the response
 * is committed to `200 OK` — so a root-level one turned every `notFound()` on
 * the public site into a "soft 404": a 200 carrying a not-found body, which
 * search engines index as a page (§32, R32.1). The public marketplace renders
 * its pages before anything is flushed, so a missing tutor, course or policy
 * answers with a real 404 (and an off-path redirect with a real 308).
 *
 * The dashboards keep the fallback, one boundary per workspace, *inside* the
 * workspace layout: the shell (navigation, header) stays on screen while the
 * page loads, and the layout's own sign-in check still runs before anything
 * is sent, so a signed-out visitor gets a real redirect rather than a
 * client-side one.
 */
export function RouteLoading() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center" role="status">
      <div className="text-center">
        <Spinner className="mx-auto size-7 text-brand-600" />
        <p className="mt-3 text-sm text-ink-500">Loading…</p>
      </div>
    </div>
  );
}
