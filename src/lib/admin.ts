import { desc, eq } from "drizzle-orm";
import { isRowId } from "@/lib/auth/ownership";
import { getDb } from "@/lib/db/client";
import { devices, turns, users } from "@/lib/db/schema";
import { publicDevice, type PublicDevice } from "@/lib/devices";

/**
 * The admin's reads: the same shapes the owner sees, without the ownership
 * filter, and with the owner's address beside them.
 *
 * They live apart from the scoped functions rather than accepting a flag, so the
 * owner rule and the admin rule are read separately — a review of one cannot
 * quietly relax the other. Nothing here touches `llm_profiles`: an account's
 * provider key is not a gadget, and no admin route returns one.
 */

export interface AdminDevice extends PublicDevice {
  ownerEmail: string;
}

export async function listAllDevices(): Promise<AdminDevice[]> {
  const rows = await getDb()
    .select({ device: devices, ownerEmail: users.email })
    .from(devices)
    .leftJoin(users, eq(users.id, devices.userId));

  return rows
    .map((row) => ({ ...publicDevice(row.device), ownerEmail: row.ownerEmail ?? "" }))
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId));
}

export async function adminDevice(deviceRowId: string): Promise<AdminDevice | undefined> {
  if (!isRowId(deviceRowId)) return undefined;

  const rows = await getDb()
    .select({ device: devices, ownerEmail: users.email })
    .from(devices)
    .leftJoin(users, eq(users.id, devices.userId))
    .where(eq(devices.id, deviceRowId))
    .limit(1);

  const row = rows[0];
  return row === undefined ? undefined : { ...publicDevice(row.device), ownerEmail: row.ownerEmail ?? "" };
}

/** Any device's conversation, for the admin's device page. */
export async function adminTurns(
  deviceRowId: string,
  limit: number
): Promise<(typeof turns.$inferSelect)[]> {
  if (!isRowId(deviceRowId)) return [];

  return getDb()
    .select()
    .from(turns)
    .where(eq(turns.deviceId, deviceRowId))
    .orderBy(desc(turns.startedAt))
    .limit(limit);
}

/**
 * One line per change the admin makes to somebody else's gadget: who, what, and
 * whose. Not a table — the deployment already keeps a log, and a line is enough
 * to answer "who released this".
 */
export function recordAdminAction(
  adminEmail: string,
  action: string,
  device: { deviceId: string },
  ownerEmail: string
): void {
  console.log(`[admin] ${adminEmail} ${action} device ${device.deviceId} (owner ${ownerEmail || "none"})`);
}

/**
 * The same line for a firmware release, which belongs to a board type rather than
 * to a person. An upload, a target, an un-target and a delete are each one line,
 * because "who put this image on the devices" is a question answered from the log.
 */
export function recordFirmwareAction(
  adminEmail: string,
  action: string,
  boardType: string,
  version: string
): void {
  console.log(`[admin] ${adminEmail} ${action} firmware ${boardType} ${version}`);
}
