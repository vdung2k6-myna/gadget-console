import { NextResponse } from "next/server";

import { currentUser, unauthenticated } from "@/lib/auth/guard";
import {
  activeAccountProvider,
  findProviderProfile,
  runtimeProvider,
} from "@/lib/provider-profiles";
import { findRuntime } from "@/lib/runtimes";

/**
 * Speak one sample through the agent's own TTS profile, converted with the
 * settings the form is rehearsing.
 *
 * Two things happen server-side that the browser must not do: the TTS profile's
 * key is decrypted here and sent only to the runtime, and the runtime is asked
 * with its own token. The browser sends the conversion config and receives WAV.
 *
 * The runtime's audition synthesizes and converts in series, so on a CPU host the
 * answer can take tens of seconds. The timeout is the runtime's own conversion
 * budget plus synthesis, not the settings read's short one.
 */
export async function POST(request: Request) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "expected JSON" }, { status: 400 });
  }

  const runtimeId = typeof body.runtimeId === "string" ? body.runtimeId : "";
  if (runtimeId === "") {
    return NextResponse.json({ ok: false, error: "runtimeId is required" }, { status: 400 });
  }
  const runtime = await findRuntime(runtimeId);
  if (runtime === undefined) {
    return NextResponse.json({ ok: false, error: "runtime not found" }, { status: 404 });
  }

  // The agent names a profile; an agent that names none uses the account's
  // speech setting, which is the profile a turn would fall back to.
  const profileId = typeof body.ttsProfileId === "string" ? body.ttsProfileId : "";
  const profile =
    profileId === ""
      ? await activeAccountProvider(user.id, "tts")
      : await findProviderProfile(user.id, profileId);
  if (profile === undefined) {
    return NextResponse.json(
      { ok: false, error: "no TTS profile is available for this agent" },
      { status: 400 }
    );
  }
  if (profile.kind !== "tts") {
    return NextResponse.json(
      { ok: false, error: "the selected profile is not a TTS profile" },
      { status: 400 }
    );
  }

  const provider = runtimeProvider(profile);
  if (provider.baseUrl === "" || provider.model === "") {
    return NextResponse.json(
      { ok: false, error: "the TTS profile has no endpoint or model" },
      { status: 400 }
    );
  }
  if (provider.voice === undefined) {
    return NextResponse.json(
      { ok: false, error: "the TTS profile has no voice" },
      { status: 400 }
    );
  }

  const payload: Record<string, unknown> = {
    ttsBaseUrl: provider.baseUrl,
    ttsModel: provider.model,
    ttsVoice: provider.voice,
    ...(provider.apiKey === undefined ? {} : { ttsApiKey: provider.apiKey }),
    ...(body.ovc === undefined ? {} : { ovc: body.ovc }),
    ...(typeof body.text === "string" && body.text.trim() !== ""
      ? { text: body.text.trim().slice(0, 200) }
      : {}),
  };

  try {
    const response = await fetch(new URL("/api/voice-conversion/audition", runtime.baseUrl), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runtime.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(120_000),
      cache: "no-store",
    });
    if (!response.ok) {
      const error = (await response
        .json()
        .catch(() => ({ error: `runtime answered ${response.status}` }))) as {
        error?: string;
      };
      return NextResponse.json(
        { ok: false, error: error.error ?? `runtime answered ${response.status}` },
        { status: 502 }
      );
    }
    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "Content-Type": "audio/wav",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "runtime unreachable" },
      { status: 502 }
    );
  }
}
