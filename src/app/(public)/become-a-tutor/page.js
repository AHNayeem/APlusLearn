import {
  Wallet, CalendarCheck, ShieldCheck, TrendingUp, Users, BadgeCheck,
  ArrowRight, Check,
} from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { getSettings } from "@/services/settings.service";
import { marketplaceStats } from "@/services/search.service";
import { getCurrentUser } from "@/lib/auth/current-user";
import { Badge, Button, Card, CardBody, Reveal, RevealGroup, RevealItem } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section, Faq } from "@/components/home/Sections";
import { formatMoney, formatNumber } from "@/lib/utils/format";
import { ROLES, ONBOARDING_STEPS, ONBOARDING_STEP_META } from "@/constants";

export const metadata = {
  title: "Become a tutor",
  description:
    "Teach the Ontario courses you know best. Set your own rate and availability, get verified, and let APlus Learn handle payments and scheduling.",
  alternates: { canonical: "/become-a-tutor" },
};

const TUTOR_FAQS = [
  {
    q: "What qualifications do I need?",
    a: "There's no single requirement. Certified teachers, university graduates, current students and subject specialists all tutor on APlus Learn. What matters is that you can prove what you claim — every qualification on your profile is verified before the matching badge appears.",
  },
  {
    q: "How much can I earn?",
    a: "You set your own hourly rate. Most Ontario tutors charge between $45 and $85, with certified teachers and senior-course specialists at the higher end. You keep 85% of every completed lesson, and you can see exactly what you'll receive before you set a rate.",
  },
  {
    q: "How long does approval take?",
    a: "Usually within two business days of submitting a complete application. If something's missing we'll tell you specifically what, rather than rejecting it outright — most applications that need work are approved once the gap is filled.",
  },
  {
    q: "Do I have to commit to set hours?",
    a: "No. You publish whatever weekly availability suits you and change it whenever you like. You can block specific dates, take a holiday, or turn off new students entirely while keeping your existing ones.",
  },
  {
    q: "When do I get paid?",
    a: "Earnings become payable a few days after each completed lesson, then transfer to your connected bank account. Every lesson, the fee taken and your running total are visible in your earnings dashboard.",
  },
  {
    q: "What happens if a student cancels?",
    a: "If they cancel more than 24 hours ahead, they're refunded and you're not paid for that slot. Inside 24 hours, the late-cancellation portion is retained. If they simply don't show, the lesson isn't refunded to them.",
  },
  {
    q: "Can I teach online, in person, or both?",
    a: "Whichever you prefer. Online lessons get a Zoom, Google Meet or Teams link generated automatically. For in person, you set a travel radius and choose which kinds of locations you'll teach at.",
  },
  {
    q: "Is there a cost to join?",
    a: "No. There's no registration fee, no subscription and no charge for your profile. The only money that changes hands is the commission on lessons you actually teach.",
  },
];

export default async function BecomeATutorPage() {
  await connectToDatabase();
  const [settings, stats, user] = await Promise.all([
    getSettings(),
    marketplaceStats(),
    getCurrentUser(),
  ]);

  const tutorKeeps = 100 - settings.commissionPercent;
  const example = 6500;
  const exampleFee = Math.floor((example * settings.commissionPercent) / 100);

  // Send an existing tutor to their application rather than to registration.
  const ctaHref = user?.role === ROLES.TUTOR ? "/tutor/onboarding" : "/register?role=TUTOR";
  const ctaLabel = user?.role === ROLES.TUTOR ? "Continue my application" : "Start my application";

  return (
    <>
      <PageHero
        eyebrow="Become a tutor"
        title="Teach the courses you know, at the rate you set"
        description={`Keep ${tutorKeeps}% of every lesson. No joining fee, no subscription, and nothing taken when you're not teaching.`}
        tone="dark"
      >
        <div className="flex flex-wrap gap-3">
          <Button href={ctaHref} size="lg" variant="accent">
            {ctaLabel}
          </Button>
          <Button href="/pricing" size="lg" variant="ghost" className="text-white hover:bg-white/10">
            See how payouts work
          </Button>
        </div>
      </PageHero>

      <Section tone="muted">
        <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
          <div>
            <Reveal>
              <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">
                What you get
              </h2>
            </Reveal>

            <RevealGroup className="mt-6 grid gap-5 sm:grid-cols-2">
              {[
                {
                  icon: Wallet,
                  title: "You set the price",
                  body: "Choose your hourly rate, and a different rate for individual courses if you want. You see what you'll receive after our fee before you commit to it.",
                },
                {
                  icon: CalendarCheck,
                  title: "You control your calendar",
                  body: "Publish the hours that suit you. Block dates, take holidays, set a minimum booking notice and a gap between lessons. Nothing is ever booked outside what you've published.",
                },
                {
                  icon: BadgeCheck,
                  title: "Verification that means something",
                  body: "Badges families actually filter by — OCT membership, education, background checks. Verified profiles get noticeably more bookings.",
                },
                {
                  icon: Users,
                  title: "Students matched to you",
                  body: "Families search by course code, so you're found by people who need exactly what you teach. Post-a-request matching notifies you when a good fit appears.",
                },
                {
                  icon: ShieldCheck,
                  title: "The admin handled",
                  body: "Payment collection, receipts, cancellation policy, refunds and earnings reconciliation. You teach; we deal with the rest.",
                },
                {
                  icon: TrendingUp,
                  title: "A profile that compounds",
                  body: "Verified reviews from real lessons build up over time. Good tutors get rebooked, and rebooking rate feeds into how you rank.",
                },
              ].map((item) => (
                <RevealItem key={item.title}>
                  <Card className="h-full">
                    <CardBody>
                      <span className="flex size-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                        <item.icon className="size-5" />
                      </span>
                      <h3 className="mt-4 text-base font-bold text-ink-900">{item.title}</h3>
                      <p className="mt-2 text-sm leading-relaxed text-ink-500">{item.body}</p>
                    </CardBody>
                  </Card>
                </RevealItem>
              ))}
            </RevealGroup>
          </div>

          <Reveal delay={0.1}>
            <div className="space-y-6 lg:sticky lg:top-24">
              <Card className="border-accent-200">
                <CardBody>
                  <Badge tone="accent">Your earnings</Badge>
                  <p className="mt-4 text-sm text-ink-500">On a {formatMoney(example)} lesson</p>
                  <p className="mt-1 text-4xl font-extrabold tracking-tight text-success-700">
                    {formatMoney(example - exampleFee)}
                  </p>
                  <dl className="mt-4 space-y-2 border-t border-ink-100 pt-4 text-sm">
                    <div className="flex justify-between">
                      <dt className="text-ink-500">Family pays</dt>
                      <dd className="font-semibold text-ink-900">{formatMoney(example)}</dd>
                    </div>
                    <div className="flex justify-between">
                      <dt className="text-ink-500">
                        Platform fee ({settings.commissionPercent}%)
                      </dt>
                      <dd className="text-ink-500">− {formatMoney(exampleFee)}</dd>
                    </div>
                  </dl>
                  <p className="mt-4 text-xs leading-relaxed text-ink-500">
                    Charged only on completed lessons. Nothing on cancellations, nothing monthly.
                  </p>
                </CardBody>
              </Card>

              <Card>
                <CardBody>
                  <h3 className="text-sm font-bold text-ink-900">What you need to apply</h3>
                  <ul className="mt-4 space-y-3">
                    {[
                      "Government-issued photo ID",
                      "Proof of your qualifications",
                      "The provincial courses you teach",
                      "A few hours a week you can commit to",
                    ].map((item) => (
                      <li key={item} className="flex gap-2.5 text-sm text-ink-600">
                        <Check className="mt-0.5 size-4 shrink-0 text-success-600" />
                        {item}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-4 border-t border-ink-100 pt-4 text-xs leading-relaxed text-ink-500">
                    A Vulnerable Sector Check isn&rsquo;t required to start, but tutors who provide
                    one earn a badge families filter for.
                  </p>
                </CardBody>
              </Card>
            </div>
          </Reveal>
        </div>
      </Section>

      <Section
        eyebrow="The application"
        title="Eleven steps, saved as you go"
        description="Most tutors finish in under half an hour. You can stop at any point and come back — nothing is lost."
      >
        <Reveal>
          <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ONBOARDING_STEPS.map((step, index) => (
              <li
                key={step}
                className="flex gap-3 rounded-xl border border-ink-200 bg-white p-4"
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-xs font-bold text-ink-600">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-ink-900">
                    {ONBOARDING_STEP_META[step].title}
                  </p>
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-500">
                    {ONBOARDING_STEP_META[step].description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </Reveal>

        <Reveal className="mt-8">
          <Button href={ctaHref} size="lg" iconRight={<ArrowRight className="size-4" />}>
            {ctaLabel}
          </Button>
        </Reveal>
      </Section>

      <Section tone="dark">
        <Reveal className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            {formatNumber(stats.tutorCount)} tutors already teach here
          </h2>
          <p className="mt-4 text-base leading-relaxed text-brand-100/80">
            Across {formatNumber(stats.cityCount)} cities and {formatNumber(stats.subjectCount)}{" "}
            subjects. Applications are reviewed within two business days.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button href={ctaHref} size="lg" variant="accent">
              {ctaLabel}
            </Button>
            <Button
              href="/verification"
              size="lg"
              variant="ghost"
              className="text-white hover:bg-white/10"
            >
              How verification works
            </Button>
          </div>
        </Reveal>
      </Section>

      <Faq faqs={TUTOR_FAQS} title="Tutor questions" showAllLink={false} />
    </>
  );
}
