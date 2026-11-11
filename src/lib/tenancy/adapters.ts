import { and, eq, isNull, or } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { providerAdapters } from "@/lib/db/schema";
import { findTenant } from "@/lib/tenants";

/**
 * The adapter chain a tenant may use.
 *
 * The registry is private: a chain contains the tenant's own adapters and the
 * platform's, never another tenant's. A row is a candidate only after it is
 * verified and healthy, its declared kinds include the requested one, and the
 * tenant's policy admits it. A local-only policy keeps only adapters that declare
 * themselves local.
 *
 * Ordering is the tenant's policy first (`order` names adapters from first to
 * last), then the tenant's own adapters before the platform's, then quality and
 * latency. The returned records carry the privacy label and scores the caller
 * needs to explain the choice; no token is read.
 */

export const ADAPTER_KINDS = ["llm", "stt", "tts"] as const;
export type AdapterKind = (typeof ADAPTER_KINDS)[number];

export interface AdapterPolicy {
  localOnly: boolean;
  order: string[];
}

export interface AdapterCandidate {
  id: string;
  name: string;
  tenantId: string | null;
  endpoint: string;
  kinds: string[];
  health: string;
  privacy: {
    operator?: string;
    region?: string;
    receives?: string[];
    retentionDays?: number | null;
    remote?: boolean;
  } | null;
  quality: {
    wer?: number;
    ttsNaturalness?: number;
    latencyP50Ms?: number;
    score?: number;
  } | null;
}

export function readAdapterPolicy(raw: unknown): AdapterPolicy {
  if (typeof raw !== "object" || raw === null) return { localOnly: false, order: [] };
  const value = raw as { localOnly?: unknown; order?: unknown };
  return {
    localOnly: value.localOnly === true,
    order: Array.isArray(value.order)
      ? value.order.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

export async function resolveAdapterChain(
  tenantId: string,
  kind: AdapterKind,
  options: { policy?: AdapterPolicy } = {}
): Promise<AdapterCandidate[]> {
  const tenant = await findTenant(tenantId);
  if (tenant === undefined) return [];

  const policy = options.policy ?? readAdapterPolicy(tenant.adapterPolicy);
  const rows = await getDb()
    .select()
    .from(providerAdapters)
    .where(
      and(
        or(eq(providerAdapters.tenantId, tenantId), isNull(providerAdapters.tenantId)),
        eq(providerAdapters.status, "verified"),
        eq(providerAdapters.health, "ok")
      )
    );

  const order = new Map(policy.order.map((id, index) => [id, index]));
  const position = (id: string): number => order.get(id) ?? Number.MAX_SAFE_INTEGER;

  return rows
    .filter((row) => row.kinds.includes(kind))
    .filter((row) => !policy.localOnly || row.privacy?.remote === false)
    .map((row) => ({
      id: row.id,
      name: row.name,
      tenantId: row.tenantId,
      endpoint: row.endpoint,
      kinds: row.kinds,
      health: row.health,
      privacy: row.privacy ?? null,
      quality: row.quality ?? null,
    }))
    .sort((a, b) => {
      const byPolicy = position(a.id) - position(b.id);
      if (byPolicy !== 0) return byPolicy;

      // A tenant's own adapter comes before the platform's when policy is silent.
      if ((a.tenantId === null) !== (b.tenantId === null)) {
        return a.tenantId === null ? 1 : -1;
      }

      const byQuality = (b.quality?.score ?? 0) - (a.quality?.score ?? 0);
      if (byQuality !== 0) return byQuality;

      const byLatency =
        (a.quality?.latencyP50Ms ?? Number.MAX_SAFE_INTEGER) -
        (b.quality?.latencyP50Ms ?? Number.MAX_SAFE_INTEGER);
      if (byLatency !== 0) return byLatency;

      return a.name.localeCompare(b.name);
    });
}
