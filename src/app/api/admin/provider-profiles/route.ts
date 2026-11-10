import { NextResponse } from "next/server";

import { currentTenantAdmin } from "@/lib/auth/admin";
import {
  listTenantBuiltins,
  publicProviderProfile,
  publishTenantBuiltin,
} from "@/lib/provider-profiles";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/** The tenant admin's own built-ins. A platform admin uses the deployment seed. */
export async function GET() {
  const admin = await currentTenantAdmin();
  if (admin === undefined || admin.tenantId === null) return notFound();

  const profiles = (await listTenantBuiltins(admin.tenantId)).map(publicProviderProfile);
  return NextResponse.json({ profiles });
}

export async function POST(request: Request) {
  const admin = await currentTenantAdmin();
  if (admin === undefined || admin.tenantId === null) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const result = await publishTenantBuiltin(admin.tenantId, body);
  if (!result.ok) return NextResponse.json({ errors: result.errors }, { status: 400 });
  return NextResponse.json({ profile: result.profile }, { status: 201 });
}
