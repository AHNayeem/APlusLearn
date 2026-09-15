"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp, Trash2, AlertTriangle } from "lucide-react";
import { api, ApiError } from "@/lib/api/client";
import { Alert, Button, Card, CardBody, CardHeader, Spinner, useToast } from "@/components/ui";
import { BRANDING_ASSETS } from "@/constants";

/**
 * Branding uploads (§26, §16).
 *
 * Each asset is its own small form: pick a file, it uploads, the preview
 * replaces itself. The rules printed under each slot come from the server's
 * own `assetRules`, so the limits shown are the limits enforced — the browser
 * check below is only there to save an obviously-wrong file a round trip.
 */
export function BrandingSettings({ settings, assetRules }) {
  const order = ["logo", "logoDark", "favicon", "appleTouchIcon", "ogImage"];

  return (
    <div className="space-y-6">
      <Alert tone="info" title="Where these appear">
        The logo replaces the wordmark in the header, dashboard sidebar and authentication pages.
        The favicon and touch icon are referenced by the page metadata. The social image is used
        when a page is shared. Anything left empty falls back to the built-in mark.
      </Alert>

      <Card>
        <CardHeader
          title="Logos and icons"
          description="Uploads are checked by file type, size and dimensions before they are stored."
        />
        <CardBody className="divide-y divide-ink-200">
          {order.map((key) => (
            <AssetSlot
              key={key}
              assetKey={key}
              rules={assetRules?.[key] ?? fallbackRules(key)}
              current={settings.branding?.[key] ?? null}
            />
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

/** If the server did not send rules, the shared constants still describe them. */
function fallbackRules(key) {
  const spec = BRANDING_ASSETS[key];
  return {
    ...spec,
    maxKb: Math.round(spec.maxBytes / 1024),
    acceptLabel: "an image",
  };
}

function AssetSlot({ assetKey, rules, current }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  // `v` changes with every upload, so the <img> below never shows a cached
  // copy of the file it just replaced (§18).
  const preview = current?.uploadedAt
    ? `/api/branding/${assetKey}?v=${Date.parse(current.uploadedAt) || 0}`
    : null;

  const upload = async (file) => {
    setProblem(null);

    if (file.size > rules.maxBytes) {
      setProblem(`That file is ${Math.round(file.size / 1024)} KB — the limit is ${rules.maxKb} KB.`);
      return;
    }

    const body = new FormData();
    body.append("file", file);

    setBusy(true);
    try {
      await api.post(`/api/admin/settings/branding?asset=${assetKey}`, body);
      toast.success(`${rules.label} updated`, "It is live across the platform.");
      router.refresh();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That upload failed. Try again.");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api.delete(`/api/admin/settings/branding?asset=${assetKey}`);
      toast.success(`${rules.label} removed`, "The built-in mark is in use again.");
      router.refresh();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const inputId = `branding-${assetKey}`;

  return (
    <div className="flex flex-col gap-4 py-5 first:pt-0 last:pb-0 sm:flex-row sm:items-start">
      {/* The checkerboard makes a transparent PNG's edges visible. */}
      <div
        className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-ink-200 bg-[repeating-conic-gradient(var(--color-ink-100)_0%_25%,white_0%_50%)] bg-[length:16px_16px] p-2"
        aria-hidden={!preview}
      >
        {busy ? (
          <Spinner />
        ) : preview ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={preview} alt={`${rules.label} preview`} className="max-h-full max-w-full object-contain" />
        ) : (
          <ImageUp className="size-6 text-ink-300" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <h3 className="text-sm font-bold text-ink-900">{rules.label}</h3>
        <p className="mt-1 text-xs text-ink-500">{rules.hint}</p>
        <p className="mt-1 text-xs text-ink-400">
          {rules.acceptLabel} · up to {rules.maxKb} KB · {rules.minWidth}×{rules.minHeight} to{" "}
          {rules.maxWidth}×{rules.maxHeight} px{rules.square ? " · square" : ""}
        </p>

        {current && (
          <p className="mt-1 text-xs text-ink-400">
            Current: {current.width}×{current.height} px, {Math.round((current.sizeBytes ?? 0) / 1024)} KB
          </p>
        )}

        {problem && (
          <p
            role="alert"
            className="mt-2 flex items-start gap-1.5 text-xs font-medium text-danger-600"
          >
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {problem}
          </p>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label
            htmlFor={inputId}
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-ink-100 px-3.5 py-2 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-200 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-500"
          >
            <ImageUp className="size-4" aria-hidden="true" />
            {current ? "Replace" : "Upload"}
            <input
              id={inputId}
              ref={inputRef}
              type="file"
              className="sr-only"
              accept={rules.accepts?.join(",")}
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) upload(file);
              }}
            />
          </label>

          {current && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={remove}
              disabled={busy}
              iconLeft={<Trash2 className="size-4" />}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
