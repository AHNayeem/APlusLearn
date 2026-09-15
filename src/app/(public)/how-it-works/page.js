import {
  Search, MessageSquare, CalendarCheck, TrendingUp, ShieldCheck, Wallet,
  UserPlus, FileCheck, Rocket, ArrowRight,
} from "lucide-react";
import { Button, Card, CardBody, Reveal, RevealGroup, RevealItem } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section, Faq, HOME_FAQS } from "@/components/home/Sections";

export const metadata = {
  title: "How it works",
  description:
    "How APlus Learn works for families and tutors — searching by course code, messaging free, booking, paying securely and leaving verified reviews.",
  alternates: { canonical: "/how-it-works" },
};

const PARENT_STEPS = [
  {
    icon: Search,
    title: "Search your exact course",
    body: "Start from the course code on the report card — MHF4U, SBI4U, ENG4U — or pick a subject and grade. Add a postal code if you want someone who can come to you. No account needed.",
    detail: "Filters cover price, rating, experience, verification badges, distance and availability.",
  },
  {
    icon: MessageSquare,
    title: "Compare and message",
    body: "Every profile shows verified reviews from families who actually completed a lesson, the tutor's real credentials, and what they charge. Message as many as you like — it's free and you're not committed.",
    detail: "Tutors typically reply within a few hours. Response time is shown on each profile.",
  },
  {
    icon: CalendarCheck,
    title: "Book and pay securely",
    body: "Pick a slot from the tutor's live calendar. Pay by card; the money is held until the lesson is complete. Online lessons get a meeting link automatically.",
    detail: "Free cancellation up to 24 hours before. Full refund if a tutor doesn't show.",
  },
  {
    icon: TrendingUp,
    title: "Review and rebook",
    body: "After the lesson, leave a review — it's what keeps the marketplace honest. Rebook the same tutor in two taps, or set up a recurring weekly slot.",
    detail: "Every lesson, receipt and review stays in your dashboard.",
  },
];

const TUTOR_STEPS = [
  {
    icon: UserPlus,
    title: "Apply",
    body: "Eleven short steps covering your qualifications, the exact courses you teach, your rate and your availability. Progress saves as you go.",
  },
  {
    icon: FileCheck,
    title: "Get verified",
    body: "Upload your ID and credentials. Our team checks each one and grants the matching badge. Certified teachers are verified against the Ontario College of Teachers register.",
  },
  {
    icon: Rocket,
    title: "Start teaching",
    body: "Once approved, your profile appears in search. Families book directly from your calendar, and you're paid a few days after each completed lesson.",
  },
];

export default function HowItWorksPage() {
  return (
    <>
      <PageHero
        eyebrow="How it works"
        title="From “we need help with MCV4U” to a booked lesson"
        description="No agency in the middle, no phone tag, and no mark-up you can't see. Here's exactly what happens."
      >
        <div className="flex flex-wrap gap-3">
          <Button href="/find-a-tutor" size="lg">
            Find a tutor
          </Button>
          <Button href="/become-a-tutor" variant="secondary" size="lg">
            Become a tutor
          </Button>
        </div>
      </PageHero>

      <Section eyebrow="For families" title="Four steps, start to finish" tone="muted">
        <div className="space-y-6">
          {PARENT_STEPS.map((step, index) => (
            <Reveal key={step.title} delay={index * 0.05}>
              <Card>
                <CardBody className="flex flex-col gap-5 sm:flex-row">
                  <div className="flex shrink-0 items-start gap-4">
                    <span className="flex size-12 items-center justify-center rounded-xl bg-brand-600 text-white">
                      <step.icon className="size-5" />
                    </span>
                    <span className="mt-3 text-3xl font-extrabold text-ink-200 sm:hidden">
                      {index + 1}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-lg font-bold text-ink-900">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-600">{step.body}</p>
                    <p className="mt-3 border-l-2 border-brand-200 pl-3 text-sm text-ink-500">
                      {step.detail}
                    </p>
                  </div>
                  <span className="hidden shrink-0 text-4xl font-extrabold text-ink-100 sm:block">
                    {index + 1}
                  </span>
                </CardBody>
              </Card>
            </Reveal>
          ))}
        </div>
      </Section>

      <Section
        eyebrow="What it costs"
        title="One price, shown upfront"
        description="The hourly rate on a tutor's profile is what you pay. Our commission comes out of the tutor's side, and they see it plainly before they set their rate."
      >
        <RevealGroup className="grid gap-6 md:grid-cols-3">
          {[
            {
              icon: Wallet,
              title: "No registration fee",
              body: "Searching, messaging and comparing tutors costs nothing. You only pay when you book a lesson.",
            },
            {
              icon: ShieldCheck,
              title: "No minimum package",
              body: "Book one lesson to try someone out. There's no bundle you have to commit to first.",
            },
            {
              icon: TrendingUp,
              title: "No surprise charges",
              body: "The total is calculated before you pay and shown on the booking screen and your receipt.",
            },
          ].map((item) => (
            <RevealItem key={item.title}>
              <Card className="h-full">
                <CardBody>
                  <span className="flex size-11 items-center justify-center rounded-xl bg-success-50 text-success-700">
                    <item.icon className="size-5" />
                  </span>
                  <h3 className="mt-4 text-base font-bold text-ink-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-500">{item.body}</p>
                </CardBody>
              </Card>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal className="mt-8">
          <Button href="/pricing" variant="secondary" iconRight={<ArrowRight className="size-4" />}>
            See full pricing
          </Button>
        </Reveal>
      </Section>

      <Section eyebrow="For tutors" title="How tutoring on APlus Learn works" tone="muted">
        <RevealGroup className="grid gap-6 md:grid-cols-3">
          {TUTOR_STEPS.map((step, index) => (
            <RevealItem key={step.title}>
              <Card className="h-full">
                <CardBody>
                  <div className="flex items-center gap-3">
                    <span className="flex size-11 items-center justify-center rounded-xl bg-accent-100 text-accent-700">
                      <step.icon className="size-5" />
                    </span>
                    <span className="text-xs font-bold uppercase tracking-wide text-ink-400">
                      Step {index + 1}
                    </span>
                  </div>
                  <h3 className="mt-4 text-base font-bold text-ink-900">{step.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-500">{step.body}</p>
                </CardBody>
              </Card>
            </RevealItem>
          ))}
        </RevealGroup>

        <Reveal className="mt-8">
          <Button href="/become-a-tutor" iconRight={<ArrowRight className="size-4" />}>
            Apply to tutor
          </Button>
        </Reveal>
      </Section>

      <Faq faqs={HOME_FAQS} title="Common questions" showAllLink={false} />
    </>
  );
}
