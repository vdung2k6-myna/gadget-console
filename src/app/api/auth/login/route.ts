import { NextResponse } from "next/server";
import { authenticate } from "@/lib/auth/accounts";
import { setSessionCookie } from "@/lib/auth/cookies";
import { createSession } from "@/lib/auth/session";
import { readCredentials } from "@/lib/http/credentials";

/**
 * One answer for a wrong password and for an address nobody holds. The status
 * and the body are identical, so an attempt learns nothing about which
 * addresses exist.
 */
export async function POST(request: Request) {
  const credentials = await readCredentials(request);
  if (credentials === undefined) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const user = await authenticate(credentials.email, credentials.password);
  if (user === undefined) {
    return NextResponse.json({ error: "invalid credentials" }, { status: 401 });
  }

  const session = await createSession(user.id);
  await setSessionCookie(session.token, session.expiresAt);
  return NextResponse.json({ user: { id: user.id, email: user.email } });
}
