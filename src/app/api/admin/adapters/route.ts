import { NextResponse } from "next/server";

import { createAdapter, listAdapters, validateAdapterRegistration } from "@/lib/adapters";
import { currentTenantAdminSurface } from "@/lib/auth/admin";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/** The tenant's private adapter registry. */
export async function GET() {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();
  return NextResponse.json({ adapters: await listAdapters(surface.tenantId) });
}

/** Register an adapter; the token is in this response and nowhere else. */
export async function POST(request: Request) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }
  const validation = validateAdapterRegistration(body);
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  const created = await createAdapter(surface.tenantId, validation.draft);
  return NextResponse.json(
    {
      adapter: created.adapter,
      token: created.token,
      notice: "this token is shown once; store it at the adapter now",
    },
    { status: 201 }
  );
}
