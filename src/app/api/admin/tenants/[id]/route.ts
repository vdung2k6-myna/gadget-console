import { NextResponse } from "next/server";

import { currentPlatformAdmin } from "@/lib/auth/admin";
import { deleteTenant } from "@/lib/tenancy/lifecycle";
import {
  findTenant,
  setTenantStatus,
  updateTenantSettings,
  validateTenantSettings,
  type TenantStatus,
} from "@/lib/tenants";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * Deleting a tenant. The body must name its slug: a delete that removes every
 * user, device and turn deserves a confirmation that cannot be sent by accident.
 */
export async function DELETE(request: Request, { params }: Params) {
  const admin = await currentPlatformAdmin();
  if (admin === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const { id } = await params;
  const tenant = await findTenant(id);
  if (tenant === undefined) return notFound();

  const confirm =
    typeof body === "object" && body !== null
      ? (body as { confirm?: unknown }).confirm
      : undefined;
  if (typeof confirm !== "string" || confirm.trim().toLowerCase() !== tenant.slug) {
    return NextResponse.json(
      { error: "confirm must name the tenant's slug" },
      { status: 400 }
    );
  }

  const result = await deleteTenant(id, { id: admin.id, email: admin.email });
  return result === "deleted" ? new NextResponse(null, { status: 204 }) : notFound();
}

/**
 * The platform admin's tenant controls: suspend/resume, or the settings the
 * tenant admin cannot change — plan, quotas, speech allowance, retention,
 * locale and branding.
 */
export async function PATCH(request: Request, { params }: Params) {
  const admin = await currentPlatformAdmin();
  if (admin === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const { id } = await params;
  const status =
    typeof body === "object" && body !== null
      ? (body as { status?: unknown }).status
      : undefined;

  if (status !== undefined) {
    if (status !== "active" && status !== "suspended") {
      return NextResponse.json(
        { error: "status must be active or suspended" },
        { status: 400 }
      );
    }
    const tenant = await setTenantStatus(id, status as TenantStatus);
    if (tenant === undefined) return notFound();
    return NextResponse.json({ tenant });
  }

  const validation = validateTenantSettings(body);
  if (!validation.ok) {
    return NextResponse.json({ errors: validation.errors }, { status: 400 });
  }

  const tenant = await updateTenantSettings(id, validation.settings);
  if (tenant === undefined) return notFound();
  return NextResponse.json({ tenant });
}
