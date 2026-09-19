"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, Check } from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, Field, Modal, Select,
  FormErrorSummary, useToast,
} from "@/components/ui";
import { formatMoney, formatDuration } from "@/lib/utils/format";

/**
 * Packages on a tutor's public profile (§41 Phase 2).
 *
 * The saving is shown against the tutor's own rate, which is the number the
 * platform enforces the package against — so the claim on the card is the
 * same one the server checked, not marketing.
 */
export function PackageOffers({ packages, tutor, students, signedIn }) {
  const [buying, setBuying] = useState(null);

  if (!packages?.length) return null;

  return (
    <Card id="packages">
      <CardHeader
        title="Lesson packages"
        description="Pay for a block up front and book the lessons whenever suits you."
      />
      <CardBody className="grid gap-4 sm:grid-cols-2">
        {packages.map((pkg) => (
          <div key={pkg.id} className="flex flex-col rounded-xl border border-ink-200 p-4">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-bold text-ink-900">{pkg.title}</h3>
              {pkg.savingPercent > 0 && (
                <Badge tone="accent" size="sm">
                  Save {pkg.savingPercent}%
                </Badge>
              )}
            </div>

            <p className="mt-2 text-2xl font-extrabold text-ink-900">
              {formatMoney(pkg.priceCents)}
            </p>
            <p className="text-xs text-ink-500">
              {pkg.sessionCount} × {formatDuration(pkg.sessionDurationMinutes)} —{" "}
              {formatMoney(pkg.perSessionCents)} a lesson
            </p>

            {pkg.description && (
              <p className="mt-3 text-sm leading-relaxed text-ink-600">{pkg.description}</p>
            )}

            <ul className="mt-3 space-y-1 text-xs text-ink-600">
              <li className="flex items-center gap-1.5">
                <Check className="size-3 text-success-600" />
                Book each lesson when it suits you
              </li>
              {pkg.validityDays && (
                <li className="flex items-center gap-1.5">
                  <Check className="size-3 text-success-600" />
                  Valid for {pkg.validityDays} days
                </li>
              )}
              <li className="flex items-center gap-1.5">
                <Check className="size-3 text-success-600" />
                Unused lessons refunded if you cancel
              </li>
            </ul>

            <Button
              className="mt-4"
              variant="secondary"
              onClick={() => setBuying(pkg)}
              iconLeft={<Package className="size-4" />}
            >
              {signedIn ? "Buy this package" : "Sign in to buy"}
            </Button>
          </div>
        ))}
      </CardBody>

      {buying && (
        <PurchaseDialog
          pkg={buying}
          tutor={tutor}
          students={students}
          signedIn={signedIn}
          onClose={() => setBuying(null)}
        />
      )}
    </Card>
  );
}

function PurchaseDialog({ pkg, tutor, students, signedIn, onClose }) {
  const router = useRouter();
  const toast = useToast();
  const [studentProfileId, setStudentProfileId] = useState(students?.[0]?.id ?? "");

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const result = await api.post("/api/packages", {
      packageId: pkg.id,
      studentProfileId,
    });
    toast.success("Package reserved", "Complete payment to start using it.");
    router.push(`/bookings/checkout/${result.payment.id}`);
    return result;
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={pkg.title}
      description={`${pkg.sessionCount} lessons with ${tutor.displayName} for ${formatMoney(pkg.priceCents)}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          {signedIn ? (
            <Button onClick={submit} loading={pending} disabled={!studentProfileId}>
              Continue to payment
            </Button>
          ) : (
            <Button href={`/login?next=/tutors/${tutor.slug}%23packages`}>Sign in</Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        {!signedIn ? (
          <Alert tone="info" title="Sign in to buy a package">
            Packages are tied to a learner on your account, so you need to be signed in.
          </Alert>
        ) : students?.length === 0 ? (
          <Alert tone="warning" title="Add a child first">
            A package belongs to one learner, so we need to know who it is for.
          </Alert>
        ) : (
          <Field label="Who is it for?" htmlFor="pkg-student" required>
            <Select
              id="pkg-student"
              value={studentProfileId}
              onChange={(e) => setStudentProfileId(e.target.value)}
            >
              {students.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.firstName}
                  {student.gradeName ? ` · ${student.gradeName}` : ""}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <p className="text-xs leading-relaxed text-ink-500">
          You book each lesson separately, whenever suits you. Cancel with enough notice and the
          lesson goes back into the package; cancel the package itself and the lessons you
          haven&rsquo;t used are refunded.
        </p>
      </div>
    </Modal>
  );
}
