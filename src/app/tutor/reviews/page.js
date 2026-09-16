import { Star } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, REVIEW_STATUS, REPORT_STATUS } from "@/constants";
import { listReviews, ratingBreakdown } from "@/services/review.service";
import { getTutorProfileByUserId } from "@/services/tutor.service";
import {
  Badge, Card, CardBody, CardHeader, EmptyState, Rating, RatingBar, StatCard,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ReviewReplyForm } from "@/components/tutor/ReviewReplyForm";
import { formatDate, publicName } from "@/lib/utils/format";

export const metadata = { title: "Reviews" };
export const dynamic = "force-dynamic";

export default async function TutorReviewsPage() {
  const user = await enforceRole(ROLES.TUTOR, "/tutor/reviews");
  await connectToDatabase();

  const profile = await getTutorProfileByUserId(user.id);
  const [{ items }, breakdown] = await Promise.all([
    listReviews(user, { pageSize: 30 }),
    profile ? ratingBreakdown(profile.id) : Promise.resolve(null),
  ]);

  const stats = profile?.stats ?? {};
  const awaitingReply = items.filter((r) => !r.tutorReply).length;

  return (
    <DashboardPage>
      <PageHeader
        title="Reviews"
        description="Only families who completed a lesson with you can leave one, which is what makes them verified."
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Star className="size-7" />}
          title="No reviews yet"
          description="After your first completed lesson, families can review you here."
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <StatCard
              label="Average rating"
              value={stats.ratingAverage ? stats.ratingAverage.toFixed(1) : "—"}
              hint={`${stats.ratingCount ?? 0} reviews`}
              icon={<Star className="size-5" />}
            />
            <StatCard label="Lessons taught" value={stats.completedLessons ?? 0} />
            <StatCard
              label="Awaiting your reply"
              value={awaitingReply}
              hint={awaitingReply > 0 ? "Replying builds trust" : "All caught up"}
            />
          </div>

          {stats.ratingCount > 0 && (
            <Card className="mt-6">
              <CardHeader title="How families rate you" />
              <CardBody>
                <div className="grid gap-8 sm:grid-cols-[auto_1fr]">
                  <div className="text-center sm:text-left">
                    <p className="text-5xl font-extrabold tracking-tight text-ink-900">
                      {stats.ratingAverage.toFixed(1)}
                    </p>
                    <Rating
                      value={stats.ratingAverage}
                      showValue={false}
                      size="lg"
                      className="mt-2 justify-center sm:justify-start"
                    />
                  </div>
                  <div className="space-y-2.5">
                    <RatingBar label="Subject knowledge" value={stats.ratingKnowledge} />
                    <RatingBar label="Communication" value={stats.ratingCommunication} />
                    <RatingBar label="Reliability" value={stats.ratingReliability} />
                    <RatingBar label="Teaching ability" value={stats.ratingTeaching} />
                  </div>
                </div>
              </CardBody>
            </Card>
          )}

          <div className="mt-6 space-y-4">
            {items.map((review) => (
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
                          {formatDate(review.createdAt, { month: "long" })}
                        </span>
                      </div>
                      {review.courseCode && (
                        <Badge tone="neutral" size="sm" className="mt-2">
                          {review.courseCode}
                        </Badge>
                      )}
                    </div>

                    {(review.reportStatus === REPORT_STATUS.OPEN ||
                      review.reportStatus === REPORT_STATUS.REVIEWING ||
                      review.status === REVIEW_STATUS.REPORTED) && (
                      <Badge tone="warning">With moderation</Badge>
                    )}
                  </div>

                  {review.title && (
                    <p className="mt-3 text-sm font-bold text-ink-900">{review.title}</p>
                  )}
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{review.body}</p>

                  {review.tutorReply ? (
                    <div className="mt-4 rounded-xl border-l-2 border-brand-300 bg-brand-50/50 p-4">
                      <p className="text-xs font-bold text-brand-800">Your reply</p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-600">
                        {review.tutorReply}
                      </p>
                    </div>
                  ) : (
                    <div className="mt-4 border-t border-ink-100 pt-4">
                      <ReviewReplyForm review={review} />
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}
    </DashboardPage>
  );
}
