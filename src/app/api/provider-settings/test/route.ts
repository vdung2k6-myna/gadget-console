import { NextResponse } from "next/server";

import { currentUser, unauthenticated } from "@/lib/auth/guard";
import { testSpeechProvider } from "@/lib/provider-profiles";

/**
 * Speak a short sample through the configuration entered in the form.
 *
 * The call itself lives in the profile module, so it can be tested against a
 * stub provider without a session or a deployment; this route only authenticates
 * and serializes the answer.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "the body must be JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ ok: false, error: "the body must be an object" }, { status: 400 });
  }
  const fields = body as Record<string, unknown>;

  const result = await testSpeechProvider({
    baseUrl: text(fields.baseUrl),
    model: text(fields.model),
    voice: text(fields.voice),
    apiKey: text(fields.apiKey),
  });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });

  return NextResponse.json({
    ok: true,
    contentType: result.contentType,
    audio: result.audio.toString("base64"),
  });
}
