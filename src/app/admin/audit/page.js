import Link from "next/link";
import { ScrollText, Search, X } from "lucide-react";
import { connectToDatabase } from "@/lib/db/connect";
import { enforceRole } from "@/lib/auth/guards";
import { ROLES, AUDIT_ACTIONS, ROLE_LABELS } from "@/constants";
import { listAuditEvents, auditEntityTypes } from "@/services/audit.service";
import { auditLogQuerySchema } from "@/lib/validation/admin";
import {
  Alert, Badge, Button, Card, CardBody, EmptyState, Pagination,
  Table, THead, TH, TBody, TR, TD,
} from "@/components/ui";
import { DashboardPage, PageHeader } from "@/components/layout/DashboardShell";
import { formatDateTime, formatRelative } from "@/lib/utils/format";

export const metadata = { title: "Audit log", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const ACTIONS = Object.values(AUDIT_ACTIONS).sort();

/** "REFUND_ISSUED" → "Refund issued". */
function actionLabel(action) {
  const words = String(action).replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The colour says what *kind* of act it was, not whether it went well.
 * Money and account restrictions are the two an operator scans for.
 */
function actionTone(action) {
  if (/REFUND|SUSPENDED|DELETED|REVOKED|CANCELLED|FAILED|REJECTED/.test(action)) return "danger";
  if (/SECRET|INTEGRATION|SETTINGS|CREDIT|PAYOUT|PAYMENT/.test(action)) return "warning";
  if (/APPROVED|GRANTED|QUALIFIED|SETTLED|PUBLISHED/.test(action)) return "success";
  return "neutral";
}

const FIELD =
  "h-10 w-full rounded-xl border-0 bg-white px-3 text-sm ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none";

/**
 * The platform-wide audit trail (§35).
 *
 * The write side of auditing was already complete — thirty-odd call sites
 * record registrations, logins, refunds, verification decisions, settings and
 * credential changes, promotions, risk decisions and every scheduled job run.
 * What was missing was anywhere to read them except one account at a time,
 * which meant "when did the Stripe key last change" and "who refunded this
 * lesson" had no answer an operator could reach.
 *
 * Filters compose, and each one is a plain query parameter, so a view is a
 * URL somebody can paste into a ticket. Credential values are redacted by the
 * service before they reach this page, not here — a second reader of the same
 * collection must not be able to skip the rule.
 */
export default async function AdminAuditPage({ searchParams }) {
  await enforceRole(ROLES.ADMIN, "/admin/audit");
  await connectToDatabase();

  const raw = await searchParams;
  const parsed = auditLogQuerySchema.safeParse(raw);
  const params = parsed.success ? parsed.data : auditLogQuerySchema.parse({});

  const [{ items, total, page, pageSize }, entityTypes] = await Promise.all([
    listAuditEvents(params),
    auditEntityTypes(),
  ]);

  const filtered = Boolean(
    params.action || params.entityType || params.entityId || params.actorId || params.from || params.to,
  );

  const hrefFor = (nextPage) => {
    const query = new URLSearchParams();
    for (const key of ["action", "entityType", "entityId", "actorId", "from", "to"]) {
      if (params[key]) query.set(key, params[key]);
    }
    query.set("page", String(nextPage));
    return `/admin/audit?${query}`;
  };

  return (
    <DashboardPage>
      <PageHeader
        title="Audit log"
        description="Every security-relevant and administrative action on the platform, newest first."
      />

      <Alert tone="info" className="mb-6">
        This record is append-only — nothing in the product edits or deletes a row. Credential
        values are never stored here and are redacted on the way out, so a rotation shows which
        field changed and who changed it, never the key itself.
      </Alert>

      <Card>
        <CardBody>
          <form
            action="/admin/audit"
            className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6"
          >
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-600">Action</span>
              <select name="action" defaultValue={params.action ?? ""} className={FIELD}>
                <option value="">Any action</option>
                {ACTIONS.map((action) => (
                  <option key={action} value={action}>
                    {actionLabel(action)}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-600">Entity type</span>
              <select name="entityType" defaultValue={params.entityType ?? ""} className={FIELD}>
                <option value="">Any entity</option>
                {entityTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-600">Entity ID</span>
              <input
                name="entityId"
                defaultValue={params.entityId ?? ""}
                placeholder="24-character id"
                className={FIELD}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-600">Actor ID</span>
              <input
                name="actorId"
                defaultValue={params.actorId ?? ""}
                placeholder="24-character id"
                className={FIELD}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-600">From</span>
              <input
                type="date"
                name="from"
                defaultValue={(params.from ?? "").slice(0, 10)}
                className={FIELD}
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-ink-600">
                To <span className="font-normal text-ink-400">(inclusive)</span>
              </span>
              <input
                type="date"
                name="to"
                defaultValue={(params.to ?? "").slice(0, 10)}
                className={FIELD}
              />
            </label>

            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3 xl:col-span-6">
              <Button type="submit" size="sm" iconLeft={<Search className="size-4" />}>
                Apply filters
              </Button>
              {filtered && (
                <Button
                  href="/admin/audit"
                  variant="ghost"
                  size="sm"
                  iconLeft={<X className="size-4" />}
                >
                  Clear
                </Button>
              )}
            </div>
          </form>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardBody className="p-0">
          {items.length === 0 ? (
            <EmptyState
              icon={<ScrollText className="size-7" />}
              title="No matching events"
              description={
                filtered
                  ? "Nothing was recorded that matches these filters. Try widening the period."
                  : "Nothing has been recorded yet."
              }
            />
          ) : (
            <Table className="min-w-[900px]">
              <THead>
                <TH>When</TH>
                <TH>Action</TH>
                <TH>Actor</TH>
                <TH>Entity</TH>
                <TH>Details</TH>
              </THead>
              <TBody>
                {items.map((event) => (
                  <TR key={event.id}>
                    <TD className="whitespace-nowrap text-xs text-ink-500">
                      <span className="block font-medium text-ink-800">
                        {formatRelative(event.createdAt)}
                      </span>
                      {formatDateTime(event.createdAt)}
                    </TD>

                    <TD>
                      <Badge tone={actionTone(event.action)} size="sm">
                        {actionLabel(event.action)}
                      </Badge>
                    </TD>

                    <TD className="text-xs">
                      {event.actorId ? (
                        <>
                          <Link
                            href={`/admin/users/${event.actorId.id}`}
                            className="font-semibold text-brand-700 hover:underline"
                          >
                            {event.actorId.firstName} {event.actorId.lastName}
                          </Link>
                          <span className="block text-ink-400">
                            {ROLE_LABELS[event.actorRole] ?? event.actorRole ?? "—"}
                          </span>
                        </>
                      ) : (
                        <span className="text-ink-400">System</span>
                      )}
                      {event.ip && <span className="block text-[11px] text-ink-400">{event.ip}</span>}
                    </TD>

                    <TD className="text-xs">
                      {event.entityType ? (
                        <>
                          <span className="font-medium text-ink-800">{event.entityType}</span>
                          {event.entityId && (
                            <Link
                              href={`/admin/audit?entityType=${event.entityType}&entityId=${event.entityId}`}
                              className="mt-0.5 block font-mono text-[11px] text-ink-400 hover:text-brand-700 hover:underline"
                            >
                              {event.entityId}
                            </Link>
                          )}
                        </>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </TD>

                    <TD className="text-xs">
                      {event.metadata && Object.keys(event.metadata).length > 0 ? (
                        <pre className="max-w-sm whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-ink-600">
                          {JSON.stringify(event.metadata, null, 1)}
                        </pre>
                      ) : (
                        <span className="text-ink-400">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardBody>
      </Card>

      <Pagination
        className="mt-6"
        page={page}
        totalPages={Math.max(1, Math.ceil(total / pageSize))}
        total={total}
        pageSize={pageSize}
        label="events"
        buildHref={hrefFor}
      />
    </DashboardPage>
  );
}
