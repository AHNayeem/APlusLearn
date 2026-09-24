"use client";

import { useRef, useState } from "react";
import { FileText, ImageIcon, Paperclip, X, Download } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatBytes } from "@/lib/utils/format";
import { Button, IconButton } from "@/components/ui";
import { UPLOAD } from "@/constants";

/**
 * Shared file UI (§21, §41 Phase 3).
 *
 * One set of pieces for both places a file can be shared — a message thread
 * and a progress report — because they are the same object with the same
 * rules, and two implementations would be two chances to render a download
 * link that the other one would not have.
 *
 * Nothing here knows where a file is stored. Every attachment arrives with an
 * `href` the server built, pointing at a route that re-checks who is asking;
 * the component's only job is to make it obvious what the file is and to let
 * somebody open it.
 */

const ACCEPT = UPLOAD.acceptedAttachmentTypes.join(",");

function isImage(contentType) {
  return Boolean(contentType?.startsWith("image/"));
}

/** What a file of this kind looks like at a glance. */
function AttachmentIcon({ contentType, className }) {
  const Icon = isImage(contentType) ? ImageIcon : FileText;
  return <Icon className={cn("size-4 shrink-0", className)} aria-hidden="true" />;
}

/**
 * One attachment, as a download row.
 *
 * `download` rather than a plain link: the server already sends
 * `Content-Disposition: attachment` for anything that is not an image, and
 * saying so here too means a click behaves the same way before the response
 * arrives. `rel="noopener"` because the target is a document route.
 */
export function AttachmentChip({ attachment, tone = "light", onRemove, removing }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-xl px-3 py-2 text-xs",
        tone === "dark"
          ? "bg-white/15 text-white"
          : "bg-ink-50 text-ink-700 ring-1 ring-inset ring-ink-200",
      )}
    >
      <AttachmentIcon contentType={attachment.contentType} />
      <a
        href={attachment.href}
        download={attachment.fileName}
        rel="noopener"
        className="min-w-0 flex-1 truncate font-semibold underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
      >
        {attachment.fileName}
      </a>
      <span className={cn("shrink-0 tabular-nums", tone === "dark" ? "text-white/70" : "text-ink-400")}>
        {formatBytes(attachment.sizeBytes)}
      </span>
      {onRemove ? (
        <IconButton
          type="button"
          size="xs"
          variant="ghost"
          label={`Remove ${attachment.fileName}`}
          onClick={() => onRemove(attachment)}
          loading={removing}
          className="-mr-1.5 w-8 px-0"
        >
          <X className="size-3.5" />
        </IconButton>
      ) : (
        <Download
          className={cn("size-3.5 shrink-0", tone === "dark" ? "text-white/70" : "text-ink-400")}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

/**
 * Every attachment on one message or report.
 *
 * Images are shown, because a photo of a question is meant to be looked at
 * rather than downloaded; everything else is a row. The image is still served
 * by the same authorised route under the same sandboxed headers — rendering
 * it in an `<img>` changes what the reader sees, not who may see it.
 */
export function AttachmentList({ attachments, tone = "light", onRemove, removingId, className }) {
  if (!attachments?.length) return null;

  return (
    <ul className={cn("mt-2 flex flex-col gap-2", className)}>
      {attachments.map((attachment) => (
        <li key={attachment.id}>
          {isImage(attachment.contentType) && !onRemove ? (
            <a
              href={attachment.href}
              rel="noopener"
              className="block overflow-hidden rounded-xl ring-1 ring-inset ring-ink-200 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={attachment.href}
                alt={attachment.fileName}
                loading="lazy"
                className="max-h-64 w-full bg-ink-50 object-contain"
              />
            </a>
          ) : (
            <AttachmentChip
              attachment={attachment}
              tone={tone}
              onRemove={onRemove}
              removing={removingId === attachment.id}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Choose files to attach, before they are sent.
 *
 * Client-side checks here are a courtesy, not a control: the same size, count
 * and format rules are enforced in the service, which is the only place that
 * has seen the bytes. What this gets right is telling somebody *now* that
 * their 20 MB scan will not be accepted, rather than after the upload.
 */
export function AttachmentPicker({ files, onChange, max, disabled, hint }) {
  const inputRef = useRef(null);
  const [notice, setNotice] = useState("");

  function handlePicked(event) {
    const picked = Array.from(event.target.files ?? []);
    // The input is reset so picking the same file twice in a row still fires.
    event.target.value = "";
    if (!picked.length) return;

    const problems = [];
    const kept = [];

    for (const file of picked) {
      if (!UPLOAD.acceptedAttachmentTypes.includes(file.type)) {
        problems.push(`${file.name} is not a PDF or image.`);
      } else if (file.size > UPLOAD.maxAttachmentBytes) {
        problems.push(`${file.name} is larger than ${formatBytes(UPLOAD.maxAttachmentBytes)}.`);
      } else {
        kept.push(file);
      }
    }

    const room = max - files.length;
    const accepted = kept.slice(0, Math.max(0, room));
    if (kept.length > accepted.length) {
      problems.push(`You can attach ${max} file${max === 1 ? "" : "s"} at a time.`);
    }

    setNotice(problems.join(" "));
    if (accepted.length) onChange([...files, ...accepted]);
  }

  const full = files.length >= max;

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple={max > 1}
        onChange={handlePicked}
        className="sr-only"
        tabIndex={-1}
      />

      {files.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${file.lastModified}-${index}`}
              className="flex items-center gap-2 rounded-lg bg-ink-50 px-3 py-1.5 text-xs text-ink-700"
            >
              <AttachmentIcon contentType={file.type} />
              <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
              <span className="shrink-0 tabular-nums text-ink-400">{formatBytes(file.size)}</span>
              <IconButton
                type="button"
                size="xs"
                variant="ghost"
                label={`Remove ${file.name}`}
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                disabled={disabled}
                className="-mr-1.5 w-8 px-0"
              >
                <X className="size-3.5" />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || full}
        >
          <Paperclip className="size-4" />
          Attach a file
        </Button>
        <p className="text-xs text-ink-400">
          {hint ?? `PDF, JPG, PNG or WebP · up to ${formatBytes(UPLOAD.maxAttachmentBytes)} each`}
        </p>
      </div>

      {notice && (
        <p role="alert" className="text-xs font-medium text-danger-600">
          {notice}
        </p>
      )}
    </div>
  );
}
