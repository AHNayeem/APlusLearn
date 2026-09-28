import "server-only";
import { isProduction } from "@/lib/config/env";

/**
 * Seeded sign-in shortcuts for the login screen, development only.
 *
 * Mirrors the accounts `bun run seed` creates (scripts/seed.js, README
 * "Seeded accounts"); it fills the form and nothing more — the request still
 * goes through `/api/auth/login` like any other sign-in.
 *
 * Held behind the same two locks as the development mailbox: a development
 * build (`NODE_ENV`) *and* a non-production deployment (`APP_ENV`). The list
 * lives in a server-only module and reaches the page as a prop, so a
 * production bundle never carries the shared seed password.
 */

const SEED_PASSWORD = "AplusLearn2024!";

const ACCOUNTS = [
  { role: "Administrator", email: "admin@apluslearn.ca" },
  { role: "Parent", email: "jennifer.chen@example.com" },
  { role: "Tutor", email: "priya.sharma@example.com" },
  { role: "Student", email: "nadia.petrov@example.com" },
  { role: "Pending tutor", email: "james.oconnor@example.com" },
];

export function devSignInAccounts() {
  if (process.env.NODE_ENV === "production" || isProduction()) return null;
  return ACCOUNTS.map((account) => ({ ...account, password: SEED_PASSWORD }));
}
