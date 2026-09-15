import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText, ExternalLink, MapPin, Mail, Phone } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import {
  ROLES, TUTOR_STATUS, TUTOR_STATUS_LABELS, LESSON_MODE_LABELS,
  QUALIFICATION_LABELS, VERIFICATION_STATUS,
} from "@/constants";
import { TutorApplication } from "@/models";
import { toPlain } from "@/lib/utils/serialize";
import { listVerificationRecords } from "@/services/verification.service";
import { Badge, Card, CardBody, CardHeader } from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { ApplicationReview } from "@/components/admin/ApplicationReview";
import { formatDate, formatRate, formatMoney } from "@/lib/utils/format";
import { minutesToLabel } from "@/lib/utils/time";
import { WEEKDAYS } from "@/constants";

export const metadata = { title: "Review application", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AdminApplicationDetailPage({ params }) {
  const { id } = await params;
  await enforceRole(ROLES.ADMIN, `/admin/applications/${id}`);
  await connectToDatabase();

  const doc = await TutorApplication.findById(id)
    .populate("userId", "firstName lastName email phone city province createdAt emailVerifiedAt")
    .populate("tutorProfileId")
    .lean();

  if (!doc) notFound();

  const application = toPlain(doc);
  const profile = application.tutorProfileId;
  const user = application.userId;

  const verification = profile ? await listVerificationRecords(profile.id) : [];
  const data = application.data ?? {};

  return (
    <DashboardPage>
      <PageHeader
        breadcrumb={
          <Link
            href="/admin/applications"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500 hover:text-ink-800"
          >
            <ArrowLeft className="size-3.5" />
            All applications
          </Link>
        }
        title={`${user?.firstName} ${user?.lastName}`}
        description={`Applied ${application.submittedAt ? formatDate(application.submittedAt) : "— not yet submitted"}`}
        action={
          <Badge tone={application.status === TUTOR_STATUS.APPROVED ? "success" : "brand"}>
            {TUTOR_STATUS_LABELS[application.status]}
          </Badge>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Applicant" />
            <CardBody>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <Row icon={<Mail className="size-3.5" />} label="Email" value={user?.email} />
                <Row icon={<Phone className="size-3.5" />} label="Phone" value={user?.phone} />
                <Row
                  icon={<MapPin className="size-3.5" />}
                  label="Location"
                  value={[profile?.city ?? user?.city, profile?.province ?? user?.province]
                    .filter(Boolean)
                    .join(", ")}
                />
                <Row
                  label="Email verified"
                  value={user?.emailVerifiedAt ? formatDate(user.emailVerifiedAt) : "Not verified"}
                />
                <Row label="Account created" value={formatDate(user?.createdAt)} />
                <Row
                  label="Travel radius"
                  value={profile?.travelRadiusKm ? `${profile.travelRadiusKm} km` : "Online only"}
                />
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Profile" />
            <CardBody className="space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">Headline</h3>
                <p className="mt-1 text-sm font-semibold text-ink-900">{profile?.headline}</p>
              </div>
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">Bio</h3>
                <div className="mt-2 space-y-3 text-sm leading-relaxed text-ink-600">
                  {profile?.bio?.split("\n\n").map((paragraph, i) => (
                    <p key={i}>{paragraph}</p>
                  ))}
                </div>
              </div>
              {profile?.introVideoUrl && (
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                    Intro video
                  </h3>
                  <a
                    href={profile.introVideoUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline"
                  >
                    {profile.introVideoUrl}
                    <ExternalLink className="size-3" />
                  </a>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Education & qualifications" />
            <CardBody className="space-y-5">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">Education</h3>
                <ul className="mt-2 space-y-3">
                  {profile?.education?.map((entry, i) => (
                    <li key={i} className="text-sm">
                      <p className="font-semibold text-ink-900">
                        {entry.credential}
                        {entry.fieldOfStudy && (
                          <span className="font-normal text-ink-600"> · {entry.fieldOfStudy}</span>
                        )}
                      </p>
                      <p className="text-ink-500">
                        {entry.institution}
                        {(entry.startYear || entry.endYear) && (
                          <>
                            {" · "}
                            {entry.startYear}
                            {entry.inProgress ? " – present" : entry.endYear ? `–${entry.endYear}` : ""}
                          </>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-t border-ink-100 pt-4">
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                  Qualifications claimed
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile?.qualifications?.map((q) => (
                    <Badge key={q} tone="neutral" size="sm">
                      {QUALIFICATION_LABELS[q]}
                    </Badge>
                  ))}
                </div>
                {profile?.octNumber && (
                  <p className="mt-3 text-sm">
                    <span className="text-ink-500">OCT number: </span>
                    <a
                      href={`https://apps.oct.ca/FindATeacher/memberdetail?id=${profile.octNumber}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-brand-600 hover:underline"
                    >
                      {profile.octNumber}
                      <ExternalLink className="ml-1 inline size-3" />
                    </a>
                  </p>
                )}
              </div>

              {profile?.experience?.length > 0 && (
                <div className="border-t border-ink-100 pt-4">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                    Experience
                  </h3>
                  <ul className="mt-2 space-y-3">
                    {profile.experience.map((entry, i) => (
                      <li key={i} className="text-sm">
                        <p className="font-semibold text-ink-900">{entry.title}</p>
                        <p className="text-ink-500">
                          {entry.organisation}
                          {entry.startYear && ` · ${entry.startYear}`}
                          {entry.current ? " – present" : entry.endYear ? `–${entry.endYear}` : ""}
                        </p>
                        {entry.description && (
                          <p className="mt-1 leading-relaxed text-ink-600">{entry.description}</p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Teaching" />
            <CardBody className="space-y-4">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">Courses</h3>
                <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                  {profile?.courses?.map((course) => (
                    <li
                      key={course.courseId}
                      className="flex items-center justify-between gap-2 rounded-lg border border-ink-200 px-3 py-2 text-sm"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-ink-900">
                          {course.code ? `${course.code} — ` : ""}
                          {course.name}
                        </span>
                        <span className="text-xs text-ink-500">
                          Grade {course.gradeLevel} · {course.yearsTeaching}y teaching
                        </span>
                      </span>
                      <span className="shrink-0 text-xs font-bold text-ink-700">
                        {formatRate(course.hourlyRateCents ?? profile.hourlyRateCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <dl className="grid gap-4 border-t border-ink-100 pt-4 text-sm sm:grid-cols-2">
                <Row
                  label="Lesson types"
                  value={profile?.lessonModes?.map((m) => LESSON_MODE_LABELS[m]).join(", ")}
                />
                <Row label="Standard rate" value={formatRate(profile?.hourlyRateCents ?? 0)} />
                <Row label="Languages" value={profile?.languages?.join(", ")} />
                <Row
                  label="Free intro"
                  value={profile?.offersFreeIntro ? "Yes" : "No"}
                />
              </dl>

              {data.AVAILABILITY?.weeklyRules?.length > 0 && (
                <div className="border-t border-ink-100 pt-4">
                  <h3 className="text-xs font-bold uppercase tracking-wide text-ink-400">
                    Availability
                  </h3>
                  <ul className="mt-2 space-y-1 text-sm">
                    {WEEKDAYS.map((day) => {
                      const rules = data.AVAILABILITY.weeklyRules.filter(
                        (r) => r.weekday === day.value,
                      );
                      if (!rules.length) return null;
                      return (
                        <li key={day.value} className="flex gap-3">
                          <span className="w-24 shrink-0 text-ink-500">{day.label}</span>
                          <span className="text-ink-800">
                            {rules
                              .map(
                                (r) =>
                                  `${minutesToLabel(r.startMinutes)}–${minutesToLabel(r.endMinutes)}`,
                              )
                              .join(", ")}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
          <ApplicationReview application={application} verification={verification} />

          <Card>
            <CardHeader
              title="Verification documents"
              description="Open each one before granting the matching badge."
            />
            <CardBody className="space-y-3">
              {verification.filter((r) => r.status !== VERIFICATION_STATUS.NOT_SUBMITTED).length ===
              0 ? (
                <p className="text-sm text-ink-500">No documents submitted.</p>
              ) : (
                verification
                  .filter((r) => r.status !== VERIFICATION_STATUS.NOT_SUBMITTED)
                  .map((record) => (
                    <div key={record.type} className="rounded-xl border border-ink-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-ink-900">{record.label}</p>
                        <Badge
                          tone={
                            record.status === VERIFICATION_STATUS.APPROVED
                              ? "success"
                              : record.status === VERIFICATION_STATUS.REJECTED
                                ? "danger"
                                : "warning"
                          }
                          size="sm"
                        >
                          {record.status.toLowerCase().replace(/_/g, " ")}
                        </Badge>
                      </div>
                      {record.documents?.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {record.documents.map((docFile) => (
                            <li key={docFile.id}>
                              <a
                                href={`/api/admin/verification/documents/${docFile.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
                              >
                                <FileText className="size-3" />
                                {docFile.fileName}
                                <ExternalLink className="size-3" />
                              </a>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-ink-400">No document uploaded</p>
                      )}
                    </div>
                  ))
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </DashboardPage>
  );
}

function Row({ icon, label, value }) {
  if (!value) return null;
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-ink-400">
        {icon}
        {label}
      </dt>
      <dd className="mt-0.5 font-medium text-ink-800">{value}</dd>
    </div>
  );
}
