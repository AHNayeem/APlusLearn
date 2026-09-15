import { Card, CardBody, CardHeader, Badge, Alert, Table, THead, TH, TBody, TR, TD } from "@/components/ui";

/**
 * Which external services this deployment is actually talking to (§38).
 *
 * A server component on purpose: it reports configuration, and configuration
 * is never sent to the browser. Provider *names* are shown; no key, secret or
 * endpoint credential appears here or in the props it receives (§36).
 */
export function IntegrationHealth({ appEnv, integrations, webhooks = [] }) {
  const problems = integrations.filter((i) => !i.ok);
  const fakes = integrations.filter((i) => i.ok && i.mode === "development");

  return (
    <Card>
      <CardHeader
        title="Integrations"
        description={`Running with APP_ENV=${appEnv}.`}
        action={
          <Badge tone={problems.length ? "danger" : fakes.length ? "warning" : "success"} size="sm">
            {problems.length
              ? `${problems.length} misconfigured`
              : fakes.length
                ? `${fakes.length} in development mode`
                : "All production"}
          </Badge>
        }
      />
      <CardBody className="p-0">
        {problems.length > 0 && (
          <Alert tone="danger" title="Configuration problems" className="m-5 mb-0">
            <ul className="mt-1 list-disc space-y-1 pl-4">
              {problems.map((p) => (
                <li key={p.key}>{p.error}</li>
              ))}
            </ul>
          </Alert>
        )}

        {appEnv !== "production" && fakes.length > 0 && (
          <Alert tone="info" title="Development providers are in use" className="m-5 mb-0">
            No real money moves and no real email is sent for the services marked below.
          </Alert>
        )}

        <Table className="min-w-[520px]">
          <THead>
            <TH>Integration</TH>
            <TH>Provider</TH>
            <TH>Mode</TH>
          </THead>
          <TBody>
            {integrations.map((row) => (
              <TR key={row.key}>
                <TD className="font-semibold text-ink-900">{row.label}</TD>
                <TD className="text-sm">{row.providerLabel}</TD>
                <TD>
                  <Badge
                    size="sm"
                    tone={!row.ok ? "danger" : row.mode === "production" ? "success" : "warning"}
                  >
                    {!row.ok ? "Misconfigured" : row.mode === "production" ? "Production" : "Development"}
                  </Badge>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>

        {webhooks.length > 0 && (
          <div className="border-t border-ink-100 p-5">
            <h3 className="mb-3 text-sm font-semibold text-ink-900">Recent webhook deliveries</h3>
            <ul className="space-y-1.5 text-xs text-ink-600">
              {webhooks.map((event) => (
                <li key={event.id} className="flex flex-wrap items-center gap-2">
                  <Badge
                    size="sm"
                    tone={
                      event.status === "PROCESSED"
                        ? "success"
                        : event.status === "FAILED"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {event.status}
                  </Badge>
                  <span className="font-medium text-ink-900">{event.type}</span>
                  {event.result && <span>— {event.result}</span>}
                  {!event.livemode && <Badge size="sm" tone="warning">test</Badge>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
