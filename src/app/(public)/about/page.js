import { Target, Users, MapPin, ShieldCheck, ArrowRight } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { marketplaceStats } from "@/services/search.service";
import { Button, Card, CardBody, Reveal, RevealGroup, RevealItem } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section } from "@/components/home/Sections";
import { Prose } from "@/components/marketing/PageHero";
import { formatNumber } from "@/lib/utils/format";
import { getAppConfig } from "@/services/settings.service";

export const metadata = {
  title: "About us",
  description:
    "Why APlus Learn exists: a Canadian tutoring marketplace built around actual provincial curriculum, with tutors verified before they appear.",
  alternates: { canonical: "/about" },
};

export const revalidate = 3600;

export default async function AboutPage() {
  await connectToDatabase();
  const [stats, { contact }] = await Promise.all([marketplaceStats(), getAppConfig()]);

  return (
    <>
      <PageHero
        eyebrow="About us"
        title="Tutoring matched to the actual course, not a vague subject"
        description="APlus Learn is a Canadian marketplace built on one observation: a parent looking for help with MHF4U doesn't want a “math tutor”. They want someone who has taught that course."
      />

      <Section tone="muted">
        <div className="grid gap-10 lg:grid-cols-[1.4fr_1fr]">
          <Reveal>
            <Prose>
              <h2>Why we built this</h2>
              <p>
                Finding a tutor in Canada usually means one of three things: an agency that charges
                a large mark-up and won&rsquo;t tell you who you&rsquo;re getting until you&rsquo;ve
                paid; a classifieds listing with no verification at all; or a word-of-mouth
                recommendation that may or may not match the course your child is actually taking.
              </p>
              <p>
                None of those start from the right question. Ontario&rsquo;s secondary curriculum
                uses course codes for a reason — MHF4U is a specific set of expectations, assessed a
                specific way. A tutor who has taught it knows which unit trips students up and what
                the culminating task demands. A generalist doesn&rsquo;t.
              </p>
              <p>
                So we built search around the curriculum itself. You search the course code on the
                report card, and you see tutors who teach that course, with their credentials
                already checked.
              </p>

              <h2>What we&rsquo;re strict about</h2>
              <p>
                <strong>Verification comes before visibility.</strong> A tutor profile is invisible
                until a person on our team has reviewed the application. That&rsquo;s enforced in the
                platform, not just in policy — an unapproved profile is structurally excluded from
                every search.
              </p>
              <p>
                <strong>Badges mean one specific thing each.</strong> We don&rsquo;t issue a general
                trust score. Identity, OCT membership, education, university enrolment and
                background checks are verified separately, and a profile shows exactly which ones
                that tutor earned.
              </p>
              <p>
                <strong>Reviews require a completed lesson.</strong> There is no way to leave a
                review without having booked and completed a lesson through the platform, and no way
                to buy one.
              </p>
              <p>
                <strong>The price you see is the price you pay.</strong> Our commission comes out of
                the tutor&rsquo;s side and is shown to them before they set a rate. There are no
                booking fees, service charges or minimum packages.
              </p>

              <h2>Where we are</h2>
              <p>
                Ontario is fully supported today, including the complete secondary course-code
                curriculum from Grade 9 through Grade 12 plus elementary subjects. The platform was
                built so additional provinces can be added without changing how search, booking or
                verification work — we&rsquo;re expanding based on where demand actually comes from
                rather than planting a flag everywhere at once.
              </p>

              <h2>How tutors fit in</h2>
              <p>
                Tutors on APlus Learn are independent — they set their own rates, keep their own
                calendars and decide which courses they teach. We handle the parts that are tedious
                and easy to get wrong: collecting payment, applying a consistent cancellation
                policy, reconciling earnings and paying out. That&rsquo;s what the commission is for.
              </p>
            </Prose>
          </Reveal>

          <Reveal delay={0.1}>
            <div className="space-y-6 lg:sticky lg:top-24">
              <Card>
                <CardBody>
                  <h3 className="text-sm font-bold text-ink-900">The marketplace today</h3>
                  <dl className="mt-4 space-y-4">
                    {[
                      {
                        icon: ShieldCheck,
                        value: formatNumber(stats.tutorCount),
                        label: "Verified tutors in search",
                      },
                      {
                        icon: MapPin,
                        value: formatNumber(stats.cityCount),
                        label: "Cities with tutors available",
                      },
                      {
                        icon: Target,
                        value: formatNumber(stats.subjectCount),
                        label: "Subjects covered",
                      },
                    ].map((item) => (
                      <div key={item.label} className="flex gap-3">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                          <item.icon className="size-4" />
                        </span>
                        <div>
                          <dt className="text-xl font-extrabold text-ink-900 tabular-nums">
                            {item.value}
                          </dt>
                          <dd className="text-xs text-ink-500">{item.label}</dd>
                        </div>
                      </div>
                    ))}
                  </dl>
                </CardBody>
              </Card>

              <Card className="border-brand-200 bg-brand-50/50">
                <CardBody>
                  <h3 className="text-sm font-bold text-brand-900">Get in touch</h3>
                  <p className="mt-2 text-sm leading-relaxed text-brand-800/80">
                    Questions about the platform, a partnership, or something that went wrong?
                  </p>
                  <div className="mt-4 space-y-1 text-sm">
                    <a
                      href={`mailto:${contact.supportEmail}`}
                      className="block font-semibold text-brand-700 hover:underline"
                    >
                      {contact.supportEmail}
                    </a>
                    <a
                      href={`tel:${contact.supportPhone}`}
                      className="block text-brand-700/80 hover:underline"
                    >
                      {contact.supportPhone}
                    </a>
                  </div>
                </CardBody>
              </Card>
            </div>
          </Reveal>
        </div>
      </Section>

      <Section
        eyebrow="Get started"
        title="Whichever side you're on"
      >
        <RevealGroup className="grid gap-6 md:grid-cols-2">
          <RevealItem>
            <Card className="h-full">
              <CardBody>
                <span className="flex size-11 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                  <Users className="size-5" />
                </span>
                <h3 className="mt-4 text-lg font-bold text-ink-900">Looking for a tutor</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">
                  Search by course code, compare verified tutors and book a time that works. No
                  account needed to look.
                </p>
                <Button
                  href="/find-a-tutor"
                  className="mt-5"
                  iconRight={<ArrowRight className="size-4" />}
                >
                  Find a tutor
                </Button>
              </CardBody>
            </Card>
          </RevealItem>

          <RevealItem>
            <Card className="h-full">
              <CardBody>
                <span className="flex size-11 items-center justify-center rounded-xl bg-accent-100 text-accent-700">
                  <Target className="size-5" />
                </span>
                <h3 className="mt-4 text-lg font-bold text-ink-900">Want to tutor</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">
                  Set your own rate and availability, teach the courses you know, and let us handle
                  payments and scheduling.
                </p>
                <Button
                  href="/become-a-tutor"
                  variant="accent"
                  className="mt-5"
                  iconRight={<ArrowRight className="size-4" />}
                >
                  Apply to tutor
                </Button>
              </CardBody>
            </Card>
          </RevealItem>
        </RevealGroup>
      </Section>
    </>
  );
}
