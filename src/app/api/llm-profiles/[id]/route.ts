import { NextResponse } from "next/server";
import { currentUser, notFound, unauthenticated } from "@/lib/auth/guard";
import { publicProfile } from "@/lib/crypto/profiles";
import { deleteProfile, updateProfile, validateProfileDraft } from "@/lib/llm-profiles";

type Params = { params: Promise<{ id: string }> };

/** A blank key keeps the stored one, so the form never has to echo a secret back. */
export async function PATCH(request: Request, { params }: Params) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ["the body must be JSON"] }, { status: 400 });
  }

  const validation = validateProfileDraft(body, { requireKey: false });
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  const profile = await updateProfile(user.id, id, validation.draft);
  return profile === undefined ? notFound() : NextResponse.json({ profile: publicProfile(profile) });
}

/** The answer says how many agents were left on the runtime's default. */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  const { id } = await params;
  const result = await deleteProfile(user.id, id);
  return result.deleted
    ? NextResponse.json({ agentsAffected: result.agentsAffected })
    : notFound();
}
