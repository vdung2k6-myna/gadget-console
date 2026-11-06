import { NextResponse } from "next/server";

import { currentAdmin } from "@/lib/auth/admin";
import { notFound } from "@/lib/auth/guard";
import {
  createProviderProfile,
  listProviderProfiles,
  publicProviderProfile,
  validateProviderDraft,
} from "@/lib/provider-profiles";

export async function GET() {
  const user = await currentAdmin();
  if (user === undefined) return notFound();
  return NextResponse.json({
    profiles: (await listProviderProfiles(user.id)).map(publicProviderProfile),
  });
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

  const validation = validateProviderDraft(body, { requireKey: true });
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  const profile = await createProviderProfile(user.id, validation.draft);
  return NextResponse.json({ profile: publicProviderProfile(profile) }, { status: 201 });
}
