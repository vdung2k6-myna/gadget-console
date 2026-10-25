import { and, eq } from "drizzle-orm";
import { adminDevice, recordAdminAction } from "@/lib/admin";
import { bindDevice, pairDevices } from "@/lib/agents";
import { releaseDevice } from "@/lib/claims";
import { getDb } from "@/lib/db/client";
import { agents, devices } from "@/lib/db/schema";

/**
 * What an admin may do to any gadget, apart from the routes that serve it — so
 * the rules can be tested without a session and read in one place.
 *
 * Two rules hold even for an admin: an agent answers only its own account's
 * devices, so the agent bound must belong to the **device's owner**; and every
 * action writes one line naming the admin, the device and its owner.
 */

export type AdminActionResult =
  | { ok: true }
  | { ok: false; reason: "not-found" | "no-owner" | "self" };

function notFound(): AdminActionResult {
  return { ok: false, reason: "not-found" };
}

export async function adminRename(
  adminEmail: string,
  deviceRowId: string,
  name: string
): Promise<AdminActionResult> {
  const device = await adminDevice(deviceRowId);
  if (device === undefined) return notFound();

  await getDb().update(devices).set({ name: name.trim() }).where(eq(devices.id, deviceRowId));
  recordAdminAction(adminEmail, "renamed", device, device.ownerEmail);
  return { ok: true };
}

export async function adminBindAgent(
  adminEmail: string,
  deviceRowId: string,
  agentId: string | null
): Promise<AdminActionResult> {
  const device = await adminDevice(deviceRowId);
  if (device === undefined) return notFound();
  if (device.userId === null) return { ok: false, reason: "no-owner" };

  if (agentId !== null) {
    const owned = await getDb()
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.userId, device.userId)))
      .limit(1);
    if (owned[0] === undefined) return notFound();
  }

  const bound = await bindDevice(device.userId, deviceRowId, agentId);
  if (!bound.ok) return notFound();

  recordAdminAction(
    adminEmail,
    agentId === null ? "unbound the agent of" : "bound an agent to",
    device,
    device.ownerEmail
  );
  return { ok: true };
}

export async function adminPair(
  adminEmail: string,
  deviceRowId: string,
  partnerDeviceId: string | null
): Promise<AdminActionResult> {
  const device = await adminDevice(deviceRowId);
  if (device === undefined) return notFound();
  if (device.userId === null) return { ok: false, reason: "no-owner" };

  const paired = await pairDevices(device.userId, deviceRowId, partnerDeviceId);
  if (!paired.ok) return paired.reason === "self" ? { ok: false, reason: "self" } : notFound();

  recordAdminAction(
    adminEmail,
    partnerDeviceId === null ? "unpaired" : "paired",
    device,
    device.ownerEmail
  );
  return { ok: true };
}

export async function adminRelease(adminEmail: string, deviceRowId: string): Promise<AdminActionResult> {
  const device = await adminDevice(deviceRowId);
  if (device === undefined || device.userId === null) return notFound();

  const released = await releaseDevice(device.userId, deviceRowId);
  if (!released) return notFound();

  recordAdminAction(adminEmail, "released", device, device.ownerEmail);
  return { ok: true };
}
