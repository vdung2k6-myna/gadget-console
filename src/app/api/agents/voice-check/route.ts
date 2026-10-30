import { NextResponse } from "next/server";

import { currentUser, unauthenticated } from "@/lib/auth/guard";
import {
  activeAccountProvider,
  defaultProviderProfile,
  runtimeProvider,
  testSpeechProvider,
} from "@/lib/provider-profiles";

/**
 * Check a voice an agent names against the account's TTS provider.
 *
 * The agent form cannot know what an arbitrary provider holds, so it asks the
 * provider itself — the same call the settings page's sample makes — and shows
 * the provider's own refusal instead of letting a turn discover it.
 */
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
  const voice = typeof fields.voice === "string" ? fields.voice.trim() : "";
  if (voice === "") {
    // Empty means the profile's own voice, which is checked when it is saved.
    return NextResponse.json({ ok: true });
  }

  const profile = (await activeAccountProvider(user.id, "tts")) ?? (await defaultProviderProfile("tts"));
  if (profile === undefined) {
    return NextResponse.json({
      ok: false,
      error: "no text-to-speech provider is configured for this account",
    });
  }
  const provider = runtimeProvider(profile);

  const result = await testSpeechProvider({
    baseUrl: provider.baseUrl,
    model: provider.model,
    voice,
    ...(provider.apiKey === undefined ? {} : { apiKey: provider.apiKey }),
  });
  return NextResponse.json(result.ok ? { ok: true } : { ok: false, error: result.error });
}
