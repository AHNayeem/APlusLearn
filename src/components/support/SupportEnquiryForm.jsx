"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { Button, Field, FormErrorSummary, Input, Select, Textarea, SuccessState } from "@/components/ui";
import { SUPPORT_TOPICS, SUPPORT_TOPIC_LABELS } from "@/constants";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";

/**
 * The message a visitor writes from the support launcher.
 *
 * Identity is asked for only when nobody is signed in. For a signed-in person
 * the name and address are shown as a line of text rather than as disabled
 * inputs: the server reads them from the session either way, so rendering
 * fields that cannot change anything would be theatre.
 */
export function SupportEnquiryForm({ account = null, path, onSent }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    topic: SUPPORT_TOPICS.OTHER,
    message: "",
    // Honeypot. Never shown, never filled by a person.
    website: "",
  });
  const [sent, setSent] = useState(false);

  const { submit, pending, error, fieldErrors } = useSubmit(
    (payload) => api.post("/api/support/enquiries", payload),
    {
      onSuccess: () => {
        setSent(true);
        onSent?.();
      },
    },
  );

  const set = (key) => (event) => {
    const { value } = event.target;
    setForm((current) => ({ ...current, [key]: value }));
  };

  if (sent) {
    return (
      <SuccessState
        title="Message sent"
        description={
          account
            ? "We've got it. We reply within one business day, to the address on your account."
            : `We've got it. We reply within one business day, to ${form.email}.`
        }
      />
    );
  }

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit({ ...form, path });
      }}
      className="space-y-4"
    >
      <FormErrorSummary error={error} fieldErrors={fieldErrors} />

      {account ? (
        <p className="rounded-xl bg-ink-50 px-3.5 py-3 text-sm text-ink-600">
          Sending as <span className="font-semibold text-ink-900">{account.name}</span> ({account.email})
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor="support-name" error={fieldErrors.name} required>
            <Input
              id="support-name"
              name="name"
              autoComplete="name"
              value={form.name}
              onChange={set("name")}
              error={fieldErrors.name}
            />
          </Field>
          <Field label="Email" htmlFor="support-email" error={fieldErrors.email} required>
            <Input
              id="support-email"
              name="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={set("email")}
              error={fieldErrors.email}
            />
          </Field>
        </div>
      )}

      <Field label="What's this about?" htmlFor="support-topic" error={fieldErrors.topic}>
        <Select id="support-topic" value={form.topic} onChange={set("topic")} error={fieldErrors.topic}>
          {Object.values(SUPPORT_TOPICS).map((topic) => (
            <option key={topic} value={topic}>
              {SUPPORT_TOPIC_LABELS[topic]}
            </option>
          ))}
        </Select>
      </Field>

      <Field
        label="How can we help?"
        htmlFor="support-message"
        hint="A booking reference or a course code helps us answer in one reply."
        error={fieldErrors.message}
        required
      >
        <Textarea
          id="support-message"
          rows={5}
          maxLength={2000}
          value={form.message}
          onChange={set("message")}
          error={fieldErrors.message}
        />
      </Field>

      {/*
        The honeypot. Hidden from sight and from assistive technology, and
        excluded from the tab order, so the only thing that can fill it is
        something reading the DOM and filling every input it finds.
      */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="support-website">Website</label>
        <input
          id="support-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={form.website}
          onChange={set("website")}
        />
      </div>

      <Button type="submit" loading={pending} fullWidth iconLeft={<Send className="size-4" />}>
        Send message
      </Button>
    </form>
  );
}
