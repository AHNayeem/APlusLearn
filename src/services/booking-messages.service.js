import "server-only";
import { Conversation } from "@/models";
import {
  LESSON_MODES,
  MEETING_PROVIDER_LABELS,
  IN_PERSON_LOCATION_LABELS,
  MESSAGE_SYSTEM_EVENTS,
} from "@/constants";
import { formatDate, formatTime, formatDuration } from "@/lib/utils/format";
import { postSystemMessage } from "./message.service";

/**
 * Booking events narrated in the family's thread with the tutor (§21, R17.3).
 *
 * Its own module, rather than a few functions inside `booking.service`, so
 * every path that changes a lesson can reach it without importing the booking
 * lifecycle — `group.service` cancels lessons and is itself imported *by*
 * `booking.service`, and a cancellation path elsewhere needs exactly one call.
 *
 * The rules all live in `postSystemMessage`: it never throws, it is keyed on
 * (event, booking, dedupeKey) so a replay writes nothing, and it carries no
 * unread count because the notification centre has already told both people.
 * What is decided here is only the wording and the key of each event, and
 * that the thread is pinned to the lesson it is talking about.
 *
 * Nothing here says where an in-person lesson is, or how to join an online
 * one. A thread is readable by moderators and outlives the lesson; the
 * address and the room are released on the lesson page, by `getBooking`.
 */

function whenLabel(booking, startAt = booking.startAt) {
  return `${formatDate(startAt, { weekday: "long", timeZone: booking.timeZone })} at ${formatTime(startAt, booking.timeZone)}`;
}

function formatLabel(booking) {
  if (booking.mode === LESSON_MODES.ONLINE) {
    const platform = MEETING_PROVIDER_LABELS[booking.meeting?.provider ?? booking.meetingProvider];
    return platform ? `online on ${platform}` : "online";
  }
  const place = IN_PERSON_LOCATION_LABELS[booking.location?.type];
  return place ? `in person (${place.toLowerCase()})` : "in person";
}

function courseLabel(booking) {
  return booking.courseCode ? `${booking.courseCode} ${booking.courseName}` : booking.courseName;
}

/**
 * The conversation used to be pinned to a booking only when it was created,
 * so a family's thread with a tutor they already knew never learned about the
 * lesson it was now arranging. A thread with no booking of its own is pinned
 * to this one; one already pinned keeps the lesson it was opened about, and
 * every message still names its own booking.
 */
async function pinThread(booking) {
  try {
    await Conversation.updateOne(
      {
        learnerUserId: booking.purchaserId,
        tutorUserId: booking.tutorUserId,
        bookingId: { $exists: false },
      },
      { $set: { bookingId: booking._id ?? booking.id } },
    );
  } catch (error) {
    console.warn("[booking] could not pin the thread to its lesson:", error.message);
  }
}

async function post(booking, event, body, dedupeKey) {
  const message = await postSystemMessage({
    learnerUserId: String(booking.purchaserId),
    tutorUserId: String(booking.tutorUserId),
    bookingId: String(booking._id ?? booking.id),
    event,
    body,
    dedupeKey,
  });
  if (message) await pinThread(booking);
  return message;
}

/**
 * "Lesson confirmed" — once per payment, or once per package lesson.
 *
 * @param {object[]} bookings  The lessons one settlement confirmed (a series
 *   shares a payment, so it is told as one event, keyed on its first lesson).
 */
export async function announceBookingConfirmed(bookings) {
  const first = bookings?.[0];
  if (!first) return null;
  const body =
    bookings.length > 1
      ? `${bookings.length} lessons confirmed: ${courseLabel(first)}, ${formatDuration(first.durationMinutes)} ${formatLabel(first)}, starting ${whenLabel(first)}.`
      : `Lesson confirmed: ${courseLabel(first)}, ${formatDuration(first.durationMinutes)} ${formatLabel(first)}, on ${whenLabel(first)}.`;
  return post(first, MESSAGE_SYSTEM_EVENTS.BOOKING_CONFIRMED, body, "confirmed");
}

/**
 * "Lesson cancelled" — by whichever path cancelled it.
 *
 * @param {object[]} bookings  The lessons one cancellation ended.
 * @param {"STUDENT"|"TUTOR"|"ADMIN"} [byRole]  Who cancelled, for the wording.
 */
export async function announceBookingCancelled(bookings, byRole) {
  const first = bookings?.[0];
  if (!first) return null;
  const by =
    byRole === "TUTOR" ? " by the tutor" : byRole === "STUDENT" ? " by the family" : byRole === "ADMIN" ? " by our support team" : "";
  const body =
    bookings.length > 1
      ? `${bookings.length} lessons cancelled${by}: ${courseLabel(first)}, from ${whenLabel(first)}.`
      : `Lesson cancelled${by}: ${courseLabel(first)} on ${whenLabel(first)}.`;
  // One cancellation per lesson is possible, so the key is the event itself.
  return post(first, MESSAGE_SYSTEM_EVENTS.BOOKING_CANCELLED, body, "cancelled");
}

/**
 * "Lesson moved" — once per reschedule.
 *
 * A lesson can legitimately be moved more than once, and even moved back, so
 * the key is the move (from, to) plus the write that made it; a replay of the
 * same call after it has succeeded finds the same key.
 *
 * @param {object} booking  The booking as saved at its new time.
 * @param {Date}   previousStartAt
 */
export async function announceBookingRescheduled(booking, previousStartAt) {
  if (!booking) return null;
  const from = new Date(previousStartAt);
  const body = `Lesson moved: ${courseLabel(booking)} is now on ${whenLabel(booking)} (was ${whenLabel(booking, from)}).`;
  const key = [
    from.getTime(),
    new Date(booking.startAt).getTime(),
    new Date(booking.updatedAt ?? Date.now()).getTime(),
  ].join("-");
  return post(booking, MESSAGE_SYSTEM_EVENTS.BOOKING_RESCHEDULED, body, key);
}
