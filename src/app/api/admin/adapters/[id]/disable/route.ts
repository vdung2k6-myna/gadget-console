import { NextResponse } from "next/server";

import { disableAdapter } from "@/lib/adapters";
import { currentTenantAdminSurface } from "@/lib/auth/admin";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/** Disable the adapter and revoke its current and previous tokens at once. */
export async function POST(_request: Request, { params }: Params) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();
  const { id } = await params;
  const adapter = await disableAdapter(surface.tenantId, id);
  return adapter === undefined ? notFound() : NextResponse.json({ adapter });
}
