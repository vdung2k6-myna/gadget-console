import { and, count, eq, gte, sql } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { devices, turns, usageEvents } from "@/lib/db/schema";

/**
 * A tenant's bounds on what it may consume.
 *
 * The values live in `tenants.quotas`; an absent or non-numeric key means no
 * bound. A refusal always names the tenant and the quota, because the operator
 * reading it needs to know which limit was reached and for whom.
 */

export const QUOTA_KINDS = [
  "devices",
  "turns",
  "concurrency",
  "speechSeconds",
  "providerSpend",
] as const;

export type QuotaKind = (typeof QUOTA_KINDS)[number];

export interface TenantQuotaSource {
  id: string;
  name: string;
  slug: string;
  quotas: Record<string, number> | null;
}

export interface QuotaRefusal {
  kind: QuotaKind;
  limit: number;
  used: number;
  tenant: string;
}

function limitFor(tenant: TenantQuotaSource, kind: QuotaKind): number | null {
  const value = tenant.quotas?.[kind];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export function checkQuota(
  tenant: TenantQuotaSource,
  kind: QuotaKind,
  used: number,
  requested = 1
): QuotaRefusal | null {
  const limit = limitFor(tenant, kind);
  if (limit === null) return null;
  if (used + requested <= limit) return null;
  return {
    kind,
    limit,
    used,
    tenant: tenant.name.trim() === "" ? tenant.slug : tenant.name,
  };
}

export function quotaRefusalMessage(refusal: QuotaRefusal): string {
  return `the tenant ${refusal.tenant} has reached its ${refusal.kind} quota of ${refusal.limit}`;
}

export async function enforceDeviceQuota(
  tenant: TenantQuotaSource
): Promise<QuotaRefusal | null> {
  const rows = await getDb()
    .select({ value: count() })
    .from(devices)
    .where(eq(devices.tenantId, tenant.id));
  return checkQuota(tenant, "devices", Number(rows[0]?.value ?? 0), 1);
}

export async function enforceTurnQuota(
  tenant: TenantQuotaSource,
  now: Date = new Date()
): Promise<QuotaRefusal | null> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await getDb()
    .select({ value: count() })
    .from(turns)
    .where(and(eq(turns.tenantId, tenant.id), gte(turns.createdAt, since)));
  return checkQuota(tenant, "turns", Number(rows[0]?.value ?? 0), 1);
}

export async function speechSecondsUsed(tenantId: string, since: Date): Promise<number> {
  // The quota bounds the platform's own speech: reseller speech is recorded
  // for the tenant view but is neither billed nor drawn from the allowance.
  const rows = await getDb()
    .select({
      value: sql<number>`coalesce(sum(${usageEvents.seconds}), 0)::int`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.tenantId, tenantId),
        eq(usageEvents.source, "platform"),
        gte(usageEvents.createdAt, since)
      )
    );
  return Number(rows[0]?.value ?? 0);
}

export function checkSpeechQuota(
  tenant: TenantQuotaSource,
  used: number
): QuotaRefusal | null {
  return checkQuota(tenant, "speechSeconds", used, 1);
}

export function checkProviderSpendQuota(
  tenant: TenantQuotaSource,
  used: number
): QuotaRefusal | null {
  return checkQuota(tenant, "providerSpend", used, 1);
}

export function checkConcurrencyQuota(
  tenant: TenantQuotaSource,
  used: number
): QuotaRefusal | null {
  return checkQuota(tenant, "concurrency", used, 1);
}
