import { routeHandler, ok } from "@/lib/api";
import { PERMISSIONS } from "@/constants";
import { listIntegrationModules } from "@/services/integration.service";

/**
 * Every external module's configuration and status (§26, §36).
 *
 * Read-only, and deliberately incapable of returning a credential: the
 * service reduces every secret to `{ set, updatedAt }` before this route ever
 * sees it, so there is no code path here that could leak one by accident.
 * `bun run qa` asserts the response body matches no key format.
 *
 * `ADMIN_INTEGRATION_MANAGE` rather than `ADMIN_SETTINGS_MANAGE` — rotating a
 * payment credential is a different act from editing the footer, and holding
 * them apart means a future limited-administrator role can be given one
 * without the other.
 */
export const GET = routeHandler(async () => ok(await listIntegrationModules()), {
  permission: PERMISSIONS.ADMIN_INTEGRATION_MANAGE,
});
