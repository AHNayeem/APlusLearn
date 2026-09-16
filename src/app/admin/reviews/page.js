import Link from "next/link";
import { Star, Flag } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, REVIEW_STATUS, REPORT_STATUS_LABELS } from "@/constants";
import { listReviews } from "@/services/review.service";
import {
  Alert, Badge, Card, CardBody, EmptyState, LinkTabs, Pagination, Rating,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ReviewModeration } from "@/components/admin/ReviewModeration";
import { formatDate, formatRelative, publicName } from "@/lib/utils/format";

export const metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

const TABS = [
  { value: "reported", label: "Reported" },
  { value: REVIEW_STATUS.PUBLISHED, label: "Published" },
  { value: REVIEW_STATUS.REMOVED, label: "Removed" },
  { value: "", label: "All" },
];

export default async function AdminReviewsPage({ searchParams }) {
  const user = await enforceRole(ROLES.ADMIN, "/admin/reviews");
  await connectToDatabase();

  const { status = "reported", page = "1" } = await searchParams;
  const reported = status === "reported";
  const { items, total, pageSize } = await listReviews(user, {
    status: reported ? undefined : status || undefined,
    reported,
    page: Number(page),
  });

  return (
    <DashboardPage>
      <PageHeader
        title="Reviews"
        description="Moderate reported reviews. Every review is tied to a completed lesson, so none are anonymous."
      />

      <LinkTabs
        activeValue={status}
        tabs={TABS.map((tab) => ({
          ...tab,
          href: tab.value ? `/admin/reviews?status=${tab.value}` : "/admin/reviews",
        }))}
      />

      {reported && items.length > 0 && (
        <Alert tone="warning" title="Reported reviews stay public until you rule on them" className="mt-6">
          A report opens a case; it does not hide the review. That is deliberate — otherwise a
          tutor could remove an unfavourable review from their own rating simply by objecting to
          it. Keep it published to dismiss the report, or remove it to uphold it.
        </Alert>
      )}

      <div className="mt-6 space-y-4">
        {items.length === 0 ? (
          <EmptyState
            icon={<Star className="size-7" />}
            title={reported ? "No reported reviews" : "No reviews here"}
            description={
              reported ? "Nothing waiting on moderation." : "Try a different status filter."
            }
          />
        ) : (
          items.map((review) => {
            const tutorProfile = review.tutorProfileId;
            const tutorUser = tutorProfile?.userId;

            return (
              <Card key={review.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Rating value={review.rating} showValue={false} size="sm" />
                        <span className="text-sm font-semibold text-ink-900">
                          {publicName(
                            review.authorId?.firstName ?? "A",
                            review.authorId?.lastName ?? "",
                          )}
                        </span>
                        <span className="text-xs text-ink-400">
                          {formatDate(review.createdAt)}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-ink-500">
                        About{" "}
                        {tutorProfile?.slug ? (
                          <Link
                            href={`/tutors/${tutorProfile.slug}`}
                            className="font-semibold text-brand-600 hover:underline"
                          >
                            {tutorUser?.firstName} {tutorUser?.lastName}
                          </Link>
                        ) : (
                          "a tutor"
                        )}
                        {review.courseCode ? ` · ${review.courseCode}` : ""}
                        {review.bookingId?.reference ? ` · ${review.bookingId.reference}` : ""}
                      </p>
                    </div>

                    <Badge
                      tone={
                        review.status === REVIEW_STATUS.REPORTED
                          ? "warning"
                          : review.status === REVIEW_STATUS.REMOVED
                            ? "danger"
                            : "success"
                      }
                      size="sm"
                    >
                      {review.status.toLowerCase().replace(/_/g, " ")}
                    </Badge>
                  </div>

                  {review.title && (
                    <p className="mt-3 text-sm font-bold text-ink-900">{review.title}</p>
                  )}
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{review.body}</p>

                  {review.reportReason && (
                    <div className="mt-4 rounded-xl border border-warning-100 bg-warning-50 p-3">
                      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-warning-700">
                        <Flag className="size-3" />
                        Reported {formatRelative(review.reportedAt)}
                        {review.reportedByRole ? ` by the ${review.reportedByRole.toLowerCase()}` : ""}
                        {review.reportStatus ? ` · ${REPORT_STATUS_LABELS[review.reportStatus]}` : ""}
                      </p>
                      <p className="mt-1 text-sm text-ink-700">{review.reportReason}</p>
                      {review.reportedByRole === "TUTOR" && (
                        <p className="mt-2 text-xs text-warning-700">
                          Reported by the tutor it is about. It is still counting towards their
                          rating, as it should until you decide.
                        </p>
                      )}
                    </div>
                  )}

                  {review.moderationNote && (
                    <div className="mt-4 rounded-xl bg-ink-50 p-3">
                      <p className="text-xs font-bold uppercase tracking-wide text-ink-400">
                        Moderation note
                      </p>
                      <p className="mt-1 text-sm text-ink-600">{review.moderationNote}</p>
                    </div>
                  )}

                  {(reported || review.status === REVIEW_STATUS.REPORTED) && (
                    <div className="mt-4 border-t border-ink-100 pt-4">
                      <ReviewModeration review={review} />
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })
        )}
      </div>

      <Pagination
        className="mt-6"
        page={Number(page)}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        label="reviews"
        buildHref={(p) =>
          `/admin/reviews?${new URLSearchParams({ ...(status ? { status } : {}), page: String(p) })}`
        }
      />
    </DashboardPage>
  );
}
