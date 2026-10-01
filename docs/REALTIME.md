# Realtime messages and notifications

How a new message or notification reaches the other person's screen without a
refresh, and why it is built the way it is.

**In one line:** Server-Sent Events carry *hints* (ids, timestamps, unread
counts). The browser answers each hint by reading through the API it already
used. The database stays the only record, so losing a hint costs one extra
fetch and never a message.

## Contents

1. [Why it was not instant before](#1-why-it-was-not-instant-before)
2. [Architecture](#2-architecture)
3. [Message flow](#3-message-flow)
4. [Notification flow](#4-notification-flow)
5. [The event stream](#5-the-event-stream)
6. [Security](#6-security)
7. [Reconnection and recovery](#7-reconnection-and-recovery)
8. [Optimistic sends and idempotency](#8-optimistic-sends-and-idempotency)
9. [Configuration](#9-configuration)
10. [Local development](#10-local-development)
11. [Production (Vercel + Atlas)](#11-production-vercel--atlas)
12. [Testing](#12-testing)
13. [Known limitations](#13-known-limitations)

---

## 1. Why it was not instant before

There was no delivery mechanism of any kind: no SSE, no WebSocket, no
polling. Pages were Server Components that read the database when you
navigated to them. The badges were worked out once by the `(dashboard)` and
`tutor` layouts. A conversation's client state only changed when *its own*
user sent something, followed by `router.refresh()`. The recipient saw a new
message on their next navigation.

## 2. Architecture

```
 write paths (unchanged)                     one hub per server process
 ───────────────────────                     ──────────────────────────
 sendMessage ──► Message, Conversation ──┐
 notify()    ──► Notification          ──┼─► change source ──► hub ──► SSE streams
 mark*Read   ──► Conversation, Notif.  ──┘   (change stream     (routes by the    (one per tab
                                              or poll)           stored document)   in view)
                                                                                     │
                     browser: RealtimeProvider ◄─────────────────────────────────────┘
                       │  hint: "conversation X changed", "you have a notification"
                       ▼
                     the existing authorised endpoints (GET … ?since=, GET /api/notifications)
```

**Why SSE, not WebSockets.** Production is Vercel, where functions can stream
a response but cannot hold a WebSocket server. Delivery only needs to go one
way, from server to browser: everything a browser *does* is already a normal
authenticated request. SSE is plain HTTP, so it passes through the same
`routeHandler` auth pipeline and the same cookies, and needs no new dependency.

**Why the source watches the database instead of each write publishing.** The
server instance that handled a send is usually not the one holding the
recipient's stream, so an in-memory pub/sub would reach nobody. Watching the
existing collections means:

- every write is seen, including ones from paths written later;
- no call site has to remember to "publish";
- no new collection, queue or infrastructure is needed.

Two sources produce the same normalised record. They are in
[src/lib/realtime/sources.js](../src/lib/realtime/sources.js).

| Source | When | How |
|---|---|---|
| `change-stream` | Replica set or sharded cluster (Atlas, production) | One change stream per watched collection per server process, `$project`ed down to routing fields. True push. |
| `poll` | Standalone `mongod` (the default local install) | One indexed `updatedAt > watermark` query per collection, about once a second, **per process — never per browser**. It re-reads a 3 s overlap for writers whose clocks trail, and drops versions it already delivered. |

`REALTIME_SOURCE=auto` (the default) picks the source from the server's
`hello` response. A source only runs while that process has at least one
subscriber, and stops 60 s after the last one leaves.

**Files**

| File | Role |
|---|---|
| [src/app/api/realtime/route.js](../src/app/api/realtime/route.js) | `GET /api/realtime`: auth, permission, rate limit, then the stream |
| [src/services/realtime.service.js](../src/services/realtime.service.js) | The hub: routing (`eventsForChange`), per-user debounced recounts, per-user stream cap, session re-check, the SSE `Response` |
| [src/lib/realtime/sources.js](../src/lib/realtime/sources.js) | Change-stream and poll sources |
| [src/lib/realtime/events.js](../src/lib/realtime/events.js) | Event and close-reason names, shared by server and browser |
| [src/components/realtime/RealtimeProvider.jsx](../src/components/realtime/RealtimeProvider.jsx) | The browser connection, `useRealtimeEvent`, live counts and status |
| [src/components/messaging/thread.js](../src/components/messaging/thread.js) | Pure merge rules for optimistic and stored messages |
| `ConversationView`, `LiveConversationList`, `NotificationsList`, `DashboardNav` | The UI that listens |

## 3. Message flow

1. User A presses Enter. `ConversationView` mints a `clientId` (UUID v4), adds
   an optimistic row and `POST`s `/api/messages` (or `/api/messages/attachments`
   when files are attached) with the `clientId`.
2. `sendMessage` runs unchanged: it checks participation, blocking, verified
   email and attachments, stores the message, updates `Conversation`
   (`lastMessageAt`, `unreadCounts`) and calls `notify()` for B. The only
   addition is the `clientId` replay check (§8).
3. The source sees the `Conversation` update and the `Notification` insert.
   The hub sends:
   - `conversation { id, lastMessageAt, lastMessageSenderId, unreadCount, archived }`
     to **each participant**, with their own unread count;
   - `notification { id, createdAt }` to **B only**;
   - after a 250 ms debounce, `counts { messages, notifications }` to each
     affected user.
4. In B's browser:
   - `DashboardNav` badges update from `counts`.
   - `LiveConversationList` re-reads `GET /api/messages/conversations`.
   - If B has the thread open, `ConversationView` reads
     `GET /api/messages/conversations/:id?since=<newest stored message>`,
     merges the result by id and, **if the tab is visible**, marks the thread
     read. A message that arrives in a background tab stays unread until
     someone looks at it.
5. A's own tabs receive the same `conversation` hint. They merge the stored
   message, which replaces the optimistic row by `clientId`, whichever of the
   response or the hint arrives first.
6. Reading the thread (`POST …/read`) changes `unreadCounts`. Every one of the
   reader's tabs gets `conversation { unreadCount: 0 }` and a recount.

The `?since=` read is `messagesSince()` in
[message.service.js](../src/services/message.service.js). It makes the same
`assertParticipant` check as every other read, looks back 5 s further than
asked (in case servers' clocks differ), returns at most 100 messages oldest
first, and sets `complete: false` when more than that are waiting. In that
case the browser reloads the thread.

## 4. Notification flow

Every notification is written by `notify()`, which is unchanged. The source
sees the insert, and the hub sends `notification { id, createdAt }` to that
notification's `userId` plus a recount. The notification centre
(`NotificationsList`) then re-reads its first page through
`GET /api/notifications`.

A notification being read, whether one or all of them and in any tab or
device, produces `notification.updated { id, readAt }` for each changed row
and a recount. Other tabs apply the read in place. Deleting a notification is
not pushed (see §13).

## 5. The event stream

`GET /api/realtime`, `text/event-stream`, `Cache-Control: no-cache, no-store,
no-transform`. The `no-transform` is what stops compression in `next start`
from holding chunks back. Event names are in
[events.js](../src/lib/realtime/events.js).

| Event | Data | Notes |
|---|---|---|
| `ready` | `{ counts, source? }` | First event of every connection. The browser reconciles everything on it. `source` is only included outside production. |
| `counts` | `{ messages, notifications }` | Both badges, recomputed at most every 250 ms per user |
| `notification` | `{ id, createdAt }` | A notification was created for you |
| `notification.updated` | `{ id, readAt }` | One of your notifications changed |
| `conversation` | `{ id, lastMessageAt, lastMessageSenderId, unreadCount, archived, updatedAt }` | A thread you are in changed |
| `resync` | `{}` | The server may have missed changes (a change stream reopened, the poll recovered from a database error). Reconcile. |
| `ping` | `{}` | Every 20 s, so a silent (buffered or dropped) stream is noticed |
| `bye` | `{ reason }` | `lifetime` means reconnect now. `unauthorized` means stop. `replaced` means wait until the tab is in view. `unavailable` means back off. |

**Never on the wire:** a message body, a thread preview, a notification's
title or text, an attachment. Both test suites assert this.

## 6. Security

- **The session decides, and only the session.** The request carries no
  channel name, conversation id or user id, so there is nothing to subscribe
  to that isn't already the caller's own. `routeHandler({ permission:
  NOTIFICATION_VIEW })` authenticates the stream exactly like any other
  endpoint.
- **Routing reads the stored document.** A notification goes to its `userId`.
  A conversation change goes to its `participantIds`. An administrator gets no
  events for other people's threads, even though the moderation tools can
  open them.
- **Content goes through authorised reads only.** A hint is answered through
  `?since=` or the list endpoints, which make their usual participant and
  ownership checks.
- **Sessions are re-checked while a stream is open.** Every 45 s the stream
  re-reads the account: deleted, suspended or a changed `tokenVersion`
  (password reset, sign out everywhere) closes it with `bye unauthorized`, and
  the browser does not reconnect. A stream also ends after 270 s, and the
  reconnect re-authenticates with the current cookie, so an expired cookie is
  noticed within about 4.5 minutes.
- **Abuse limits.** Each account can open 60 streams per 5 minutes
  (`enforceRateLimit`, shared across instances), and can hold at most 8
  concurrent streams per server process. When the cap is reached, the oldest
  stream is closed with `bye replaced`.
- **Input validation.** `clientId` must be a UUID (`z.uuid()`), and `since`
  must be a date.
- **The service worker refuses `/api/**` first** ([docs/PWA.md](PWA.md)), so
  the stream is never intercepted or cached.

## 7. Reconnection and recovery

The rule: **the browser reconciles from the database on every `ready` and
every `resync`.** `RealtimeProvider` turns both into one `RESYNC`
notification to its listeners, and each listener re-reads what it shows:

- `ConversationView` reads `?since=` its newest stored message;
- `LiveConversationList` and `NotificationsList` re-read their first page;
- the badges come from the counts in `ready`.

So recovery doesn't depend on any particular event having arrived. A missed
event costs one fetch on the next reconnect, and nothing is lost.

| Situation | What happens |
|---|---|
| Network drops | The `offline` event closes the stream and shows "Offline". On `online`, the browser reconnects at once, gets `ready` and reconciles. |
| Server restart, deploy, error | `EventSource` errors, and the browser reconnects with exponential backoff (1 s, 2 s, 4 s … up to 30 s, with jitter). On `ready` it reconciles. |
| Stream silently dead (proxy buffering, socket dropped by the OS) | A 50 s watchdog with no events (pings arrive every 20 s) treats it as broken and reconnects. |
| Vercel `maxDuration` | The server ends the stream itself at 270 s (`maxDuration = 300`) with `bye lifetime`, and the browser reconnects immediately. This also caps how stale a quiet connection can get. |
| Tab in the background | It keeps streaming for 30 s, then closes. Becoming visible reconnects and reconciles. |
| Laptop sleep, phone app switch, back/forward cache | `visibilitychange`, `pageshow` and the watchdog all lead to a reconnect and reconcile. The stream is closed on `pagehide` so the page can enter the back/forward cache. |
| Change stream error the driver cannot resume | The stream reopens after 2 s from the last resume token (or fresh, if the oplog no longer holds it). The first resume token from the new cursor triggers `resync` for everyone. |
| Signed out, suspended, password reset | `bye unauthorized`. The browser stops and calls `router.refresh()`, and the layout's guard redirects. |

**Multiple tabs.** Each tab *in view* holds its own stream, and all of them
receive the same events. A tab hidden for more than 30 s lets its stream go
and reconciles when it's back. There is deliberately no leader election
across tabs (`navigator.locks` + `BroadcastChannel`). A leader in a
background tab can be frozen or throttled, especially on mobile, and that
would leave every visible tab silently stale. Keeping the connection count to
the tabs actually on screen gets the same benefit without that risk.

## 8. Optimistic sends and idempotency

- **`Message.clientId`** is optional, minted by the browser per send.
  `sendMessage` looks it up **before** anything is written or uploaded. A
  retry of a send that already landed returns the stored message, with no
  second message, notification or unread increment. Copies racing each other
  are stopped by a partial unique index on `{ senderId, clientId }`: the loser
  of the insert discards its uploaded files and returns the winner. A
  `clientId` belongs to its sender, so another sender's identical one is a
  different message.
- **Merging** ([thread.js](../src/components/messaging/thread.js)). Stored
  messages are keyed by id. A local (optimistic) message is keyed by its
  `clientId`, and disappears the moment any source brings back the stored
  message with that `clientId`. The three sources are the send's response,
  the `?since=` read after a hint, and a server render. However they race,
  each message appears exactly once.
- **Failure.** A send that fails stays in the thread marked **Not sent**, with
  the server's reason, or "Couldn't reach the server" when the server was
  never reached. **Retry** re-sends under the **same `clientId`**, files
  included. **Edit** moves the text and files back into the composer. Sends
  are queued, so the thread's order is the order the messages were typed.

## 9. Configuration

None of this is secret, and none of it is required.

| Variable | Default | Meaning |
|---|---|---|
| `REALTIME_SOURCE` | `auto` | `auto` uses change streams on a replica set or sharded cluster and polling on a standalone server. `change-stream` forces change streams (it logs and falls back to polling if the server can't do it). `poll` forces polling. |
| `REALTIME_POLL_MS` | `1000` | The poll tick (minimum 250). Only used by the poll source. |

Fixed in code (`STREAM_TIMING` in
[realtime.service.js](../src/services/realtime.service.js)): ping every 20 s,
session check every 45 s, stream lifetime 270 s, count debounce 250 ms,
source idle stop after 60 s.

**Indexes.** `Notification` and `Conversation` gain `{ updatedAt: 1 }` for the
poll source. `Message` gains the partial unique `{ senderId: 1, clientId: 1 }`.
`autoIndex` builds them in development. Production runs with `autoIndex` off,
so create them once (see §11). Idempotency still holds without the unique
index for every *sequential* retry, because the lookup comes first. The index
is the backstop against two copies arriving at the same instant.

## 10. Local development

Nothing to configure. A default `brew install mongodb-community` is
standalone, so `auto` picks **polling**, and messages arrive within about a
second.

To exercise the production path locally, run a throwaway single-node replica
set alongside your normal server:

```bash
mkdir -p /tmp/rs0 && mongod --replSet rs0 --port 27018 --dbpath /tmp/rs0 --bind_ip 127.0.0.1
# once, in another terminal:
mongosh --port 27018 --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"127.0.0.1:27018"}]})'

MONGODB_URI="mongodb://127.0.0.1:27018/aplus_rs?replicaSet=rs0" node --env-file=.env.local scripts/seed.js
MONGODB_URI="mongodb://127.0.0.1:27018/aplus_rs?replicaSet=rs0" bun run dev
```

Outside production, `ready.source` says which source a stream is using
(`bun run qa` prints it).

## 11. Production (Vercel + Atlas)

- **Atlas is always a replica set**, so `auto` picks change streams. Check
  that the database user's role can run `changeStream` (`readWrite` covers
  it).
- **Create the new indexes once** against production, for example from a
  shell with the production URI:
  ```js
  db.messages.createIndex({ senderId: 1, clientId: 1 },
    { unique: true, partialFilterExpression: { clientId: { $type: "string" } } })
  db.notifications.createIndex({ updatedAt: 1 })   // only used by the poll source
  db.conversations.createIndex({ updatedAt: 1 })   // only used by the poll source
  ```
- **`maxDuration = 300`** on the route. On a plan whose limit is lower, the
  stream still ends itself at 270 s, so lower `STREAM_TIMING.lifetimeMs` to
  stay inside the limit. Streaming is native on Vercel. Behind any other proxy,
  make sure it doesn't buffer `text/event-stream` (the route sends
  `X-Accel-Buffering: no` for nginx).
- **Cost.** Each tab in view holds one function invocation open. With Fluid
  compute, many streams share an instance, and that instance runs one change
  stream per collection (not one per user). Reconnects happen about every
  4.5 minutes per open tab.
- **Connections.** Each instance with subscribers holds two change-stream
  cursors on the existing pool (`maxPoolSize: 10`).

## 12. Testing

| Suite | What it covers |
|---|---|
| `bun run test:integrations`, section "Realtime" | Routing scope (owner only, participants only, no content in events), the merge rules, the poll source (inserts, updates, overlap de-duplication, projection), the hub with a recipient, a sender, a stranger and an admin, `clientId` replay and a three-way race, `messagesSince` recovery and refusal, read sync, session revocation, the per-user stream cap. With `REALTIME_REPLSET_URI=<replica set>` it also runs the change-stream source: auto-selection, inserts, updates with lookup, projection, routing and the resync on open. |
| `bun run qa`, section "Realtime" | Over real HTTP: 401 for anonymous, headers, `ready` counts, a tutor hearing a parent's message within 5 s, a notification hint and a recount, nothing for an outsider or admin, no body on the wire, the authorised `?since=` read and its refusal, `clientId` replay, invalid input, the reconnect snapshot and recovery of a message sent while away, two-tab read and notification sync. |
| `bun run e2e:realtime` | Two real browsers (parent and tutor) with **no page reloads**: the live inbox and badge, the badge clearing on open, read-on-arrival in an open thread, the reply going the other way, a live notification and badge, mark-all-read clearing another tab's badge, an offline period recovering a missed message, and a send failing offline then a Retry delivering it exactly once to both screens and the database. |

To watch it by hand: sign in as `jennifer.chen@example.com` in one browser and
as `priya.sharma@example.com` in another (a private window works), open
`/messages/<thread>` and `/tutor/messages`, and type. In DevTools' Network
panel, `/api/realtime` shows each event as it arrives.

## 13. Known limitations

- **There are no OS-level push notifications.** The app has no Push API,
  VAPID keys or `push` handler in the service worker. Realtime works while the
  app is open. A closed app, or a phone with the PWA in the background,
  catches up the next time it's opened. Adding push would mean a VAPID key
  pair, a `PushSubscription` collection, a `push` handler in `sw.js`, and a
  `notify()` channel. That belongs in its own piece of work.
- **Polling adds up to about a second of latency** (`REALTIME_POLL_MS`). It's
  meant for development and standalone servers. On a standalone server, a
  writer whose clock is more than 3 s behind could be missed until the next
  reconnect (at most 4.5 min).
- **Deleting a notification is not pushed.** Other tabs drop it on their next
  reconcile.
- **A signed-out browser's existing stream lives until its next session check
  or lifetime end**, unless the sign-out bumped `tokenVersion`. The stream
  carries only ids and counts.
- **"Seen" receipts are not shown.** `Message.readBy` is stored, and reading a
  thread syncs unread counts across the reader's tabs, but the UI shows no
  "seen" marker to the sender. None existed before this work, and adding one
  is a product decision.
- **The admin area has no live updates.** It has no inbox or notification
  centre, and its queue badges are read by the layout as before.
