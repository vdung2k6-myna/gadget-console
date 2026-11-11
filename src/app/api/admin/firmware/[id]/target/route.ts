import { NextResponse } from "next/server";
import { currentTenantAdminSurface } from "@/lib/auth/admin";
import { clearFirmwareTarget, markFirmwareTarget } from "@/lib/firmware";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

/**
 * Making a release its board type's target, or clearing that place.
 *
 * `forced` is an admin's deliberate statement that a downgrade is allowed. It is
 * read only from the body — never from a query — so the act is the one that was
 * confirmed in the interface, and it is written to the audit line.
 */
export async function POST(request: Request, { params }: Params) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();

  let forced = false;
  try {
    const body: unknown = await request.json();
    forced =
      typeof body === "object" && body !== null && (body as { forced?: unknown }).forced === true;
  } catch {
    // No body, or not JSON: an ordinary target.
  }

  const { id } = await params;
  const result = await markFirmwareTarget(id, forced, surface.user.email, surface.tenantId);
  return result === "targeted" ? new NextResponse(null, { status: 204 }) : notFound();
}

export async function DELETE(_request: Request, { params }: Params) {
  const surface = await currentTenantAdminSurface();
  if (surface === undefined) return notFound();

  const { id } = await params;
  const result = await clearFirmwareTarget(id, surface.user.email, surface.tenantId);
  if (result === "not-found") return notFound();
  return new NextResponse(null, { status: 204 });
}
