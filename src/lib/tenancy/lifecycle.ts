import { eq } from "drizzle-orm";
import { rm } from "node:fs/promises";
import path from "node:path";

import { type Agent } from "@/lib/agents";
import { getDb } from "@/lib/db/client";
import {
  agents,
  auditEvents,
  claims,
  devices,
  firmwareReleases,
  providerProfiles,
  tenantDomains,
  tenants,
  turns,
  usageEvents,
  users,
} from "@/lib/db/schema";
import { publicDevice, type PublicDevice } from "@/lib/devices";
import { firmwareDirectory, type FirmwareRelease } from "@/lib/firmware";
import { type ProviderProfileRow } from "@/lib/provider-profiles";
import { findTenant, type TenantRow } from "@/lib/tenants";
import { type TenantDomainRow } from "@/lib/tenancy/domains";

/**
 * Taking a tenant out, and giving it back.
 *
 * Export is a read of the tenant's own rows with every secret removed: no
 * password hash, device secret or provider key. Deletion is a cascade of the
 * tenant row, so every owned table follows the foreign keys; the deletion audit
 * is written in the same transaction with no tenant, because the tenant's own
 * rows (including its audit) are about to disappear.
 *
 * Provider keys are derived from the master key and the tenant id, so there is no
 * separate key row to destroy. Removing every ciphertext with the tenant rows is
 * what makes the derived key useless; `delete` also removes the tenant's firmware
 * files, which the cascade cannot reach.
 */

export interface TenantExport {
  tenant: TenantRow;
  domains: TenantDomainRow[];
  users: {
    id: string;
    email: string;
    role: string;
    createdAt: Date;
    disabledAt: Date | null;
  }[];
  devices: PublicDevice[];
  agents: Agent[];
  claims: Omit<typeof claims.$inferSelect, "code">[];
  firmware: FirmwareRelease[];
  profiles: Omit<ProviderProfileRow, "encryptedKey">[];
  turns: (typeof turns.$inferSelect)[];
  usage: (typeof usageEvents.$inferSelect)[];
}

export async function exportTenant(id: string): Promise<TenantExport | undefined> {
  const tenant = await findTenant(id);
  if (tenant === undefined) return undefined;

  const db = getDb();
  const [
    domains,
    accounts,
    deviceRows,
    agentRows,
    claimRows,
    firmwareRows,
    profileRows,
    turnRows,
    usageRows,
  ] = await Promise.all([
    db.select().from(tenantDomains).where(eq(tenantDomains.tenantId, id)),
    db
      .select({
        id: users.id,
        email: users.email,
        role: users.role,
        createdAt: users.createdAt,
        disabledAt: users.disabledAt,
      })
      .from(users)
      .where(eq(users.tenantId, id)),
    db.select().from(devices).where(eq(devices.tenantId, id)),
    db.select().from(agents).where(eq(agents.tenantId, id)),
    db.select().from(claims).where(eq(claims.tenantId, id)),
    db.select().from(firmwareReleases).where(eq(firmwareReleases.tenantId, id)),
    db.select().from(providerProfiles).where(eq(providerProfiles.tenantId, id)),
    db.select().from(turns).where(eq(turns.tenantId, id)),
    db.select().from(usageEvents).where(eq(usageEvents.tenantId, id)),
  ]);

  return {
    tenant,
    domains,
    users: accounts,
    devices: deviceRows.map(publicDevice),
    agents: agentRows,
    claims: claimRows.map(({ code: _code, ...rest }) => rest),
    firmware: firmwareRows,
    profiles: profileRows.map(({ encryptedKey: _key, ...rest }) => rest),
    turns: turnRows,
    usage: usageRows,
  };
}

export type DeleteTenantResult = "deleted" | "not-found";

export async function deleteTenant(
  id: string,
  actor: { id: string; email: string }
): Promise<DeleteTenantResult> {
  const tenant = await findTenant(id);
  if (tenant === undefined) return "not-found";

  const firmware = await getDb()
    .select({ id: firmwareReleases.id })
    .from(firmwareReleases)
    .where(eq(firmwareReleases.tenantId, id));

  await getDb().transaction(async (tx) => {
    // The tenant id is deliberately absent: this row must survive the cascade.
    await tx.insert(auditEvents).values({
      tenantId: null,
      actorId: actor.id,
      actorEmail: actor.email,
      action: "tenant.delete",
      targetType: "tenant",
      targetId: id,
      metadata: { slug: tenant.slug, name: tenant.name },
    });
    await tx.delete(tenants).where(eq(tenants.id, id));
  });

  const directory = firmwareDirectory();
  if ("path" in directory) {
    for (const release of firmware) {
      await rm(path.join(directory.path, `${release.id}.bin`), { force: true }).catch(() => {});
    }
  }

  return "deleted";
}
