import { ShieldCheck, UserCheck, School, GraduationCap, FileCheck, ArrowRight } from "lucide-react";
import { Badge, Button, Card, CardBody, Reveal } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { StepCards } from "@/components/home/StepCards";
import { Section, Faq } from "@/components/home/Sections";
import { VERIFICATION_TYPES, VERIFICATION_LABELS, VERIFICATION_DESCRIPTIONS } from "@/constants";

export const metadata = {
  title: "Tutor verification",
  description:
    "How APlus Learn verifies tutors: identity checks, Ontario College of Teachers membership, education, university enrolment and Vulnerable Sector Checks.",
  alternates: { canonical: "/verification" },
};

const BADGE_DETAIL = {
  [VERIFICATION_TYPES.IDENTITY]: {
    icon: UserCheck,
    what: "Government-issued photo ID matched against the name on the account.",
    why: "It means the person teaching your child is who their profile says they are.",
    required: true,
  },
  [VERIFICATION_TYPES.OCT]: {
    icon: School,
    what: "Registration number checked against the Ontario College of Teachers public register.",
    why: "OCT members are certified Ontario teachers, subject to professional standards and discipline.",
  },
  [VERIFICATION_TYPES.EDUCATION]: {
    icon: GraduationCap,
    what: "Degrees and diplomas confirmed against transcripts or official confirmation letters.",
    why: "A tutor claiming a mathematics degree has actually been asked to prove it.",
  },
  [VERIFICATION_TYPES.UNIVERSITY_STUDENT]: {
    icon: GraduationCap,
    what: "Current enrolment confirmed through an institutional email or enrolment letter.",
    why: "Current students are often excellent tutors for recent courses — this confirms they are one.",
  },
  [VERIFICATION_TYPES.BACKGROUND_CHECK]: {
    icon: FileCheck,
    what: "A Vulnerable Sector Check reviewed by our team and dated within the last 12 months.",
    why: "The standard schools and community organisations use for people working with children.",
  },
};

const APPROVAL_STEPS = [
  {
    art: "apply",
    title: "They apply",
    body: "Qualifications, the exact courses they teach, their rate and availability — plus documents for the badges they're applying for.",
  },
  {
    art: "verify",
    title: "We check the documents",
    body: "A real person opens each one. OCT numbers are checked against the public register; degrees against transcripts.",
  },
  {
    art: "decide",
    title: "We decide",
    body: "Approve, reject, or ask for more. Badges are granted individually — approval doesn't mean every badge.",
  },
  {
    art: "live",
    title: "The profile goes live",
    body: "Only then does the tutor appear in search, showing exactly the badges they earned.",
  },
];

const VERIFICATION_FAQS = [
  {
    q: "Can a tutor appear in search before being verified?",
    a: "No. A tutor profile stays completely invisible until our team has reviewed the application and approved it. There is no way to pay to skip the queue or appear early.",
  },
  {
    q: "Does every tutor have every badge?",
    a: "No, and that's deliberate. Identity verification is required of everyone. The others are earned individually — a university student won't have an OCT badge, and a certified teacher may not have provided a background check. Each profile shows exactly which badges that tutor holds.",
  },
  {
    q: "What does a background check actually cover?",
    a: "A Vulnerable Sector Check is a police record check that includes a search for pardoned sexual offences. It's the level of check schools and community organisations require for people working with children. We review the document and confirm it's dated within the last 12 months.",
  },
  {
    q: "Do badges expire?",
    a: "Background checks and OCT memberships do. When one lapses we remove the badge from the profile and ask the tutor to supply a current document. Families filtering for that badge stop seeing that tutor until it's renewed.",
  },
  {
    q: "What if I'm concerned about a tutor?",
    a: "Report them from their profile or from any conversation, and our team reviews it. We can suspend a profile from search immediately while we investigate. Safety concerns take priority over everything else in our queue.",
  },
  {
    q: "Are documents I upload kept private?",
    a: "Yes. Verification documents are stored privately and can only be opened by our verification team through an audited internal route. They are never shown on your profile, never shared with families, and are deleted once a badge expires or is withdrawn.",
  },
];

export default function VerificationPage() {
  return (
    <>
      <PageHero
        eyebrow="Tutor verification"
        title="Five checks, each one earned separately"
        description="A tutor doesn't get a general seal of approval. Each badge means our team verified one specific thing, and you can see exactly which ones a tutor holds before you book."
        tone="dark"
      >
        <Button href="/find-a-tutor" size="lg" variant="accent">
          Browse verified tutors
        </Button>
      </PageHero>

      <Section
        eyebrow="The badges"
        title="What each one actually means"
        tone="muted"
      >
        <div className="space-y-5">
          {Object.values(VERIFICATION_TYPES).map((type, index) => {
            const detail = BADGE_DETAIL[type];
            const Icon = detail.icon;

            return (
              <Reveal key={type} delay={index * 0.04}>
                <Card>
                  <CardBody className="flex flex-col gap-5 sm:flex-row">
                    <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-success-50 text-success-700">
                      <Icon className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-base font-bold text-ink-900">
                          {VERIFICATION_LABELS[type]}
                        </h2>
                        {detail.required && (
                          <Badge tone="brand" size="sm">
                            Required of every tutor
                          </Badge>
                        )}
                      </div>
                      <dl className="mt-3 grid gap-4 sm:grid-cols-2">
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-ink-400">
                            What we check
                          </dt>
                          <dd className="mt-1 text-sm leading-relaxed text-ink-600">
                            {detail.what}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-bold uppercase tracking-wide text-ink-400">
                            Why it matters
                          </dt>
                          <dd className="mt-1 text-sm leading-relaxed text-ink-600">
                            {detail.why}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </CardBody>
                </Card>
              </Reveal>
            );
          })}
        </div>
      </Section>

      <Section
        eyebrow="Every tutor, every time"
        title="How a tutor gets approved"
        description="Four steps between an application and a profile a family can book. A person reads every document — nothing here is automatic, and nothing can be skipped."
      >
        <StepCards steps={APPROVAL_STEPS} />

        <Reveal className="mt-10">
          <Card className="border-brand-200 bg-brand-50/50">
            <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h3 className="flex items-center gap-2 text-base font-bold text-brand-900">
                  <ShieldCheck className="size-5" />
                  Unapproved tutors never appear in search
                </h3>
                <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-brand-800/80">
                  This is enforced in the platform itself, not by policy alone — a profile is
                  structurally excluded from every search query until an administrator approves it.
                </p>
              </div>
              <Button href="/safety" variant="secondary" className="shrink-0">
                Read about safety
              </Button>
            </CardBody>
          </Card>
        </Reveal>
      </Section>

      <Faq faqs={VERIFICATION_FAQS} title="Verification questions" showAllLink={false} />
    </>
  );
}
