import Link from "next/link";
import * as Icons from "lucide-react";
import {
  ShieldCheck, Video, MapPin, Wallet, Clock, BadgeCheck, ArrowRight, Check, Quote,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Badge, Button, Card, Rating, Reveal, RevealGroup, RevealItem } from "@/components/ui";
import { StepCards } from "@/components/home/StepCards";
import { StepArt } from "@/components/home/StepArt";
import { formatRate, formatNumber } from "@/lib/utils/format";
import { VERIFICATION_LABELS, VERIFICATION_DESCRIPTIONS, VERIFICATION_TYPES } from "@/constants";

/**
 * The wave that opens every marketing section (§30). Small, warm and the only
 * ornament the section header carries — it marks the start of a chapter
 * without competing with the heading under it.
 */
export function SectionWave({ className }) {
  return (
    <svg
      viewBox="0 0 64 18"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={cn("h-[0.9rem] w-16", className)}
    >
      <path
        d="M4 11c4.6-8.5 9.2-8.5 13.8 0s9.2 8.5 13.8 0 9.2-8.5 13.8 0 9.2 8.5 13.8 0"
        stroke="currentColor"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Shared section scaffolding so spacing and headings never drift (§30).
 *
 * The header is centred by default — wave, eyebrow, heading, one line of
 * supporting copy — and any `action` sits centred *below* the content, because
 * a button pinned to the right of a centred heading reads as a mistake. Pass
 * `align="start"` for the few layouts that genuinely need a left-hung header.
 */
export function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
  tone = "default",
  action,
  align = "center",
  ornament = true,
}) {
  const dark = tone === "dark";
  const centered = align === "center";

  const header = (eyebrow || title) && (
    <Reveal className={cn("mb-10 lg:mb-14", centered && "text-center")}>
      <div
        className={cn(
          centered ? "mx-auto flex max-w-3xl flex-col items-center" : "flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between",
        )}
      >
        <div className={cn(centered ? "w-full" : "max-w-2xl")}>
          {centered && ornament && (
            <SectionWave className={cn("mx-auto", dark ? "text-accent-400" : "text-accent-500")} />
          )}
          {eyebrow && (
            <p
              className={cn(
                centered
                  ? "mt-4 text-base font-semibold"
                  : "text-xs font-bold uppercase tracking-[0.12em]",
                dark
                  ? centered ? "text-brand-200" : "text-brand-300"
                  : centered ? "text-ink-500" : "text-brand-600",
              )}
            >
              {eyebrow}
            </p>
          )}
          {title && (
            <h2
              className={cn(
                "mt-2 font-extrabold tracking-tight",
                centered ? "text-[1.85rem] leading-[1.15] sm:text-4xl lg:text-[2.6rem]" : "text-3xl sm:text-4xl",
                dark ? "text-white" : "text-ink-900",
              )}
            >
              {title}
            </h2>
          )}
          {description && (
            <p
              className={cn(
                "text-base leading-relaxed",
                centered ? "mx-auto mt-4 max-w-2xl" : "mt-3",
                dark ? "text-brand-100/80" : "text-ink-500",
              )}
            >
              {description}
            </p>
          )}
        </div>
        {action && !centered && <div className="shrink-0">{action}</div>}
      </div>
    </Reveal>
  );

  return (
    <section
      id={id}
      className={cn(
        "py-16 lg:py-24",
        tone === "muted" && "bg-white",
        dark && "bg-ink-900",
        className,
      )}
    >
      <div className="container-page">
        {header}
        {children}
        {action && centered && (
          <Reveal className="mt-10 flex justify-center lg:mt-12">{action}</Reveal>
        )}
      </div>
    </section>
  );
}

// --- How it works (§12) ----------------------------------------------------

const STEPS = [
  {
    art: "search",
    title: "Search your exact course",
    body: "Filter by province, grade and course code — MHF4U, not just “math”. Add your postal code if you want someone who can come to you.",
  },
  {
    art: "message",
    title: "Compare and message free",
    body: "Read verified reviews from families who actually booked. Ask a tutor about their approach before you spend anything.",
  },
  {
    art: "calendar",
    title: "Book a time that works",
    body: "Pick a slot from the tutor's real calendar. Pay securely; your money is held until the lesson is done.",
  },
  {
    art: "progress",
    title: "Track progress, rebook easily",
    body: "See every lesson, receipt and review in one place. Rebook your tutor in two taps when it's working.",
  },
];

export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      eyebrow="Making tutoring simple for every family"
      title="From “we need help with MCV4U” to a booked lesson"
      description="Four steps, no phone calls, and no agency mark-up you can't see — you can do the first two without even making an account."
      action={
        <Button href="/find-a-tutor" size="lg" iconRight={<ArrowRight className="size-4" />}>
          Start with your course code
        </Button>
      }
    >
      <StepCards steps={STEPS} columns={4} />
    </Section>
  );
}

// --- Popular subjects (§12) ------------------------------------------------

export function PopularSubjects({ subjects = [] }) {
  if (!subjects.length) return null;

  return (
    <Section
      eyebrow="Popular subjects"
      title="Help with the subjects families ask for most"
      tone="muted"
      action={
        <Button href="/courses" variant="secondary" iconRight={<ArrowRight className="size-4" />}>
          Browse all courses
        </Button>
      }
    >
      <RevealGroup className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {subjects.map((subject) => {
          const Icon = Icons[subject.icon] ?? Icons.BookOpen;
          return (
            <RevealItem key={subject.id}>
              <Link
                href={`/find-a-tutor?subject=${subject.slug}`}
                className="group flex h-full flex-col rounded-2xl border border-ink-200 bg-canvas p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg motion-reduce:hover:translate-y-0"
              >
                <span
                  className={cn(
                    "flex size-11 items-center justify-center rounded-xl transition-colors",
                    toneClasses(subject.colorKey),
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <h3 className="mt-4 text-sm font-bold text-ink-900 group-hover:text-brand-700">
                  {subject.name}
                </h3>
                {subject.description && (
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-500">
                    {subject.description}
                  </p>
                )}
                <span className="mt-auto pt-4 text-xs font-semibold text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">
                  Find tutors →
                </span>
              </Link>
            </RevealItem>
          );
        })}
      </RevealGroup>
    </Section>
  );
}

function toneClasses(key) {
  return (
    {
      brand: "bg-brand-100 text-brand-600",
      accent: "bg-accent-100 text-accent-700",
      success: "bg-success-100 text-success-700",
      warning: "bg-warning-100 text-warning-700",
      info: "bg-info-100 text-info-600",
      ink: "bg-ink-200 text-ink-700",
    }[key] ?? "bg-brand-100 text-brand-600"
  );
}

// --- Popular Ontario courses (§12) -----------------------------------------

export function PopularCourses({ courses = [] }) {
  if (!courses.length) return null;

  return (
    <Section
      eyebrow="Popular Ontario courses"
      title="Search by course code, the way report cards do"
      description="Ontario course codes map to exactly one curriculum. Searching MHF4U finds tutors who have taught that course — not just “senior math”."
      tone="muted"
      action={
        <Button href="/courses" variant="secondary" iconRight={<ArrowRight className="size-4" />}>
          All Ontario courses
        </Button>
      }
    >
      <RevealGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => (
          <RevealItem key={course.id}>
            <Link
              href={`/find-a-tutor?courseCode=${course.code}&province=ON`}
              className="group flex h-full items-start gap-4 rounded-2xl border border-ink-200 bg-canvas p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-lg motion-reduce:hover:translate-y-0"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-[11px] font-black tracking-tight text-white">
                {course.code ?? "ON"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink-900 group-hover:text-brand-700">
                  {course.name}
                </span>
                <span className="mt-0.5 block text-xs text-ink-500">
                  Grade {course.gradeLevel} · {course.stream}
                </span>
                {course.tutorCount > 0 && (
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-success-700">
                    <span className="size-1.5 rounded-full bg-success-500" />
                    {course.tutorCount} {course.tutorCount === 1 ? "tutor" : "tutors"} available
                  </span>
                )}
              </span>
            </Link>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

// --- Find tutors by grade (§12) --------------------------------------------

export function TutorsByGrade({ grades = [] }) {
  if (!grades.length) return null;

  const groups = [
    { label: "Elementary", stage: "ELEMENTARY", hint: "Kindergarten to Grade 6" },
    { label: "Intermediate", stage: "MIDDLE", hint: "Grades 7 and 8" },
    { label: "Secondary", stage: "SECONDARY", hint: "Grades 9 to 12" },
  ];

  return (
    <Section
      eyebrow="Find tutors by grade"
      title="Support that matches where your child actually is"
      description="A Grade 4 reading gap and a Grade 12 calculus gap need very different tutors. Start from the grade."
    >
      <div className="grid gap-6 lg:grid-cols-3">
        {groups.map((group) => {
          const inGroup = grades.filter((g) => g.stage === group.stage);
          if (!inGroup.length) return null;

          return (
            <Reveal key={group.stage}>
              <Card className="h-full p-6">
                <h3 className="text-base font-bold text-ink-900">{group.label}</h3>
                <p className="mt-1 text-sm text-ink-500">{group.hint}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  {inGroup.map((grade) => (
                    <Link
                      key={grade.id}
                      href={`/find-a-tutor?grade=${grade.slug}&province=ON`}
                      className="rounded-lg bg-ink-100 px-3 py-1.5 text-xs font-semibold text-ink-700 transition-colors hover:bg-brand-100 hover:text-brand-700"
                    >
                      {grade.name}
                    </Link>
                  ))}
                </div>
              </Card>
            </Reveal>
          );
        })}
      </div>
    </Section>
  );
}

// --- Why choose APlus Learn (§12) ------------------------------------------

const REASONS = [
  {
    icon: BadgeCheck,
    title: "Verified before they're visible",
    body: "Every tutor's ID is checked and their credentials confirmed before their profile appears in search. Teaching certificates are verified against the Ontario College of Teachers register.",
  },
  {
    icon: Wallet,
    title: "One transparent price",
    body: "The hourly rate you see is what you pay. Our commission comes out of the tutor's side, and it's shown to them plainly. No registration fees, no minimum packages.",
  },
  {
    icon: ShieldCheck,
    title: "Your money is protected",
    body: "Payment is held until the lesson is complete. Free cancellation up to 24 hours before, and a full refund if a tutor doesn't show.",
  },
  {
    icon: Clock,
    title: "Real availability, not phone tag",
    body: "Tutors keep their calendars current. You book a slot that's genuinely free — no waiting two days to find out they're busy.",
  },
];

export function WhyChoose() {
  return (
    <Section
      eyebrow="Why APlus Learn"
      title="Built for parents who've been burned by tutoring before"
      tone="muted"
    >
      <RevealGroup className="grid gap-6 md:grid-cols-2">
        {REASONS.map((reason) => (
          <RevealItem key={reason.title}>
            <div className="flex h-full gap-4 rounded-2xl border border-ink-200 bg-canvas p-6">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-600">
                <reason.icon className="size-5" />
              </span>
              <div className="min-w-0">
                <h3 className="text-base font-bold text-ink-900">{reason.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-500">{reason.body}</p>
              </div>
            </div>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

// --- Verification (§12, §16) -----------------------------------------------

export function VerificationSection() {
  const badges = Object.values(VERIFICATION_TYPES);

  return (
    <Section
      eyebrow="Tutor verification"
      title="Five checks, each one earned separately"
      description="A tutor doesn't get a general seal of approval. Each badge means one specific thing was verified by our team, and you can see exactly which ones a tutor holds."
      action={
        <Button href="/verification" variant="secondary" iconRight={<ArrowRight className="size-4" />}>
          How verification works
        </Button>
      }
    >
      <RevealGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {badges.map((type) => (
          <RevealItem key={type}>
            <div className="h-full rounded-2xl border border-ink-200 bg-white p-5">
              <Badge tone="success" icon={<BadgeCheck className="size-3.5" />}>
                {VERIFICATION_LABELS[type]}
              </Badge>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">
                {VERIFICATION_DESCRIPTIONS[type]}
              </p>
            </div>
          </RevealItem>
        ))}
        <RevealItem>
          <div className="flex h-full flex-col justify-center rounded-2xl border border-dashed border-brand-300 bg-brand-50/50 p-5">
            <p className="text-sm font-bold text-brand-800">
              Unapproved tutors never appear in search
            </p>
            <p className="mt-2 text-sm leading-relaxed text-brand-700/80">
              A profile stays invisible until our team has reviewed it. There is no way to skip the
              queue by paying.
            </p>
          </div>
        </RevealItem>
      </RevealGroup>
    </Section>
  );
}

// --- Online vs in person (§12, §27) ----------------------------------------

/**
 * The two modes share everything except the place, so the page says it that
 * way: a matched pair of cards for what differs, and one strip underneath for
 * what doesn't — rather than the same four reassurances printed twice.
 */
const LESSON_MODES = [
  {
    art: "online",
    label: "Online",
    icon: Video,
    title: "Online lessons",
    body:
      "Zoom, Google Meet or Microsoft Teams — the link is generated when you book and sits on the lesson in your dashboard.",
    points: [
      "No travel time, so evening slots actually work",
      "Access to tutors anywhere in the province",
      "Screen sharing makes worked solutions easy to follow",
      "Often a few dollars an hour cheaper",
    ],
    footnote: "Nothing to install for the student — the link opens in a browser.",
    stage: "bg-brand-50",
    pill: "bg-brand-600",
    ring: "bg-brand-100",
    tick: "text-brand-600",
  },
  {
    art: "inperson",
    label: "In person",
    icon: MapPin,
    title: "In-person lessons",
    body:
      "At your home, a public library, or another agreed location. Distance search shows approximately how far away each tutor is.",
    points: [
      "Easier for younger students to stay focused",
      "Better for hands-on subjects and paper-based practice",
      "Tutors set their own travel radius, so no long-distance surprises",
      "Exact addresses are only shared once a lesson is confirmed",
    ],
    footnote: "Search by postal code to see who is genuinely nearby.",
    stage: "bg-accent-50",
    pill: "bg-accent-500",
    ring: "bg-accent-100",
    tick: "text-accent-600",
  },
];

const LESSON_CONSTANTS = [
  { icon: ShieldCheck, text: "The same verified tutors, either way" },
  { icon: Wallet, text: "Payment held until the lesson is done" },
  { icon: Clock, text: "Same free cancellation window" },
];

export function LessonModes() {
  return (
    <Section
      eyebrow="Online or in person"
      title="Whichever actually fits your week"
      description="Same tutors, same protected payment, same booking. The only thing that changes is where the lesson happens — and you can switch between the two whenever you like."
      tone="muted"
    >
      <div className="grid gap-6 lg:grid-cols-2">
        {LESSON_MODES.map((mode, index) => {
          const ModeIcon = mode.icon;

          return (
            <Reveal key={mode.label} delay={index * 0.08}>
              <article
                className={cn(
                  "group flex h-full flex-col overflow-hidden rounded-2xl border border-ink-200/80 bg-white",
                  "shadow-sm transition duration-300 ease-out",
                  "hover:-translate-y-1.5 hover:border-brand-200 hover:shadow-xl",
                  "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                )}
              >
                <div className={cn("px-6 pt-7 sm:pt-8", mode.stage)}>
                  <StepArt
                    name={mode.art}
                    className="mx-auto max-w-[21rem] transition-transform duration-500 ease-out group-hover:-translate-y-1 motion-reduce:group-hover:translate-y-0"
                  />
                </div>

                <div className="flex flex-1 flex-col p-6 text-center sm:p-7">
                  <span
                    className={cn(
                      "mx-auto inline-flex items-center gap-1.5 rounded-md px-3 py-1.5",
                      "text-[11px] font-extrabold uppercase tracking-[0.16em] text-white shadow-xs",
                      mode.pill,
                    )}
                  >
                    <ModeIcon className="size-3.5" aria-hidden="true" />
                    {mode.label}
                  </span>

                  <h3 className="mt-5 text-xl font-bold tracking-tight text-ink-900">
                    {mode.title}
                  </h3>
                  <p className="mt-3 text-sm leading-relaxed text-ink-500">{mode.body}</p>

                  <ul className="mt-6 space-y-3 border-t border-ink-100 pt-6 text-left">
                    {mode.points.map((point) => (
                      <li key={point} className="flex gap-3 text-sm leading-relaxed text-ink-600">
                        <span
                          className={cn(
                            "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full",
                            mode.ring,
                          )}
                        >
                          <Check
                            className={cn("size-3", mode.tick)}
                            strokeWidth={3.2}
                            aria-hidden="true"
                          />
                        </span>
                        {point}
                      </li>
                    ))}
                  </ul>

                  <p className="mt-auto pt-6 text-xs leading-relaxed text-ink-400">
                    {mode.footnote}
                  </p>
                </div>
              </article>
            </Reveal>
          );
        })}
      </div>

      <Reveal delay={0.16} className="mt-6">
        <ul className="grid gap-4 rounded-2xl border border-ink-200/80 bg-canvas p-6 sm:grid-cols-3">
          {LESSON_CONSTANTS.map(({ icon: ConstantIcon, text }) => (
            <li key={text} className="flex items-center gap-3 text-sm font-semibold text-ink-700">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-600 shadow-xs">
                <ConstantIcon className="size-4" aria-hidden="true" />
              </span>
              {text}
            </li>
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}

// --- Testimonials (§12) ----------------------------------------------------

export function Testimonials({ reviews = [] }) {
  if (!reviews.length) return null;

  return (
    <Section
      eyebrow="From families"
      title="Reviews you can trust, because they're tied to real lessons"
      description="Only a family who booked and completed a lesson can leave a review. There is no way to buy one."
    >
      <RevealGroup className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {reviews.slice(0, 6).map((review) => (
          <RevealItem key={review.id}>
            <figure className="flex h-full flex-col rounded-2xl border border-ink-200 bg-white p-6">
              <Quote className="size-6 text-brand-200" aria-hidden="true" />
              <Rating value={review.rating} showValue={false} className="mt-3" />
              {review.title && (
                <figcaption className="mt-3 text-sm font-bold text-ink-900">
                  {review.title}
                </figcaption>
              )}
              <blockquote className="mt-2 flex-1 text-sm leading-relaxed text-ink-600">
                “{review.body}”
              </blockquote>
              <div className="mt-5 flex items-center gap-2 border-t border-ink-100 pt-4 text-xs">
                <span className="font-semibold text-ink-700">{review.authorName}</span>
                <span className="text-ink-300">·</span>
                <span className="text-ink-500">{review.courseCode ?? review.courseName}</span>
                <Badge tone="success" size="sm" className="ml-auto">
                  Verified
                </Badge>
              </div>
            </figure>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

// --- Become a tutor (§12) --------------------------------------------------

export function BecomeTutorCta({ commissionPercent = 15 }) {
  return (
    <Section tone="dark">
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <Reveal>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-brand-300">
            For tutors
          </p>
          <h2 className="mt-2 text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            Teach the courses you know, at the rate you set
          </h2>
          <p className="mt-4 text-base leading-relaxed text-brand-100/80">
            Set your own hourly rate and availability. We handle payments, scheduling and the
            paperwork, and take {commissionPercent}% of each completed lesson — nothing upfront, and
            nothing when you&rsquo;re not teaching.
          </p>

          <dl className="mt-8 grid grid-cols-2 gap-6 sm:grid-cols-3">
            {[
              { value: "$0", label: "To join" },
              { value: `${commissionPercent}%`, label: "Per completed lesson" },
              { value: "48h", label: "Typical review time" },
            ].map((item) => (
              <div key={item.label}>
                <dt className="sr-only">{item.label}</dt>
                <dd>
                  <span className="block text-2xl font-extrabold text-white">{item.value}</span>
                  <span className="mt-0.5 block text-xs text-brand-200/80">{item.label}</span>
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button href="/become-a-tutor" size="lg" variant="accent">
              Apply to tutor
            </Button>
            <Button
              href="/pricing"
              size="lg"
              variant="ghost"
              className="text-white hover:bg-white/10"
            >
              See how payouts work
            </Button>
          </div>
        </Reveal>

        <Reveal delay={0.1}>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
            <h3 className="text-sm font-bold text-white">What you need to apply</h3>
            <ul className="mt-4 space-y-3">
              {[
                "Government-issued photo ID",
                "Proof of your qualifications — degree, diploma or OCT registration",
                "The provincial courses you're confident teaching",
                "A few hours a week you can commit to",
              ].map((item) => (
                <li key={item} className="flex gap-3 text-sm text-brand-100/90">
                  <BadgeCheck className="mt-0.5 size-4 shrink-0 text-accent-300" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-5 border-t border-white/10 pt-4 text-xs leading-relaxed text-brand-200/70">
              A Vulnerable Sector Check isn&rsquo;t required to start, but tutors who provide one get a
              badge that families filter for.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

// --- FAQ (§12) -------------------------------------------------------------

export const HOME_FAQS = [
  {
    q: "How much does tutoring cost?",
    a: "Tutors set their own rates. Most Ontario tutors on APlus Learn charge between $45 and $85 an hour, with certified teachers and specialists at the higher end. You see the exact hourly rate on every profile before you contact anyone, and the price you see is the price you pay — our commission comes out of the tutor's side.",
  },
  {
    q: "Do I need an account to search?",
    a: "No. You can search, filter, read reviews and view tutor profiles without signing up. You only need an account to message a tutor or make a booking, which is also when we ask about your child's grade and courses.",
  },
  {
    q: "How are tutors verified?",
    a: "Every tutor's identity is checked before their profile becomes visible. Beyond that, tutors can earn separate badges for education, Ontario College of Teachers membership, current university enrolment, and a Vulnerable Sector Check. Each badge on a profile means our team reviewed a specific document for it.",
  },
  {
    q: "What if a lesson doesn't go well?",
    a: "You can cancel free of charge up to 24 hours before a lesson starts. If a tutor doesn't show up, you're refunded in full automatically. If something else goes wrong, you can open a dispute from the lesson page and our team reviews it.",
  },
  {
    q: "Can I book the same tutor every week?",
    a: "Yes. When you book you can choose a recurring weekly or biweekly slot, and the whole series is reserved on the tutor's calendar. You can also rebook a past tutor in two taps from your dashboard.",
  },
  {
    q: "Which provinces do you cover?",
    a: "Ontario is fully supported today, including the complete secondary course-code curriculum. The platform is built so other provinces can be added without changing how search or booking works, and we're expanding based on where demand comes from.",
  },
  {
    q: "How do online lessons work?",
    a: "When you book an online lesson, a meeting link is generated for Zoom, Google Meet or Microsoft Teams — whichever the tutor offers. The link appears on the lesson in your dashboard and in your confirmation email.",
  },
  {
    q: "Is my child's information private?",
    a: "Tutors only see what they need to teach: a first name and last initial, the grade, and the course. Full names, addresses and contact details are never shown on public pages, and an in-person address is only released to the tutor once a lesson is confirmed.",
  },
];

export function Faq({ faqs = HOME_FAQS, title = "Questions parents ask first", showAllLink = true }) {
  return (
    <Section
      eyebrow="FAQ"
      title={title}
      tone="muted"
      action={
        showAllLink && (
          <Button href="/faq" variant="secondary" iconRight={<ArrowRight className="size-4" />}>
            All questions
          </Button>
        )
      }
    >
      <div className="mx-auto max-w-3xl divide-y divide-ink-200 rounded-2xl border border-ink-200 bg-canvas">
        {faqs.map((faq) => (
          <details key={faq.q} className="group px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
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
    </Section>
  );
}
