import { NextResponse } from "next/server";
import { readSessionToken } from "./cookies";
import { findSessionUser, type SessionUser } from "./session";

export async function currentUser(): Promise<SessionUser | undefined> {
  const token = await readSessionToken();
  return token === undefined ? undefined : findSessionUser(token);
}

export function unauthenticated(): NextResponse {
  return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
}

/**
 * The answer for a resource that is not this account's is the answer for one
 * that does not exist — the two are deliberately indistinguishable.
 */
export function notFound(): NextResponse {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}
