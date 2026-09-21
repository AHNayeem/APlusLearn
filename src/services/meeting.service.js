import "server-only";
import { Booking, GroupSession, GroupEnrolment, User } from "@/models";
import {
  BOOKING_STATUS,
  ACTIVE_SESSION_STATUSES,
  GROUP_ENROLMENT_STATUS,
  LESSON_MODES,
  MEETING_PROVIDERS,
  MEETING_PROVIDER_LABELS,
  MEETING_SOURCES,
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  AUDIT_ACTIONS,
  ROLES,
} from "@/constants";
import {
  NotFoundError,
  AuthorizationError,
  BusinessRuleError,
  ConflictError,
} from "@/lib/api/errors";
import { toPlain } from "@/lib/utils/serialize";
import { getMeetingProvider } from "./external/meeting-provider";
import { notify } from "./notification.service";
import { brandedEmailTemplates } from "./external/email-provider";
import { formatDate, formatTime } from "@/lib/utils/format";
import { recordAudit } from "./audit.service";

/**
 * The online classroom for a lesson (§27).
 *
 * This module is the single implementation of everything a meeting room is
 * and everything that may be done to one, for **both** kinds of online lesson
 * this platform runs: a one-to-one `Booking` and a many-learner
 * `GroupSession`. Before it existed the two services each carried their own
 * copy of "ask the provider, swallow the failure, store what came back", which
 * is exactly the second implementation of a business rule the architecture
 * forbids.
 *
 * ## Two kinds of room, and the difference is ownership
 *
 * A `PROVIDER` room is one this platform asked Zoom, Google or Microsoft for
 * through an adapter in `external/meeting-provider.js`. The platform owns it,
 * so a reschedule moves it and a cancellation tears it down.
 *
 * A `MANUAL` room is one a human already owns — a tutor's personal Zoom room,
 * a Meet link from their own workspace — pasted in because the deployment has
 * no credentials for that platform, or because the provider was down at the
 * moment a paid lesson confirmed. **Nothing here ever calls a provider API
 * about a MANUAL room.** Doing so would be acting on a resource in somebody
 * else's account: a `deleteMeeting` would destroy a room the tutor may use for
 * other lessons, and an `updateMeeting` would move their calendar around. The
 * guard is `ownsRoom()` and every provider call goes through it.
 *
 * This is also the honest answer to "does AplusLearn integrate with Zoom?".
 * The adapters are real and complete; a deployment without Zoom credentials
 * gets manual configuration instead of a fabricated room, and the two states
 * are distinguishable everywhere a human can see them.
 *
 * ## What is never done here
 *
 * A passcode is a credential. It is stored, it is released to the people
 * entitled to attend, and it appears in **no** log line and **no** audit
 * record — `auditable()` strips it, and the failure paths report the
 * provider's message rather than the room's contents.
 */

// --- Provisioning ----------------------------------------------------------

/** Does this application own the room, and may it therefore call the API? */
function ownsRoom(meeting) {
  return Boolean(meeting?.meetingId) && meeting.source !== MEETING_SOURCES.MANUAL;
}

/**
 * Ask the provider for a room.
 *
 * A provider being down must not strand a lesson somebody has already paid
 * for, so a failure returns `undefined` and the caller confirms the lesson
 * anyway. What makes that safe rather than merely quiet is that there is now
 * somewhere for the missing room to come from: `configureMeeting()` below lets
 * the tutor or an administrator retry or paste in a link, and the lesson shows
 * an explicit "room pending" state to everyone until one of them does.
 *
 * @param {object} subject  A Booking or GroupSession document.
 * @param {string} [requestedProvider]  A MEETING_PROVIDERS value.
 */
export async function provisionMeeting(subject, requestedProvider) {
  // The platform the learner chose, read back from the stored record — never
  // from a request body at confirmation time (§42).
  const provider = requestedProvider ?? subject.meetingProvider ?? MEETING_PROVIDERS.ZOOM;

  try {
    const room = await getMeetingProvider(provider).createMeeting({
      provider,
      topic: topicFor(subject),
      agenda: agendaFor(subject),
      startAt: subject.startAt,
      durationMinutes: subject.durationMinutes,
      timeZone: subject.timeZone,
    });

    return {
      ...room,
      provider: room.provider ?? provider,
      source: MEETING_SOURCES.PROVIDER,
      disabled: false,
    };
  } catch (error) {
    console.error(`[meeting] creation failed for ${subject.reference}:`, error.message);
    return undefined;
  }
}

/**
 * Move an existing room to a new time.
 *
 * A reschedule updates the room in place rather than issuing a new one, so a
 * join link already sitting in somebody's calendar keeps working. A MANUAL
 * room needs no call at all — a personal room has no start time to move — so
 * it is left exactly as it is and the lesson's own new time is what changes.
 */
export async function moveMeeting(subject) {
  if (!ownsRoom(subject.meeting)) return false;
  try {
    await getMeetingProvider(subject.meeting.provider).updateMeeting({
      meetingId: subject.meeting.meetingId,
      topic: topicFor(subject),
      startAt: subject.startAt,
      durationMinutes: subject.durationMinutes,
      timeZone: subject.timeZone,
    });
    return true;
  } catch (error) {
    console.error(`[meeting] move failed for ${subject.reference}:`, error.message);
    return false;
  }
}

/**
 * Tear a room down so a cancelled lesson's link stops working.
 *
 * Torn down through the adapter for the platform the room was *actually*
 * created on — `meeting.provider`, not the lesson's requested one, which can
 * differ when the chosen platform was unconfigured and the room came from the
 * development provider.
 */
export async function releaseMeeting(subject) {
  if (!ownsRoom(subject.meeting)) return false;
  try {
    await getMeetingProvider(subject.meeting.provider).deleteMeeting({
      meetingId: subject.meeting.meetingId,
    });
    return true;
  } catch (error) {
    console.error(`[meeting] teardown failed for ${subject.reference}:`, error.message);
    return false;
  }
}

function topicFor(subject) {
  return subject.title ?? `${subject.courseName ?? "Tutoring"} lesson`;
}

function agendaFor(subject) {
  return subject.courseCode ? `${subject.courseName} (${subject.courseCode})` : undefined;
}

/**
 * Copy a group session's room onto every seat in it.
 *
 * A learner reads their own `Booking`, not the session, so a room that lived
 * only on the session would never reach them. Needed twice: when the room is
 * first created, and again whenever a manager replaces or withdraws it — a
 * learner must not be left holding a link the session has moved on from.
 */
export async function syncSeatMeetings(session) {
  await Booking.updateMany(
    { groupSessionId: session._id },
    session.meeting ? { $set: { meeting: session.meeting } } : { $unset: { meeting: "" } },
  );
}

/**
 * Stand a cancelled lesson's room down.
 *
 * Two things have to happen and neither is enough on its own. The room is torn
 * down at the provider, because a cancelled lesson's link is a room two
 * strangers could still walk into; and the credentials are dropped from the
 * record, because a `joinUrl` and a passcode at rest on a lesson that is never
 * going to happen can only be leaked, never used. What survives is the fact
 * that this *was* an online lesson and which platform it was on, which is what
 * a cancelled lesson has to be able to say about itself (§27).
 *
 * Returns the meeting as it should now be stored, or `null` when there was
 * none — the caller writes it, because a `Booking` and a `GroupSession` are
 * persisted along different paths.
 */
export async function retireMeeting(subject) {
  if (!subject.meeting) return null;

  // A MANUAL room is somebody else's; `releaseMeeting` leaves it running and
  // only this platform's copy of the credentials is forgotten.
  await releaseMeeting(subject);

  return {
    provider: subject.meeting.provider,
    source: subject.meeting.source,
    createdAt: subject.meeting.createdAt,
    disabled: true,
  };
}

// --- Release to a viewer ---------------------------------------------------

/**
 * What one person may see of a room.
 *
 * Called by every read path *after* it has decided the caller is entitled to
 * the lesson at all — the booking and session pages, the booking list, the
 * dashboard summary and the administrator's session list. This decides how
 * much of the room that entitlement is worth, which is a narrower question and
 * turns on two things.
 *
 * A **withdrawn** room (`disabled`) still exists and a manager still needs to
 * see it to fix it, but the join credentials are removed for everybody else —
 * that is the whole point of withdrawing one.
 *
 * A **finished or cancelled** lesson keeps no live credentials for anybody.
 * The room is gone or irrelevant, and a dead `joinUrl` sitting in an API
 * response is a stale credential with no purpose: it cannot start a lesson and
 * it can only be leaked. The historical fact that the lesson *was* online, and
 * on which platform, is preserved — that is what a past lesson needs to
 * represent (§27).
 *
 * @param {object|null} meeting
 * @param {{ isManager?: boolean, live?: boolean }} viewer
 *   `isManager` — the tutor hosting it, or an administrator.
 *   `live` — the lesson is still going to happen.
 */
export function meetingForViewer(meeting, { isManager = false, live = true } = {}) {
  if (!meeting) return null;

  const withheld = meeting.disabled || !live;
  if (!withheld) return meeting;

  if (isManager && meeting.disabled && live) return meeting;

  // Everything that is not a credential survives, so the lesson can still say
  // "this was an online lesson on Zoom" without handing anyone a way in.
  return {
    provider: meeting.provider,
    source: meeting.source,
    instructions: meeting.instructions,
    disabled: meeting.disabled,
    createdAt: meeting.createdAt,
    joinUrl: null,
    meetingId: null,
    passcode: null,
  };
}

/**
 * The same decision, for a booking, wherever a booking is handed out.
 *
 * `getBooking` and `listBookings` return the *same record* to the *same
 * person* and so must release the same amount of it. They did not: the detail
 * endpoint asked `meetingForViewer` and the list endpoint returned the stored
 * sub-document untouched, so a link the tutor had withdrawn — and a finished
 * lesson's live credentials — went out on `GET /api/bookings` and rendered a
 * working Join button on the dashboard, while `GET /api/bookings/:id`
 * correctly refused them. Withdrawing a link is only a control if *every* way
 * of reading the lesson honours it.
 *
 * So the rule lives here once and both callers ask it, rather than each
 * carrying its own copy of "who is a manager and what counts as live".
 *
 * @param {object} booking  A booking, plain or hydrated.
 * @param {{id: string, role: string}} actor
 */
export function meetingOnBookingForViewer(booking, actor) {
  return meetingForViewer(booking.meeting ?? null, {
    isManager: actor?.role === ROLES.ADMIN || String(booking.tutorUserId) === String(actor?.id),
    live: booking.status === BOOKING_STATUS.CONFIRMED,
  });
}

// --- Configuration ---------------------------------------------------------

/**
 * Set, replace, withdraw or remove the joining details on a booked lesson.
 *
 * One function for both kinds of lesson, because the rules are the same ones:
 * only an online lesson has a room, only a lesson that is still going to
 * happen can have its room changed, only the host or an administrator may
 * change it, and the people attending are told when it changes.
 *
 * ## Actions
 *
 * `retry`   — ask the provider again. The remedy for a room that is missing
 *             because the provider was down.
 *
 *             What it asks is whatever `getMeetingProvider` hands back for the
 *             chosen platform, and on a deployment that has named no adapter
 *             for it that is the development provider — a deterministic link
 *             stored, like any other, as `source: PROVIDER`. That is
 *             `meeting.fakeAllowedInProduction` in `lib/config/env.js` doing
 *             what it says, not an oversight: naming a platform *without* its
 *             secrets is still a hard boot failure, and selecting a platform
 *             this build has no adapter for never reaches that platform's API.
 *             An operator who wants a real room on a real platform configures
 *             one; until then the honest alternative for a host is `manual`.
 * `manual`  — store a room the caller already owns. `provider` records which
 *             platform it is on so the learner knows what they are opening.
 * `disable` — withdraw the link from the people attending, reversibly.
 * `enable`  — hand it back.
 * `clear`   — remove the configuration. A PROVIDER room is torn down at the
 *             provider once the removal is stored; a MANUAL room is only
 *             forgotten, never deleted.
 *
 * ## Two requests at once
 *
 * Every action is read-modify-write, and two managers — a tutor and an
 * administrator during an incident, or one tutor double-clicking — can hold
 * the same lesson at the same moment. Two kinds of damage follow from that,
 * and only one of them is repairable.
 *
 * A lost *edit* is survivable: one of two links wins whole, and the loser can
 * look and try again. A duplicated *room* is not. Two concurrent `retry`
 * calls both saw a lesson with no room, both asked Zoom for one, and both
 * stored theirs — leaving a live meeting in the platform's Zoom account that
 * nothing references, that no cancellation will ever tear down, and that
 * anybody who was handed the losing link can still walk into. This was
 * reproducible: four simultaneous retries produced two rooms.
 *
 * So the write is guarded on the version the request read (`commit` below),
 * which is the same claim-your-work-atomically rule the schedulers follow. A
 * request that loses the race changes nothing and is told so, and — this is
 * the part that matters — anything it had already created at the provider is
 * torn down again rather than orphaned.
 *
 * @param {"BOOKING"|"GROUP"} kind
 * @param {string} id
 * @param {{action: string, provider?: string, joinUrl?: string, meetingId?: string,
 *          passcode?: string|null, instructions?: string|null}} input
 * @param {{id: string, role: string}} actor
 */
export async function configureMeeting(kind, id, input, actor) {
  const subject = await loadSubject(kind, id);

  assertManager(subject, actor);
  assertOnline(subject);
  assertMutable(kind, subject);

  const before = subject.meeting ? { ...toPlain(subject.meeting) } : null;
  let outcome;

  switch (input.action) {
    case "retry":
      outcome = await applyRetry(subject);
      break;
    case "manual":
      outcome = await applyManual(subject, input, actor);
      break;
    case "disable":
      outcome = applyDisabled(subject, true);
      break;
    case "enable":
      outcome = applyDisabled(subject, false);
      break;
    case "clear":
      outcome = await applyClear(subject);
      break;
    default:
      throw new BusinessRuleError("That is not something that can be done to a meeting.", "UNKNOWN_MEETING_ACTION");
  }

  await commit(kind, subject, outcome);

  /**
   * Now that the change is stored, give up the room it replaced.
   *
   * After, never before. A teardown issued first and a write that then failed
   * would leave the lesson pointing at a room that no longer exists —
   * "everything looks fine, nobody can get in" — which is the worse of the two
   * inconsistencies. Doing it in this order means the only thing a failure
   * here leaves behind is a room nobody is using any more, which is visible in
   * the provider's own account and costs nothing.
   */
  if (outcome.release) await releaseMeeting(outcome.release);

  // A group room lives on the session but is read from each learner's booking.
  if (kind === "GROUP") await syncSeatMeetings(subject);

  await recordAudit({
    actor,
    action: outcome.audit,
    entityType: kind === "BOOKING" ? "Booking" : "GroupSession",
    entityId: subject._id,
    // No passcode and no join URL reach the audit log: the record is of *what
    // changed*, not of the credential it changed to.
    metadata: { action: input.action, before: auditable(before), after: auditable(subject.meeting) },
  });

  if (outcome.notify) await announce(kind, subject, outcome.notify);

  return {
    meeting: subject.meeting ? toPlain(subject.meeting) : null,
    action: input.action,
  };
}

/**
 * Store the change, but only if nothing else changed the lesson first.
 *
 * The guard is the version the request loaded. Mongoose maintains `__v` on
 * every document, so this needs no new field and no lock table: the update
 * matches only while the record is still the one the decisions above were made
 * against, and `$inc` moves it on so a concurrent request sees a miss.
 *
 * `rollback` is what separates a refusal from a mess. `retry` has to ask the
 * provider *before* it can store what came back; if the claim then loses, that
 * room exists and nothing points at it, so it is handed straight back.
 */
async function commit(kind, subject, outcome) {
  const model = kind === "BOOKING" ? Booking : GroupSession;
  const version = subject.__v ?? 0;

  const meeting = subject.meeting
    ? (subject.meeting.toObject?.() ?? subject.meeting)
    : undefined;

  let claimed;
  try {
    claimed = await model.updateOne(
      { _id: subject._id, __v: version },
      meeting
        ? { $set: { meeting }, $inc: { __v: 1 } }
        : { $unset: { meeting: "" }, $inc: { __v: 1 } },
    );
  } catch (error) {
    // The database refused the write, so nothing points at the room this
    // request may just have created either. Same remedy as losing the race.
    if (outcome.rollback) await releaseMeeting(outcome.rollback);
    throw error;
  }

  if (!claimed.matchedCount) {
    if (outcome.rollback) await releaseMeeting(outcome.rollback);
    throw new ConflictError(
      "Somebody else changed this lesson's joining details a moment ago. Open it again to see where it stands.",
    );
  }

  subject.__v = version + 1;
}

async function applyRetry(subject) {
  if (ownsRoom(subject.meeting) && !subject.meeting.disabled) {
    throw new BusinessRuleError(
      "This lesson already has a room. Remove it first if you want a new one.",
      "MEETING_ALREADY_EXISTS",
    );
  }

  // The room this call is giving up, if any — released once the new one is
  // safely stored, so a failed write cannot destroy the only working link.
  const replaced = ownsRoom(subject.meeting) ? roomRef(subject) : null;

  const room = await provisionMeeting(subject);
  if (!room) {
    throw new BusinessRuleError(
      "The meeting platform could not be reached. Try again in a moment, or enter a link by hand.",
      "MEETING_PROVIDER_UNAVAILABLE",
    );
  }

  subject.meeting = { ...room, createdAt: room.createdAt ?? new Date() };

  return {
    audit: AUDIT_ACTIONS.MEETING_CONFIGURED,
    notify: "created",
    release: replaced,
    // Losing the race means this room was never stored: give it back.
    rollback: roomRef(subject),
  };
}

async function applyManual(subject, input, actor) {
  // Replacing a room this platform owns means giving it up, so it is torn down
  // rather than left running unreferenced — but only once the replacement is
  // stored (§27).
  const replaced =
    ownsRoom(subject.meeting) && subject.meeting.joinUrl !== input.joinUrl
      ? roomRef(subject)
      : null;

  const had = Boolean(subject.meeting?.joinUrl);
  const changed = subject.meeting?.joinUrl !== input.joinUrl;

  subject.meeting = {
    provider: input.provider,
    joinUrl: input.joinUrl,
    meetingId: input.meetingId || undefined,
    // `null` clears a stored passcode; omitting the field keeps it.
    passcode: input.passcode === null ? undefined : (input.passcode ?? subject.meeting?.passcode),
    instructions:
      input.instructions === null ? undefined : (input.instructions ?? subject.meeting?.instructions),
    source: MEETING_SOURCES.MANUAL,
    disabled: false,
    createdAt: subject.meeting?.createdAt ?? new Date(),
    configuredBy: actor.id,
    configuredAt: new Date(),
  };

  return {
    audit: AUDIT_ACTIONS.MEETING_CONFIGURED,
    notify: !had ? "created" : changed ? "changed" : null,
    release: replaced,
  };
}

function applyDisabled(subject, disabled) {
  if (!subject.meeting?.joinUrl) {
    throw new BusinessRuleError("There is no meeting to change.", "MEETING_NOT_CONFIGURED");
  }
  if (Boolean(subject.meeting.disabled) === disabled) {
    throw new BusinessRuleError(
      disabled ? "That meeting has already been withdrawn." : "That meeting is already available.",
      "MEETING_STATE_UNCHANGED",
    );
  }

  subject.meeting.disabled = disabled;
  subject.meeting.configuredAt = new Date();

  return {
    audit: disabled ? AUDIT_ACTIONS.MEETING_DISABLED : AUDIT_ACTIONS.MEETING_CONFIGURED,
    notify: disabled ? "withdrawn" : "created",
  };
}

async function applyClear(subject) {
  if (!subject.meeting) {
    throw new BusinessRuleError("There is no meeting to remove.", "MEETING_NOT_CONFIGURED");
  }

  // Only a room this platform created is destroyed, and only once the removal
  // is stored. A tutor's own room is forgotten here and left running in their
  // account, which is theirs to decide about.
  const owned = ownsRoom(subject.meeting) ? roomRef(subject) : null;
  subject.meeting = undefined;

  return { audit: AUDIT_ACTIONS.MEETING_CLEARED, notify: "withdrawn", release: owned };
}

/**
 * A room pinned to the shape `releaseMeeting` needs, taken now.
 *
 * The teardown happens after the document has been reassigned, so it cannot
 * read the room off `subject` any more — by then `subject.meeting` is the new
 * one, or gone. This keeps hold of which room to destroy and, for the error
 * message, which lesson it belonged to.
 */
function roomRef(subject) {
  return {
    reference: subject.reference,
    meeting: subject.meeting.toObject?.() ?? { ...subject.meeting },
  };
}

// --- Loading, authorisation and eligibility --------------------------------

async function loadSubject(kind, id) {
  const subject =
    kind === "BOOKING"
      ? await Booking.findById(id)
      : await GroupSession.findById(id);

  if (!subject) throw new NotFoundError("That lesson no longer exists.");
  return subject;
}

/**
 * Who may change a room.
 *
 * Checked against the **loaded record**, never against anything in the
 * request: the tutor named on the lesson, or an administrator. The permission
 * on the route opened the door; this decides which rooms are behind it, which
 * is what stops a tutor holding `BOOKING_MEETING_MANAGE` reaching a colleague's
 * lesson.
 *
 * Learners are absent by construction — the permission is not in their role,
 * so a student never reaches this function at all, and if they somehow did the
 * identity comparison would refuse them.
 */
function assertManager(subject, actor) {
  const isAdmin = actor.role === ROLES.ADMIN;
  const isHost = String(subject.tutorUserId) === String(actor.id);
  if (!isAdmin && !isHost) {
    throw new AuthorizationError("You do not teach this lesson.");
  }
}

function assertOnline(subject) {
  if (subject.mode !== LESSON_MODES.ONLINE) {
    throw new BusinessRuleError(
      "This is an in-person lesson, so it has no meeting room.",
      "LESSON_NOT_ONLINE",
    );
  }
}

/**
 * Only a lesson that is still going to happen.
 *
 * A finished, cancelled or expired lesson is history. Letting anyone attach a
 * live room to one would create a joinable link with no lesson behind it, and
 * would rewrite what a past lesson says about itself.
 */
const CONFIGURABLE_BOOKING_STATUSES = [BOOKING_STATUS.CONFIRMED];

function assertMutable(kind, subject) {
  const allowed =
    kind === "BOOKING" ? CONFIGURABLE_BOOKING_STATUSES : ACTIVE_SESSION_STATUSES;

  if (!allowed.includes(subject.status)) {
    throw new BusinessRuleError(
      kind === "BOOKING"
        ? "Only a confirmed lesson can have its joining details changed."
        : "A cancelled or finished session cannot have its joining details changed.",
      "LESSON_NOT_CONFIGURABLE",
    );
  }
}

/** A meeting as an audit record may hold it — no credentials, ever. */
function auditable(meeting) {
  if (!meeting) return null;
  return {
    provider: meeting.provider,
    source: meeting.source,
    disabled: Boolean(meeting.disabled),
    hasJoinUrl: Boolean(meeting.joinUrl),
    hasPasscode: Boolean(meeting.passcode),
  };
}

// --- Telling the people attending ------------------------------------------

const ANNOUNCEMENTS = {
  created: {
    title: "Joining details for your lesson",
    body: (label) => `The link for your ${label} lesson is ready. You can open it from the lesson page.`,
  },
  changed: {
    title: "The joining link for your lesson has changed",
    body: (label) => `Your lesson now uses a different ${label} link. Please use the one on the lesson page.`,
  },
  withdrawn: {
    title: "The joining link for your lesson has been withdrawn",
    body: () => "Your tutor is arranging a new one. The lesson itself is unchanged.",
  },
};

/** The lesson as the email template wants it — no room details among them. */
function emailPayloadFor(subject) {
  return {
    id: String(subject._id),
    reference: subject.reference,
    courseName: subject.title ?? subject.courseName ?? "your lesson",
    dateLabel: formatDate(subject.startAt, { weekday: "long", timeZone: subject.timeZone }),
    timeLabel: formatTime(subject.startAt, subject.timeZone),
  };
}

/**
 * Tell whoever is attending.
 *
 * Through the existing notification service, so these land in the same inbox,
 * obey the same per-category email switches and are delivered by the same
 * transport as every other booking notification (§28). The notification says
 * *that* the details changed and where to look — it never carries the link or
 * the passcode, because a notification is delivered over channels this
 * platform does not control.
 */
async function announce(kind, subject, key) {
  const template = ANNOUNCEMENTS[key];
  if (!template) return;

  const label = MEETING_PROVIDER_LABELS[subject.meeting?.provider] ?? "online";

  try {
    const templates = await brandedEmailTemplates();
    const lesson = emailPayloadFor(subject);

    const payloadFor = (firstName) => ({
      type: NOTIFICATION_TYPES.MEETING_UPDATED,
      title: template.title,
      body: template.body(label),
      channels: [NOTIFICATION_CHANNELS.IN_APP, NOTIFICATION_CHANNELS.EMAIL],
      email: templates.meetingUpdated({
        firstName: firstName ?? "there",
        booking: lesson,
        providerLabel: label,
        reason: key,
      }),
    });

    if (kind === "BOOKING") {
      const purchaser = await User.findById(subject.purchaserId).select("firstName").lean();
      await notify({
        ...payloadFor(purchaser?.firstName),
        userId: subject.purchaserId,
        href: `/bookings/${subject._id}`,
        entityType: "Booking",
        entityId: subject._id,
      });
      return;
    }

    // Everybody holding a seat — not the waiting list, who have no lesson yet.
    const enrolments = await GroupEnrolment.find({
      sessionId: subject._id,
      status: GROUP_ENROLMENT_STATUS.CONFIRMED,
    })
      .select("purchaserId")
      .lean();

    // One mail each, addressed by name, rather than one payload shared by all.
    const purchaserIds = [...new Set(enrolments.map((e) => String(e.purchaserId)))];
    const people = await User.find({ _id: { $in: purchaserIds } }).select("firstName").lean();
    const nameById = new Map(people.map((u) => [String(u._id), u.firstName]));

    await Promise.all(
      purchaserIds.map((userId) =>
        notify({
          ...payloadFor(nameById.get(userId)),
          userId,
          href: `/groups/${subject._id}`,
          entityType: "GroupSession",
          entityId: subject._id,
        }),
      ),
    );
  } catch (error) {
    // Announcing a change must never undo the change itself.
    console.error("[meeting] could not announce the change:", error.message);
  }
}
