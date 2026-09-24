import { routeHandler, ok } from "@/lib/api";
import { NotFoundError } from "@/lib/api/errors";
import { devMailQuerySchema } from "@/lib/validation/auth";
import { developmentMailboxEnabled } from "@/services/external/email-provider";
import { readDevMail } from "@/services/external/dev-mailbox";

/**
 * The development mailbox, for scripts (§38): what the console transport
 * "sent", newest first. This is how `bun run qa` and the browser journey read
 * the reset code a real inbox would have received.
 *
 * A 404 — not a 403 — anywhere it is not a development build with mail going
 * to the console, so a production deployment does not even admit it exists.
 */
export const GET = routeHandler(
  async ({ query }) => {
    if (!(await developmentMailboxEnabled())) throw new NotFoundError();
    return ok({ messages: readDevMail(query) });
  },
  { querySchema: devMailQuerySchema },
);
