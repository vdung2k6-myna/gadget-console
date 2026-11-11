import { NextResponse } from "next/server";

import { rotateAdapterToken } from "@/lib/adapters";
import { currentTenantAdminSurface } from "@/lib/auth/admin";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/** Rotate; the previous token stays valid for the overlap window. */
export async function POST(_request: Request, { params }: Params) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();
  const { id } = await params;
  const rotated = await rotateAdapterToken(surface.tenantId, id);
  if (rotated === undefined) return notFound();
  return NextResponse.json({
    adapter: rotated.adapter,
    token: rotated.token,
    previousExpiresAt: rotated.previousExpiresAt.toISOString(),
    notice: "this token is shown once; the previous token is accepted until previousExpiresAt",
  });
}
