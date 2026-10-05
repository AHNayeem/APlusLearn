import Link from "next/link";
import { Search, CalendarCheck, CreditCard, ShieldCheck, GraduationCap, UserCog, ArrowRight } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { getAppConfig } from "@/services/settings.service";
import { Button, Card, CardBody } from "@/components/ui";
import { PageHero } from "@/components/marketing/PageHero";
import { Section, Faq } from "@/components/home/Sections";
import { supportResponseLabel } from "@/lib/utils/format";
import { homeFaqs, hoursLabel, refundPhrase, VERIFICATION_DISCLAIMER } from "@/constants";

export const metadata = {
  title: "Help centre",
  description: "Answers about searching, booking, payments, refunds, verification and your account.",
  alternates: { canonical: "/help-centre" },
};

// Help content quotes live settings, so it is rebuilt with them.
export const revalidate = 3600;

/**
 * The help centre (§33, R33.1).
 *
 * Every answer here is built from the platform's own settings and rules — the
 * cancellation window, refund percentages, payout hold, review time, support
 * response time — so a family reads exactly the terms the platform applies.
 * Anything not answered here goes to the support form, which is stored and
 * worked from the admin support queue.
 */
export default async function HelpCentrePage() {
  await connectToDatabase();
  const { policy, branding, contact } = await getAppConfig();
  const appName = branding?.appName;
  const reply = supportResponseLabel(policy);
  const window = policy.freeCancellationWindowHours;

  const topics = [
    {
      icon: Search,
      title: "Finding a tutor",
      items: [
        "Search by subject, course name or course code, then narrow by grade, format, distance, price, rating, experience, qualifications and real availability.",
        "Online tutors are always included unless you ask for in-person lessons only; distance applies only to in-person lessons.",
        "If we can't place a city or postal code on the map, we say so and show tutors who list that place — we never guess another city.",
      ],
      links: [["Find a tutor", "/find-a-tutor"], ["Browse courses", "/courses"]],
    },
    {
      icon: CalendarCheck,
      title: "Booking and lessons",
      items: [
        "Pick a time from the tutor's live calendar; only times you can actually book are shown.",
        window > 0
          ? `Cancel more than ${hoursLabel(window)} before a lesson for a full refund; inside that window you get ${refundPhrase(policy.lateCancellationRefundPercent)}.`
          : "You can cancel for a full refund until the lesson starts.",
        `If a tutor doesn't attend, report it from the lesson page within ${hoursLabel(policy.noShowReportWindowHours)}; our team reviews it and refunds per policy (${refundPhrase(policy.tutorNoShowRefundPercent)}).`,
      ],
      links: [["Cancellation & refunds", "/legal/cancellation"], ["How it works", "/how-it-works"]],
    },
    {
      icon: CreditCard,
      title: "Payments and receipts",
      items: [
        "You pay through the platform when you book; card details are handled by our payment provider and never stored by us.",
        "Every paid lesson has a receipt under Payments in your dashboard. A payment that didn't go through has no receipt and no charge.",
        `Problems with a lesson can be reported from the lesson page for ${policy.disputeWindowDays} days after it ends.`,
      ],
      links: [["Pricing", "/pricing"]],
    },
    {
      icon: ShieldCheck,
      title: "Safety and verification",
      items: [
        "Every tutor's government-issued ID is reviewed before their application is approved; other badges are verified one at a time.",
        VERIFICATION_DISCLAIMER,
        "Keep contact and payment on the platform: contact details sent in messages are removed automatically.",
      ],
      links: [["Verification", "/verification"], ["Safety", "/safety"], ["Community standards", "/legal/community-standards"]],
    },
    {
      icon: GraduationCap,
      title: "For tutors",
      items: [
        `Applications are usually reviewed within ${policy.applicationReviewBusinessDays} business ${policy.applicationReviewBusinessDays === 1 ? "day" : "days"}.`,
        `You keep ${100 - policy.commissionPercent}% of each lesson; earnings become payable ${policy.payoutHoldDays} days after the lesson.`,
      ],
      links: [["Become a tutor", "/become-a-tutor"], ["Tutor agreement", "/legal/tutor-agreement"]],
    },
    {
      icon: UserCog,
      title: "Your account and privacy",
      items: [
        "Manage children's profiles, notifications and your phone number in Settings.",
        "You can delete your account from Settings; personal details are removed and verification documents deleted.",
      ],
      links: [["Privacy policy", "/legal/privacy"], ["Cookie policy", "/legal/cookies"]],
    },
  ];

  return (
    <>
      <PageHero
        eyebrow="Help centre"
        title="How can we help?"
        description={`Answers using ${appName ?? "our"} current terms. Can't find yours? Our team usually replies within ${reply}.`}
      />

      <Section>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {topics.map(({ icon: Icon, title, items, links }) => (
            <Card key={title}>
              <CardBody>
                <Icon className="size-5 text-brand-600" aria-hidden="true" />
                <h2 className="mt-3 text-base font-bold text-ink-900">{title}</h2>
                <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink-600">
                  {items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                  {links.map(([label, href]) => (
                    <Link key={href} href={href} className="text-sm font-semibold text-brand-600 hover:underline">
                      {label}
                    </Link>
                  ))}
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </Section>

      <Faq faqs={homeFaqs({ appName, policy })} title="Frequently asked" />

      <Section tone="muted">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-2xl font-extrabold tracking-tight text-ink-900">Still need help?</h2>
          <p className="mt-2 text-sm text-ink-600">
            Send us a message and a person will reply{contact?.supportEmail ? `, or email ${contact.supportEmail}` : ""}.
          </p>
          <Button href="/support" className="mt-5" iconRight={<ArrowRight className="size-4" />}>
            Contact support
          </Button>
        </div>
      </Section>
    </>
  );
}
