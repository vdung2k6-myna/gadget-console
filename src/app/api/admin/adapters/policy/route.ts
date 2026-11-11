import { NextResponse } from "next/server";

import { currentTenantAdminSurface } from "@/lib/auth/admin";
import { findTenant } from "@/lib/tenants";
import {
  readAdapterPolicy,
  saveAdapterPolicy,
  validateAdapterPolicy,
} from "@/lib/tenancy/adapters";

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/** The tenant's current adapter policy, as selection reads it. */
export async function GET() {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();
  const tenant = await findTenant(surface.tenantId);
  if (tenant === undefined) return notFound();
  return NextResponse.json({
    policy: readAdapterPolicy(tenant.adapterPolicy),
    monthlyBudgetUsd:
      (tenant.adapterPolicy as { monthlyBudgetUsd?: unknown } | null)?.monthlyBudgetUsd ?? null,
  });
}

/** Save the policy; the next chain resolution reads it. */
export async function PATCH(request: Request) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ errors: ["the body must be JSON"] }, { status: 400 });
  }
  const validation = validateAdapterPolicy(body);
  if (!validation.ok) return NextResponse.json({ errors: validation.errors }, { status: 400 });

  const saved = await saveAdapterPolicy(surface.tenantId, validation.policy);
  if (saved === undefined) return notFound();
  return NextResponse.json({ policy: saved });
}
