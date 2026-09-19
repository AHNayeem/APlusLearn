"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CalendarSync, Link2, RefreshCw, Trash2, TriangleAlert, Check,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useSubmit } from "@/hooks/useAsync";
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, Field, Modal, Select,
  Switch, useToast,
} from "@/components/ui";
import {
  CALENDAR_PROVIDER_LABELS,
  CALENDAR_CONNECTION_STATUS,
  CALENDAR_CONNECTION_STATUS_LABELS,
} from "@/constants";
import { formatRelative } from "@/lib/utils/format";

/**
 * Connecting Google and Outlook calendars (§18, §41 Phase 2).
 *
 * Two directions, shown separately because they are separately useful: one
 * stops the platform offering time the tutor is already committed to, the
 * other puts lessons where the tutor actually looks. A tutor can want either
 * without the other.
 *
 * When the deployment has no credentials for a provider, the card says so
 * plainly and still works — against the platform's own development calendar —
 * rather than pretending a Google account is attached.
 */
export function CalendarConnections({ initial }) {
  const router = useRouter();
  const toast = useToast();
  const searchParams = useSearchParams();

  const [connections, setConnections] = useState(initial.connections ?? []);
  const [busyId, setBusyId] = useState(null);
  const [picking, setPicking] = useState(null);

  // The OAuth callback lands back here with its outcome in the query string.
  // It is read once and cleared, so a refresh does not repeat the message.
  useEffect(() => {
    const outcome = searchParams.get("calendar");
    if (!outcome) return;

    if (outcome === "connected") {
      toast.success("Calendar connected", "We'll keep your availability in step with it.");
    } else if (outcome === "cancelled") {
      toast.info("Connection cancelled", "Nothing was changed.");
    } else {
      const reason = searchParams.get("reason");
      toast.error(
        "Couldn't connect that calendar",
        reason && reason !== "failed" && reason !== "missing"
          ? reason
          : "The provider didn't complete the authorisation. Please try again.",
      );
    }

    router.replace("/tutor/calendar");
    // Runs once per arrival; `router.replace` clears the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async (provider) => {
    setBusyId(provider);
    try {
      const { authorizationUrl } = await api.post("/api/tutor/calendar/connect", { provider });
      // A full navigation, not a fetch: the consent screen is the provider's,
      // and it will not render in a request we made ourselves.
      window.location.assign(authorizationUrl);
    } catch (error) {
      toast.error("Couldn't start the connection", error.message);
      setBusyId(null);
    }
  };

  const patch = async (id, body, message) => {
    setBusyId(id);
    try {
      const { connection } = await api.patch(`/api/tutor/calendar/connections/${id}`, body);
      setConnections((current) => current.map((c) => (c.id === id ? connection : c)));
      if (message) toast.success(message);
      router.refresh();
    } catch (error) {
      toast.error("Couldn't save that", error.message);
    } finally {
      setBusyId(null);
    }
  };

  const sync = async (id) => {
    setBusyId(id);
    try {
      const result = await api.post(`/api/tutor/calendar/connections/${id}`);
      toast.success(
        "Calendar refreshed",
        result.failed
          ? "We couldn't reach the calendar — try reconnecting it."
          : `${result.synced ?? 0} busy period${result.synced === 1 ? "" : "s"} found.`,
      );
      router.refresh();
    } catch (error) {
      toast.error("Couldn't refresh", error.message);
    } finally {
      setBusyId(null);
    }
  };

  const connectedProviders = new Set(connections.map((c) => c.provider));

  return (
    <Card id="calendar-sync">
      <CardHeader
        title="Connected calendars"
        description="Keep your availability in step with the calendar you already use."
      />
      <CardBody className="space-y-5">
        {connections.length === 0 && (
          <p className="text-sm leading-relaxed text-ink-600">
            Connect a calendar and we&rsquo;ll stop offering families the hours you&rsquo;re
            already committed to — and put every confirmed lesson straight into your week.
          </p>
        )}

        {connections.map((connection) => (
          <ConnectionRow
            key={connection.id}
            connection={connection}
            busy={busyId === connection.id}
            onToggle={(body, message) => patch(connection.id, body, message)}
            onSync={() => sync(connection.id)}
            onPickCalendar={() => setPicking(connection)}
            onDisconnect={() => {
              setConnections((c) => c.filter((x) => x.id !== connection.id));
              router.refresh();
            }}
          />
        ))}

        <div className="flex flex-wrap gap-2 border-t border-ink-100 pt-5">
          {(initial.providers ?? []).map((provider) => (
            <Button
              key={provider.provider}
              variant="secondary"
              size="sm"
              loading={busyId === provider.provider}
              onClick={() => connect(provider.provider)}
              iconLeft={<Link2 className="size-3.5" />}
            >
              {connectedProviders.has(provider.provider) ? "Connect another" : "Connect"}{" "}
              {CALENDAR_PROVIDER_LABELS[provider.provider]}
            </Button>
          ))}
        </div>

        {(initial.providers ?? []).some((p) => !p.live) && (
          <Alert tone="warning" title="Running against the development calendar">
            {(initial.providers ?? [])
              .filter((p) => !p.live)
              .map((p) => CALENDAR_PROVIDER_LABELS[p.provider])
              .join(" and ")}{" "}
            {(initial.providers ?? []).filter((p) => !p.live).length === 1 ? "has" : "have"} no
            credentials configured on this deployment. Connecting still works and still syncs — but
            against this platform&rsquo;s own calendar, not your real account.
          </Alert>
        )}
      </CardBody>

      {picking && (
        <CalendarPicker
          connection={picking}
          onClose={() => setPicking(null)}
          onChosen={(connection) => {
            setConnections((current) =>
              current.map((c) => (c.id === connection.id ? connection : c)),
            );
            setPicking(null);
            router.refresh();
          }}
        />
      )}
    </Card>
  );
}

function ConnectionRow({ connection, busy, onToggle, onSync, onPickCalendar, onDisconnect }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const needsReconsent = connection.status === CALENDAR_CONNECTION_STATUS.NEEDS_RECONSENT;

  const disconnect = useSubmit(async () => {
    await api.delete(`/api/tutor/calendar/connections/${connection.id}`);
    toast.success("Calendar disconnected", "Lessons we added have been removed from it.");
    setConfirming(false);
    onDisconnect();
  });

  return (
    <div className="rounded-xl border border-ink-200 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-bold text-ink-900">
              {CALENDAR_PROVIDER_LABELS[connection.provider] ?? connection.provider}
            </h3>
            <Badge tone={needsReconsent ? "warning" : "success"} size="sm">
              {CALENDAR_CONNECTION_STATUS_LABELS[connection.status] ?? connection.status}
            </Badge>
            {connection.simulated && (
              <Badge tone="neutral" size="sm">
                Development calendar
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-500">
            {connection.accountEmail}
            {connection.calendarName ? ` · ${connection.calendarName}` : ""}
            {connection.lastSyncedAt ? ` · synced ${formatRelative(connection.lastSyncedAt)}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="ghost"
            size="xs"
            onClick={onPickCalendar}
            iconLeft={<CalendarSync className="size-3.5" />}
          >
            Change calendar
          </Button>
          <Button
            variant="ghost"
            size="xs"
            loading={busy}
            onClick={onSync}
            iconLeft={<RefreshCw className="size-3.5" />}
          >
            Refresh
          </Button>
          <Button
            variant="dangerGhost"
            size="xs"
            onClick={() => setConfirming(true)}
            iconLeft={<Trash2 className="size-3.5" />}
          >
            Disconnect
          </Button>
        </div>
      </div>

      {needsReconsent && (
        <Alert
          tone="warning"
          title="This calendar needs reconnecting"
          icon={<TriangleAlert className="size-3" />}
          className="mt-3"
        >
          {connection.lastSyncError ||
            "We can no longer reach this calendar. Connect it again to resume syncing."}{" "}
          Until then it is not affecting your availability.
        </Alert>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Switch
          label="Block my availability"
          description={
            connection.busyPeriodCount
              ? `${connection.busyPeriodCount} busy period${connection.busyPeriodCount === 1 ? "" : "s"} are hiding slots.`
              : "Anything in this calendar stops families booking that time."
          }
          checked={connection.syncBusy}
          disabled={busy}
          onChange={(e) =>
            onToggle(
              { syncBusy: e.target.checked },
              e.target.checked ? "Availability will follow this calendar" : "Availability unlinked",
            )
          }
        />
        <Switch
          label="Add my lessons to it"
          description="Confirmed lessons appear in this calendar, and move or vanish when they do."
          checked={connection.pushEvents}
          disabled={busy}
          onChange={(e) =>
            onToggle(
              { pushEvents: e.target.checked },
              e.target.checked ? "Lessons will be added" : "Lessons will no longer be added",
            )
          }
        />
      </div>

      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Disconnect this calendar?"
        description="We'll remove the lessons we added to it and forget the connection. Your bookings are unaffected."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep it connected
            </Button>
            <Button variant="danger" onClick={disconnect.submit} loading={disconnect.pending}>
              Disconnect
            </Button>
          </>
        }
      >
        <p className="text-sm text-ink-600">
          Your availability will go back to exactly what you have published here, so make sure
          anything you are busy with is blocked out.
        </p>
      </Modal>
    </div>
  );
}

/** Which calendar inside the connected account lessons should live in. */
function CalendarPicker({ connection, onClose, onChosen }) {
  const toast = useToast();
  const [calendars, setCalendars] = useState(null);
  const [selected, setSelected] = useState(connection.calendarId ?? "");
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .get(`/api/tutor/calendar/connections/${connection.id}/calendars`)
      .then((data) => setCalendars(data.calendars ?? []))
      .catch((err) => setError(err.message));
  }, [connection.id]);

  const { submit, pending } = useSubmit(async () => {
    const { connection: updated } = await api.patch(
      `/api/tutor/calendar/connections/${connection.id}`,
      { calendarId: selected },
    );
    toast.success("Calendar changed", `Lessons will go to ${updated.calendarName}.`);
    onChosen(updated);
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Choose a calendar"
      description="Busy time is read from this calendar, and lessons are written to it."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={submit}
            loading={pending}
            disabled={!selected || selected === connection.calendarId}
          >
            Use this calendar
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="danger" title="Couldn't load your calendars">
          {error}
        </Alert>
      )}

      {!calendars && !error && <p className="text-sm text-ink-500">Loading your calendars…</p>}

      {calendars && (
        <Field label="Calendar" htmlFor="calendar-choice">
          <Select
            id="calendar-choice"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            {calendars.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.name}
                {calendar.primary ? " (primary)" : ""}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {calendars?.length === 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-500">
          <Check className="size-3.5" />
          This account has no calendars we can write to.
        </p>
      )}
    </Modal>
  );
}
