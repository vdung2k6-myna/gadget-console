import { and, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { usageEvents } from "@/lib/db/schema";
import { findTenant } from "@/lib/tenants";

/**
 * Usage the platform meters and the allowance it is billed against.
 *
 * Platform speech is metered and only the seconds past the tenant's allowance
 * are billable. Reseller-hosted speech is recorded for the tenant view but is
 * never billed by the platform. The report returns seconds; the commercial rate
 * turns overage seconds into money.
 */

export type UsageSource = "platform" | "reseller";

export interface UsageInput {
  tenantId: string;
  kind: string;
  source: UsageSource;
  provider?: string | null;
  seconds?: number;
  bytes?: number;
}

export interface UsageReport {
  tenantId: string;
  since: Date;
  platformSeconds: number;
  resellerSeconds: number;
  allowanceSeconds: number;
  overageSeconds: number;
  billableSeconds: number;
}

export async function recordUsage(input: UsageInput): Promise<void> {
  if (input.source !== "platform" && input.source !== "reseller") {
    throw new Error("the usage source must be platform or reseller");
  }
  if (input.kind.trim() === "") throw new Error("a usage kind is required");

  const seconds = input.seconds ?? 0;
  const bytes = input.bytes ?? 0;
  if (!Number.isInteger(seconds) || seconds < 0) {
    throw new Error("usage seconds must be a non-negative integer");
  }
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new Error("usage bytes must be a non-negative integer");
  }

  await getDb().insert(usageEvents).values({
    tenantId: input.tenantId,
    kind: input.kind,
    source: input.source,
    provider: input.provider ?? null,
    seconds,
    bytes,
  });
}

export async function usageReport(
  tenantId: string,
  options: { since: Date; allowanceSeconds?: number | null }
): Promise<UsageReport> {
  const tenant = await findTenant(tenantId);
  if (tenant === undefined) throw new Error(`no tenant ${tenantId}`);

  const allowance = Math.max(
    0,
    options.allowanceSeconds ?? tenant.speechAllowanceSeconds ?? 0
  );

  const rows = await getDb()
    .select({
      source: usageEvents.source,
      seconds: sql<number>`coalesce(sum(${usageEvents.seconds}), 0)::int`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.tenantId, tenantId),
        eq(usageEvents.kind, "speech"),
        gte(usageEvents.createdAt, options.since)
      )
    )
    .groupBy(usageEvents.source);

  const platformSeconds = Number(
    rows.find((row) => row.source === "platform")?.seconds ?? 0
  );
  const resellerSeconds = Number(
    rows.find((row) => row.source === "reseller")?.seconds ?? 0
  );
  const overageSeconds = Math.max(0, platformSeconds - allowance);

  return {
    tenantId,
    since: options.since,
    platformSeconds,
    resellerSeconds,
    allowanceSeconds: allowance,
    overageSeconds,
    billableSeconds: overageSeconds,
  };
}
