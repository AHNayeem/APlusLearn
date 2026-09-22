import { z } from "zod";
import { SUPPORT_TOPICS } from "@/constants";
import { email, personName } from "./common";

/**
 * The enquiry the floating support launcher sends (§37).
 *
 * `name` and `email` are optional *in the schema* and required by the service,
 * because whether they are needed depends on something a schema cannot see:
 * a signed-in enquiry takes both from the session and ignores whatever the
 * payload claims, exactly as every other endpoint derives state server-side.
 * A guest gets the field errors back from the service instead.
 */
export const supportEnquirySchema = z.object({
  name: personName.optional(),
  email: email.optional(),
  topic: z.enum(Object.values(SUPPORT_TOPICS)).default(SUPPORT_TOPICS.OTHER),
  message: z
    .string()
    .trim()
    .min(15, "Tell us a little more — at least 15 characters.")
    .max(2000, "Please keep this under 2000 characters."),
  /**
   * The page they were on. Support's first question is always "where were
   * you?", so it travels with the message. Constrained to a same-site path
   * with no scheme, so nothing a bot injects can turn the email we send into
   * a link to somewhere else.
   */
  path: z
    .string()
    .trim()
    .max(200)
    .regex(/^\/[^\s]*$/, "Not a valid page.")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  /**
   * Honeypot. Hidden from people, irresistible to form-filling bots. A filled
   * value is answered with the same success the real path returns, because
   * telling a bot it was detected only teaches it to try again differently.
   */
  website: z.string().max(200).optional(),
});
