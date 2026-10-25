import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { agents, devices, turns } from "@/lib/db/schema";

/**
 * Every read and write goes through one of these. A row another account owns
 * comes back as `undefined`, exactly as a row that does not exist — the routes
 * turn both into the same answer, so ownership is not inferable from a status.
 */

/**
 * Row ids are UUIDs. A path segment that is not one cannot name a row, and
 * handing it to Postgres raises a cast error — a 500 for what is plainly a
 * 404. Compare it here instead of asking the database to.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isRowId(value: string): boolean {
  return UUID.test(value);
}

export async function ownDevice(userId: string, deviceRowId: string) {
  if (!isRowId(deviceRowId)) return undefined;
  const rows = await getDb()
    .select()
    .from(devices)
    .where(and(eq(devices.id, deviceRowId), eq(devices.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function ownAgent(userId: string, agentId: string) {
  if (!isRowId(agentId)) return undefined;

  const rows = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.id, agentId), eq(agents.userId, userId)))
    .limit(1);
  return rows[0];
}

export async function ownTurns(
  userId: string,
  deviceRowId: string,
  limit: number
): Promise<typeof turns.$inferSelect[] | undefined> {
  const device = await ownDevice(userId, deviceRowId);
  if (device === undefined) return undefined;

  return getDb()
    .select()
    .from(turns)
    .where(eq(turns.deviceId, device.id))
    .orderBy(desc(turns.startedAt))
    .limit(limit);
}
