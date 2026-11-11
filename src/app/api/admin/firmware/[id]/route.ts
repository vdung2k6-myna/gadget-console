import { NextResponse } from "next/server";
import { currentTenantAdminSurface } from "@/lib/auth/admin";
import { deleteFirmware } from "@/lib/firmware";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * Deleting a release. A release that is its board type's target is refused: the
 * target would then point at nothing, and the failure would be silent. Clear or
 * replace the target first.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();

  const { id } = await params;
  const result = await deleteFirmware(id, surface.user.email, surface.tenantId);
  if (result === "deleted") return new NextResponse(null, { status: 204 });
  if (result === "targeted") {
    return NextResponse.json({ error: "targeted" }, { status: 409 });
  }
  return notFound();
}
