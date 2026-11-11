import { NextResponse } from "next/server";
import { currentTenantAdminSurface } from "@/lib/auth/admin";
import { approveClaim, rejectClaim } from "@/lib/claims";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * Approving or refusing a claim request. Approval is the only place a device
 * changes hands after a code was entered; a refusal leaves it claimable again.
 */
export async function POST(request: Request, { params }: Params) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();

  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }

  const decision =
    typeof body === "object" && body !== null ? (body as { decision?: unknown }).decision : undefined;
  if (decision !== "approve" && decision !== "reject") {
    return NextResponse.json({ error: "decision must be approve or reject" }, { status: 400 });
  }

  const result =
    decision === "approve"
      ? await approveClaim(surface.user.email, id, surface.tenantId)
      : await rejectClaim(surface.user.email, id, surface.tenantId);

  if (result === "approved" || result === "rejected") return new NextResponse(null, { status: 204 });
  if (result === "taken") return NextResponse.json({ error: "taken" }, { status: 409 });
  if (result === "expired") return NextResponse.json({ error: "expired" }, { status: 410 });
  return notFound();
}
