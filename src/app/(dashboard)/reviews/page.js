import Link from "next/link";
import { Star } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { LEARNER_ROLES } from "@/constants";
import { listReviews } from "@/services/review.service";
import { listBookings } from "@/services/booking.service";
import {
  Alert, Avatar, Badge, Button, Card, CardBody, EmptyState, Rating,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatDate } from "@/lib/utils/format";

export const metadata = { title: "My reviews" };
export const dynamic = "force-dynamic";

export default async function MyReviewsPage() {
  const user = await enforceRole(LEARNER_ROLES, "/reviews");
  await connectToDatabase();

  const [{ items }, awaiting] = await Promise.all([
    listReviews(user, { pageSize: 30 }),
    listBookings(user, { scope: "AWAITING_REVIEW", page: 1, pageSize: 5 }),
  ]);

  return (
    <DashboardPage>
      <PageHeader
        title="My reviews"
        description="Reviews you've left. Only completed lessons can be reviewed, which is what makes them verified."
      />

      {awaiting.items.length > 0 && (
        <Alert
          tone="warning"
          title={`${awaiting.total} ${awaiting.total === 1 ? "lesson is" : "lessons are"} waiting for a review`}
          className="mb-6"
          action={
            <Button href="/bookings?scope=AWAITING_REVIEW" size="sm" variant="secondary">
              Review now
            </Button>
          }
        >
          Your review helps other families pick the right tutor.
        </Alert>
      )}

      {items.length === 0 ? (
        <EmptyState
          icon={<Star className="size-7" />}
          title="No reviews yet"
          description="After a lesson is completed you'll be able to review your tutor here."
          action={<Button href="/bookings">View my lessons</Button>}
        />
      ) : (
        <div className="space-y-4">
          {items.map((review) => {
            const tutorProfile = review.tutorProfileId;
            const tutorUser = tutorProfile?.userId;
            return (
              <Card key={review.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 gap-3">
                      <Avatar
                        src={tutorUser?.avatarUrl}
                        firstName={tutorUser?.firstName}
                        lastName={tutorUser?.lastName}
                        size="md"
                      />
                      <div className="min-w-0">
                        <Link
                          href={`/tutors/${tutorProfile?.slug}`}
                          className="text-sm font-bold text-ink-900 hover:text-brand-700"
                        >
                          {tutorUser?.firstName} {tutorUser?.lastName?.charAt(0)}.
                        </Link>
                        <p className="mt-0.5 text-xs text-ink-500">
                          {review.courseCode ?? review.courseName} ·{" "}
                          {formatDate(review.createdAt, { month: "long" })}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Rating value={review.rating} showValue={false} size="sm" />
                      <Badge tone="success" size="sm">
                        Verified
                      </Badge>
                    </div>
                  </div>

                  {review.title && (
                    <p className="mt-4 text-sm font-bold text-ink-900">{review.title}</p>
                  )}
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{review.body}</p>

                  {review.tutorReply && (
                    <div className="mt-4 rounded-xl border-l-2 border-brand-300 bg-brand-50/50 p-4">
                      <p className="text-xs font-bold text-brand-800">
                        Reply from {tutorUser?.firstName}
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-600">
                        {review.tutorReply}
                      </p>
                    </div>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </DashboardPage>
  );
}
