import "server-only";

/**
 * External calendar sync (§18, Phase 2).
 *
 * Declared now, not implemented now. Availability already stores an
 * `externalCalendars` array and the service layer routes through this
 * interface, so connecting Google or Outlook later touches only this file.
 */

export class CalendarProvider {
  async getAuthorizationUrl() {
    throw new Error("not implemented");
  }
  async exchangeCode() {
    throw new Error("not implemented");
  }
  async listBusyPeriods() {
    throw new Error("not implemented");
  }
  async pushEvent() {
    throw new Error("not implemented");
  }
}

class UnconfiguredCalendarProvider extends CalendarProvider {
  get configured() {
    return false;
  }

  /** No connected calendars means no external busy periods to subtract. */
  async listBusyPeriods() {
    return [];
  }

  /** Events are stored on the booking; pushing out is a Phase 2 concern. */
  async pushEvent() {
    return { synced: false, reason: "No calendar connected." };
  }
}

let cached;

export function getCalendarProvider() {
  if (cached) return cached;
  cached = new UnconfiguredCalendarProvider();
  return cached;
}

export function calendarIntegrationsStatus() {
  return [
    { provider: "GOOGLE", label: "Google Calendar", connected: false, available: false },
    { provider: "OUTLOOK", label: "Outlook Calendar", connected: false, available: false },
  ];
}
