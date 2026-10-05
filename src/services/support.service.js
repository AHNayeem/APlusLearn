import "server-only";
import { SupportTicket } from "@/models";
import {
  SITE, SUPPORT_TOPIC_LABELS, SUPPORT_TOPICS, SUPPORT_TICKET_STATUS, SUPPORT_TICKET_STATUS_LABELS,
  URGENT_SUPPORT_TOPICS, AUDIT_ACTIONS, PAGE_SIZES,
} from "@/constants";
import {
  BusinessRuleError, ConflictError, NotFoundError, ValidationError,
} from "@/lib/api/errors";
import { publicReference } from "@/lib/auth/tokens";
import { toPlain } from "@/lib/utils/serialize";
import { getAppConfig } from "./settings.service";
import { recordAudit } from "./audit.service";
import { brandedEmailTemplates, sendEmail } from "./external/email-provider";

/**
 * Support enquiries and the queue that answers them (§33, §35, §36, R28.20).
 *
 * The launcher is the only unauthenticated write path into the platform that
 * a stranger can reach from any page, so these decisions are made here rather
 * than at the route:
 *
 * 1. **The ticket is the record; the email is a notification about it.** An
 *    enquiry is written to `SupportTicket` *before* anything is sent. The inbox
 *    email is then best effort: if the transport is down the ticket still
 *    exists, the enquirer still gets a reference, and the queue shows the
 *    failed notification so somebody notices. The earlier design made the email
 *    the record — a bounce lost the message — and had to answer 503 to say so.
 *
 * 2. **A signed-in enquiry takes its identity from the session.** The payload's
 *    `name` and `email` are read only when nobody is signed in — the client
 *    supplies intent, never state.
 *
 * 3. **Nothing is sent to the address in the form.** Only the support inbox is
 *    written to, with the enquirer's address in `Reply-To`. An endpoint that
 *    mailed an acknowledgement to whatever address a stranger typed would be a
 *    small open relay, and a rate limit alone does not fix that.
 *
 * 4. **Tickets are admin-only.** The enquirer gets a reference to quote, not a
 *    way to read the ticket back: an unauthenticated lookup by reference would
 *    hand somebody's complaint to whoever guessed it.
 */
export async function submitSupportEnquiry(input, { user = null, request } = {}) {
  /**
   * A bot filled the hidden field. Answer exactly as the real path does —
   * same shape, a reference of the same form — and store nothing.
   */
  if (input.website) return { received: true, reference: publicReference("SUP") };

  const name = user ? `${user.firstName} ${user.lastName}`.trim() : input.name;
  const fromEmail = user ? user.email : input.email;

  if (!name || !fromEmail) {
    throw new ValidationError({
      fieldErrors: {
        ...(name ? {} : { name: ["Tell us who you are."] }),
        ...(fromEmail ? {} : { email: ["We need an address to reply to."] }),
      },
    });
  }

  const topic = Object.values(SUPPORT_TOPICS).includes(input.topic) ? input.topic : SUPPORT_TOPICS.OTHER;

  const ticket = await createTicket({
    topic,
    urgent: URGENT_SUPPORT_TOPICS.includes(topic),
    userId: user?.id ?? null,
    userRole: user?.role ?? undefined,
    name,
    email: fromEmail,
    message: input.message,
    path: input.path,
  });

  await recordAudit({
    actor: user,
    action: AUDIT_ACTIONS.SUPPORT_TICKET_CREATED,
    entityType: "SupportTicket",
    entityId: ticket._id,
    // The topic and reference, never the message: the audit trail is read by
    // a different permission than the queue.
    metadata: { reference: ticket.reference, topic, urgent: ticket.urgent, signedIn: Boolean(user) },
    request,
  });

  const notification = await notifyInbox(ticket, user);
  await SupportTicket.updateOne({ _id: ticket._id }, { $set: { notification } });

  return { received: true, reference: ticket.reference };
}

/**
 * Write the ticket under a fresh reference. A reference is six characters
 * from a 31-letter alphabet, so a collision is vanishingly rare — but the
 * unique index is the authority, and a duplicate-key error is retried with a
 * new reference rather than surfaced to somebody reporting a problem.
 */
async function createTicket(fields) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await SupportTicket.create({
        ...fields,
        reference: publicReference("SUP"),
        history: [{ to: SUPPORT_TICKET_STATUS.OPEN, byId: fields.userId ?? undefined }],
      });
    } catch (error) {
      if (error?.code !== 11000 || attempt >= 3) throw error;
    }
  }
}

/**
 * Tell the support inbox. Never throws: whatever happens is recorded on the
 * ticket instead.
 *
 * Sent with no `category`, deliberately. The notification switches exist so an
 * operator can stop the platform *talking to members*; an enquiry a member of
 * the public just wrote is the opposite direction, and silently discarding it
 * because "announcement emails" are off would lose somebody's safety report.
 */
async function notifyInbox(ticket, user) {
  const attemptedAt = new Date();
  try {
    const { contact } = await getAppConfig();
    const inbox = contact.supportEmail || SITE.supportEmail;

    const templates = await brandedEmailTemplates();
    const message = templates.supportEnquiry({
      name: ticket.name,
      fromEmail: ticket.email,
      topicLabel: `${SUPPORT_TOPIC_LABELS[ticket.topic]} · ${ticket.reference}`,
      accountLabel: user ? `Signed in — ${user.role.toLowerCase()} (${user.id})` : "Not signed in",
      pageLabel: ticket.path ?? "Not recorded",
      message: ticket.message,
    });

    const result = await sendEmail({ to: inbox, replyTo: ticket.email, ...message });
    if (result?.delivered === false) {
      return { status: "FAILED", attemptedAt, error: String(result.skipped ?? result.error ?? "NOT_DELIVERED").slice(0, 200) };
    }
    return { status: "SENT", attemptedAt };
  } catch (error) {
    // The reason, never the body — the message is somebody's own words.
    console.error("[support] inbox notification failed:", error?.message);
    return { status: "FAILED", attemptedAt, error: String(error?.code ?? error?.message ?? "FAILED").slice(0, 200) };
  }
}

/* --- The admin queue -------------------------------------------------------- */

/**
 * Which moves a ticket may make.
 *
 * Forward through the work, plus re-opening: a resolved complaint that turns
 * out not to be resolved goes back to IN_PROGRESS rather than becoming a new
 * ticket that loses its history. A move to the status a ticket already has is
 * not in any list, so it is refused rather than recorded as a change.
 */
export const SUPPORT_TICKET_TRANSITIONS = {
  [SUPPORT_TICKET_STATUS.OPEN]: [
    SUPPORT_TICKET_STATUS.IN_PROGRESS, SUPPORT_TICKET_STATUS.RESOLVED, SUPPORT_TICKET_STATUS.CLOSED,
  ],
  [SUPPORT_TICKET_STATUS.IN_PROGRESS]: [SUPPORT_TICKET_STATUS.RESOLVED, SUPPORT_TICKET_STATUS.CLOSED],
  [SUPPORT_TICKET_STATUS.RESOLVED]: [SUPPORT_TICKET_STATUS.IN_PROGRESS, SUPPORT_TICKET_STATUS.CLOSED],
  [SUPPORT_TICKET_STATUS.CLOSED]: [SUPPORT_TICKET_STATUS.IN_PROGRESS],
};

export function canTransition(from, to) {
  return SUPPORT_TICKET_TRANSITIONS[from]?.includes(to) ?? false;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The queue, with counts for the filter tabs.
 *
 * Urgent (safety) tickets sort first within whatever is being looked at, then
 * newest first. Counts are computed in MongoDB over the whole collection, not
 * reduced from the page, so a tab's number is the number of tickets behind it.
 */
export async function listSupportTickets({ status, topic, q, page = 1, pageSize } = {}) {
  const size = Math.min(pageSize ?? PAGE_SIZES.adminTable, 100);
  const filter = {};
  if (status) filter.status = status;
  if (topic) filter.topic = topic;
  if (q) {
    const pattern = new RegExp(escapeRegex(q.trim()), "i");
    filter.$or = [{ reference: pattern }, { email: pattern }, { name: pattern }];
  }

  const [items, total, byStatus, byTopic, urgentOpen] = await Promise.all([
    SupportTicket.find(filter)
      .sort({ urgent: -1, createdAt: -1 })
      .skip((page - 1) * size)
      .limit(size)
      .select("-notes -history")
      .lean(),
    SupportTicket.countDocuments(filter),
    SupportTicket.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
    SupportTicket.aggregate([
      { $match: status ? { status } : {} },
      { $group: { _id: "$topic", count: { $sum: 1 } } },
    ]),
    SupportTicket.countDocuments({
      urgent: true,
      status: { $in: [SUPPORT_TICKET_STATUS.OPEN, SUPPORT_TICKET_STATUS.IN_PROGRESS] },
    }),
  ]);

  const statusCounts = Object.fromEntries(Object.values(SUPPORT_TICKET_STATUS).map((s) => [s, 0]));
  for (const row of byStatus) statusCounts[row._id] = row.count;
  const topicCounts = Object.fromEntries(Object.values(SUPPORT_TOPICS).map((t) => [t, 0]));
  for (const row of byTopic) topicCounts[row._id] = row.count;

  return {
    items: toPlain(items),
    total,
    page,
    pageSize: size,
    counts: {
      status: statusCounts,
      topic: topicCounts,
      all: Object.values(statusCounts).reduce((a, b) => a + b, 0),
      urgentOpen,
    },
  };
}

export async function getSupportTicket(id) {
  const ticket = await SupportTicket.findById(id)
    .populate("userId", "firstName lastName email role")
    .populate("notes.authorId", "firstName lastName")
    .populate("history.byId", "firstName lastName role")
    .lean();
  if (!ticket) throw new NotFoundError("We couldn't find that support ticket.");
  return toPlain(ticket);
}

/**
 * Move a ticket, add an internal note, or both — one administrator action.
 *
 * The status move is a conditional update on the status the ticket had when
 * it was read, so two administrators working the same ticket cannot both
 * "resolve" it: the second finds nothing to claim and is told so, the same
 * pattern the dispute decision uses. Every change is audited.
 */
export async function updateSupportTicket(id, { status, note }, admin, { request } = {}) {
  const current = await SupportTicket.findById(id).select("status reference topic").lean();
  if (!current) throw new NotFoundError("We couldn't find that support ticket.");

  if (status !== undefined && status !== current.status) {
    if (!canTransition(current.status, status)) {
      throw new BusinessRuleError(
        `A ${SUPPORT_TICKET_STATUS_LABELS[current.status].toLowerCase()} ticket can't be marked ${SUPPORT_TICKET_STATUS_LABELS[status].toLowerCase()}.`,
        "SUPPORT_TICKET_TRANSITION",
      );
    }

    const now = new Date();
    const set = { status };
    if (status === SUPPORT_TICKET_STATUS.RESOLVED) set.resolvedAt = now;
    if (status === SUPPORT_TICKET_STATUS.CLOSED) set.closedAt = now;

    const moved = await SupportTicket.findOneAndUpdate(
      { _id: id, status: current.status },
      {
        $set: set,
        $push: { history: { from: current.status, to: status, byId: admin.id, at: now } },
      },
      { returnDocument: "after" },
    ).lean();

    if (!moved) {
      throw new ConflictError("Someone else changed this ticket just now. Reload it and try again.");
    }

    await recordAudit({
      actor: admin,
      action: AUDIT_ACTIONS.SUPPORT_TICKET_STATUS_CHANGED,
      entityType: "SupportTicket",
      entityId: id,
      metadata: { reference: current.reference, from: current.status, to: status },
      request,
    });
  } else if (status !== undefined && note === undefined) {
    throw new BusinessRuleError(
      `This ticket is already ${SUPPORT_TICKET_STATUS_LABELS[current.status].toLowerCase()}.`,
      "SUPPORT_TICKET_UNCHANGED",
    );
  }

  if (note !== undefined) {
    await SupportTicket.updateOne(
      { _id: id },
      { $push: { notes: { authorId: admin.id, note } } },
      { runValidators: true },
    );

    await recordAudit({
      actor: admin,
      action: AUDIT_ACTIONS.SUPPORT_TICKET_NOTE_ADDED,
      entityType: "SupportTicket",
      entityId: id,
      // That a note was written, and how long — not what it says.
      metadata: { reference: current.reference, length: note.length },
      request,
    });
  }

  return getSupportTicket(id);
}
