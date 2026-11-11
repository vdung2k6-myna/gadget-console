import { and, eq, isNull, or } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { providerAdapters, tenants } from "@/lib/db/schema";
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
  capabilities: {
    tools?: boolean;
    languages?: string[];
    streaming?: boolean;
  } | null;
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

/** What a tenant admin may set: the selection policy and its monthly budget. */
export interface AdapterPolicyInput extends AdapterPolicy {
  /** Advisory routing budget in USD; null means none stated. */
  monthlyBudgetUsd: number | null;
}

export type AdapterPolicyValidation =
  | { ok: true; policy: AdapterPolicyInput }
  | { ok: false; errors: string[] };

export function validateAdapterPolicy(raw: unknown): AdapterPolicyValidation {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, errors: ["the policy must be an object"] };
  }
  const value = raw as Record<string, unknown>;
  const errors: string[] = [];
  if (value.localOnly !== undefined && typeof value.localOnly !== "boolean") {
    errors.push("localOnly must be a boolean");
  }
  if (
    value.order !== undefined &&
    (!Array.isArray(value.order) ||
      !value.order.every((entry) => typeof entry === "string"))
  ) {
    errors.push("order must be a list of adapter ids");
  }
  let budget: number | null = null;
  if (value.monthlyBudgetUsd !== undefined && value.monthlyBudgetUsd !== null && value.monthlyBudgetUsd !== "") {
    budget = Number(value.monthlyBudgetUsd);
    if (!Number.isFinite(budget) || budget < 0) {
      errors.push("monthlyBudgetUsd must be zero or more");
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    policy: {
      localOnly: value.localOnly === true,
      order: Array.isArray(value.order) ? (value.order as string[]) : [],
      monthlyBudgetUsd: budget,
    },
  };
}

/** Save a tenant's policy; selection reads it on the next resolution. */
export async function saveAdapterPolicy(
  tenantId: string,
  raw: unknown
): Promise<AdapterPolicyInput | undefined> {
  const validation = validateAdapterPolicy(raw);
  if (!validation.ok) return undefined;
  const rows = await getDb()
    .update(tenants)
    .set({ adapterPolicy: validation.policy })
    .where(eq(tenants.id, tenantId))
    .returning({ adapterPolicy: tenants.adapterPolicy });
  return rows[0] === undefined ? undefined : validation.policy;
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

/** What this turn needs an adapter to do, before selection. */
export interface AdapterRequirements {
  /** The turn offers tools, so the adapter must declare them. */
  tools?: boolean;
  /** Every language the turn may carry. A candidate must declare all of them. */
  languages?: readonly string[];
  /** The turn expects a streamed answer. */
  streaming?: boolean;
}

/**
 * Whether a candidate declares it can serve what the turn needs.
 *
 * Absent capability is absence of a claim, not a yes: an adapter that declares
 * no tools cannot be handed a tool turn, and one that names no languages cannot
 * be handed a language requirement.
 */
function servesRequirements(
  row: { capabilities: AdapterCandidate["capabilities"] },
  requires: AdapterRequirements
): boolean {
  if (requires.tools === true && row.capabilities?.tools !== true) return false;
  if (requires.streaming === true && row.capabilities?.streaming !== true) return false;
  if (requires.languages !== undefined && requires.languages.length > 0) {
    const declared = row.capabilities?.languages;
    if (!Array.isArray(declared)) return false;
    if (!requires.languages.every((language) => declared.includes(language))) return false;
  }
  return true;
}

export async function resolveAdapterChain(
  tenantId: string,
  kind: AdapterKind,
  options: { policy?: AdapterPolicy; requires?: AdapterRequirements } = {}
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
    .filter((row) => servesRequirements(row, options.requires ?? {}))
    .map((row) => ({
      id: row.id,
      name: row.name,
      tenantId: row.tenantId,
      endpoint: row.endpoint,
      kinds: row.kinds,
      health: row.health,
      capabilities: row.capabilities ?? null,
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
