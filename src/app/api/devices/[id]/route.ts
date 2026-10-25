import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { bindDevice, pairDevices } from "@/lib/agents";
import { currentUser, notFound, unauthenticated } from "@/lib/auth/guard";
import { ownDevice } from "@/lib/auth/ownership";
import { releaseDevice } from "@/lib/claims";
import { publicDevice } from "@/lib/devices";
import { getDb } from "@/lib/db/client";
import { devices } from "@/lib/db/schema";

type Params = { params: Promise<{ id: string }> };

/**
 * One route for the three things an owner changes about a device: its name, the
 * agent that answers it, and the partner it talks to. Each field is optional and
 * untouched when absent, so a caller never has to send the whole device back.
 */
export async function PATCH(request: Request, { params }: Params) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  const { id } = await params;
  if ((await ownDevice(user.id, id)) === undefined) return notFound();

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
    await getDb().update(devices).set({ name: fields.name.trim() }).where(eq(devices.id, id));
  }

  if ("agentId" in fields) {
    const agentId = fields.agentId === null ? null : typeof fields.agentId === "string" ? fields.agentId : undefined;
    if (agentId === undefined) {
      return NextResponse.json({ error: "agentId must be a string or null" }, { status: 400 });
    }
    const bound = await bindDevice(user.id, id, agentId);
    // A device or an agent that is not this account's is answered as missing.
    if (!bound.ok) return notFound();
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
    const paired = await pairDevices(user.id, id, partnerId);
    if (!paired.ok) {
      return paired.reason === "self"
        ? NextResponse.json({ error: "a device cannot be its own partner" }, { status: 400 })
        : notFound();
    }
  }

  const device = await ownDevice(user.id, id);
  return device === undefined ? notFound() : NextResponse.json({ device: publicDevice(device) });
}

/** Releasing a gadget: it becomes claimable again, and its record goes with it. */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await currentUser();
  if (user === undefined) return unauthenticated();

  const { id } = await params;
  return (await releaseDevice(user.id, id)) ? new NextResponse(null, { status: 204 }) : notFound();
}
