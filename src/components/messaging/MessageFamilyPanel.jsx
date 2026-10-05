"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Button, Card, CardBody, CardHeader, Field, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import { formatDateTime } from "@/lib/utils/format";
import { BOOKING_STATUS_LABELS } from "@/constants";

/**
 * A tutor's first message to the family behind a booking (R17.1, R23.6).
 *
 * The request names the booking and nothing else — the server reads the
 * family from it — so there is no recipient field here to tamper with.
 */
export function MessageFamilyPanel({ booking, canMessage }) {
  const router = useRouter();
  const toast = useToast();
  const [body, setBody] = useState("");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post("/api/messages", { bookingId: booking.id, body });
    if (result.warning) toast.info("Message sent — contact details removed", result.warning.message);
    else toast.success("Message sent", "The family will be notified.");
    router.push(`/tutor/messages/${result.conversationId}`);
    return result;
  });

  return (
    <Card className="max-w-2xl">
      <CardHeader
        title={booking.familyName ? `Message ${booking.familyName}` : "Message the family"}
        description={[
          booking.courseCode ?? booking.courseName,
          booking.startAt ? formatDateTime(booking.startAt, booking.timeZone) : null,
          BOOKING_STATUS_LABELS[booking.status],
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <CardBody>
        {!canMessage ? (
          <Alert tone="neutral">
            You can message a family once a lesson with them is confirmed. Unpaid, expired and
            cancelled bookings don&rsquo;t open a conversation.
          </Alert>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="space-y-4"
          >
            <FormErrorSummary error={error} fieldErrors={fieldErrors} />

            <Field label="Your message" htmlFor="family-message" error={fieldErrors.body}>
              <Textarea
                id="family-message"
                rows={5}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={4000}
                error={fieldErrors.body}
                placeholder="Hi, looking forward to our lesson. Is there anything you'd like me to focus on?"
              />
            </Field>

            <p className="text-xs text-ink-500">
              Keep contact and payment on APlus Learn — phone numbers, emails and social handles are
              removed from messages.
            </p>

            <div className="flex justify-end">
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
        )}
      </CardBody>
    </Card>
  );
}
