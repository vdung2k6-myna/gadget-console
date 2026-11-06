import { NextResponse } from "next/server";
import { currentAdmin } from "@/lib/auth/admin";
import { notFound } from "@/lib/auth/guard";
import { publicProfile } from "@/lib/crypto/profiles";
import { createProfile, listProfiles, validateProfileDraft } from "@/lib/llm-profiles";

export async function GET() {
  const user = await currentAdmin();
  if (user === undefined) return notFound();
  return NextResponse.json({ profiles: (await listProfiles(user.id)).map(publicProfile) });
}

export async function POST(request: Request) {
  const user = await currentAdmin();
  if (user === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ["the body must be JSON"] }, { status: 400 });
  }

  const validation = validateProfileDraft(body, { requireKey: true });
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  const profile = await createProfile(user.id, validation.draft);
  return NextResponse.json({ profile: publicProfile(profile) }, { status: 201 });
}
