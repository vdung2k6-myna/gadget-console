import { NextResponse } from "next/server";

import { getAdapter } from "@/lib/adapters";
import { currentTenantAdminSurface } from "@/lib/auth/admin";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

export async function GET(_request: Request, { params }: Params) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();
  const { id } = await params;
  const adapter = await getAdapter(surface.tenantId, id);
  return adapter === undefined ? notFound() : NextResponse.json({ adapter });
}
