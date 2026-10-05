import { RouteLoading } from "@/components/layout/RouteLoading";

/**
 * Loading fallback for this workspace (§32). Lives here rather than at the
 * application root so public pages can still answer with a real 404 — see
 * `RouteLoading` for why.
 */
export default function Loading() {
  return <RouteLoading />;
}
