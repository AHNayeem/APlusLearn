import { SITE, FEATURES } from "@/constants";
import { getCurrentUser } from "@/lib/auth/current-user";
import { getAppConfig } from "@/services/settings.service";
import { messagesPathForRole, whatsappLink } from "@/lib/support/channels";
import { FloatingChatWidget } from "./FloatingChatWidget";

/**
 * Resolves who is looking and what the platform offers them, then hands the
 * client widget the finished answer (§26b).
 *
 * A Server Component for the same reason the public layout is one: the session
 * is read on the server and only the small, safe subset the launcher renders —
 * a display name, the address a reply goes to — is serialised to the browser.
 *
 * Nothing here may take a page down. It is mounted in the root layout, so a
 * slow database or an unreadable settings document would otherwise break every
 * route in the application to render a help button; instead the widget is
 * simply absent, and the support page, the footer and the header still carry
 * the same contact details.
 */
export async function SupportWidget() {
  let config;
  let user = null;

  try {
    [config, user] = await Promise.all([getAppConfig(), getCurrentUser()]);
  } catch (error) {
    /**
     * Next signals its own control flow by throwing — a redirect, a
     * `notFound()`, or the bail-out that marks a route dynamic the first time
     * a request reads cookies. Every one of those carries a `digest`, and every
     * one of them has to reach the framework: swallowing the dynamic bail-out
     * here would let a page be prerendered as though nobody were ever signed
     * in. Only a genuine failure — an unreachable database, an unreadable
     * settings document — costs the launcher.
     */
    if (typeof error?.digest === "string") throw error;
    console.warn("[support] launcher not rendered:", error.message);
    return null;
  }

  const { branding, contact, features } = config;
  const supportEmail = contact.supportEmail || SITE.supportEmail;

  /**
   * The prefill is the greeting, not the enquiry. WhatsApp puts it in the
   * composer for the sender to edit or delete, so it carries nothing about the
   * person or the page they came from — that would be handing their context to
   * a third party before they had decided to send anything.
   */
  const whatsappUrl = whatsappLink(
    contact.whatsappNumber,
    `Hi ${branding.appName}, I have a question.`,
  );

  /**
   * "Your messages" is only offered when there is somewhere to go: messaging is
   * an operator switch (§26b), and an administrator's workspace has no
   * conversation list of its own.
   */
  const messagesPath =
    user && features[FEATURES.MESSAGING] !== false ? messagesPathForRole(user.role) : null;

  return (
    <FloatingChatWidget
      whatsappUrl={whatsappUrl}
      whatsappLabel={`Chat with ${branding.appName} on WhatsApp`}
      supportEmail={supportEmail}
      messagesPath={messagesPath}
      account={user && { name: `${user.firstName} ${user.lastName}`.trim(), email: user.email }}
    />
  );
}
