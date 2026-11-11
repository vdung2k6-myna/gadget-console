import { eq } from "drizzle-orm";

import { findAuditEvent, recordAudit } from "@/lib/audit";
import { isPlatformAdmin } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import { devices } from "@/lib/db/schema";

/**
 * Opening a tenant's conversation through support.
 *
 * The page never renders conversation text on the strength of a role alone. The
 * support user first takes an action naming the device; that writes an audit row
 * for the tenant, and the row's id is the short-lived grant the page checks
 * before showing turns. A tenant admin reads those rows in the audit view.
 */

export const SUPPORT_ACTION = "support.conversation.open";
export const SUPPORT_ACCESS_TTL_MS = 15 * 60 * 1000;

export type DeviceRow = typeof devices.$inferSelect;

export interface SupportActor {
  id: string;
  email: string;
  role: string;
  tenantId: string | null;
}

/**
 * The device this actor may support. A platform admin may reach any device; every
 * other role is confined to its own tenant.
 */
export async function findSupportDevice(
  actor: SupportActor,
  deviceRowId: string
): Promise<DeviceRow | undefined> {
  const rows = await getDb()
    .select()
    .from(devices)
    .where(eq(devices.id, deviceRowId))
    .limit(1);
  const device = rows[0];
  if (device === undefined) return undefined;
  if (isPlatformAdmin(actor.role)) return device;
  if (actor.tenantId === null || device.tenantId !== actor.tenantId) return undefined;
  return device;
}

export interface SupportAccess {
  id: string;
  expiresAt: Date;
}

export async function openSupportConversation(
  actor: SupportActor,
  device: DeviceRow,
  reason?: string
): Promise<SupportAccess | undefined> {
  if (device.tenantId === null) return undefined;

  const expiresAt = new Date(Date.now() + SUPPORT_ACCESS_TTL_MS);
  const event = await recordAudit({
    tenantId: device.tenantId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: SUPPORT_ACTION,
    targetType: "device",
    targetId: device.id,
    metadata: {
      deviceId: device.deviceId,
      expiresAt: expiresAt.toISOString(),
      ...(reason === undefined || reason.trim() === "" ? {} : { reason: reason.trim() }),
    },
  });
  return { id: event.id, expiresAt };
}

/** The expiry of an access id for this actor and device, when it is still open. */
export async function supportAccessGrant(input: {
  accessId: string;
  actorEmail: string;
  device: DeviceRow;
  now?: Date;
}): Promise<Date | undefined> {
  const event = await findAuditEvent(input.accessId);
  if (
    event === undefined ||
    event.action !== SUPPORT_ACTION ||
    event.actorEmail !== input.actorEmail ||
    event.targetId !== input.device.id ||
    event.tenantId !== input.device.tenantId
  ) {
    return undefined;
  }

  const raw = event.metadata?.expiresAt;
  if (typeof raw !== "string") return undefined;
  const expiresAt = new Date(raw);
  if (Number.isNaN(expiresAt.getTime())) return undefined;
  return (input.now ?? new Date()).getTime() < expiresAt.getTime() ? expiresAt : undefined;
}

/** Whether an access id is this actor's, for this device, and still open. */
export async function supportAccessGranted(input: {
  accessId: string;
  actorEmail: string;
  device: DeviceRow;
  now?: Date;
}): Promise<boolean> {
  return (await supportAccessGrant(input)) !== undefined;
}
