import { routeHandler, ok, paginationMeta } from "@/lib/api";
import { auditLogQuerySchema } from "@/lib/validation/admin";
import { listAuditEvents, auditEntityTypes } from "@/services/audit.service";
import { PERMISSIONS } from "@/constants";

/**
 * The platform-wide audit trail (§35).
 *
 * Read-only, and there is no sibling POST/PATCH/DELETE on purpose: the log is
 * append-only and the only writer is `recordAudit`, called from the action
 * being recorded. An endpoint that could edit a row would make the whole
 * collection worthless as evidence.
 *
 * Behind `ADMIN_AUDIT_VIEW` rather than `ADMIN_SETTINGS_MANAGE`, so reading
 * what administrators did is a right that can be granted without also
 * granting the ability to change the platform. The service redacts credential
 * values out of the stored metadata on the way out.
 */
export const GET = routeHandler(
  async ({ query }) => {
    const [{ items, total, page, pageSize }, entityTypes] = await Promise.all([
      listAuditEvents(query),
      auditEntityTypes(),
    ]);

    return ok(
      { events: items, entityTypes },
      { meta: paginationMeta({ page, pageSize, total }) },
    );
  },
  {
    permission: PERMISSIONS.ADMIN_AUDIT_VIEW,
    querySchema: auditLogQuerySchema,
  },
);
