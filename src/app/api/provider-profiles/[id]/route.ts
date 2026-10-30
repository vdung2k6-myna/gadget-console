import { NextResponse } from "next/server";

import { currentUser, notFound, unauthenticated } from "@/lib/auth/guard";
import {
  deleteProviderProfile,
  publicProviderProfile,
  updateProviderProfile,
  validateProviderDraft,
} from "@/lib/provider-profiles";

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

  const validation = validateProviderDraft(body, { requireKey: false });
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  const profile = await updateProviderProfile(user.id, id, validation.draft);
  // A built-in is not this account's to change, so it is answered exactly as one
  // that does not exist.
  return profile === undefined
    ? notFound()
    : NextResponse.json({ profile: publicProviderProfile(profile) });
}

/** The answer says how many agents fell back to the deployment's default. */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  const { id } = await params;
  const result = await deleteProviderProfile(user.id, id);
  return result.deleted
    ? NextResponse.json({ agentsAffected: result.agentsAffected })
    : notFound();
}
