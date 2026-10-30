import { NextResponse } from "next/server";

import { currentUser, unauthenticated } from "@/lib/auth/guard";
import {
  accountSpeechSettings,
  saveAccountProvider,
  SPEECH_KINDS,
  useDeploymentDefault,
  validateProviderDraft,
  type SpeechKind,
} from "@/lib/provider-profiles";

/**
 * The account's speech settings: one transcriber and one voice, edited in place.
 *
 * The setting is stored as a provider profile so the resolve payload and every
 * turn keep their shape; saving re-points the account's agents at it.
 */

function asKind(value: unknown): SpeechKind | undefined {
  return (SPEECH_KINDS as readonly unknown[]).includes(value) ? (value as SpeechKind) : undefined;
}

function labelFor(kind: SpeechKind): string {
  return kind === "stt" ? "STT" : "TTS";
}

export async function GET() {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();
  return NextResponse.json({ settings: await accountSpeechSettings(user.id) });
}

export async function PUT(request: Request) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ["the body must be JSON"] }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ errors: ["the body must be an object"] }, { status: 400 });
  }
  const fields = body as Record<string, unknown>;
  const kind = asKind(fields.kind);
  if (kind === undefined) {
    return NextResponse.json({ errors: [`kind must be one of ${SPEECH_KINDS.join(", ")}`] }, { status: 400 });
  }

  const validation = validateProviderDraft(
    {
      kind,
      name: labelFor(kind),
      baseUrl: fields.baseUrl,
      model: fields.model,
      voice: kind === "tts" ? fields.voice : "",
      apiKey: fields.apiKey,
    },
    { requireKey: false }
  );
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  await saveAccountProvider(user.id, kind, validation.draft);
  return NextResponse.json({ settings: await accountSpeechSettings(user.id) });
}

export async function DELETE(request: Request) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ["the body must be JSON"] }, { status: 400 });
  }
  const kind = typeof body === "object" && body !== null ? asKind((body as Record<string, unknown>).kind) : undefined;
  if (kind === undefined) {
    return NextResponse.json({ errors: [`kind must be one of ${SPEECH_KINDS.join(", ")}`] }, { status: 400 });
  }

  await useDeploymentDefault(user.id, kind);
  return NextResponse.json({ settings: await accountSpeechSettings(user.id) });
}
