import { and, desc, eq, isNull, or } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

import { normalizeDeviceId } from "@/lib/claims";
import { getDb } from "@/lib/db/client";
import {
  agents,
  claims,
  devices,
  firmwareReleases,
  providerProfiles,
  turns,
  usageEvents,
} from "@/lib/db/schema";

/**
 * Tenant-scoped reads.
 *
 * Every owned read goes through here, and every function starts by requiring a
 * tenant context. A caller that has no tenant is refused rather than answered
 * with a wider result. The two-tenant test matrix in
 * `test/tenancy-isolation.test.ts` is the proof that a row from one tenant is
 * never returned to the other.
 *
 * Platform built-ins are the one exception: `listBuiltInProfiles` includes rows
 * whose tenant is null, because every tenant may select them.
 */

export interface TenantContext {
  tenantId: string;
}

export function asTenantContext(value: unknown): TenantContext {
  const tenantId =
    typeof value === "object" && value !== null
      ? (value as { tenantId?: unknown }).tenantId
      : undefined;
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new Error("a tenant context is required");
  }
  return { tenantId: tenantId.trim() };
}

function tenantIdOf(context: TenantContext): string {
  return asTenantContext(context).tenantId;
}

/** The predicate every owned query carries. */
export function ownedBy(table: { tenantId: PgColumn }, context: TenantContext) {
  return eq(table.tenantId, tenantIdOf(context));
}

export async function findDeviceByDeviceId(
  context: TenantContext,
  rawDeviceId: string
): Promise<typeof devices.$inferSelect | undefined> {
  const tenantId = tenantIdOf(context);
  const rows = await getDb()
    .select()
    .from(devices)
    .where(
      and(eq(devices.deviceId, normalizeDeviceId(rawDeviceId)), eq(devices.tenantId, tenantId))
    )
    .limit(1);
  return rows[0];
}

export async function findDeviceRow(
  context: TenantContext,
  rowId: string
): Promise<typeof devices.$inferSelect | undefined> {
  const tenantId = tenantIdOf(context);
  const rows = await getDb()
    .select()
    .from(devices)
    .where(and(eq(devices.id, rowId), eq(devices.tenantId, tenantId)))
    .limit(1);
  return rows[0];
}

export async function listDevices(
  context: TenantContext
): Promise<(typeof devices.$inferSelect)[]> {
  const tenantId = tenantIdOf(context);
  return getDb().select().from(devices).where(eq(devices.tenantId, tenantId));
}

export async function findAgent(
  context: TenantContext,
  id: string
): Promise<typeof agents.$inferSelect | undefined> {
  const tenantId = tenantIdOf(context);
  const rows = await getDb()
    .select()
    .from(agents)
    .where(and(eq(agents.id, id), eq(agents.tenantId, tenantId)))
    .limit(1);
  return rows[0];
}

export async function listAgents(
  context: TenantContext
): Promise<(typeof agents.$inferSelect)[]> {
  const tenantId = tenantIdOf(context);
  return getDb().select().from(agents).where(eq(agents.tenantId, tenantId));
}

export async function findProviderProfile(
  context: TenantContext,
  id: string
): Promise<typeof providerProfiles.$inferSelect | undefined> {
  const tenantId = tenantIdOf(context);
  const rows = await getDb()
    .select()
    .from(providerProfiles)
    .where(and(eq(providerProfiles.id, id), eq(providerProfiles.tenantId, tenantId)))
    .limit(1);
  return rows[0];
}

/** Platform built-ins plus this tenant's built-ins; no other tenant's appear. */
export async function listBuiltInProfiles(
  context: TenantContext
): Promise<(typeof providerProfiles.$inferSelect)[]> {
  const tenantId = tenantIdOf(context);
  return getDb()
    .select()
    .from(providerProfiles)
    .where(
      or(
        and(eq(providerProfiles.tenantId, tenantId), eq(providerProfiles.builtin, true)),
        and(isNull(providerProfiles.tenantId), eq(providerProfiles.builtin, true))
      )
    );
}

export async function findClaimByDeviceId(
  context: TenantContext,
  rawDeviceId: string
): Promise<typeof claims.$inferSelect | undefined> {
  const tenantId = tenantIdOf(context);
  const rows = await getDb()
    .select()
    .from(claims)
    .where(
      and(eq(claims.deviceId, normalizeDeviceId(rawDeviceId)), eq(claims.tenantId, tenantId))
    )
    .orderBy(desc(claims.createdAt))
    .limit(1);
  return rows[0];
}

export async function listClaims(
  context: TenantContext
): Promise<(typeof claims.$inferSelect)[]> {
  const tenantId = tenantIdOf(context);
  return getDb().select().from(claims).where(eq(claims.tenantId, tenantId));
}

export async function listTurns(
  context: TenantContext,
  deviceRowId?: string
): Promise<(typeof turns.$inferSelect)[]> {
  const tenantId = tenantIdOf(context);
  const where =
    deviceRowId === undefined
      ? eq(turns.tenantId, tenantId)
      : and(eq(turns.tenantId, tenantId), eq(turns.deviceId, deviceRowId));
  return getDb().select().from(turns).where(where).orderBy(desc(turns.startedAt));
}

export async function listFirmware(
  context: TenantContext
): Promise<(typeof firmwareReleases.$inferSelect)[]> {
  const tenantId = tenantIdOf(context);
  return getDb()
    .select()
    .from(firmwareReleases)
    .where(eq(firmwareReleases.tenantId, tenantId));
}

export async function listUsage(
  context: TenantContext
): Promise<(typeof usageEvents.$inferSelect)[]> {
  const tenantId = tenantIdOf(context);
  return getDb()
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.tenantId, tenantId))
    .orderBy(desc(usageEvents.createdAt));
}
