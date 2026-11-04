import { NextResponse } from "next/server";

import { currentAdmin } from "@/lib/auth/admin";
import { notFound } from "@/lib/auth/guard";
import { getDefaultPair, setDefaultPair, validatePair } from "@/lib/device-calibration";

/** The deployment default: what a device without its own pair uses. Administrator-only. */
export async function GET() {
  const admin = await currentAdmin();
  if (admin === undefined) return notFound();
  return NextResponse.json({ default: await getDefaultPair() });
}

export async function PUT(request: Request) {
  const admin = await currentAdmin();
  if (admin === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ["the body must be JSON"] }, { status: 400 });
  }
  const validation = validatePair(body);
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  const pair = await setDefaultPair(validation.pair, `operator:${admin.email}`);
  return NextResponse.json({ default: pair });
}
