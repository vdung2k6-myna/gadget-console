import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { publicHardware, type DeviceHardware } from "@/lib/device-hardware";
import { devices } from "@/lib/db/schema";

/**
 * The device's secret is the console's, not the browser's: the bridge fetches it
 * over its own authenticated route, and no browser-facing shape has a field to
 * carry it. The hardware report goes through `publicHardware` for the same kind
 * of reason — a stored shape can grow a field, and a projection is what keeps a
 * page from carrying one the console did not mean to show.
 */
export type PublicDevice = Omit<typeof devices.$inferSelect, "secret" | "hardware"> & {
  hardware: DeviceHardware | null;
};

export function publicDevice(device: typeof devices.$inferSelect): PublicDevice {
  const { secret: _secret, hardware, ...rest } = device;
  return { ...rest, hardware: publicHardware(hardware) };
}

export async function listOwnedDevices(userId: string): Promise<PublicDevice[]> {
  const rows = await getDb().select().from(devices).where(eq(devices.userId, userId));
  return rows.map(publicDevice);
}
