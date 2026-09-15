import { Spinner } from "@/components/ui";

/** Route-level loading fallback so navigation never shows a blank screen (§32). */
export default function Loading() {
  return (
    <div className="flex min-h-[60dvh] items-center justify-center" role="status">
      <div className="text-center">
        <Spinner className="mx-auto size-7 text-brand-600" />
        <p className="mt-3 text-sm text-ink-500">Loading…</p>
      </div>
    </div>
  );
}
