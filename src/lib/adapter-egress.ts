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
  /** The audio the platform observed, for an STT or TTS call. */
  audioSeconds?: number;
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
      audioSeconds: input.audioSeconds ?? 0,
      status: input.status,
    })
    .returning();
  return rows[0]!;
}

/**
 * Every tenant's egress, for the platform admin, or one tenant's when a filter
 * is named. A tenant admin never reaches this: the route gives it only its own.
 */
export async function listAllEgress(
  options: { tenantId?: string; limit?: number } = {}
): Promise<AdapterEgressRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  if (options.tenantId === undefined) {
    return getDb()
      .select()
      .from(adapterEgressEvents)
      .orderBy(desc(adapterEgressEvents.at))
      .limit(limit);
  }
  return getDb()
    .select()
    .from(adapterEgressEvents)
    .where(eq(adapterEgressEvents.tenantId, options.tenantId))
    .orderBy(desc(adapterEgressEvents.at))
    .limit(limit);
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

/**
 * The platform's measured usage for a tenant.
 *
 * Billing and quotas read the platform's own observation — bytes and audio
 * seconds — never an adapter's report. Reseller speech is counted here too, but
 * as `resellerSpeechSeconds`: the platform records it and does not bill it.
 */
export interface AdapterUsageReport {
  calls: number;
  bytes: number;
  audioSeconds: number;
  /** Speech through the platform's own provider, which the platform bills. */
  platformSpeechSeconds: number;
  /** Speech through a reseller adapter: recorded, not billed by the platform. */
  resellerSpeechSeconds: number;
  byStatus: Record<string, number>;
}

export async function tenantUsageReport(tenantId: string): Promise<AdapterUsageReport> {
  const rows = await getDb()
    .select()
    .from(adapterEgressEvents)
    .where(eq(adapterEgressEvents.tenantId, tenantId));

  const report: AdapterUsageReport = {
    calls: rows.length,
    bytes: 0,
    audioSeconds: 0,
    platformSpeechSeconds: 0,
    resellerSpeechSeconds: 0,
    byStatus: {},
  };
  for (const row of rows) {
    report.bytes += row.bytes;
    report.audioSeconds += row.audioSeconds;
    report.byStatus[row.status] = (report.byStatus[row.status] ?? 0) + 1;
    if (row.kind !== "llm") {
      if (row.adapterId === null) report.platformSpeechSeconds += row.audioSeconds;
      else report.resellerSpeechSeconds += row.audioSeconds;
    }
  }
  return report;
}
