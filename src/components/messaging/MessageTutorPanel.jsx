"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, MessageSquare } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Card, CardBody, CardHeader, Field, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";

/**
 * "Usually replies within 2 hours", from the tutor's measured reply time
 * (R10.8) — or nothing, when there is no measurement yet. A claim about how
 * fast somebody answers is only worth showing if it was observed.
 */
function replyTimeLabel(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return null;
  const m = Number(minutes);
  if (m < 60) return "Usually replies within an hour";
  if (m < 24 * 60) {
    const hours = Math.ceil(m / 60);
    return `Usually replies within ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  const days = Math.ceil(m / (24 * 60));
  return `Usually replies within ${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Contact form on a tutor profile (§21). Starting a thread creates the
 * conversation server-side, so a parent never needs to find the tutor twice.
 */
export function MessageTutorPanel({ tutor, user }) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post("/api/messages", { tutorProfileId: tutor.id, body });
    // Contact details are removed server-side (R17.7); say so, rather than let
    // the thread show something other than what was typed without a reason.
    if (result.warning) toast.info("Message sent — contact details removed", result.warning.message);
    else toast.success("Message sent", `${tutor.firstName} will be notified.`);
    router.push(`/messages/${result.conversationId}`);
    return result;
  });

  if (!user) {
    return (
      <Card id="message">
        <CardHeader
          title={`Message ${tutor.firstName}`}
          description="Ask about their approach, availability or experience — it's free."
        />
        <CardBody>
          <Alert tone="info">
            Sign in to start a conversation. Messaging is free and you&rsquo;re not committed to
            booking anything.
          </Alert>
          <Button
            href={`/login?next=${encodeURIComponent(`/tutors/${tutor.slug}`)}`}
            className="mt-4"
            fullWidth
          >
            Sign in to message
          </Button>
        </CardBody>
      </Card>
    );
  }

  if (user.role === "TUTOR" || user.role === "ADMIN") return null;

  return (
    <Card id="message">
      <CardHeader
        title={`Message ${tutor.firstName}`}
        description="Ask about their approach, availability or experience — it's free."
      />
      <CardBody>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-4"
        >
          <FormErrorSummary error={error} fieldErrors={fieldErrors} />

          <Field label="Your message" htmlFor="tutor-message" error={fieldErrors.body}>
            <Textarea
              id="tutor-message"
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={4000}
              error={fieldErrors.body}
              placeholder={`Hi ${tutor.firstName}, I'm looking for help with… My child is in Grade … and is currently around …`}
            />
          </Field>

          <p className="text-xs text-ink-500">
            Keep contact and payment on APlus Learn — phone numbers, emails and social handles are
            removed from messages.
          </p>

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-500">{replyTimeLabel(tutor.stats?.responseTimeMinutes)}</p>
            <Button
              type="submit"
              loading={pending}
              disabled={body.trim().length < 1}
              iconLeft={<Send className="size-4" />}
            >
              Send message
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
