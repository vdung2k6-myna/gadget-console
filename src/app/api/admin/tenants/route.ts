import { NextResponse } from "next/server";

import { currentPlatformAdmin } from "@/lib/auth/admin";
import { createTenant, listTenants, validateTenantDraft } from "@/lib/tenants";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/** The tenant list and creation, on the platform admin surface only. */
export async function GET() {
  const admin = await currentPlatformAdmin();
  if (admin === undefined) return notFound();
  return NextResponse.json({ tenants: await listTenants() });
}

export async function POST(request: Request) {
  const admin = await currentPlatformAdmin();
  if (admin === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const validation = validateTenantDraft(body);
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  const created = await createTenant(validation.draft);
  if (!created.ok) {
    return NextResponse.json(
      { error: "a tenant with that slug already exists" },
      { status: 409 }
    );
  }
  return NextResponse.json({ tenant: created.tenant }, { status: 201 });
}
