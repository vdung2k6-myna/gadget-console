import { NextResponse } from "next/server";
import { clearSessionCookie, readSessionToken } from "@/lib/auth/cookies";
import { destroySession } from "@/lib/auth/session";

export async function POST() {
  const token = await readSessionToken();
  if (token !== undefined) await destroySession(token);
  await clearSessionCookie();
  return new NextResponse(null, { status: 204 });
}
