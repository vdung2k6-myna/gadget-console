import { NextResponse } from "next/server";

import { currentTenantAdminSurface } from "@/lib/auth/admin";
import {
  updateTenantAdminSettings,
  validateTenantAdminSettings,
} from "@/lib/tenants";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * The tenant admin's own settings: branding, default locale and retention.
 * Quotas, plan and domains are the platform operator's, so they are not read here.
 */
export async function PATCH(request: Request) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const validation = validateTenantAdminSettings(body);
  if (!validation.ok) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }

  const tenant = await updateTenantAdminSettings(surface.tenantId, validation.settings);
  if (tenant === undefined) return notFound();
  return NextResponse.json({ tenant });
}
