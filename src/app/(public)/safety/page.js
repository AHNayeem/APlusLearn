import {
  ShieldCheck, Lock, EyeOff, Flag, MessageSquare, UserCheck, ArrowRight, Video,
} from "lucide-react";
import { Button, Card, CardBody, Reveal, RevealGroup, RevealItem } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section, Faq } from "@/components/home/Sections";
import { SITE } from "@/constants";

export const metadata = {
  title: "Safety",
  description:
    "How APlus Learn keeps students safe: verified tutors, protected personal information, in-platform messaging, and a team that acts on reports.",
  alternates: { canonical: "/safety" },
};

const SAFETY_FAQS = [
  {
    q: "What information can a tutor see about my child?",
    a: "A first name and last initial, their grade, the course being taught, and anything you choose to write in the notes. Full surnames are hidden by default — you can share one if you want to, but nothing requires it. Your address is only released for an in-person lesson you booked, and only once it's confirmed.",
  },
  {
    q: "Should I stay in the platform's messaging?",
    a: "Yes. Messages sent through APlus Learn are retained, which means if something goes wrong there's a record our team can review. Moving to personal email or text removes that protection, and we can't help with what we can't see.",
  },
  {
    q: "What should a first in-person lesson look like?",
    a: "Somewhere public or with an adult present — a library, a kitchen table with someone home. Most families do the first session or two this way regardless of the tutor's badges, and good tutors expect it.",
  },
  {
    q: "How do I report a concern?",
    a: "Every tutor profile and every conversation has a report option, and any lesson can be disputed from its page. Reports go straight to our team. We can suspend a profile from search immediately while we investigate.",
  },
  {
    q: "What happens to a tutor who breaks the rules?",
    a: "Depending on what happened: a warning, removal of a badge, suspension from search, or permanent removal. Repeated cancellations and no-shows are tracked automatically and flagged for review.",
  },
];

export default function SafetyPage() {
  return (
    <>
      <PageHero
        eyebrow="Safety"
        title="What we do, and what you should do"
        description="Verification is the part we can control. Here's how it works, what we protect, and the handful of habits that make tutoring safer for your child."
        tone="dark"
      />

      <Section eyebrow="What we do" title="Safety built into the platform" tone="muted">
        <RevealGroup className="grid gap-6 md:grid-cols-2">
          {[
            {
              icon: UserCheck,
              title: "Nobody appears unverified",
              body: "Every tutor's identity is checked before their profile is visible. Optional badges — OCT membership, education, background checks — are each verified separately and shown individually so you can see exactly what was confirmed.",
            },
            {
              icon: EyeOff,
              title: "Personal details stay private",
              body: "Public pages show a tutor's first name, last initial and city — never a surname or street address. The same protection runs the other way: tutors see your child's first name and initial unless you choose otherwise.",
            },
            {
              icon: MessageSquare,
              title: "Messaging stays on the platform",
              body: "Conversations are retained so there's a record if something goes wrong. You can block or report anyone from inside a thread, and our team can review the history.",
            },
            {
              icon: Lock,
              title: "Payments are held, not forwarded",
              body: "Money sits with us until a lesson is complete. That's what lets us refund you quickly when a tutor doesn't show, rather than trying to recover funds after the fact.",
            },
            {
              icon: Flag,
              title: "Reports reach a person",
              body: "Every report is reviewed by our team, not an automated filter. We can suspend a profile from search immediately while we investigate.",
            },
            {
              icon: Video,
              title: "Online lessons are linked, not open",
              body: "Meeting links are generated per lesson and appear only in the dashboards of the two people attending — they aren't published anywhere.",
            },
          ].map((item) => (
            <RevealItem key={item.title}>
              <Card className="h-full">
                <CardBody className="flex gap-4">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                    <item.icon className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-base font-bold text-ink-900">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-500">{item.body}</p>
                  </div>
                </CardBody>
              </Card>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <Section
        eyebrow="What you can do"
        title="Sensible habits, whoever you book"
        description="None of this is a substitute for verification — it's what careful families do anyway."
      >
        <RevealGroup className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "Message before you book",
              body: "A short conversation tells you a lot. Ask how they'd approach your child's specific problem — not just whether they teach the course.",
            },
            {
              title: "Start somewhere public",
              body: "For in-person lessons, a library or a room where someone else is home. Good tutors expect this and won't find it odd.",
            },
            {
              title: "Sit in on the first lesson",
              body: "Or stay within earshot. You'll learn more about whether it's working in twenty minutes than from any profile.",
            },
            {
              title: "Read the reviews properly",
              body: "Every review is tied to a real completed lesson. A thoughtful four-star review often tells you more than a five-star one.",
            },
            {
              title: "Keep it on the platform",
              body: "Messages, bookings and payments through APlus Learn are protected. Off-platform arrangements aren't, and we can't help with them.",
            },
            {
              title: "Say something early",
              body: "If a lesson felt off, report it. You don't need proof of anything — patterns across several reports are often how problems surface.",
            },
          ].map((item) => (
            <RevealItem key={item.title}>
              <Card className="h-full">
                <CardBody>
                  <h3 className="text-sm font-bold text-ink-900">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-500">{item.body}</p>
                </CardBody>
              </Card>
            </RevealItem>
          ))}
        </RevealGroup>
      </Section>

      <Section tone="muted">
        <Reveal>
          <Card className="border-danger-200 bg-danger-50/50">
            <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="flex items-center gap-2 text-lg font-bold text-ink-900">
                  <ShieldCheck className="size-5 text-danger-600" />
                  Something feels wrong?
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-600">
                  Report it from the profile, the conversation or the lesson page — or email us
                  directly. If a child is in immediate danger, call 911 first, then tell us.
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button href="/support">Contact support</Button>
                <Button href={`mailto:${SITE.supportEmail}`} variant="secondary">
                  {SITE.supportEmail}
                </Button>
              </div>
            </CardBody>
          </Card>
        </Reveal>
      </Section>

      <Faq faqs={SAFETY_FAQS} title="Safety questions" showAllLink={false} />
    </>
  );
}
