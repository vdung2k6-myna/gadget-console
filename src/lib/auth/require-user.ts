import { redirect } from "next/navigation";
import { connection } from "next/server";
import { readSessionToken } from "./cookies";
import { findSessionUser, type SessionUser } from "./session";

/**
 * The session gate, in each page that needs one rather than in middleware: a
 * gate that runs where it is used is visible where it is read, and the only
 * public routes are the root page and `/health`.
 *
 * `connection()` comes first because a session is a fact about *this* request:
 * the cookie it reads, the row it matches, and the expiry it compares against
 * are all read now, never at build time. Without it Next finds the clock read
 * inside `findSessionUser` while prerendering the shell and fails the route.
 * The root layout calls this on every page, so the whole console renders at
 * request time — which is what an account-gated console is.
 */
export async function optionalUser(): Promise<SessionUser | undefined> {
  await connection();
  const token = await readSessionToken();
  return token === undefined ? undefined : findSessionUser(token);
}

export async function requireUser(): Promise<SessionUser> {
  const user = await optionalUser();
  if (user === undefined) redirect("/");
  return user;
}
