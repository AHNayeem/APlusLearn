import Link from "next/link";
import {
  Mail, Phone, MessageSquare, BookOpen, ShieldAlert, CreditCard, CalendarDays, ArrowRight,
} from "lucide-react";
import { Button, Card, CardBody, Reveal, RevealGroup, RevealItem } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section } from "@/components/home/Sections";
import { SITE } from "@/constants";

export const metadata = {
  title: "Support",
  description:
    "Get help with bookings, payments, refunds, verification or safety on APlus Learn. We reply within one business day.",
  alternates: { canonical: "/support" },
};

const TOPICS = [
  {
    icon: CalendarDays,
    title: "Bookings and lessons",
    body: "Changing a time, cancelling, joining an online lesson, or reporting a no-show.",
    links: [
      { label: "How booking works", href: "/how-it-works" },
      { label: "Cancellation policy", href: "/legal/cancellation" },
    ],
  },
  {
    icon: CreditCard,
    title: "Payments and refunds",
    body: "Charges, receipts, refunds and payout questions.",
    links: [
      { label: "Pricing explained", href: "/pricing" },
      { label: "Refund policy", href: "/legal/cancellation" },
    ],
  },
  {
    icon: ShieldAlert,
    title: "Safety and conduct",
    body: "Reporting a tutor, a conversation, or anything that felt wrong.",
    links: [
      { label: "Safety guidance", href: "/safety" },
      { label: "How verification works", href: "/verification" },
    ],
  },
  {
    icon: BookOpen,
    title: "Tutoring on APlus Learn",
    body: "Applications, verification badges, availability and earnings.",
    links: [
      { label: "Become a tutor", href: "/become-a-tutor" },
      { label: "Verification badges", href: "/verification" },
    ],
  },
];

export default function SupportPage() {
  return (
    <>
      <PageHero
        eyebrow="Support"
        title="Get help"
        description="Most answers are in the FAQ. If yours isn't, email us — a person reads every message and we reply within one business day."
      >
        <div className="flex flex-wrap gap-3">
          <Button href={`mailto:${SITE.supportEmail}`} size="lg" iconLeft={<Mail className="size-4" />}>
            Email support
          </Button>
          <Button href="/faq" variant="secondary" size="lg">
            Browse the FAQ
          </Button>
        </div>
      </PageHero>

      <Section tone="muted">
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <div>
            <Reveal>
              <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
                What do you need help with?
              </h2>
            </Reveal>

            <RevealGroup className="mt-6 grid gap-5 sm:grid-cols-2">
              {TOPICS.map((topic) => (
                <RevealItem key={topic.title}>
                  <Card className="h-full">
                    <CardBody>
                      <span className="flex size-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                        <topic.icon className="size-5" />
                      </span>
                      <h3 className="mt-4 text-base font-bold text-ink-900">{topic.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-ink-500">{topic.body}</p>
                      <ul className="mt-4 space-y-1.5">
                        {topic.links.map((link) => (
                          <li key={link.href}>
                            <Link
                              href={link.href}
                              className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:underline"
                            >
                              {link.label}
                              <ArrowRight className="size-3" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </CardBody>
                  </Card>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>

          <Reveal delay={0.1}>
            <div className="space-y-6 lg:sticky lg:top-24">
              <Card className="border-brand-200">
                <CardBody>
                  <h3 className="text-sm font-bold text-ink-900">Contact us</h3>
                  <ul className="mt-4 space-y-4">
                    <li className="flex gap-3">
                      <Mail className="mt-0.5 size-4 shrink-0 text-ink-400" />
                      <div className="min-w-0">
                        <p className="text-xs text-ink-400">Email</p>
                        <a
                          href={`mailto:${SITE.supportEmail}`}
                          className="break-words text-sm font-semibold text-brand-600 hover:underline"
                        >
                          {SITE.supportEmail}
                        </a>
                        <p className="mt-0.5 text-xs text-ink-500">
                          Replies within one business day
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <Phone className="mt-0.5 size-4 shrink-0 text-ink-400" />
                      <div className="min-w-0">
                        <p className="text-xs text-ink-400">Phone</p>
                        <a
                          href={`tel:${SITE.supportPhone}`}
                          className="text-sm font-semibold text-brand-600 hover:underline"
                        >
                          {SITE.supportPhone}
                        </a>
                        <p className="mt-0.5 text-xs text-ink-500">
                          Weekdays, 9am–6pm Eastern
                        </p>
                      </div>
                    </li>
                    <li className="flex gap-3">
                      <MessageSquare className="mt-0.5 size-4 shrink-0 text-ink-400" />
                      <div className="min-w-0">
                        <p className="text-xs text-ink-400">In your account</p>
                        <p className="text-sm text-ink-700">
                          Report a tutor, conversation or lesson directly from its page — it reaches
                          us with the context attached.
                        </p>
                      </div>
                    </li>
                  </ul>
                </CardBody>
              </Card>

              <Card className="border-danger-200 bg-danger-50/50">
                <CardBody>
                  <h3 className="text-sm font-bold text-ink-900">Urgent safety concern?</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-600">
                    If a child is in immediate danger, call 911 first. Then email us so we can act
                    on the account straight away.
                  </p>
                  <Button href="/safety" variant="secondary" size="sm" fullWidth className="mt-4">
                    Read safety guidance
                  </Button>
                </CardBody>
              </Card>
            </div>
          </Reveal>
        </div>
      </Section>
    </>
  );
}
