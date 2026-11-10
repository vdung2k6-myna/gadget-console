import { NextResponse } from "next/server";

import { currentPlatformAdmin } from "@/lib/auth/admin";
import { setTenantStatus, type TenantStatus } from "@/lib/tenants";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/** Suspend or resume one tenant. */
export async function PATCH(request: Request, { params }: Params) {
  const admin = await currentPlatformAdmin();
  if (admin === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const status =
    typeof body === "object" && body !== null ? (body as { status?: unknown }).status : undefined;
  if (status !== "active" && status !== "suspended") {
    return NextResponse.json(
      { error: "status must be active or suspended" },
      { status: 400 }
    );
  }

  const { id } = await params;
  const tenant = await setTenantStatus(id, status as TenantStatus);
  if (tenant === undefined) return notFound();
  return NextResponse.json({ tenant });
}
