"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, KeyRound, Trash2, Undo2 } from "lucide-react";
import { Badge, Button, Field, Input } from "@/components/ui";
import { formatDate } from "@/lib/utils/format";

/**
 * A credential input that can set and replace, but never reveal (§36).
 *
 * The stored value is not fetched, so there is nothing here to leak: the
 * input starts empty and a blank field means "leave the stored value alone".
 * That is what lets an administrator change an SMTP port without knowing the
 * password, and it is why an accidental save can never blank a credential.
 *
 * Removing one is therefore a separate, explicit act rather than the result
 * of clearing a box — the Remove button, which stages a `null` and can be
 * undone before saving.
 *
 * ## About the eye
 *
 * It reveals what the administrator is *typing*, not what is stored. Pasting
 * a forty-character key and not being able to check it is how a wrong key
 * gets saved, so the toggle earns its place; it simply has nothing to do with
 * the value already in the database.
 */
export function SecretField({ field, state, value, onChange, onClear, onUndoClear, error, disabled }) {
  const [visible, setVisible] = useState(false);
  const id = useId();

  const stored = Boolean(state?.set);
  const staged = value !== undefined && value !== null && value !== "";
  const clearing = value === null;

  return (
    <Field
      label={field.label}
      htmlFor={id}
      required={field.required && !stored}
      hint={field.help ?? undefined}
      error={error}
    >
      <div className="space-y-2">
        <div className="flex items-start gap-2">
          <div className="relative flex-1">
            <Input
              id={id}
              type={visible ? "text" : "password"}
              autoComplete="new-password"
              spellCheck={false}
              value={clearing ? "" : (value ?? "")}
              onChange={onChange}
              disabled={disabled || clearing}
              error={error}
              className="pr-10"
              placeholder={
                clearing
                  ? "Will be removed when you save"
                  : stored
                    ? "Stored — type to replace it"
                    : (field.placeholder ?? "")
              }
              // The stored value is never loaded, so there is nothing to
              // describe here beyond whether one exists.
              aria-describedby={`${id}-state`}
            />
            <button
              type="button"
              onClick={() => setVisible((v) => !v)}
              disabled={disabled || clearing}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-ink-400 transition hover:bg-ink-50 hover:text-ink-700 disabled:opacity-40"
              aria-label={visible ? "Hide what you are typing" : "Show what you are typing"}
            >
              {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>

          {stored && !clearing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={disabled}
              iconLeft={<Trash2 className="size-4" />}
            >
              Remove
            </Button>
          )}
          {clearing && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onUndoClear}
              iconLeft={<Undo2 className="size-4" />}
            >
              Keep it
            </Button>
          )}
        </div>

        {/*
          Status in words as well as colour, and inside a live region, so the
          state of a credential is available to a screen reader rather than
          only to someone looking at a badge (§34).
        */}
        <p id={`${id}-state`} className="flex flex-wrap items-center gap-2 text-xs text-ink-600" aria-live="polite">
          {clearing ? (
            <Badge tone="danger" size="sm">Will be removed on save</Badge>
          ) : staged ? (
            <Badge tone="warning" size="sm">New value — not saved yet</Badge>
          ) : stored ? (
            <>
              <Badge tone="success" size="sm">
                <KeyRound className="mr-1 inline size-3" aria-hidden="true" />
                Stored
              </Badge>
              {state.last4 && (
                <span className="font-mono text-ink-500">{"•".repeat(12)}{state.last4}</span>
              )}
              {state.updatedAt && <span>Last changed {formatDate(state.updatedAt)}</span>}
            </>
          ) : (
            <Badge tone="neutral" size="sm">Not set</Badge>
          )}
        </p>
      </div>
    </Field>
  );
}
