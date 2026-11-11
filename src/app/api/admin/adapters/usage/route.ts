import { NextResponse } from "next/server";

import {
  listAllEgress,
  listTenantEgress,
  tenantUsageReport,
} from "@/lib/adapter-egress";
import { currentAdmin } from "@/lib/auth/admin";
import { notFound } from "@/lib/auth/guard";
import { isPlatformAdmin } from "@/lib/auth/roles";

/**
 * The egress record of every remote adapter call.
 *
 * A tenant admin sees its own tenant's calls and nothing else; a platform admin
 * sees all of them, or one tenant's when it asks. Neither answer carries request
 * text or audio — the table has no field for either.
 */
export async function GET(request: Request) {
  const user = await currentAdmin();
  if (user === undefined) return notFound();

  if (isPlatformAdmin(user.role)) {
    const tenantId = new URL(request.url).searchParams.get("tenantId") ?? undefined;
    return NextResponse.json({
      events: await listAllEgress(tenantId === undefined ? {} : { tenantId }),
    });
  }

  if (user.tenantId === null) return notFound();
  return NextResponse.json({
    events: await listTenantEgress(user.tenantId),
    report: await tenantUsageReport(user.tenantId),
  });
}
