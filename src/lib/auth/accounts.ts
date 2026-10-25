import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { hashPassword, verifyPassword } from "./password";
import type { SessionUser } from "./session";

/**
 * Registration and sign-in, apart from the routes that serve them so the
 * behaviour can be tested without an HTTP request.
 *
 * An address is stored normalized — trimmed and lower-cased — because the unique
 * index is what refuses a second account, and `Ann@example.com` is the same
 * person as `ann@example.com`.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MIN_PASSWORD_LENGTH = 8;

export type RegisterResult =
  | { ok: true; user: SessionUser }
  | { ok: false; reason: "invalid-email" | "weak-password" | "taken" };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function registerAccount(
  rawEmail: string,
  password: string
): Promise<RegisterResult> {
  const email = normalizeEmail(rawEmail);
  if (!EMAIL.test(email)) return { ok: false, reason: "invalid-email" };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, reason: "weak-password" };

  const passwordHash = await hashPassword(password);
  const inserted = await getDb()
    .insert(users)
    .values({ email, passwordHash })
    .onConflictDoNothing({ target: users.email })
    .returning();

  const user = inserted[0];
  if (user === undefined) return { ok: false, reason: "taken" };
  return { ok: true, user };
}

/**
 * A wrong password and an address nobody holds are one answer: `undefined`.
 * The caller turns that into one response, so neither attempt learns whether
 * the address exists.
 */
export async function authenticate(
  rawEmail: string,
  password: string
): Promise<SessionUser | undefined> {
  const email = normalizeEmail(rawEmail);
  const rows = await getDb().select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (user === undefined || user.disabledAt !== null) return undefined;

  return (await verifyPassword(password, user.passwordHash)) ? user : undefined;
}
