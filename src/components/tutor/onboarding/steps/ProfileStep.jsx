"use client";

import { useState } from "react";
import { X, Plus } from "lucide-react";
import { Badge, Field, Input, Textarea, InlineNote } from "@/components/ui";

const SUGGESTED_LANGUAGES = [
  "English", "French", "Mandarin", "Cantonese", "Punjabi", "Hindi", "Urdu",
  "Spanish", "Arabic", "Tagalog", "Portuguese", "Tamil", "Farsi", "Korean",
];

/** Step 2 — the headline and bio parents read first (§17). */
export function ProfileStep({ value, onChange, fieldErrors }) {
  const [languageInput, setLanguageInput] = useState("");
  const languages = value.languages ?? ["English"];

  const set = (key, next) => onChange({ ...value, [key]: next });

  const addLanguage = (language) => {
    const trimmed = language.trim();
    if (!trimmed || languages.includes(trimmed)) return;
    set("languages", [...languages, trimmed]);
    setLanguageInput("");
  };

  const bioLength = (value.bio ?? "").length;

  return (
    <div className="space-y-5">
      <Field
        label="Headline"
        htmlFor="ob-headline"
        hint="One line that says what you teach and what makes you different. This is the first thing parents read."
        error={fieldErrors.headline}
        required
      >
        <Input
          id="ob-headline"
          value={value.headline ?? ""}
          onChange={(e) => set("headline", e.target.value)}
          error={fieldErrors.headline}
          maxLength={120}
          placeholder="OCT-certified math teacher — Advanced Functions & Calculus specialist"
        />
        <InlineNote>{(value.headline ?? "").length}/120 characters</InlineNote>
      </Field>

      <Field
        label="About you"
        htmlFor="ob-bio"
        hint="Who you work with, how you teach, and what a lesson actually looks like. Specifics win bookings — vague enthusiasm doesn't."
        error={fieldErrors.bio}
        required
      >
        <Textarea
          id="ob-bio"
          rows={10}
          value={value.bio ?? ""}
          onChange={(e) => set("bio", e.target.value)}
          error={fieldErrors.bio}
          maxLength={4000}
          placeholder={
            "I've taught senior mathematics for eleven years and most of my students come to me part-way through MHF4U.\n\nMy approach is diagnostic: in the first session we work through a past test together so I can see exactly where the reasoning breaks down.\n\nI send a written summary after every lesson so parents can see what we covered."
          }
        />
        <InlineNote tone={bioLength < 120 ? "danger" : "neutral"}>
          {bioLength}/4000 characters
          {bioLength < 120 && ` — at least 120 needed (${120 - bioLength} more)`}
        </InlineNote>
      </Field>

      <Field
        label="Languages you can teach in"
        htmlFor="ob-language-input"
        error={fieldErrors.languages}
        required
      >
        <div className="flex flex-wrap gap-2">
          {languages.map((language) => (
            <Badge key={language} tone="brand">
              {language}
              {languages.length > 1 && (
                <button
                  type="button"
                  onClick={() => set("languages", languages.filter((l) => l !== language))}
                  aria-label={`Remove ${language}`}
                  className="-mr-0.5 ml-0.5 rounded-full p-0.5 hover:bg-brand-200"
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <Input
            id="ob-language-input"
            value={languageInput}
            onChange={(e) => setLanguageInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addLanguage(languageInput);
              }
            }}
            placeholder="Add a language"
            className="flex-1"
          />
          <button
            type="button"
            onClick={() => addLanguage(languageInput)}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-600 transition-colors hover:bg-ink-200"
            aria-label="Add language"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {SUGGESTED_LANGUAGES.filter((l) => !languages.includes(l))
            .slice(0, 8)
            .map((language) => (
              <button
                key={language}
                type="button"
                onClick={() => addLanguage(language)}
                className="rounded-lg bg-ink-100 px-2.5 py-1 text-xs font-medium text-ink-600 transition-colors hover:bg-brand-100 hover:text-brand-700"
              >
                + {language}
              </button>
            ))}
        </div>
      </Field>

      <Field
        label="Intro video"
        htmlFor="ob-video"
        hint="Optional. A 60-second YouTube or Vimeo link. Profiles with a video get noticeably more bookings."
        error={fieldErrors.introVideoUrl}
      >
        <Input
          id="ob-video"
          type="url"
          value={value.introVideoUrl ?? ""}
          onChange={(e) => set("introVideoUrl", e.target.value)}
          error={fieldErrors.introVideoUrl}
          placeholder="https://youtube.com/watch?v=…"
        />
      </Field>
    </div>
  );
}
