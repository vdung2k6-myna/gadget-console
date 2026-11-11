import { eq } from "drizzle-orm";

import { createAdapterClient } from "@/lib/adapter-client";
import { type AdapterRow } from "@/lib/adapters";
import { encryptionKeyForTenant } from "@/lib/crypto/profiles";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { getDb } from "@/lib/db/client";
import { providerAdapters } from "@/lib/db/schema";
import { listTenants } from "@/lib/tenants";

/**
 * Periodic adapter health.
 *
 * `GET /v1/health` answering 200 with `status: "ok"` marks the adapter `ok`;
 * anything else marks it `down`. The chain resolver already keeps only `ok`, so
 * an unhealthy adapter stops being routed without failing a turn.
 */

export const ADAPTER_HEALTH_INTERVAL_MS = 60_000;

export interface HealthCheckOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function setHealth(
  tenantId: string,
  id: string,
  health: "ok" | "down"
): Promise<void> {
  await getDb()
    .update(providerAdapters)
    .set({ health, updatedAt: new Date() })
    .where(eq(providerAdapters.id, id));
}

export async function checkAdapterHealth(
  adapter: AdapterRow,
  options: HealthCheckOptions = {}
): Promise<"ok" | "down"> {
  if (
    adapter.tenantId === null ||
    adapter.status === "disabled" ||
    adapter.tokenEncrypted === ""
  ) {
    return "down";
  }

  const token = decryptSecret(
    adapter.tokenEncrypted,
    encryptionKeyForTenant(adapter.tenantId)
  );
  const client = createAdapterClient({
    endpoint: adapter.endpoint,
    token,
    adapterId: adapter.id,
    tenantId: adapter.tenantId,
    timeoutMs: options.timeoutMs ?? 5_000,
    maxRetries: 0,
    fetchImpl: options.fetchImpl,
  });

  let health: "ok" | "down" = "down";
  try {
    const response = await client.getJson<{ status?: unknown }>("/health");
    health = response.body.status === "ok" ? "ok" : "down";
  } catch {
    health = "down";
  }
  await setHealth(adapter.tenantId, adapter.id, health);
  return health;
}

/** One pass over every tenant's adapters, for the scheduler or an operator. */
export async function sweepAdapterHealth(
  options: HealthCheckOptions = {}
): Promise<number> {
  let checked = 0;
  for (const tenant of await listTenants()) {
    const rows = await getDb()
      .select()
      .from(providerAdapters)
      .where(eq(providerAdapters.tenantId, tenant.id));
    for (const adapter of rows) {
      if (adapter.status === "disabled") continue;
      await checkAdapterHealth(adapter, options);
      checked += 1;
    }
  }
  return checked;
}

/** Start the periodic pass; the returned function stops it. */
export function startAdapterHealthChecks(
  intervalMs: number = ADAPTER_HEALTH_INTERVAL_MS,
  options: HealthCheckOptions = {}
): () => void {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const run = async (): Promise<void> => {
    if (stopped) return;
    await sweepAdapterHealth(options).catch(() => {});
    if (!stopped) timer = setTimeout(() => void run(), intervalMs);
  };
  void run();

  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
