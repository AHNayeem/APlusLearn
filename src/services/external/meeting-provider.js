import "server-only";
import { randomUUID } from "node:crypto";
import { MEETING_PROVIDERS } from "@/constants";
import { requireIntegration } from "@/lib/config/env";

/**
 * Online lesson links (§27, §38).
 *
 *   MockMeetingProvider — development. Issues a deterministic, per-booking
 *                         room link so bookings, dashboards and reminders all
 *                         carry meeting data without credentials.
 *   ZoomMeetingProvider — production. Creates a real scheduled meeting on the
 *                         platform's Zoom account.
 *
 * A meeting link is private to the two participants. Nothing in this module
 * publishes one; `booking.service` stores it on the booking and
 * `getBooking()` releases it only to the purchaser, the tutor or an admin.
 * The Zoom *host* start URL is a credential in URL form — it is deliberately
 * never returned, never stored and never logged.
 */

export class MeetingProvider {
  get name() {
    throw new Error("not implemented");
  }
  async createMeeting() {
    throw new Error("not implemented");
  }
  /** Move an existing meeting. Reschedules keep the same join link. */
  async updateMeeting() {
    throw new Error("not implemented");
  }
  /** Tear a meeting down so a cancelled lesson's link stops working. */
  async deleteMeeting() {
    throw new Error("not implemented");
  }
}

class MockMeetingProvider extends MeetingProvider {
  get name() {
    return "MOCK";
  }

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

  /** Nothing to call; the deterministic link is valid whenever it is used. */
  async updateMeeting({ meetingId }) {
    return { meetingId, updated: true };
  }

  async deleteMeeting({ meetingId }) {
    return { meetingId, deleted: true };
  }
}

// --- Zoom ------------------------------------------------------------------

const ZOOM_API = "https://api.zoom.us/v2";
const ZOOM_OAUTH = "https://zoom.us/oauth/token";

/**
 * Production provider.
 *
 * Uses Zoom's Server-to-Server OAuth app: the platform owns the meetings, so
 * there is no per-tutor OAuth dance and no tutor Zoom account to maintain.
 * The access token lives for an hour and is cached in memory until just
 * before it expires.
 *
 * Google Meet and Microsoft Teams are reachable through the same interface
 * but need a per-host OAuth grant (Calendar / Graph) rather than an account
 * credential, so they are configuration, not code: see docs/INTEGRATIONS.md.
 */
export class ZoomMeetingProvider extends MeetingProvider {
  constructor({ accountId, clientId, clientSecret, hostUserId = "me", fetchImpl } = {}) {
    super();
    this.accountId = accountId;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.hostUserId = hostUserId;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.token = null;
  }

  get name() {
    return "ZOOM";
  }

  async accessToken() {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString("base64");
    const url = `${ZOOM_OAUTH}?grant_type=account_credentials&account_id=${encodeURIComponent(this.accountId)}`;
    const response = await this.fetch(url, {
      method: "POST",
      headers: { Authorization: `Basic ${credentials}` },
    });

    if (!response.ok) {
      throw meetingError(`Zoom authentication failed (HTTP ${response.status}).`);
    }

    const payload = await response.json();
    this.token = {
      value: payload.access_token,
      expiresAt: Date.now() + (payload.expires_in ?? 3600) * 1000,
    };
    return this.token.value;
  }

  async call(path, { method = "GET", body } = {}) {
    const response = await this.fetch(`${ZOOM_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await this.accessToken()}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (response.status === 204) return {};
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw meetingError(payload.message ?? `Zoom responded HTTP ${response.status}.`);
    }
    return payload;
  }

  async createMeeting({ topic, startAt, durationMinutes, timeZone = "America/Toronto", agenda }) {
    const meeting = await this.call(`/users/${encodeURIComponent(this.hostUserId)}/meetings`, {
      method: "POST",
      body: {
        topic: topic.slice(0, 200),
        agenda: agenda?.slice(0, 2000),
        // 2 = a scheduled meeting at a fixed time.
        type: 2,
        start_time: new Date(startAt).toISOString().replace(/\.\d{3}Z$/, "Z"),
        duration: durationMinutes,
        timezone: timeZone,
        settings: {
          // A tutoring session is two named people; nobody wanders in.
          waiting_room: true,
          join_before_host: false,
          meeting_authentication: false,
          mute_upon_entry: true,
          auto_recording: "none",
        },
      },
    });

    return {
      provider: MEETING_PROVIDERS.ZOOM,
      meetingId: String(meeting.id),
      joinUrl: meeting.join_url,
      passcode: meeting.password || undefined,
      topic,
      startAt: new Date(startAt).toISOString(),
      durationMinutes,
      createdAt: new Date().toISOString(),
      // `meeting.start_url` is deliberately dropped: it authenticates the
      // host and would hand anyone who saw it control of the meeting.
    };
  }

  async updateMeeting({ meetingId, topic, startAt, durationMinutes, timeZone = "America/Toronto" }) {
    await this.call(`/meetings/${encodeURIComponent(meetingId)}`, {
      method: "PATCH",
      body: {
        ...(topic ? { topic: topic.slice(0, 200) } : {}),
        ...(startAt
          ? { start_time: new Date(startAt).toISOString().replace(/\.\d{3}Z$/, "Z"), timezone: timeZone }
          : {}),
        ...(durationMinutes ? { duration: durationMinutes } : {}),
      },
    });
    return { meetingId, updated: true };
  }

  async deleteMeeting({ meetingId }) {
    await this.call(`/meetings/${encodeURIComponent(meetingId)}`, { method: "DELETE" });
    return { meetingId, deleted: true };
  }
}

function meetingError(message) {
  const error = new Error(message);
  error.code = "MEETING_PROVIDER_ERROR";
  return error;
}

let cached = null;

export function getMeetingProvider() {
  const { name } = requireIntegration("meeting");
  if (cached?.key === name) return cached.provider;

  const provider =
    name === "zoom"
      ? new ZoomMeetingProvider({
          accountId: process.env.ZOOM_ACCOUNT_ID,
          clientId: process.env.ZOOM_CLIENT_ID,
          clientSecret: process.env.ZOOM_CLIENT_SECRET,
          hostUserId: process.env.ZOOM_USER_ID || "me",
        })
      : new MockMeetingProvider();

  cached = { key: name, provider };
  return provider;
}
