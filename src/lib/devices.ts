import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { devices } from "@/lib/db/schema";

/**
 * The device's secret is the console's, not the browser's: the bridge fetches it
 * over its own authenticated route, and no browser-facing shape has a field to
 * carry it.
 */
export type PublicDevice = Omit<typeof devices.$inferSelect, "secret">;

export function publicDevice(device: typeof devices.$inferSelect): PublicDevice {
  const { secret: _secret, ...rest } = device;
  return rest;
}

export async function listOwnedDevices(userId: string): Promise<PublicDevice[]> {
  const rows = await getDb().select().from(devices).where(eq(devices.userId, userId));
  return rows.map(publicDevice);
}
