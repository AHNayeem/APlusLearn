import { notFound } from "next/navigation";
import { connectToDatabase } from "@/lib/db/connect";
import { devMailQuerySchema } from "@/lib/validation/auth";
import { developmentMailboxEnabled } from "@/services/external/email-provider";
import { devMailboxAllowed, readDevMail } from "@/services/external/dev-mailbox";

// Rendered on demand, never prerendered: a prerendered not-found is served
// with a 200, and anywhere this page is closed it must be an honest 404.
export const dynamic = "force-dynamic";

/** No title where it is closed — the page should not even name itself. */
export function generateMetadata() {
  return devMailboxAllowed()
    ? { title: "Development mailbox", robots: { index: false, follow: false } }
    : { robots: { index: false, follow: false } };
}

/**
 * Every email the console transport "sent" since the server started (§38).
 *
 * Exists only in a development build whose mail goes to the console; anywhere
 * else it is a 404. The messages are exactly what a real inbox would have
 * received — the same codes and links, generated and checked by the same code
 * as production.
 */
export default async function DevMailPage({ searchParams }) {
  // The build-time answer, before anything touches a database: a production
  // build prerenders this page as a plain 404 and never connects to Mongo.
  if (!devMailboxAllowed()) notFound();
  await connectToDatabase();
  if (!(await developmentMailboxEnabled())) notFound();

  const parsed = devMailQuerySchema.safeParse(await searchParams);
  const filter = parsed.success ? parsed.data : { limit: 20 };
  const messages = readDevMail({ to: filter.to, limit: 50 });

  return (
    <main id="main" className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-wider text-warning-700">
        Development only
      </p>
      <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-ink-900">
        Development mailbox
      </h1>
      <p className="mt-2 text-sm text-ink-500">
        No mail server is configured, so outgoing email is printed to the server log and kept here
        until the server restarts. Configure a provider in <code>.env.local</code> or the admin
        panel and this page disappears.
      </p>

      <form method="get" className="mt-6 flex flex-col gap-2 sm:flex-row">
        <label htmlFor="dev-mail-to" className="sr-only">
          Recipient
        </label>
        <input
          id="dev-mail-to"
          name="to"
          type="email"
          defaultValue={filter.to ?? ""}
          placeholder="Filter by recipient"
          className="block w-full rounded-xl border-0 bg-white px-3.5 py-2.5 text-sm text-ink-800 ring-1 ring-inset ring-ink-200 focus:ring-2 focus:ring-brand-500 focus:outline-none"
        />
        <button
          type="submit"
          className="h-11 shrink-0 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700"
        >
          Filter
        </button>
      </form>

      {messages.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-500">
          Nothing yet. Request a password reset or register an account, then refresh.
        </p>
      ) : (
        <ol className="mt-8 space-y-4">
          {messages.map((message) => (
            <li key={message.id} className="rounded-2xl border border-ink-200 bg-white p-5 shadow-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-semibold text-ink-900">{message.subject}</p>
                <time dateTime={message.sentAt} className="text-xs text-ink-400">
                  {new Date(message.sentAt).toLocaleTimeString("en-CA")}
                </time>
              </div>
              <p className="mt-0.5 text-xs text-ink-500">To: {message.to}</p>
              <pre className="mt-4 overflow-x-auto whitespace-pre-wrap break-words rounded-xl bg-ink-50 p-4 font-mono text-xs leading-relaxed text-ink-700">
                {message.text}
              </pre>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
