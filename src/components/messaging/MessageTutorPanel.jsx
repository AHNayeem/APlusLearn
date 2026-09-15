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
 * Contact form on a tutor profile (§21). Starting a thread creates the
 * conversation server-side, so a parent never needs to find the tutor twice.
 */
export function MessageTutorPanel({ tutor, user }) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post("/api/messages", { tutorProfileId: tutor.id, body });
    toast.success("Message sent", `${tutor.firstName} will be notified.`);
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

          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-ink-500">
              {tutor.stats?.responseTimeMinutes
                ? "Usually replies within a few hours"
                : "New tutors often reply quickly"}
            </p>
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
