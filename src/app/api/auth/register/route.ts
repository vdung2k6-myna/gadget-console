import { NextResponse } from "next/server";
import { registerAccount } from "@/lib/auth/accounts";
import { setSessionCookie } from "@/lib/auth/cookies";
import { createSession } from "@/lib/auth/session";
import { readCredentials } from "@/lib/http/credentials";

export async function POST(request: Request) {
  const credentials = await readCredentials(request);
  if (credentials === undefined) {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }

  const result = await registerAccount(credentials.email, credentials.password);
  if (!result.ok) {
    const status = result.reason === "taken" ? 409 : 400;
    const error =
      result.reason === "taken"
        ? "that address already has an account"
        : result.reason === "invalid-email"
          ? "that is not an email address"
          : "a password is at least 8 characters";
    return NextResponse.json({ error }, { status });
  }

  const session = await createSession(result.user.id);
  await setSessionCookie(session.token, session.expiresAt);
  return NextResponse.json({ user: { id: result.user.id, email: result.user.email } }, { status: 201 });
}
