import Link from "next/link";
import * as Icons from "lucide-react";
import {
  ShieldCheck, Video, MapPin, Wallet, Clock, BadgeCheck, ArrowRight, Check,
  IdCard, Stamp, GraduationCap, School, X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Badge, Button, Reveal, RevealGroup, RevealItem } from "@/components/ui";
import { StepCards } from "@/components/home/StepCards";
import { StepArt } from "@/components/home/StepArt";
import { TestimonialRail } from "@/components/home/TestimonialRail";
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

/**
 * Cards are tinted by the code's opening letter, because in Ontario's system
 * that letter *is* the discipline — M mathematics, E English, S science,
 * F French, B business, I computer studies. The section's whole argument is
 * that the code carries meaning, so the only thing allowed to colour a card is
 * the part of it that does — which is also why the palette goes quiet when the
 * popular list happens to be mostly maths, rather than inventing difference.
 * Computer studies borrows the ink tone the subjects section already gives it.
 * Codeless elementary courses fall back to brand.
 */
const CODE_TONES = {
  M: { rule: "bg-brand-600", code: "text-brand-700", chip: "bg-brand-50 text-brand-700 ring-brand-100" },
  E: { rule: "bg-accent-500", code: "text-accent-700", chip: "bg-accent-50 text-accent-700 ring-accent-100" },
  S: { rule: "bg-success-600", code: "text-success-700", chip: "bg-success-50 text-success-700 ring-success-100" },
  F: { rule: "bg-plum-600", code: "text-plum-700", chip: "bg-plum-50 text-plum-700 ring-plum-100" },
  I: { rule: "bg-ink-700", code: "text-ink-700", chip: "bg-ink-100 text-ink-700 ring-ink-200" },
  B: { rule: "bg-warning-600", code: "text-warning-700", chip: "bg-warning-50 text-warning-700 ring-warning-100" },
};

/**
 * The five characters of an Ontario code, split the way the ministry defines
 * them. Shown coming apart rather than described, because "a code maps to
 * exactly one curriculum" stays an abstract claim until you watch MHF4U do it.
 * The diagram is `aria-hidden` — read aloud it is just letters — and the line
 * underneath carries the same information in prose.
 */
const CODE_ANATOMY = [
  { chars: "MHF", label: "Course" },
  { chars: "4", label: "Grade" },
  { chars: "U", label: "Pathway" },
];

export function PopularCourses({ courses = [] }) {
  if (!courses.length) return null;

  return (
    <Section
      eyebrow="Popular Ontario courses"
      title="Search by course code, the way report cards do"
      description="A report card hands you MHF4U, not “senior math”. Search the code and you get tutors who have taught that exact course."
      tone="muted"
      action={
        <Button href="/courses" variant="secondary" iconRight={<ArrowRight className="size-4" />}>
          All Ontario courses
        </Button>
      }
    >
      <RevealGroup className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {courses.map((course) => {
          const tone = CODE_TONES[course.code?.[0]] ?? CODE_TONES.M;
          // Elementary courses carry no code, so they resolve by slug instead —
          // narrowed by grade, because a slug is only unique within one.
          const href = course.code
            ? `/find-a-tutor?courseCode=${course.code}&province=ON`
            : `/find-a-tutor?course=${course.slug}&grade=${course.gradeSlug}&province=ON`;

          return (
            <RevealItem key={course.id} className="h-full">
              <Link
                href={href}
                className={cn(
                  "group flex h-full flex-col overflow-hidden rounded-2xl border border-ink-200 bg-canvas",
                  "transition duration-300 ease-out",
                  "hover:-translate-y-1 hover:border-brand-200 hover:bg-white hover:shadow-xl",
                  "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
                )}
              >
                <span className={cn("block h-1.5 w-full", tone.rule)} aria-hidden="true" />

                <span className="flex flex-1 flex-col p-5 sm:p-6">
                  <span
                    className={cn(
                      "block font-extrabold tracking-tight",
                      course.code ? "text-[1.7rem] leading-none" : "text-lg leading-snug",
                      tone.code,
                    )}
                  >
                    {course.code ?? course.name}
                  </span>

                  {course.code && (
                    <span className="mt-2 block text-sm font-bold text-ink-900 transition-colors group-hover:text-brand-700">
                      {course.name}
                    </span>
                  )}

                  <span
                    className={cn(
                      "mt-3 inline-flex w-fit items-center rounded-sm px-2 py-1 ring-1 ring-inset",
                      "text-[11px] font-bold uppercase tracking-[0.08em]",
                      tone.chip,
                    )}
                  >
                    Grade {course.gradeLevel} · {course.stream}
                  </span>

                  {course.description && (
                    <span className="mt-4 line-clamp-2 text-xs leading-relaxed text-ink-500">
                      {course.description}
                    </span>
                  )}

                  <span className="mt-auto pt-5">
                    <span className="flex items-center justify-between gap-3 border-t border-ink-200/70 pt-4">
                      {course.tutorCount > 0 ? (
                        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-success-700">
                          <span className="size-1.5 rounded-full bg-success-500" aria-hidden="true" />
                          {formatNumber(course.tutorCount)}{" "}
                          {course.tutorCount === 1 ? "tutor" : "tutors"} available
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-ink-400">Browse tutors</span>
                      )}
                      <ArrowRight
                        className="size-4 shrink-0 text-ink-300 transition duration-200 group-hover:translate-x-0.5 group-hover:text-brand-600 motion-reduce:group-hover:translate-x-0"
                        aria-hidden="true"
                      />
                    </span>
                  </span>
                </span>
              </Link>
            </RevealItem>
          );
        })}
      </RevealGroup>

      <Reveal className="mt-10 lg:mt-12">
        <div className="mx-auto max-w-2xl rounded-2xl border border-ink-200 bg-canvas px-6 py-7 text-center sm:px-8">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-400">
            How an Ontario code reads
          </p>

          <div className="mt-5 flex items-start justify-center gap-4 sm:gap-6" aria-hidden="true">
            {CODE_ANATOMY.map(({ chars, label }) => (
              <span key={label} className="flex flex-col items-center">
                <span className="flex gap-1.5">
                  {[...chars].map((char, index) => (
                    <span
                      key={`${label}-${index}`}
                      className={cn(
                        "flex size-10 items-center justify-center rounded-sm bg-white",
                        "text-lg font-extrabold text-ink-900 shadow-xs ring-1 ring-ink-200",
                        "sm:size-11 sm:text-xl",
                      )}
                    >
                      {char}
                    </span>
                  ))}
                </span>
                <span className="mt-2 h-2 w-full border-x border-b border-ink-200" />
                <span className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-brand-600">
                  {label}
                </span>
              </span>
            ))}
          </div>

          <p className="mx-auto mt-5 max-w-md text-xs leading-relaxed text-ink-500">
            Three letters for the course, one digit for the grade, one for the pathway. MHF4U is
            Grade 12 university-level Advanced Functions — and nothing else answers to it.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}

// --- Find tutors by grade (§12) --------------------------------------------

/**
 * The Ontario stages, in the order a child moves through them (§12).
 *
 * Rendered as one ladder rather than three equal cards, because the stages
 * hold seven, two and four grades — a three-column grid leaves the
 * intermediate card two-thirds empty no matter how it is styled. Each stage
 * keeps its own colour so the chips stay tellable apart, and the tile carries
 * the range so a row reads before you reach the numbers.
 */
const GRADE_STAGES = [
  {
    stage: "ELEMENTARY",
    label: "Elementary",
    range: "K–6",
    hint: "Reading fluency, number sense, and homework that stops being a fight.",
    tile: "bg-brand-600",
    chip: "bg-brand-50 text-brand-700 ring-brand-100 hover:bg-brand-600 hover:text-white hover:ring-brand-600",
  },
  {
    stage: "MIDDLE",
    label: "Intermediate",
    range: "7–8",
    hint: "Where algebra lands and small gaps start to compound.",
    tile: "bg-plum-600",
    chip: "bg-plum-50 text-plum-700 ring-plum-100 hover:bg-plum-600 hover:text-white hover:ring-plum-600",
  },
  {
    stage: "SECONDARY",
    label: "Secondary",
    range: "9–12",
    hint: "Course codes, exam prep, and the marks universities will see.",
    tile: "bg-accent-500",
    chip: "bg-accent-50 text-accent-700 ring-accent-100 hover:bg-accent-500 hover:text-white hover:ring-accent-500",
  },
];

/**
 * "Grade 9" printed thirteen times is noise; inside a row already labelled
 * "Secondary · 9–12" the numeral alone is unambiguous. The full name stays on
 * the link's accessible name, so nothing is lost to a screen reader.
 */
function gradeChipLabel(name) {
  const digits = name.match(/\d+/);
  if (digits) return digits[0];
  return name
    .split(/\s+/)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

export function TutorsByGrade({ grades = [] }) {
  if (!grades.length) return null;

  return (
    <Section
      eyebrow="Find tutors by grade"
      title="Support that matches where your child actually is"
      description="A Grade 4 reading gap and a Grade 12 calculus gap need very different tutors. Start from the grade."
    >
      <Reveal>
        <div className="mx-auto max-w-3xl overflow-hidden rounded-2xl border border-ink-200/80 bg-white shadow-sm">
          <ul className="divide-y divide-ink-100">
            {GRADE_STAGES.map((stage) => {
              const inStage = grades
                .filter((grade) => grade.stage === stage.stage)
                .sort((a, b) => a.level - b.level);
              if (!inStage.length) return null;

              return (
                <li
                  key={stage.stage}
                  className="flex flex-col gap-5 p-6 sm:p-7 lg:flex-row lg:items-center lg:gap-8"
                >
                  <div className="flex items-center gap-4 lg:w-[19rem] lg:shrink-0">
                    <span
                      className={cn(
                        "flex size-14 shrink-0 items-center justify-center rounded-2xl",
                        "text-sm font-extrabold tracking-tight text-white shadow-xs",
                        stage.tile,
                      )}
                    >
                      {stage.range}
                    </span>
                    <span className="min-w-0">
                      <h3 className="text-base font-bold tracking-tight text-ink-900">{stage.label}</h3>
                      <p className="mt-1 text-xs leading-relaxed text-ink-500">{stage.hint}</p>
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {inStage.map((grade) => (
                      <Link
                        key={grade.id}
                        href={`/find-a-tutor?grade=${grade.slug}&province=ON`}
                        aria-label={`Find ${grade.name} tutors`}
                        className={cn(
                          "inline-flex size-11 items-center justify-center rounded-2xl",
                          "text-sm font-bold ring-1 ring-inset transition-colors duration-200",
                          stage.chip,
                        )}
                      >
                        <span aria-hidden="true">{gradeChipLabel(grade.name)}</span>
                      </Link>
                    ))}
                  </div>
                </li>
              );
            })}
          </ul>

          <p className="border-t border-ink-100 bg-canvas px-6 py-5 text-center text-xs leading-relaxed text-ink-500 sm:px-7">
            Grade filters run against the courses each tutor has listed, so picking a grade only
            returns people who actually teach at that level.
          </p>
        </div>
      </Reveal>
    </Section>
  );
}

// --- Why choose APlus Learn (§12) ------------------------------------------

/**
 * The four arguments, each hung on the frustration it answers (§12).
 *
 * The heading promises parents who have been burned before, so each card
 * names the burn first — in grey, struck through with a small cross — and
 * only then makes the claim. Without that, the four cards restate the
 * verification and payment sections that sit either side of this one.
 * Each reason carries its own colour family so four cards do not read as one
 * repeated thing.
 */
const REASONS = [
  {
    icon: BadgeCheck,
    friction: "Anyone can print “qualified tutor” on a listing.",
    title: "Checked before you can find them",
    body: "A profile only reaches search once its ID and credentials are confirmed — teaching certificates against the Ontario College of Teachers register.",
    tint: "bg-brand-50 text-brand-600",
  },
  {
    icon: Wallet,
    friction: "Agency fees you discover at checkout.",
    title: "The rate on the profile is the rate you pay",
    body: "No registration fee, no minimum package, nothing added at the end. Our commission comes out of the tutor's side, and it is shown to them plainly.",
    tint: "bg-accent-50 text-accent-600",
  },
  {
    icon: ShieldCheck,
    friction: "Paying up front and hoping for the best.",
    title: "Your money waits until the lesson has happened",
    body: "Payment is held until the lesson is complete. Free cancellation up to 24 hours before, and a full refund if a tutor doesn't show.",
    tint: "bg-success-50 text-success-600",
  },
  {
    icon: Clock,
    friction: "Three messages just to find a time that works.",
    title: "You book a slot, not a conversation",
    body: "Tutors keep their calendars current, so the slot you pick is genuinely free. No waiting two days to hear that Tuesday is no good after all.",
    tint: "bg-plum-50 text-plum-600",
  },
];

export function WhyChoose() {
  return (
    <Section
      eyebrow="Why APlus Learn"
      title="Built for parents who've been burned by tutoring before"
      description="Four things that usually go wrong with tutoring — and what we changed so they don't."
      tone="muted"
    >
      <RevealGroup className="grid gap-6 md:grid-cols-2">
        {REASONS.map(({ icon: ReasonIcon, friction, title, body, tint }) => (
          <RevealItem key={title} className="h-full">
            <article
              className={cn(
                "group flex h-full flex-col overflow-hidden rounded-2xl border border-ink-200/80 bg-white",
                "shadow-sm transition duration-300 ease-out",
                "hover:-translate-y-1 hover:border-brand-200 hover:shadow-xl",
                "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
              )}
            >
              <p className="flex items-center gap-2.5 border-b border-ink-100 bg-canvas px-6 py-4 text-[13px] text-ink-500">
                {/* <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ink-200 text-ink-600">
                  <X className="size-3" strokeWidth={3.2} aria-hidden="true" />
                </span> */}
                {/* line-through */}
                <span className=" decoration-ink-300">{friction}</span>
              </p>

              <div className="flex flex-1 flex-col gap-4 p-6 sm:flex-row sm:gap-5 sm:p-7">
                <span className={cn("flex size-12 shrink-0 items-center justify-center rounded-2xl", tint)}>
                  <ReasonIcon className="size-5.5" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold tracking-tight text-ink-900">{title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-500">{body}</p>
                </div>
              </div>
            </article>
          </RevealItem>
        ))}
      </RevealGroup>
    </Section>
  );
}

// --- Verification (§12, §16) -----------------------------------------------

/**
 * Presentation for each check. Keyed by `VERIFICATION_TYPES` and looked up with
 * a fallback, so adding a type to the domain still renders here rather than
 * dropping silently — it just arrives in the default blue.
 *
 * Two families alternate down the list so neighbouring checks stay
 * distinguishable, and the background check takes the accent because it is the
 * one parents scan for first.
 */
const VERIFICATION_META = {
  IDENTITY: { icon: IdCard, chip: "bg-brand-50 text-brand-600" },
  OCT: { icon: Stamp, chip: "bg-plum-50 text-plum-600" },
  EDUCATION: { icon: GraduationCap, chip: "bg-brand-50 text-brand-600" },
  UNIVERSITY_STUDENT: { icon: School, chip: "bg-plum-50 text-plum-600" },
  BACKGROUND_CHECK: { icon: ShieldCheck, chip: "bg-accent-50 text-accent-600" },
};

const VERIFICATION_FALLBACK = { icon: BadgeCheck, chip: "bg-brand-50 text-brand-600" };

/**
 * The stored labels all end in "Verified", which is worth saying on a tutor
 * profile but turns into five identical words down a list. Here the green tick
 * on the icon says it once per row, so the name can carry the difference.
 */
function checkName(type) {
  return VERIFICATION_LABELS[type].replace(/ Verified$/, "");
}

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
      <div className="grid gap-6 lg:grid-cols-[minmax(0,21rem)_minmax(0,1fr)] lg:gap-8">
        {/* The promise that used to be squeezed into the grid as a sixth tile.
            It isn't a badge, so it no longer pretends to be one. */}
        <Reveal>
          <div className="flex h-full flex-col overflow-hidden rounded-2xl border border-ink-200/80 bg-white shadow-sm">
            <div className="bg-brand-50 px-6 pt-7 sm:pt-8">
              <StepArt name="verify" className="mx-auto max-w-[17rem]" />
            </div>
            <div className="flex flex-1 flex-col justify-center p-6 text-center sm:p-7">
              <span className="mx-auto inline-flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.16em] text-white shadow-xs">
                <ShieldCheck className="size-3.5" aria-hidden="true" />
                Before it goes live
              </span>
              <h3 className="mt-5 text-xl font-bold tracking-tight text-ink-900">
                Unapproved tutors never appear in search
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">
                A profile stays invisible until our team has reviewed it. There is no way to skip
                the queue by paying.
              </p>
            </div>
          </div>
        </Reveal>

        {/* One panel, five rows — a record of what was checked, rather than
            five marketing tiles that leave a hole in the grid. */}
        <Reveal delay={0.08}>
          <ul className="flex h-full flex-col divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-200/80 bg-white shadow-sm">
            {badges.map((type) => {
              const { icon: CheckIcon, chip } = VERIFICATION_META[type] ?? VERIFICATION_FALLBACK;

              return (
                <li key={type} className="flex flex-1 items-start gap-4 p-5 sm:gap-5 sm:p-6">
                  <span className="relative shrink-0">
                    <span
                      className={cn(
                        "flex size-12 items-center justify-center rounded-2xl",
                        chip,
                      )}
                    >
                      <CheckIcon className="size-5.5" aria-hidden="true" />
                    </span>
                    <span
                      className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full border-2 border-white bg-success-600"
                      aria-hidden="true"
                    >
                      <Check className="size-2.5 text-white" strokeWidth={4} />
                    </span>
                  </span>

                  <div className="min-w-0">
                    <h3 className="text-base font-bold tracking-tight text-ink-900">
                      {checkName(type)}
                      <span className="sr-only"> verified</span>
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-ink-500">
                      {VERIFICATION_DESCRIPTIONS[type]}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </Reveal>
      </div>
    </Section>
  );
}

// --- Online vs in person (§12, §27) ----------------------------------------

/**
 * The two modes share everything except the place, so the page says it that
 * way: a matched pair of cards for what differs, and one strip underneath for
 * what doesn't — rather than the same four reassurances printed twice.
 */
const LESSON_MODE_CARDS = [
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
        {LESSON_MODE_CARDS.map((mode, index) => {
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
      <Reveal>
        <TestimonialRail reviews={reviews} />
      </Reveal>
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
