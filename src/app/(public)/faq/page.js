import Link from "next/link";
import { ArrowRight, MessageSquare } from "lucide-react";
import { Button, Card, CardBody, Reveal } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section } from "@/components/home/Sections";
import { HOME_FAQS } from "@/components/home/Sections";
import { SITE } from "@/constants";

export const metadata = {
  title: "Frequently asked questions",
  description:
    "Answers about searching for tutors, booking lessons, payments, cancellations, verification and privacy on APlus Learn.",
  alternates: { canonical: "/faq" },
};

const GROUPS = [
  {
    title: "Getting started",
    faqs: HOME_FAQS.filter((f) =>
      ["How much does tutoring cost?", "Do I need an account to search?", "Which provinces do you cover?"].includes(f.q),
    ),
  },
  {
    title: "Booking and lessons",
    faqs: [
      ...HOME_FAQS.filter((f) =>
        ["Can I book the same tutor every week?", "How do online lessons work?"].includes(f.q),
      ),
      {
        q: "How far ahead can I book?",
        a: "Up to 60 days ahead, and at least a few hours before the lesson starts — the exact minimum notice is set by each tutor. You'll only ever see times that are genuinely free on their calendar.",
      },
      {
        q: "Can I change a lesson time after booking?",
        a: "Yes. Open the lesson from your dashboard and choose Reschedule. The new time has to be free on the tutor's calendar, and both of you are notified of the change.",
      },
      {
        q: "What happens in an in-person lesson?",
        a: "You choose where — your home, a library, or another agreed public place — when you book. Your address is only shared with the tutor once the lesson is confirmed, and never appears on any public page.",
      },
    ],
  },
  {
    title: "Payments and refunds",
    faqs: [
      ...HOME_FAQS.filter((f) => f.q === "What if a lesson doesn't go well?"),
      {
        q: "When is my card charged?",
        a: "At the point of booking. The money is held and released to the tutor a few days after the lesson is completed, which is what lets us refund you quickly if something goes wrong.",
      },
      {
        q: "How do refunds work?",
        a: "Cancel more than 24 hours before and you're refunded in full automatically. Inside 24 hours, the late-cancellation rate applies. If the tutor cancels or doesn't attend, you're refunded in full regardless of timing.",
      },
      {
        q: "Can I get a receipt?",
        a: "Every payment has a printable receipt in your Payments page, showing the lessons covered, the amount and any refunds applied.",
      },
    ],
  },
  {
    title: "Tutors and verification",
    faqs: [
      ...HOME_FAQS.filter((f) => f.q === "How are tutors verified?"),
      {
        q: "Why don't all tutors have all badges?",
        a: "Because each badge means one specific thing. Identity verification is required of everyone. The others are earned individually — a university student won't hold an OCT badge, and a certified teacher may not have supplied a background check. Each profile shows exactly what that tutor holds.",
      },
      {
        q: "Can I see a tutor's full name?",
        a: "No. Public profiles show a first name and last initial. This protects tutors the same way we protect your child's name, and it's enough to identify who you're talking to.",
      },
    ],
  },
  {
    title: "Privacy",
    faqs: [
      ...HOME_FAQS.filter((f) => f.q === "Is my child's information private?"),
      {
        q: "Can I delete my account?",
        a: "Yes, from Settings. Your personal details are removed and the account is anonymised. Lesson and payment records are kept in anonymised form because tax and accounting rules require it.",
      },
      {
        q: "Do you sell my data?",
        a: "No. We don't sell or share personal information with advertisers or data brokers. See our Privacy Policy for exactly what we collect and why.",
      },
    ],
  },
];

export default function FaqPage() {
  const allFaqs = GROUPS.flatMap((g) => g.faqs);

  return (
    <>
      <PageHero
        eyebrow="FAQ"
        title="Questions, answered"
        description="If something isn't covered here, our support team replies within one business day."
      />

      <Section tone="muted">
        <div className="grid gap-10 lg:grid-cols-[1fr_16rem]">
          <div className="min-w-0 space-y-10">
            {GROUPS.map((group) => (
              <Reveal key={group.title}>
                <section id={group.title.toLowerCase().replace(/\s+/g, "-")}>
                  <h2 className="text-lg font-bold text-ink-900">{group.title}</h2>
                  <div className="mt-4 divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-canvas">
                    {group.faqs.map((faq) => (
                      <details
                        key={faq.q}
                        className="group px-5 py-4 [&_summary::-webkit-details-marker]:hidden"
                      >
                        <summary className="flex cursor-pointer list-none items-start justify-between gap-4 text-left">
                          <h3 className="text-sm font-bold text-ink-900">{faq.q}</h3>
                          <span
                            aria-hidden="true"
                            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-100 text-ink-500 transition-transform duration-200 group-open:rotate-45"
                          >
                            +
                          </span>
                        </summary>
                        <p className="mt-3 text-sm leading-relaxed text-ink-600">{faq.a}</p>
                      </details>
                    ))}
                  </div>
                </section>
              </Reveal>
            ))}
          </div>

          <Reveal delay={0.1}>
            <div className="space-y-6 lg:sticky lg:top-24">
              <nav aria-label="FAQ sections">
                <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
                  On this page
                </p>
                <ul className="mt-3 space-y-2">
                  {GROUPS.map((group) => (
                    <li key={group.title}>
                      <a
                        href={`#${group.title.toLowerCase().replace(/\s+/g, "-")}`}
                        className="text-sm text-ink-600 hover:text-brand-600"
                      >
                        {group.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>

              <Card>
                <CardBody>
                  <MessageSquare className="size-5 text-brand-600" />
                  <h3 className="mt-3 text-sm font-bold text-ink-900">Still stuck?</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                    We reply within one business day.
                  </p>
                  <Button
                    href="/support"
                    size="sm"
                    fullWidth
                    className="mt-4"
                    iconRight={<ArrowRight className="size-3.5" />}
                  >
                    Contact support
                  </Button>
                </CardBody>
              </Card>
            </div>
          </Reveal>
        </div>
      </Section>

      {/* Full FAQ structured data for search results (§29). */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "FAQPage",
            mainEntity: allFaqs.map((faq) => ({
              "@type": "Question",
              name: faq.q,
              acceptedAnswer: { "@type": "Answer", text: faq.a },
            })),
          }),
        }}
      />
    </>
  );
}
