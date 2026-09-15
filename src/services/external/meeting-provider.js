import "server-only";
import { randomUUID } from "node:crypto";
import { MEETING_PROVIDERS } from "@/constants";

/**
 * Online lesson links (§27, §38).
 *
 * Each provider would normally be created through its own API. The
 * development implementation issues a deterministic, per-booking room link so
 * the booking record, dashboards and reminders all carry real meeting data.
 */

export class MeetingProvider {
  async createMeeting() {
    throw new Error("not implemented");
  }
}

class MockMeetingProvider extends MeetingProvider {
  async createMeeting({ provider, topic, startAt, durationMinutes }) {
    const id = randomUUID().replace(/-/g, "").slice(0, 11);
    const urls = {
      [MEETING_PROVIDERS.ZOOM]: `https://zoom.us/j/${id}`,
      [MEETING_PROVIDERS.GOOGLE_MEET]: `https://meet.google.com/${id.slice(0, 3)}-${id.slice(3, 7)}-${id.slice(7, 10)}`,
      [MEETING_PROVIDERS.MICROSOFT_TEAMS]: `https://teams.microsoft.com/l/meetup-join/${id}`,
    };

    return {
      provider,
      meetingId: id,
      joinUrl: urls[provider] ?? urls[MEETING_PROVIDERS.ZOOM],
      // Zoom is the only one of the three that uses a numeric passcode.
      passcode: provider === MEETING_PROVIDERS.ZOOM ? String(100000 + (Date.now() % 899999)) : undefined,
      topic,
      startAt,
      durationMinutes,
      createdAt: new Date().toISOString(),
    };
  }
}

let cached;

export function getMeetingProvider() {
  if (cached) return cached;
  // if (process.env.ZOOM_CLIENT_ID) cached = new ZoomMeetingProvider(...)
  cached = new MockMeetingProvider();
  return cached;
}
