/**
 * Server start-up hook.
 *
 * Configuration is validated once, before the first request is served. In
 * development a problem is a warning so the app stays usable; in production a
 * misconfigured integration stops the server coming up at all, rather than
 * letting it serve a marketplace whose payments or email are quietly fake
 * (§38).
 *
 * ## Why this reads the database
 *
 * Provider credentials may now be stored as well as deployed (§26), so
 * validating the environment alone would have made this gate lie in both
 * directions: it would refuse to start a deployment whose Stripe key lives in
 * the admin settings, and it would pass a deployment whose stored
 * configuration is broken. So the environment check runs first — it is the
 * one that can never fail to run — and the merged, database-aware check runs
 * behind it.
 *
 * The database check is deliberately forgiving of the database itself being
 * unreachable at boot. A container that starts a second before Mongo accepts
 * connections should retry a request, not refuse to exist; the environment
 * gate has already proved the deployment has a valid configuration to fall
 * back on.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertConfiguration, appEnv, integrationStatus, isProduction } = await import(
    "@/lib/config/env"
  );

  // Environment-level gate. Unchanged: this is what refuses to boot a
  // production deployment with no configuration at all.
  assertConfiguration();

  const rows = integrationStatus()
    .map((s) => `  ${s.ok ? (s.mode === "production" ? "●" : "○") : "✗"} ${s.label.padEnd(14)} ${s.providerLabel}`)
    .join("\n");
  console.info(`\nAPlus Learn — APP_ENV=${appEnv()}\n${rows}\n`);

  await reportStoredConfiguration(isProduction());
}

/**
 * The merged view, for the modules an operator can edit.
 *
 * Reported rather than asserted, and the distinction matters: a stored
 * configuration that is broken should be loud, but it must not be able to
 * take a running deployment down on the next restart when the environment
 * behind it is still perfectly valid. The module's own factory refuses at the
 * point of use, which fails the one request that needed it instead of all of
 * them.
 */
async function reportStoredConfiguration(production) {
  try {
    const { connectToDatabase } = await import("@/lib/db/connect");
    // Deliberately the reporting module, not the resolver: a boot report has
    // no business decrypting a credential, and the resolver's `node:crypto`
    // would be traced into the Edge instrumentation bundle.
    const { integrationBootReport } = await import("@/lib/config/integration-report");

    await connectToDatabase();
    const stored = await integrationBootReport();
    if (!stored.length) return;

    const lines = stored.map((m) => {
      const mark = !m.enabled ? "⊘" : m.configured ? "●" : "✗";
      const state = !m.enabled
        ? "disabled"
        : m.configured
          ? m.provider
          : `incomplete — needs ${m.missing.join(", ")}`;
      return `  ${mark} ${m.label.padEnd(14)} ${state}`;
    });
    console.info(`Configured from the admin panel:\n${lines.join("\n")}\n`);

    const broken = stored.filter((m) => m.enabled && !m.configured);
    if (broken.length) {
      const detail = broken
        .map((m) => `  • ${m.label} is incomplete: ${m.missing.join(", ")}.`)
        .join("\n");
      console.warn(
        `\n${production ? "PRODUCTION " : ""}stored integration problems — these modules will refuse at the point of use:\n${detail}\n`,
      );
    }
  } catch (error) {
    // Boot must not depend on the database being up yet.
    console.warn(`[startup] stored integration configuration not read: ${error.message}`);
  }
}
