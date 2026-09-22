"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Trash2, AlertTriangle, ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/lib/api/client";
import { Avatar, Button, Card, CardBody, CardHeader, Spinner, useToast } from "@/components/ui";
import { AVATAR_IMAGE, ROLE_LABELS, ROLES } from "@/constants";
import { formatDate } from "@/lib/utils/format";

/**
 * Who you are, and the photo that goes with it (§8, §24).
 *
 * The summary above the form exists because "your details" was previously a
 * form and nothing else: there was no single place that simply *showed* an
 * account — name, address, role, whether the email and mobile are confirmed.
 * Those last two are read-only on purpose. They are statements this platform
 * made about the account rather than preferences, so they are reported here
 * and changed where they are earned.
 *
 * The photo is picked, previewed locally, and only then sent. The preview is
 * an object URL rather than an optimistic write, so cancelling costs a click
 * and nothing has to be undone; the file is not uploaded until "Save photo",
 * which is what makes "replace the one I just chose" a normal thing to do.
 */
export function ProfilePhotoPanel({ user }) {
  const router = useRouter();
  const toast = useToast();
  const inputRef = useRef(null);

  const [chosen, setChosen] = useState(null); // { file, url }
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState(null);

  // An object URL is a handle on a blob the browser is holding for us, so it
  // is released when this component stops pointing at it — otherwise choosing
  // six photos in a row leaks six of them for the life of the page.
  useEffect(() => () => { if (chosen?.url) URL.revokeObjectURL(chosen.url); }, [chosen]);

  const maxMb = Math.round(AVATAR_IMAGE.maxBytes / 1024 / 1024);

  const choose = (file) => {
    setProblem(null);

    // A courtesy, not a control: the server decides from the bytes. This only
    // saves an obviously-wrong file a round trip and a wait.
    if (!AVATAR_IMAGE.accepts.includes(file.type)) {
      setProblem("Choose a JPG, PNG or WebP image.");
      return;
    }
    if (file.size > AVATAR_IMAGE.maxBytes) {
      setProblem(`That photo is ${Math.round(file.size / 1024 / 1024 * 10) / 10} MB — the limit is ${maxMb} MB.`);
      return;
    }

    if (chosen?.url) URL.revokeObjectURL(chosen.url);
    setChosen({ file, url: URL.createObjectURL(file) });
  };

  const clearChoice = () => {
    if (chosen?.url) URL.revokeObjectURL(chosen.url);
    setChosen(null);
    setProblem(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const save = async () => {
    if (!chosen || busy) return;

    const body = new FormData();
    body.append("file", chosen.file);

    setBusy(true);
    setProblem(null);
    try {
      await api.post("/api/users/me/avatar", body);
      clearChoice();
      toast.success("Photo updated", "It's now shown wherever your name appears.");
      router.refresh();
    } catch (error) {
      // The previous photo is untouched when an upload fails, so the screen
      // says what went wrong and keeps showing it.
      setProblem(error instanceof ApiError ? error.message : "That upload didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await api.delete("/api/users/me/avatar");
      clearChoice();
      toast.success("Photo removed", "Your initials are shown instead.");
      router.refresh();
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const preview = chosen?.url ?? user.avatarUrl ?? null;
  const hasPhoto = Boolean(user.avatarUrl);

  return (
    <Card id="photo">
      <CardHeader
        title="Your profile"
        description={
          user.role === ROLES.TUTOR
            ? "Your photo and name are what families see when they find you."
            : "Your photo appears next to your name in messages and lessons."
        }
      />
      <CardBody className="space-y-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="relative shrink-0 self-center sm:self-start">
            <Avatar
              src={preview}
              firstName={user.firstName}
              lastName={user.lastName}
              size="2xl"
            />
            {busy && (
              <span className="absolute inset-0 flex items-center justify-center rounded-full bg-white/70">
                <Spinner />
              </span>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="text-lg font-bold text-ink-900">
                {user.firstName} {user.lastName}
              </p>
              <p className="text-sm text-ink-500">{ROLE_LABELS[user.role]}</p>
            </div>

            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <Detail
                label="Email"
                value={user.email}
                note={user.emailVerifiedAt ? "Confirmed" : "Not confirmed yet"}
                confirmed={Boolean(user.emailVerifiedAt)}
              />
              <Detail
                label="Phone"
                value={user.phone || "Not added"}
                note={user.phone ? (user.phoneVerifiedAt ? "Confirmed" : "Not confirmed yet") : null}
                confirmed={Boolean(user.phoneVerifiedAt)}
              />
              <Detail
                label="Location"
                value={[user.city, user.province].filter(Boolean).join(", ") || "Not added"}
              />
              <Detail label="Member since" value={formatDate(user.createdAt)} />
            </dl>
          </div>
        </div>

        {problem && (
          <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger-600">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden="true" />
            {problem}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-ink-200 pt-4">
          <label
            htmlFor="avatar-file"
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-ink-100 px-3.5 py-2 text-sm font-semibold text-ink-700 transition-colors hover:bg-ink-200 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-500 aria-disabled:pointer-events-none aria-disabled:opacity-50"
            aria-disabled={busy}
          >
            <Camera className="size-4" aria-hidden="true" />
            {chosen ? "Choose another" : hasPhoto ? "Change photo" : "Upload a photo"}
            <input
              id="avatar-file"
              ref={inputRef}
              type="file"
              className="sr-only"
              accept={AVATAR_IMAGE.accepts.join(",")}
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) choose(file);
              }}
            />
          </label>

          {chosen && (
            <>
              <Button type="button" onClick={save} loading={busy} disabled={busy}>
                Save photo
              </Button>
              <Button type="button" variant="ghost" onClick={clearChoice} disabled={busy}>
                Cancel
              </Button>
            </>
          )}

          {!chosen && hasPhoto && (
            <Button
              type="button"
              variant="ghost"
              onClick={remove}
              disabled={busy}
              iconLeft={<Trash2 className="size-4" />}
            >
              Remove
            </Button>
          )}
        </div>

        <p className="text-xs text-ink-400">
          JPG, PNG or WebP · up to {maxMb} MB · at least {AVATAR_IMAGE.minWidth}×
          {AVATAR_IMAGE.minHeight} pixels. {chosen ? "This is a preview — nothing is saved until you choose Save photo." : ""}
        </p>
      </CardBody>
    </Card>
  );
}

function Detail({ label, value, note, confirmed }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-ink-400">{label}</dt>
      <dd className="truncate font-medium text-ink-800">{value}</dd>
      {note && (
        <p
          className={
            confirmed
              ? "mt-0.5 flex items-center gap-1 text-xs font-medium text-success-700"
              : "mt-0.5 text-xs text-ink-400"
          }
        >
          {confirmed && <ShieldCheck className="size-3.5" aria-hidden="true" />}
          {note}
        </p>
      )}
    </div>
  );
}
