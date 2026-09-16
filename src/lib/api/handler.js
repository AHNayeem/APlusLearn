import "server-only";
import { connectToDatabase } from "@/lib/db/connect";
import { getCurrentUser } from "@/lib/auth/current-user";
import { requireVerifiedEmail } from "@/lib/auth/assert";
import { roleHasPermission } from "@/lib/permissions";
import { AuthenticationError, AuthorizationError, ValidationError, zodToDetails } from "./errors";
import { requireFeature } from "./features";
import { failFromError } from "./response";

/**
 * The single request pipeline every API route runs through (§6):
 *
 *   Request -> Database -> Authentication -> Role -> Permission
 *           -> Email verification -> Feature -> Validation -> Service
 *           -> Response
 *
 * Declaring the requirements as options rather than writing them inline keeps
 * every endpoint's contract visible at a glance, and makes it impossible to
 * forget a check.
 */
export function routeHandler(handler, options = {}) {
  const {
    auth = false,
    roles = null,
    permission = null,
    /** Actions that need a confirmed email address behind the account (§9). */
    verifiedEmail = false,
    /** Platform feature toggle this endpoint belongs to (§26). */
    feature = null,
    bodySchema = null,
    querySchema = null,
    paramsSchema = null,
    /** Skip the DB connection for routes that don't touch Mongo. */
    database = true,
  } = options;

  return async function handleRequest(request, context) {
    try {
      if (database) await connectToDatabase();

      // 1. Authentication
      let user = null;
      const needsUser = auth || roles || permission;
      if (needsUser) {
        user = await getCurrentUser();
        if (!user) throw new AuthenticationError();
      } else {
        // Optional: public endpoints may still personalise for a known user.
        user = await getCurrentUser();
      }

      // 2. Role
      if (roles) {
        const allowed = [roles].flat();
        if (!allowed.includes(user.role)) {
          throw new AuthorizationError("Your account type does not have access to this.");
        }
      }

      // 3. Permission
      if (permission && !roleHasPermission(user.role, permission)) {
        throw new AuthorizationError("You do not have permission to do that.");
      }

      // 4. Email verification — an account-security gate, not a role one, so
      //    it sits after the permission table and before anything is done.
      if (verifiedEmail) requireVerifiedEmail(user);

      // 5. Feature availability — an operator switch, checked after identity
      //    so a signed-out caller still gets 401 rather than a hint about
      //    which modules this platform runs.
      if (feature) await requireFeature(feature);

      // 6. Validation — route params, query string, then body
      const rawParams = context?.params ? await context.params : {};
      const params = paramsSchema ? parseOrThrow(paramsSchema, rawParams) : rawParams;

      const rawQuery = Object.fromEntries(new URL(request.url).searchParams.entries());
      const query = querySchema ? parseOrThrow(querySchema, rawQuery) : rawQuery;

      let body;
      if (bodySchema) {
        body = parseOrThrow(bodySchema, await readJson(request));
      }

      // 7. Service (the handler delegates; business logic never lives here)
      return await handler({ request, user, params, query, body, context });
    } catch (error) {
      return failFromError(error);
    }
  };
}

function parseOrThrow(schema, value) {
  const result = schema.safeParse(value);
  if (!result.success) throw new ValidationError(zodToDetails(result.error));
  return result.data;
}

async function readJson(request) {
  try {
    const text = await request.text();
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ValidationError({ fieldErrors: { _: ["Request body must be valid JSON."] } });
  }
}
