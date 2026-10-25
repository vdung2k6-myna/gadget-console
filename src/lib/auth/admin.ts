import { notFound } from "next/navigation";
import { connection } from "next/server";
import { currentUser } from "./guard";
import type { SessionUser } from "./session";

/**
 * The admin gate, on its own surface.
 *
 * A user is answered with the not-found page rather than a refusal, for the same
 * reason a foreign device is: whether an admin area exists is not something a
 * normal account should learn from a status code.
 *
 * The role is read from the account row on every request — `currentUser` selects
 * it — so an account demoted while signed in loses the area on its next request.
 *
 * `connection()` first, for the same reason the session gate has it: this reads
 * the session, and the session's expiry is compared against now. The
 * route-handler form below does not need it — a handler has no prerender pass.
 */
export async function requireAdmin(): Promise<SessionUser> {
  await connection();
  const user = await currentUser();
  if (user === undefined || user.role !== "admin") notFound();
  return user;
}

/** The route-handler form: `undefined` for anybody who is not an admin. */
export async function currentAdmin(): Promise<SessionUser | undefined> {
  const user = await currentUser();
  return user !== undefined && user.role === "admin" ? user : undefined;
}
