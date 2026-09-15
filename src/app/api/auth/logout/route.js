import { routeHandler, ok } from "@/lib/api";
import { destroySessionCookie } from "@/lib/auth/session";
import { recordAudit } from "@/services/audit.service";
import { AUDIT_ACTIONS } from "@/constants";

export const POST = routeHandler(
  async ({ request, user }) => {
    if (user) {
      await recordAudit({
        actor: user,
        action: AUDIT_ACTIONS.USER_LOGOUT,
        entityType: "User",
        entityId: user.id,
        request,
      });
    }
    await destroySessionCookie();
    return ok({ signedOut: true });
  },
  { database: true },
);
