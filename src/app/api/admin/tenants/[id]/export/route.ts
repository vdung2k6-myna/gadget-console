import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { currentPlatformAdmin } from "@/lib/auth/admin";
import { exportTenant } from "@/lib/tenancy/lifecycle";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/** The tenant's rows as JSON, with every secret removed, and one audit row. */
export async function GET(_request: Request, { params }: Params) {
  const admin = await currentPlatformAdmin();
  if (admin === undefined) return notFound();

  const { id } = await params;
  const exported = await exportTenant(id);
  if (exported === undefined) return notFound();

  await recordAudit({
    tenantId: id,
    actorId: admin.id,
    actorEmail: admin.email,
    action: "tenant.export",
    targetType: "tenant",
    targetId: id,
    metadata: { slug: exported.tenant.slug },
  });

  return NextResponse.json(exported, {
    headers: {
      "content-disposition": `attachment; filename="tenant-${exported.tenant.slug}.json"`,
    },
  });
}
