/**
 * Server start-up hook.
 *
 * Configuration is validated once, before the first request is served. In
 * development a problem is a warning so the app stays usable; in production a
 * misconfigured integration stops the server coming up at all, rather than
 * letting it serve a marketplace whose payments or email are quietly fake
 * (§38).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertConfiguration, appEnv, integrationStatus } = await import("@/lib/config/env");

  assertConfiguration();

  const rows = integrationStatus()
    .map((s) => `  ${s.ok ? (s.mode === "production" ? "●" : "○") : "✗"} ${s.label.padEnd(14)} ${s.providerLabel}`)
    .join("\n");
  console.info(`\nAPlus Learn — APP_ENV=${appEnv()}\n${rows}\n`);
}
