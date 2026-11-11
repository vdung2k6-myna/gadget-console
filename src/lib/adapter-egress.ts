import { desc, eq } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { adapterEgressEvents } from "@/lib/db/schema";

/**
 * What the platform observed for one remote adapter call.
 *
 * The input shape has no field for request text, audio or a response body, so a
 * caller cannot accidentally record what was said. The row is attributed to the
 * tenant that owns the adapter.
 */

export type AdapterEgressRow = typeof adapterEgressEvents.$inferSelect;

export interface AdapterEgressInput {
  tenantId: string;
  adapterId?: string | null;
  kind: "llm" | "stt" | "tts";
  region?: string | null;
  bytes?: number;
  latencyMs?: number;
  status: "ok" | "upstream" | "timeout" | "rate_limit" | "refused" | "error";
}

export async function recordAdapterEgress(
  input: AdapterEgressInput
): Promise<AdapterEgressRow> {
  const rows = await getDb()
    .insert(adapterEgressEvents)
    .values({
      tenantId: input.tenantId,
      adapterId: input.adapterId ?? null,
      kind: input.kind,
      region: input.region ?? null,
      bytes: input.bytes ?? 0,
      latencyMs: input.latencyMs ?? 0,
      status: input.status,
    })
    .returning();
  return rows[0]!;
}

export async function listTenantEgress(
  tenantId: string,
  options: { limit?: number } = {}
): Promise<AdapterEgressRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  return getDb()
    .select()
    .from(adapterEgressEvents)
    .where(eq(adapterEgressEvents.tenantId, tenantId))
    .orderBy(desc(adapterEgressEvents.at))
    .limit(limit);
}
