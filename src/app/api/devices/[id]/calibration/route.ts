import { NextResponse } from "next/server";

import { currentTenantAdminSurface } from "@/lib/auth/admin";
import { notFound } from "@/lib/auth/guard";
import { findDeviceRow } from "@/lib/tenancy/repository";
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
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();
  const { id } = await params;
  if ((await findDeviceRow({ tenantId: surface.tenantId }, id)) === undefined) {
    return notFound();
  }
  const view = await getCalibration({ id });
  if (view === null) return notFound();
  return NextResponse.json(view);
}

export async function PUT(request: Request, { params }: Params) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ["the body must be JSON"] }, { status: 400 });
  }
  const validation = validatePair(body);
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  const { id } = await params;
  if ((await findDeviceRow({ tenantId: surface.tenantId }, id)) === undefined) {
    return notFound();
  }
  const view = await setDeviceCalibration(
    { id },
    validation.pair,
    `operator:${surface.user.email}`
  );
  if (view === null) return notFound();
  return NextResponse.json(view);
}

export async function DELETE(_request: Request, { params }: Params) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();
  const { id } = await params;
  if ((await findDeviceRow({ tenantId: surface.tenantId }, id)) === undefined) {
    return notFound();
  }
  const view = await deleteDeviceCalibration(
    { id },
    `operator:${surface.user.email}`
  );
  if (view === null) return notFound();
  return NextResponse.json(view);
}
