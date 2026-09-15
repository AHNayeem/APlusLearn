import "server-only";
import { FEATURE_LABELS } from "@/constants";
import { isFeatureEnabled } from "@/services/settings.service";
import { AuthorizationError } from "./errors";

/**
 * Feature-flag enforcement (§26).
 *
 * Hiding a button is a courtesy to the person looking at the screen. It is not
 * a control: the endpoint is still there, still documented by its own error
 * messages, and still one `fetch` away. So every flag is checked here, on the
 * server, in the same pipeline position as a permission — and `bun run qa`
 * asserts a disabled feature refuses a direct API call.
 *
 * A disabled feature answers 403 rather than 404: the route exists, the
 * operator turned it off, and saying so plainly is more useful to a support
 * conversation than pretending the endpoint was never there.
 */
export async function requireFeature(feature) {
  if (await isFeatureEnabled(feature)) return true;

  throw new AuthorizationError(
    `${FEATURE_LABELS[feature] ?? "That feature"} is currently switched off on this platform.`,
  );
}
