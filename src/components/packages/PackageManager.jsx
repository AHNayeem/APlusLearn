"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Package, Pencil, Archive, Play, Pause } from "lucide-react";
import { api, qs } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, Input,
  Modal, Select, Textarea, FormErrorSummary, useToast,
} from "@/components/ui";
import {
  PACKAGE_STATUS, PACKAGE_STATUS_LABELS, LESSON_MODES, LESSON_MODE_LABELS,
  LESSON_DURATIONS,
} from "@/constants";
import { formatMoney, formatDuration } from "@/lib/utils/format";

/**
 * A tutor's package offers (§41 Phase 2).
 *
 * The form shows what the price works out to per hour as it is typed, because
 * that is the number the platform actually checks: a package may not cost
 * more per hour than the same lessons booked one at a time. Seeing it before
 * submitting turns a refusal into a decision.
 */
export function PackageManager({ initial, courses, standardRateCents }) {
  const router = useRouter();
  const [packages, setPackages] = useState(initial ?? []);
  const [editing, setEditing] = useState(null);
  const toast = useToast();

  const setStatus = async (pkg, status) => {
    try {
      const { package: updated } = await api.post(`/api/tutor/packages/${pkg.id}`, { status });
      setPackages((current) => current.map((p) => (p.id === pkg.id ? updated : p)));
      toast.success(
        status === PACKAGE_STATUS.ACTIVE
          ? "Package is on sale"
          : status === PACKAGE_STATUS.ARCHIVED
            ? "Package archived"
            : "Package paused",
        status === PACKAGE_STATUS.ARCHIVED
          ? "Lessons families already bought are unaffected."
          : undefined,
      );
      router.refresh();
    } catch (error) {
      toast.error("Couldn't update that", error.message);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Your packages"
        description="Blocks of lessons families can buy up front."
        action={
          <Button
            size="sm"
            onClick={() => setEditing({})}
            disabled={courses.length === 0}
            iconLeft={<Plus className="size-4" />}
          >
            New package
          </Button>
        }
      />
      <CardBody className="space-y-4">
        {courses.length === 0 && (
          <Alert tone="neutral" title="Add a course first">
            A package is for a specific course, so you need at least one on your profile.
          </Alert>
        )}

        {packages.length === 0 ? (
          <EmptyState
            icon={<Package className="size-7" />}
            title="No packages yet"
            description="Families who commit to a block of lessons show up more consistently — and it saves them money."
          />
        ) : (
          packages.map((pkg) => (
            <div key={pkg.id} className="rounded-xl border border-ink-200 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-sm font-bold text-ink-900">{pkg.title}</h3>
                    <Badge
                      tone={pkg.status === PACKAGE_STATUS.ACTIVE ? "success" : "neutral"}
                      size="sm"
                    >
                      {PACKAGE_STATUS_LABELS[pkg.status]}
                    </Badge>
                    {pkg.savingPercent > 0 && (
                      <Badge tone="accent" size="sm">
                        Saves {pkg.savingPercent}%
                      </Badge>
                    )}
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {pkg.courseCode ? `${pkg.courseCode} · ` : ""}
                    {pkg.sessionCount} × {formatDuration(pkg.sessionDurationMinutes)} ·{" "}
                    {LESSON_MODE_LABELS[pkg.mode]}
                  </p>
                  <p className="mt-2 text-sm">
                    <span className="font-bold text-ink-900">{formatMoney(pkg.priceCents)}</span>
                    <span className="text-ink-500">
                      {" "}
                      — {formatMoney(pkg.perSessionCents)} a lesson,{" "}
                      {formatMoney(pkg.effectiveHourlyRateCents)}/hour
                    </span>
                  </p>
                  {pkg.stats?.purchases > 0 && (
                    <p className="mt-1 text-xs text-ink-500">
                      {pkg.stats.purchases} sold · {pkg.stats.sessionsDelivered} lessons delivered
                    </p>
                  )}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setEditing(pkg)}
                    iconLeft={<Pencil className="size-3.5" />}
                  >
                    Edit
                  </Button>
                  {pkg.status === PACKAGE_STATUS.ACTIVE ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setStatus(pkg, PACKAGE_STATUS.PAUSED)}
                      iconLeft={<Pause className="size-3.5" />}
                    >
                      Pause
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setStatus(pkg, PACKAGE_STATUS.ACTIVE)}
                      iconLeft={<Play className="size-3.5" />}
                    >
                      Put on sale
                    </Button>
                  )}
                  <Button
                    variant="dangerGhost"
                    size="xs"
                    onClick={() => setStatus(pkg, PACKAGE_STATUS.ARCHIVED)}
                    iconLeft={<Archive className="size-3.5" />}
                  >
                    Archive
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </CardBody>

      {editing && (
        <PackageForm
          pkg={editing.id ? editing : null}
          courses={courses}
          standardRateCents={standardRateCents}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setPackages((current) =>
              current.some((p) => p.id === saved.id)
                ? current.map((p) => (p.id === saved.id ? saved : p))
                : [saved, ...current],
            );
            setEditing(null);
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}

function PackageForm({ pkg, courses, standardRateCents, onClose, onSaved }) {
  const toast = useToast();
  const editing = Boolean(pkg);

  const [form, setForm] = useState({
    title: pkg?.title ?? "",
    description: pkg?.description ?? "",
    courseId: pkg?.courseId ?? courses[0]?.courseId ?? "",
    sessionCount: pkg?.sessionCount ?? 5,
    sessionDurationMinutes: pkg?.sessionDurationMinutes ?? 60,
    mode: pkg?.mode ?? LESSON_MODES.ONLINE,
    price: pkg ? String(pkg.priceCents / 100) : "",
    validityDays: pkg?.validityDays ?? "",
  });

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const priceCents = Math.round(Number(form.price || 0) * 100);
  const perSession = form.sessionCount > 0 ? Math.floor(priceCents / form.sessionCount) : 0;
  const perHour =
    form.sessionDurationMinutes > 0
      ? Math.round((perSession * 60) / form.sessionDurationMinutes)
      : 0;

  // The same comparison the server makes, shown before it is made.
  const courseRate =
    courses.find((c) => c.courseId === form.courseId)?.hourlyRateCents ?? standardRateCents;
  const tooExpensive = priceCents > 0 && courseRate > 0 && perHour > courseRate;

  const { submit, pending, error, fieldErrors } = useSubmit(async () => {
    const payload = {
      title: form.title,
      description: form.description || undefined,
      sessionCount: Number(form.sessionCount),
      sessionDurationMinutes: Number(form.sessionDurationMinutes),
      priceCents,
      validityDays: form.validityDays ? Number(form.validityDays) : undefined,
    };

    const result = editing
      ? await api.patch(`/api/tutor/packages/${pkg.id}`, payload)
      : await api.post("/api/tutor/packages", {
          ...payload,
          courseId: form.courseId,
          mode: form.mode,
        });

    toast.success(editing ? "Package updated" : "Package created",
      editing ? undefined : "It stays a draft until you put it on sale.");
    onSaved(result.package);
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={editing ? "Edit package" : "New package"}
      description="Families pay once and book the lessons whenever suits them."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!form.title || !priceCents}>
            {editing ? "Save changes" : "Create package"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <FormErrorSummary error={error} fieldErrors={fieldErrors} />

        <Field label="Name" htmlFor="pkg-title" error={fieldErrors.title} required>
          <Input
            id="pkg-title"
            value={form.title}
            onChange={(e) => set("title", e.target.value)}
            maxLength={120}
            error={fieldErrors.title}
            placeholder="MHF4U exam block — 10 lessons"
          />
        </Field>

        {!editing && (
          <Field label="Course" htmlFor="pkg-course" error={fieldErrors.courseId} required>
            <Select
              id="pkg-course"
              value={form.courseId}
              onChange={(e) => set("courseId", e.target.value)}
            >
              {courses.map((course) => (
                <option key={course.courseId} value={course.courseId}>
                  {course.code ? `${course.code} — ` : ""}
                  {course.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Number of lessons" htmlFor="pkg-count" error={fieldErrors.sessionCount}>
            <Input
              id="pkg-count"
              type="number"
              min={2}
              max={50}
              value={form.sessionCount}
              onChange={(e) => set("sessionCount", e.target.value)}
              error={fieldErrors.sessionCount}
            />
          </Field>
          <Field label="Lesson length" htmlFor="pkg-duration">
            <Select
              id="pkg-duration"
              value={form.sessionDurationMinutes}
              onChange={(e) => set("sessionDurationMinutes", Number(e.target.value))}
            >
              {LESSON_DURATIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {formatDuration(minutes)}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Price for the whole block"
          htmlFor="pkg-price"
          error={fieldErrors.priceCents}
          required
        >
          <Input
            id="pkg-price"
            type="number"
            inputMode="decimal"
            min={0}
            step="1"
            value={form.price}
            onChange={(e) => set("price", e.target.value)}
            error={fieldErrors.priceCents}
            placeholder="500"
          />
        </Field>

        {priceCents > 0 && (
          <div
            className={`rounded-xl border p-3 text-sm ${
              tooExpensive
                ? "border-danger-200 bg-danger-50 text-danger-700"
                : "border-ink-200 bg-ink-50 text-ink-700"
            }`}
          >
            <p>
              <span className="font-semibold">{formatMoney(perSession)}</span> a lesson —{" "}
              <span className="font-semibold">{formatMoney(perHour)}/hour</span>
            </p>
            {tooExpensive ? (
              <p className="mt-1 text-xs">
                That is more per hour than your standard rate of {formatMoney(courseRate)}. A
                package has to be worth buying — lower the price, or raise your rate.
              </p>
            ) : (
              courseRate > 0 && (
                <p className="mt-1 text-xs text-ink-500">
                  Your standard rate is {formatMoney(courseRate)}/hour, so families save{" "}
                  {Math.max(0, Math.round(((courseRate - perHour) / courseRate) * 100))}%.
                </p>
              )
            )}
          </div>
        )}

        <Field
          label="Valid for"
          htmlFor="pkg-validity"
          hint="Days after purchase. Leave blank for the platform default."
          error={fieldErrors.validityDays}
        >
          <Input
            id="pkg-validity"
            type="number"
            min={1}
            max={730}
            value={form.validityDays}
            onChange={(e) => set("validityDays", e.target.value)}
            error={fieldErrors.validityDays}
            className="max-w-32"
          />
        </Field>

        <Field label="Description" htmlFor="pkg-description" hint="Optional.">
          <Textarea
            id="pkg-description"
            rows={3}
            maxLength={1000}
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
          />
        </Field>
      </div>
    </Modal>
  );
}
