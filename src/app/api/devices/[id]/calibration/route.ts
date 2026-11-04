import { NextResponse } from "next/server";

import { currentAdmin } from "@/lib/auth/admin";
import { notFound } from "@/lib/auth/guard";
import {
  deleteDeviceCalibration,
  getCalibration,
  setDeviceCalibration,
  validatePair,
} from "@/lib/device-calibration";

type Params = { params: Promise<{ id: string }> };

/**
 * A device's calibration pair: what it uses, where that came from, and the pair it owns.
 *
 * Administrator-only, like the rest of the device's configuration, and answered as missing for
 * anybody else — an account that is not an administrator is not told the pair exists.
 */
export async function GET(_request: Request, { params }: Params) {
  const admin = await currentAdmin();
  if (admin === undefined) return notFound();
  const { id } = await params;
  const view = await getCalibration({ id });
  if (view === null) return notFound();
  return NextResponse.json(view);
}

export async function PUT(request: Request, { params }: Params) {
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

  const { id } = await params;
  const view = await setDeviceCalibration({ id }, validation.pair, `operator:${admin.email}`);
  if (view === null) return notFound();
  return NextResponse.json(view);
}

export async function DELETE(_request: Request, { params }: Params) {
  const admin = await currentAdmin();
  if (admin === undefined) return notFound();
  const { id } = await params;
  const view = await deleteDeviceCalibration({ id }, `operator:${admin.email}`);
  if (view === null) return notFound();
  return NextResponse.json(view);
}
