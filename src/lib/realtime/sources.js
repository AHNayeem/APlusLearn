import "server-only";

/**
 * Where the realtime hub learns that something changed (docs/REALTIME.md).
 *
 * Two sources, one output. Both watch the *existing* collections — nothing
 * publishes, so no write path has to remember to — and both hand the hub the
 * same normalised record:
 *
 *   { collection: "notifications" | "conversations", op: "insert" | "update", doc }
 *
 * where `doc` carries only the fields routing needs (`WATCHED_FIELDS`). Neither
 * source reads a message body or a notification's text: the stream never
 * carries content, so there is no reason to load any.
 *
 *   change-stream  A replica set or sharded cluster (Atlas, production). True
 *                  push, one cursor per collection per server process.
 *   poll           A standalone server (local development). One indexed
 *                  `updatedAt` query per collection per tick per process —
 *                  never per connected browser.
 *
 * Each source is started by the hub when its first subscriber arrives and
 * stopped when its last one leaves. Either may lose events (a change stream
 * that has to be reopened, a clock far enough out to defeat the poll's
 * overlap), and that is survivable by design: `onResync` tells every browser
 * to reconcile from the database, which is the source of truth.
 */

export const REALTIME_SOURCES = Object.freeze({
  AUTO: "auto",
  CHANGE_STREAM: "change-stream",
  POLL: "poll",
});

/** The only fields routing reads. Content stays in the database. */
export const WATCHED_FIELDS = Object.freeze({
  notifications: ["userId", "readAt", "createdAt", "updatedAt"],
  conversations: [
    "participantIds",
    "lastMessageAt",
    "lastMessageSenderId",
    "unreadCounts",
    "archivedBy",
    "createdAt",
    "updatedAt",
  ],
});

const COLLECTIONS = Object.keys(WATCHED_FIELDS);

/** Poll tick. Short enough to feel instant, one query per collection. */
const DEFAULT_POLL_MS = 1000;
/** How far behind its watermark the poll re-reads, for writers whose clocks trail. */
const POLL_OVERLAP_MS = 3000;
const POLL_BATCH = 500;
/** How long a change stream waits before reopening after a non-resumable error. */
const REOPEN_DELAY_MS = 2000;

export function configuredSource() {
  const value = (process.env.REALTIME_SOURCE ?? "").trim().toLowerCase();
  return Object.values(REALTIME_SOURCES).includes(value) ? value : REALTIME_SOURCES.AUTO;
}

function pollInterval() {
  const value = Number(process.env.REALTIME_POLL_MS);
  return Number.isFinite(value) && value >= 250 ? value : DEFAULT_POLL_MS;
}

/**
 * Whether this deployment can open change streams: a replica set member or a
 * mongos. A standalone `mongod` — the default local install — cannot.
 */
export async function supportsChangeStreams(db) {
  try {
    const hello = await db.admin().command({ hello: 1 });
    return Boolean(hello.setName) || hello.msg === "isdbgrid";
  } catch {
    return false;
  }
}

/** Resolve `auto` against the server actually connected to. */
export async function resolveSourceKind(db, requested = configuredSource()) {
  if (requested !== REALTIME_SOURCES.AUTO) return requested;
  return (await supportsChangeStreams(db))
    ? REALTIME_SOURCES.CHANGE_STREAM
    : REALTIME_SOURCES.POLL;
}

/**
 * Start a source. Returns `{ kind, stop }`.
 *
 * `onChange(record)` is called once per change; `onResync()` whenever the
 * source may have missed something (it reopened, or it fell back), so the hub
 * can tell browsers to reconcile.
 */
export async function startSource(db, { kind, onChange, onResync, log = console }) {
  const resolved = await resolveSourceKind(db, kind);
  if (resolved === REALTIME_SOURCES.CHANGE_STREAM) {
    if (await supportsChangeStreams(db)) {
      return startChangeStream(db, { onChange, onResync, log });
    }
    // Asked for change streams on a server that cannot provide them. Fall
    // back loudly rather than deliver nothing.
    log.error?.(
      "[realtime] REALTIME_SOURCE=change-stream, but this MongoDB is not a replica set; " +
        "falling back to polling.",
    );
  }
  return startPoll(db, { onChange, onResync, log });
}

// --- Change stream -----------------------------------------------------------

function startChangeStream(db, { onChange, onResync, log }) {
  const streams = new Map();
  const resumeTokens = new Map();
  const timers = new Set();
  let stopped = false;

  const pipelineFor = (collection) => [
    { $match: { operationType: { $in: ["insert", "update", "replace"] } } },
    {
      $project: {
        operationType: 1,
        ...Object.fromEntries(
          ["_id", ...WATCHED_FIELDS[collection]].map((field) => [`fullDocument.${field}`, 1]),
        ),
      },
    },
  ];

  const open = (collection) => {
    const token = resumeTokens.get(collection);
    const stream = db.collection(collection).watch(pipelineFor(collection), {
      fullDocument: "updateLookup",
      ...(token ? { startAfter: token } : {}),
    });

    // A cursor is established some time after `watch()` returns, and a change
    // in between is in nobody's stream. The first resume token a cursor
    // reports — on first open and on every reopen — is the server accepting
    // it, and that is the moment browsers should reconcile across the gap.
    // (The driver does not forward the cursor's own `init`; later tokens
    // arrive with every batch and mean nothing new.)
    let established = false;
    stream.on("resumeTokenChanged", () => {
      if (established || stopped) return;
      established = true;
      onResync();
    });

    stream.on("change", (change) => {
      resumeTokens.set(collection, change._id);
      // An update whose document is already gone has nothing to route.
      if (!change.fullDocument) return;
      onChange({
        collection,
        op: change.operationType === "insert" ? "insert" : "update",
        doc: change.fullDocument,
      });
    });

    // The driver resumes transient errors by itself; this is what it could
    // not. Reopen from the last token after a pause.
    stream.on("error", (error) => {
      if (stopped) return;
      log.error?.(`[realtime] change stream on ${collection} failed:`, error.message);
      stream.close().catch(() => {});
      streams.delete(collection);
      // A token the oplog no longer holds would fail forever; start fresh.
      if (error?.code === 286 || /resume/i.test(error?.message ?? "")) {
        resumeTokens.delete(collection);
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        if (!stopped) open(collection);
      }, REOPEN_DELAY_MS);
      timers.add(timer);
    });

    streams.set(collection, stream);
  };

  for (const collection of COLLECTIONS) open(collection);

  return {
    kind: REALTIME_SOURCES.CHANGE_STREAM,
    async stop() {
      stopped = true;
      for (const timer of timers) clearTimeout(timer);
      await Promise.all([...streams.values()].map((s) => s.close().catch(() => {})));
      streams.clear();
    },
  };
}

// --- Poll --------------------------------------------------------------------

function startPoll(db, { onChange, onResync, log }) {
  const interval = pollInterval();
  const projection = (collection) =>
    Object.fromEntries(WATCHED_FIELDS[collection].map((field) => [field, 1]));

  // Per collection: the newest `updatedAt` seen, and which versions of which
  // documents were already delivered inside the overlap window.
  const state = new Map(
    COLLECTIONS.map((collection) => [
      collection,
      { watermark: Date.now(), seen: new Map() },
    ]),
  );

  let stopped = false;
  let timer = null;
  let failing = false;

  const pollCollection = async (collection) => {
    const entry = state.get(collection);
    const from = new Date(entry.watermark - POLL_OVERLAP_MS);
    const docs = await db
      .collection(collection)
      .find({ updatedAt: { $gt: from } }, { projection: projection(collection) })
      .sort({ updatedAt: 1 })
      .limit(POLL_BATCH)
      .toArray();

    for (const doc of docs) {
      const updatedAt = new Date(doc.updatedAt).getTime();
      const key = `${doc._id}:${updatedAt}`;
      if (entry.seen.has(key)) continue;
      entry.seen.set(key, updatedAt);
      if (updatedAt > entry.watermark) entry.watermark = updatedAt;

      const createdAt = doc.createdAt ? new Date(doc.createdAt).getTime() : null;
      onChange({ collection, op: createdAt === updatedAt ? "insert" : "update", doc });
    }

    // Forget versions that have fallen out of the window the query re-reads.
    const horizon = entry.watermark - POLL_OVERLAP_MS * 2;
    for (const [key, at] of entry.seen) if (at < horizon) entry.seen.delete(key);
  };

  const tick = async () => {
    if (stopped) return;
    try {
      for (const collection of COLLECTIONS) await pollCollection(collection);
      if (failing) {
        // The database came back. Whatever was written meanwhile is behind
        // the watermark or not, but the browsers cannot know — reconcile.
        failing = false;
        onResync();
      }
    } catch (error) {
      if (!failing) log.error?.("[realtime] poll failed:", error.message);
      failing = true;
    } finally {
      if (!stopped) timer = setTimeout(tick, interval);
    }
  };

  timer = setTimeout(tick, 0);

  return {
    kind: REALTIME_SOURCES.POLL,
    async stop() {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
