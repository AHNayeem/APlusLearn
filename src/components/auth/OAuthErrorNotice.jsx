"use client";

import { useSearchParams } from "next/navigation";
import { Alert } from "@/components/ui";
import { oauthErrorPresentation } from "@/lib/auth/oauth-errors";

/**
 * Why a Google or Apple sign-in came back unfinished (§9).
 *
 * The callback reports its outcome as `?oauthError=CODE`. Only the code is
 * read; the words are this application's own, from `oauth-errors.js`, so the
 * parameter cannot be used to put a crafted message on the sign-in page.
 */
export function OAuthErrorNotice({ className = "mb-5" }) {
  const params = useSearchParams();
  const presentation = oauthErrorPresentation(params.get("oauthError"));
  if (!presentation) return null;

  return (
    <Alert tone={presentation.tone} title={presentation.title} className={className}>
      {presentation.message}
    </Alert>
  );
}
