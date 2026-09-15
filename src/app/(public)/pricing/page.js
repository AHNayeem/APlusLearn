import { Check, X, Wallet, ShieldCheck, Receipt, Banknote, ArrowRight } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { getSettings } from "@/services/settings.service";
import { Badge, Button, Card, CardBody, Reveal, RevealGroup, RevealItem } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section, Faq } from "@/components/home/Sections";
import { formatMoney } from "@/lib/utils/format";

export const metadata = {
  title: "Pricing",
  description:
    "What tutoring costs on APlus Learn: tutors set their own rates, families pay exactly what's shown, and our commission comes out of the tutor's side.",
  alternates: { canonical: "/pricing" },
};

export const revalidate = 3600;

const PRICING_FAQS = [
  {
    q: "Who sets the hourly rate?",
    a: "Each tutor does. They see exactly what they'll receive after our fee before they choose it, so the rate on a profile reflects what that tutor thinks their time is worth — not a price we imposed.",
  },
  {
    q: "Do I pay anything to search or message?",
    a: "No. Searching, filtering, reading reviews and messaging tutors are all free and don't require a payment method. You only pay when you book a lesson.",
  },
  {
    q: "When am I charged?",
    a: "At the point of booking. The money is held and released to the tutor a few days after the lesson is completed, which is what lets us refund you promptly if something goes wrong.",
  },
  {
    q: "What happens if I cancel?",
    a: "Cancel more than 24 hours before the lesson and you're refunded in full, automatically. Inside 24 hours, the late-cancellation rate applies. If the tutor cancels or doesn't attend, you're always refunded in full.",
  },
  {
    q: "Are there any fees on top of the hourly rate?",
    a: "No. There's no booking fee, no service charge and no registration cost. A 60-minute lesson at $60/hour costs exactly $60.",
  },
  {
    q: "How and when do tutors get paid?",
    a: "Earnings become payable a few days after each completed lesson, then are transferred to the tutor's connected bank account. Tutors see every lesson, the fee taken and their running total in their earnings dashboard.",
  },
];

export default async function PricingPage() {
  await connectToDatabase();
  const settings = await getSettings();

  const tutorKeeps = 100 - settings.commissionPercent;
  const example = 6000;
  const exampleFee = Math.floor((example * settings.commissionPercent) / 100);

  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="The rate you see is the rate you pay"
        description="Tutors set their own hourly rates. We take a commission from the tutor's side of each completed lesson — never as an add-on to your bill."
      />

      <Section tone="muted">
        <div className="grid gap-6 lg:grid-cols-2">
          <Reveal>
            <Card className="h-full border-brand-200">
              <CardBody>
                <Badge tone="brand">For families</Badge>
                <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-900">
                  Free to use
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">
                  You pay the tutor&rsquo;s hourly rate for lessons you book. Nothing else.
                </p>

                <ul className="mt-6 space-y-3">
                  {[
                    "Search and filter every tutor",
                    "Read verified reviews",
                    "Message as many tutors as you like",
                    "Post a tutor request",
                    "Save tutors to compare later",
                    "Secure payment held until the lesson is done",
                    "Free cancellation up to 24 hours before",
                    "Full refund if a tutor doesn't attend",
                  ].map((item) => (
                    <li key={item} className="flex gap-2.5 text-sm text-ink-700">
                      <Check className="mt-0.5 size-4 shrink-0 text-success-600" />
                      {item}
                    </li>
                  ))}
                </ul>

                <ul className="mt-5 space-y-2 border-t border-ink-100 pt-5">
                  {["No registration fee", "No booking fee", "No minimum package"].map((item) => (
                    <li key={item} className="flex gap-2.5 text-sm text-ink-500">
                      <X className="mt-0.5 size-4 shrink-0 text-ink-300" />
                      {item}
                    </li>
                  ))}
                </ul>

                <Button href="/find-a-tutor" size="lg" fullWidth className="mt-6">
                  Find a tutor
                </Button>
              </CardBody>
            </Card>
          </Reveal>

          <Reveal delay={0.08}>
            <Card className="h-full">
              <CardBody>
                <Badge tone="accent">For tutors</Badge>
                <h2 className="mt-4 text-2xl font-extrabold tracking-tight text-ink-900">
                  {settings.commissionPercent}% per completed lesson
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">
                  You keep {tutorKeeps}%. Nothing upfront, nothing when you&rsquo;re not teaching,
                  and nothing on a lesson that gets cancelled.
                </p>

                <div className="mt-6 rounded-xl bg-ink-50 p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
                    On a {formatMoney(example)} lesson
                  </p>
                  <dl className="mt-3 space-y-2 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-ink-500">Family pays</dt>
                      <dd className="font-semibold text-ink-900">{formatMoney(example)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-500">
                        APlus Learn fee ({settings.commissionPercent}%)
                      </dt>
                      <dd className="text-ink-500">− {formatMoney(exampleFee)}</dd>
                    </div>
                    <div className="flex justify-between border-t border-ink-200 pt-2">
                      <dt className="font-bold text-ink-900">You receive</dt>
                      <dd className="text-base font-extrabold text-success-700">
                        {formatMoney(example - exampleFee)}
                      </dd>
                    </div>
                  </dl>
                </div>

                <ul className="mt-6 space-y-3">
                  {[
                    "Set your own rate, and a different rate per course",
                    "Keep your own calendar and availability",
                    "Verification badges families filter by",
                    "Payments collected and reconciled for you",
                    "Paid automatically after each lesson clears",
                    "Cancel-and-refund policy applied for you",
                  ].map((item) => (
                    <li key={item} className="flex gap-2.5 text-sm text-ink-700">
                      <Check className="mt-0.5 size-4 shrink-0 text-success-600" />
                      {item}
                    </li>
                  ))}
                </ul>

                <Button href="/become-a-tutor" variant="accent" size="lg" fullWidth className="mt-6">
                  Apply to tutor
                </Button>
              </CardBody>
            </Card>
          </Reveal>
        </div>
      </Section>

      <Section
        eyebrow="What tutors charge"
        title="Typical rates on APlus Learn"
        description="Rates reflect qualifications and the level being taught. These are the ranges you'll actually see."
      >
        <RevealGroup className="grid gap-5 md:grid-cols-3">
          {[
            {
              label: "Elementary & intermediate",
              range: "$40–55",
              body: "Grades 1–8 mathematics, reading and general science. Often university students and certified elementary teachers.",
            },
            {
              label: "Senior secondary",
              range: "$55–80",
              body: "Grade 11 and 12 courses including MHF4U, SBI4U and ENG4U. Subject specialists and OCT-certified teachers.",
            },
            {
              label: "Specialist & exam prep",
              range: "$75–110",
              body: "Department heads, contest coaching and students targeting the most competitive university programs.",
            },
          ].map((tier) => (
            <RevealItem key={tier.label}>
              <Card className="h-full">
                <CardBody>
                  <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
                    {tier.label}
                  </p>
                  <p className="mt-2 text-3xl font-extrabold tracking-tight text-ink-900">
                    {tier.range}
                    <span className="text-base font-semibold text-ink-400">/hr</span>
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-ink-500">{tier.body}</p>
                </CardBody>
              </Card>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <Section
        eyebrow="Cancellations"
        title="What happens when plans change"
        tone="muted"
      >
        <RevealGroup className="grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {[
            {
              icon: ShieldCheck,
              title: `More than ${settings.freeCancellationWindowHours} hours before`,
              body: "Cancel free of charge. You're refunded in full, automatically.",
              tone: "success",
            },
            {
              icon: Wallet,
              title: `Inside ${settings.freeCancellationWindowHours} hours`,
              body:
                settings.lateCancellationRefundPercent > 0
                  ? `${settings.lateCancellationRefundPercent}% is refunded — the rest covers the tutor's reserved time.`
                  : "The lesson isn't refunded, as the tutor has held that time for you.",
              tone: "warning",
            },
            {
              icon: Receipt,
              title: "Tutor cancels",
              body: "You're refunded in full, whatever the notice. Always.",
              tone: "success",
            },
            {
              icon: Banknote,
              title: "Something went wrong",
              body: "Open a dispute from the lesson page. Our team reviews it and decides on a refund.",
              tone: "info",
            },
          ].map((item) => (
            <RevealItem key={item.title}>
              <Card className="h-full">
                <CardBody>
                  <span
                    className={`flex size-10 items-center justify-center rounded-xl ${
                      item.tone === "success"
                        ? "bg-success-50 text-success-700"
                        : item.tone === "warning"
                          ? "bg-warning-50 text-warning-700"
                          : "bg-info-50 text-info-600"
                    }`}
                  >
                    <item.icon className="size-5" />
                  </span>
                  <h3 className="mt-3 text-sm font-bold text-ink-900">{item.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-500">{item.body}</p>
                </CardBody>
              </Card>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal className="mt-8">
          <Button
            href="/legal/cancellation"
            variant="secondary"
            iconRight={<ArrowRight className="size-4" />}
          >
            Read the full policy
          </Button>
        </Reveal>
      </Section>

      <Faq faqs={PRICING_FAQS} title="Pricing questions" showAllLink={false} />
    </>
  );
}
