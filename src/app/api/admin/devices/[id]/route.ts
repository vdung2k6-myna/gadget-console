import { NextResponse } from "next/server";
import { adminDevice } from "@/lib/admin";
import { adminBindAgent, adminPair, adminRelease, adminRename } from "@/lib/admin-actions";
import { currentAdmin } from "@/lib/auth/admin";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not found" }, { status: 404 });

function rejected(reason: "not-found" | "no-owner" | "self") {
  if (reason === "self") {
    return NextResponse.json({ error: "a device cannot be its own partner" }, { status: 400 });
  }
  if (reason === "no-owner") {
    return NextResponse.json({ error: "that gadget has no owner" }, { status: 400 });
  }
  return notFound();
}

/**
 * Acting on any account's gadget. The owner-facing route keeps its scoping; this
 * one is guarded by the role, and the rules it still honours live in
 * `src/lib/admin-actions.ts`.
 */
export async function PATCH(request: Request, { params }: Params) {
  const admin = await currentAdmin();
  if (admin === undefined) return notFound();

  const { id } = await params;
  if ((await adminDevice(id)) === undefined) return notFound();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "the body must be JSON" }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "the body must be an object" }, { status: 400 });
  }
  const fields = body as Record<string, unknown>;

  if (typeof fields.name === "string") {
    const result = await adminRename(admin.email, id, fields.name);
    if (!result.ok) return rejected(result.reason);
  }

  if ("agentId" in fields) {
    const agentId =
      fields.agentId === null ? null : typeof fields.agentId === "string" ? fields.agentId : undefined;
    if (agentId === undefined) {
      return NextResponse.json({ error: "agentId must be a string or null" }, { status: 400 });
    }
    const result = await adminBindAgent(admin.email, id, agentId);
    if (!result.ok) return rejected(result.reason);
  }

  if ("partnerDeviceId" in fields) {
    const partnerId =
      fields.partnerDeviceId === null
        ? null
        : typeof fields.partnerDeviceId === "string"
          ? fields.partnerDeviceId
          : undefined;
    if (partnerId === undefined) {
      return NextResponse.json({ error: "partnerDeviceId must be a string or null" }, { status: 400 });
    }
    const result = await adminPair(admin.email, id, partnerId);
    if (!result.ok) return rejected(result.reason);
  }

  return NextResponse.json({ device: await adminDevice(id) });
}

export async function DELETE(_request: Request, { params }: Params) {
  const admin = await currentAdmin();
  if (admin === undefined) return notFound();

  const { id } = await params;
  const result = await adminRelease(admin.email, id);
  return result.ok ? new NextResponse(null, { status: 204 }) : rejected(result.reason);
}
