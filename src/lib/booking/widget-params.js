/**
 * The booking widget's URL contract (§37 steps 11 and 18, R10.14, R18.10).
 *
 * Three journeys open a tutor's booking widget part-filled, and they all do
 * it through the address bar so the selection survives the one thing state
 * cannot — a trip through sign-in and back:
 *
 *   - "Book again" from a lesson: same course, learner, type, length, place.
 *   - "Book" from a request's tutor comparison: the request, its course and
 *     its learner, so the booking closes the request.
 *   - A signed-out visitor who picked a time: the time and everything they
 *     chose, carried in `next` through `/login` (sanitised by `internalPath`).
 *
 * Every value here is a *suggestion*. The widget keeps one only if the tutor
 * actually offers it (a course they teach, a learner the viewer owns, a slot
 * still open), and the server re-checks all of it on submit (§42).
 *
 * Pure and import-free so a Server Component can build a link with it and a
 * Client Component can read one.
 */

export const WIDGET_PARAMS = {
  course: "course",
  student: "student",
  mode: "mode",
  duration: "duration",
  location: "location",
  platform: "platform",
  slot: "slot",
  request: "request",
};

/**
 * `/tutors/<slug>?…#availability` for a selection. Empty values are dropped,
 * so the link stays short enough for the 300-character `next` limit.
 *
 * @param {string} slug
 * @param {object} [selection]
 * @param {string} [selection.courseId]
 * @param {string} [selection.studentProfileId]
 * @param {string} [selection.mode]
 * @param {number} [selection.durationMinutes]
 * @param {string} [selection.locationType]
 * @param {string} [selection.meetingProvider]
 * @param {string} [selection.startAt]  ISO instant of a chosen slot.
 * @param {string} [selection.requestId]
 */
export function bookingWidgetHref(slug, selection = {}) {
  const pairs = [
    [WIDGET_PARAMS.request, selection.requestId],
    [WIDGET_PARAMS.course, selection.courseId],
    [WIDGET_PARAMS.student, selection.studentProfileId],
    [WIDGET_PARAMS.mode, selection.mode],
    [WIDGET_PARAMS.duration, selection.durationMinutes],
    [WIDGET_PARAMS.location, selection.locationType],
    [WIDGET_PARAMS.platform, selection.meetingProvider],
    [WIDGET_PARAMS.slot, selection.startAt],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");

  const query = new URLSearchParams(pairs.map(([key, value]) => [key, String(value)])).toString();
  return `/tutors/${slug}${query ? `?${query}` : ""}#availability`;
}

/**
 * Read a selection back out of the URL — raw strings, unvalidated. The widget
 * decides which of them it can honour.
 *
 * @param {{ get(name: string): string|null }} params  URLSearchParams-like.
 */
export function readBookingWidgetParams(params) {
  const get = (key) => params?.get?.(key) || undefined;
  const duration = Number(get(WIDGET_PARAMS.duration));
  return {
    requestId: get(WIDGET_PARAMS.request),
    courseId: get(WIDGET_PARAMS.course),
    studentProfileId: get(WIDGET_PARAMS.student),
    mode: get(WIDGET_PARAMS.mode),
    durationMinutes: Number.isInteger(duration) ? duration : undefined,
    locationType: get(WIDGET_PARAMS.location),
    meetingProvider: get(WIDGET_PARAMS.platform),
    startAt: get(WIDGET_PARAMS.slot),
  };
}
