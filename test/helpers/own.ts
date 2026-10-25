import { eq } from "drizzle-orm";
import { approveClaim, claimDevice, issueClaim } from "../../src/lib/claims";
import { claims, devices } from "../../src/lib/db/schema";
import { getDb } from "./db";

/**
 * A gadget in an account's hands: the code issued, entered, and the request
 * approved by an admin — the three steps the product takes, so a fixture cannot
 * describe a state the product cannot reach.
 */
export async function ownDevice(userId: string, deviceId: string, adminEmail = "admin@example.com") {
  const issued = await issueClaim(deviceId);
  if (issued === undefined) throw new Error(`no claim was issued for ${deviceId}`);

  const requested = await claimDevice(userId, issued.code);
  if (!requested.ok) throw new Error(`the claim was refused: ${requested.reason}`);

  const claimed = await getDb()
    .select({ id: claims.id })
    .from(claims)
    .where(eq(claims.code, issued.code))
    .limit(1);
  const approved = await approveClaim(adminEmail, claimed[0]!.id);
  if (approved !== "approved") throw new Error(`the approval failed: ${approved}`);

  const rows = await getDb().select().from(devices).where(eq(devices.id, requested.device.id));
  return rows[0]!;
}
