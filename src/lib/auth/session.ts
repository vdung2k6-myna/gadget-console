import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt } from "drizzle-orm";
import { loadConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { sessions, users } from "@/lib/db/schema";

/**
 * A session is a random token the browser holds; the console stores only its
 * hash, so a database read cannot be replayed as a sign-in. Expiry is a row
 * value, checked on every read, rather than a cookie the client promises to
 * honour.
 */

export const SESSION_COOKIE = "gc_session";

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(userId: string): Promise<IssuedSession> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + loadConfig().sessionTtlMs);
  await getDb()
    .insert(sessions)
    .values({ tokenHash: hashSessionToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export type SessionUser = typeof users.$inferSelect;

export async function findSessionUser(token: string): Promise<SessionUser | undefined> {
  const rows = await getDb()
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(eq(sessions.tokenHash, hashSessionToken(token)), gt(sessions.expiresAt, new Date()))
    );

  const user = rows[0]?.user;
  if (user === undefined || user.disabledAt !== null) return undefined;
  return user;
}

export async function destroySession(token: string): Promise<void> {
  await getDb().delete(sessions).where(eq(sessions.tokenHash, hashSessionToken(token)));
}
