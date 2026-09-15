"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Upload, FileText, Check, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { ApiError } from "@/lib/api/client";
import { Alert, Badge, Button, Checkbox, Spinner, useToast } from "@/components/ui";
import {
  VERIFICATION_TYPES, VERIFICATION_LABELS, VERIFICATION_DESCRIPTIONS, UPLOAD,
} from "@/constants";

/**
 * Step 10 — verification documents (§16, §17).
 *
 * Files go to a private store and are only ever read back by an administrator
 * through an audited route — never served publicly (§35).
 */
export function DocumentsStep({ value, onChange, fieldErrors }) {
  const requested = value.requestedBadges ?? [VERIFICATION_TYPES.IDENTITY];
  const [uploads, setUploads] = useState({});

  const toggle = (type) =>
    onChange({
      ...value,
      requestedBadges: requested.includes(type)
        ? requested.filter((t) => t !== type)
        : [...requested, type],
    });

  return (
    <div className="space-y-6">
      <Alert tone="info" title="Documents are private" icon={<ShieldCheck className="size-3" />}>
        Only our verification team can open what you upload. Documents are never shown on your
        profile, never shared with families, and are deleted once a badge expires or is withdrawn.
      </Alert>

      <div>
        <h3 className="text-sm font-semibold text-ink-800">
          Which badges are you applying for? <span className="text-danger-600">*</span>
        </h3>
        <p className="mt-1 text-xs text-ink-500">
          Identity verification is required. The rest are optional but families filter by them.
        </p>
        {fieldErrors.requestedBadges && (
          <p className="mt-2 text-xs font-medium text-danger-600">
            {fieldErrors.requestedBadges}
          </p>
        )}

        <div className="mt-4 space-y-3">
          {Object.values(VERIFICATION_TYPES).map((type) => {
            const isRequested = requested.includes(type);
            const isIdentity = type === VERIFICATION_TYPES.IDENTITY;

            return (
              <div
                key={type}
                className={cn(
                  "rounded-xl border p-4 transition-colors",
                  isRequested ? "border-brand-300 bg-brand-50/40" : "border-ink-200",
                )}
              >
                <Checkbox
                  label={VERIFICATION_LABELS[type]}
                  description={VERIFICATION_DESCRIPTIONS[type]}
                  checked={isRequested}
                  disabled={isIdentity}
                  onChange={() => !isIdentity && toggle(type)}
                />
                {isIdentity && (
                  <Badge tone="brand" size="sm" className="ml-7 mt-2">
                    Required
                  </Badge>
                )}

                {isRequested && (
                  <DocumentUploader
                    type={type}
                    uploaded={uploads[type]}
                    onUploaded={(doc) => setUploads((u) => ({ ...u, [type]: doc }))}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      <Alert tone="neutral">
        You can submit your application before every document is uploaded — but a badge is only
        granted once we&rsquo;ve seen the proof for it. You can add documents later from your
        verification page.
      </Alert>
    </div>
  );
}

function DocumentUploader({ type, uploaded, onUploaded }) {
  const toast = useToast();
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  const upload = async (file) => {
    if (!file) return;

    if (file.size > UPLOAD.maxDocumentBytes) {
      toast.error(
        "File too large",
        `Documents must be under ${Math.round(UPLOAD.maxDocumentBytes / 1024 / 1024)} MB.`,
      );
      return;
    }
    if (!UPLOAD.acceptedDocumentTypes.includes(file.type)) {
      toast.error("Unsupported file", "Upload a PDF, JPG, PNG or WebP.");
      return;
    }

    setUploading(true);
    const form = new FormData();
    form.append("type", type);
    form.append("file", file);

    try {
      const response = await fetch("/api/tutor/verification/upload", {
        method: "POST",
        body: form,
        credentials: "same-origin",
      });
      const payload = await response.json();

      if (!response.ok || payload.ok === false) {
        throw new ApiError(payload?.error?.message ?? "Upload failed", {
          status: response.status,
        });
      }

      onUploaded(payload.data.document);
      toast.success("Document uploaded", "Our team will review it with your application.");
    } catch (error) {
      toast.error("Upload failed", error.message);
    } finally {
      setUploading(false);
    }
  };

  if (uploaded) {
    return (
      <div className="ml-7 mt-3 flex items-center gap-3 rounded-lg border border-success-100 bg-success-50 p-3">
        <Check className="size-4 shrink-0 text-success-700" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-900">
            {uploaded.fileName}
          </span>
          <span className="text-xs text-ink-500">
            {(uploaded.sizeBytes / 1024).toFixed(0)} KB · awaiting review
          </span>
        </span>
        <Button variant="ghost" size="xs" onClick={() => inputRef.current?.click()}>
          Replace
        </Button>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={UPLOAD.acceptedDocumentTypes.join(",")}
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </div>
    );
  }

  return (
    <div className="ml-7 mt-3">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "flex cursor-pointer items-center justify-center gap-3 rounded-lg border-2 border-dashed p-4 transition-colors",
          dragging ? "border-brand-500 bg-brand-50" : "border-ink-300 hover:border-brand-400",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          accept={UPLOAD.acceptedDocumentTypes.join(",")}
          onChange={(e) => upload(e.target.files?.[0])}
          disabled={uploading}
        />
        {uploading ? (
          <>
            <Spinner className="size-4 text-brand-600" />
            <span className="text-sm text-ink-600">Uploading…</span>
          </>
        ) : (
          <>
            <Upload className="size-4 text-ink-400" />
            <span className="text-sm text-ink-600">
              <span className="font-semibold text-brand-600">Choose a file</span> or drag it here
            </span>
          </>
        )}
      </label>
      <p className="mt-1.5 text-[11px] text-ink-400">
        PDF, JPG, PNG or WebP · up to {Math.round(UPLOAD.maxDocumentBytes / 1024 / 1024)} MB
      </p>
    </div>
  );
}
