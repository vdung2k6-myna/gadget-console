import { and, eq, inArray, isNull, notInArray, sql, type SQL } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import {
  agents,
  calibrationAudit,
  calibrationDefault,
  claims,
  conversations,
  deviceCalibration,
  devices,
  firmwareReleases,
  providerProfiles,
  runtimes,
  tenantDomains,
  tenants,
  turns,
  users,
} from "@/lib/db/schema";

/**
 * The one-time move from a single deployment to a tenant.
 *
 * The live pilot already exists: its accounts, devices, agents, provider
 * profiles and records have no tenant. This creates the pilot tenant, assigns
 * every owned row to it, and turns the deployment's admins into a platform admin
 * (no tenant) and tenant admins (the pilot tenant).
 *
 * A dry run prints the same table counts and writes nothing. Running the real
 * pass twice is safe: it only assigns rows whose tenant is still null.
 */

export interface PilotBackfillOptions {
  tenantName: string;
  tenantSlug: string;
  /** The accounts that become platform admins; at least one is required. */
  platformAdminEmails: string[];
  consoleDomain?: string;
  gatewayDomain?: string;
}

export interface TableBackfill {
  table: string;
  total: number;
  unassignedBefore: number;
  unassignedAfter: number;
  assigned: number;
}

export interface BackfillReport {
  dryRun: boolean;
  tenantSlug: string;
  tenantId: string | null;
  tenantCreated: boolean;
  platformAdmins: string[];
  tables: TableBackfill[];
}

const SIMPLE_TABLES = [
  "runtimes",
  "agents",
  "devices",
  "claims",
  "conversations",
  "turns",
  "firmware_releases",
  "device_calibration",
  "calibration_default",
  "calibration_audit",
] as const;

async function scalar(query: SQL): Promise<number> {
  const result = await getDb().execute<{ n: number }>(query);
  return Number(result.rows[0]?.n ?? 0);
}

async function countSimple(table: (typeof SIMPLE_TABLES)[number]): Promise<{
  total: number;
  unassigned: number;
}> {
  // Table names are internal constants, never caller input.
  const total = await scalar(sql.raw(`select count(*)::int as n from ${table}`));
  const unassigned = await scalar(
    sql.raw(`select count(*)::int as n from ${table} where tenant_id is null`)
  );
  return { total, unassigned };
}

function normalizeDomain(raw: string | undefined): string | undefined {
  const value = raw?.trim().toLowerCase();
  if (value === undefined || value === "") return undefined;
  const host = value.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  if (host === "" || host.includes(" ")) {
    throw new Error(`a tenant domain must be a hostname, got ${JSON.stringify(raw)}`);
  }
  return host;
}

async function ensureDomain(
  tenantId: string,
  domain: string,
  kind: "console" | "gateway"
): Promise<void> {
  const db = getDb();
  const sameHost = await db
    .select({ tenantId: tenantDomains.tenantId })
    .from(tenantDomains)
    .where(eq(tenantDomains.domain, domain))
    .limit(1);
  if (sameHost[0] !== undefined) {
    if (sameHost[0].tenantId !== tenantId) {
      throw new Error(`the domain ${domain} already belongs to another tenant`);
    }
    return;
  }

  const sameKind = await db
    .select({ id: tenantDomains.id })
    .from(tenantDomains)
    .where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.kind, kind)))
    .limit(1);
  if (sameKind[0] !== undefined) {
    throw new Error(`the tenant already has a ${kind} domain`);
  }

  await db.insert(tenantDomains).values({ tenantId, domain, kind });
}

export async function backfillPilotTenant(
  options: PilotBackfillOptions,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<BackfillReport> {
  const db = getDb();
  const slug = options.tenantSlug.trim().toLowerCase();
  if (slug === "") throw new Error("a tenant slug is required");

  const emails = Array.from(
    new Set(
      options.platformAdminEmails
        .map((email) => email.trim().toLowerCase())
        .filter((email) => email !== "")
    )
  );
  if (emails.length === 0) {
    throw new Error(
      "PLATFORM_ADMIN_EMAILS (or PROTECTED_ADMINS) must name at least one platform admin"
    );
  }

  const existingAdmins = await db
    .select({ email: users.email })
    .from(users)
    .where(inArray(users.email, emails));
  const found = new Set(existingAdmins.map((row) => row.email));
  const missing = emails.filter((email) => !found.has(email));
  if (missing.length > 0) {
    throw new Error(`no account with the address ${missing.map((e) => JSON.stringify(e)).join(", ")}`);
  }

  let tenant = (
    await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1)
  )[0];
  const tenantCreated = tenant === undefined;

  const before = new Map<string, { total: number; unassigned: number }>();
  for (const table of SIMPLE_TABLES) before.set(table, await countSimple(table));
  const usersBefore = {
    total: await scalar(sql`select count(*)::int as n from users`),
    unassigned: await scalar(sql`select count(*)::int as n from users where tenant_id is null`),
  };
  const profilesBefore = {
    total: await scalar(sql`select count(*)::int as n from provider_profiles where builtin = false`),
    unassigned: await scalar(
      sql`select count(*)::int as n from provider_profiles where builtin = false and tenant_id is null`
    ),
  };

  if (!dryRun) {
    const created = await db.transaction(async (tx) => {
      if (tenant === undefined) {
        const inserted = await tx
          .insert(tenants)
          .values({ name: options.tenantName.trim() || slug, slug })
          .onConflictDoNothing({ target: tenants.slug })
          .returning();
        tenant =
          inserted[0] ??
          (await tx.select().from(tenants).where(eq(tenants.slug, slug)).limit(1))[0];
      }
      if (tenant === undefined) throw new Error(`could not create the tenant ${slug}`);
      const tenantId = tenant.id;

      await tx
        .update(users)
        .set({ tenantId: null, role: "platform_admin" })
        .where(inArray(users.email, emails));
      await tx
        .update(users)
        .set({ tenantId })
        .where(and(isNull(users.tenantId), notInArray(users.email, emails)));
      await tx
        .update(users)
        .set({ role: "tenant_admin" })
        .where(and(eq(users.role, "admin"), notInArray(users.email, emails)));

      await tx.update(runtimes).set({ tenantId }).where(isNull(runtimes.tenantId));
      await tx.update(agents).set({ tenantId }).where(isNull(agents.tenantId));
      await tx.update(devices).set({ tenantId }).where(isNull(devices.tenantId));
      await tx.update(claims).set({ tenantId }).where(isNull(claims.tenantId));
      await tx.update(conversations).set({ tenantId }).where(isNull(conversations.tenantId));
      await tx.update(turns).set({ tenantId }).where(isNull(turns.tenantId));
      await tx
        .update(firmwareReleases)
        .set({ tenantId })
        .where(isNull(firmwareReleases.tenantId));
      await tx
        .update(deviceCalibration)
        .set({ tenantId })
        .where(isNull(deviceCalibration.tenantId));
      await tx
        .update(calibrationDefault)
        .set({ tenantId })
        .where(isNull(calibrationDefault.tenantId));
      await tx
        .update(calibrationAudit)
        .set({ tenantId })
        .where(isNull(calibrationAudit.tenantId));
      await tx
        .update(providerProfiles)
        .set({ tenantId })
        .where(
          and(isNull(providerProfiles.tenantId), eq(providerProfiles.builtin, false))
        );

      return tenant;
    });
    tenant = created;

    const consoleDomain = normalizeDomain(options.consoleDomain);
    const gatewayDomain = normalizeDomain(options.gatewayDomain);
    if (consoleDomain !== undefined) await ensureDomain(tenant.id, consoleDomain, "console");
    if (gatewayDomain !== undefined) await ensureDomain(tenant.id, gatewayDomain, "gateway");
  }

  const tables: TableBackfill[] = [];
  for (const table of SIMPLE_TABLES) {
    const beforeRow = before.get(table)!;
    const afterRow = dryRun ? 0 : (await countSimple(table)).unassigned;
    tables.push({
      table,
      total: beforeRow.total,
      unassignedBefore: beforeRow.unassigned,
      unassignedAfter: afterRow,
      assigned: Math.max(0, beforeRow.unassigned - afterRow),
    });
  }

  const usersAfter = dryRun
    ? emails.length
    : await scalar(sql`select count(*)::int as n from users where tenant_id is null`);
  tables.push({
    table: "users",
    total: usersBefore.total,
    unassignedBefore: usersBefore.unassigned,
    unassignedAfter: usersAfter,
    assigned: Math.max(0, usersBefore.unassigned - usersAfter),
  });

  const profilesAfter = dryRun
    ? 0
    : await scalar(
        sql`select count(*)::int as n from provider_profiles where builtin = false and tenant_id is null`
      );
  tables.push({
    table: "provider_profiles (non-builtin)",
    total: profilesBefore.total,
    unassignedBefore: profilesBefore.unassigned,
    unassignedAfter: profilesAfter,
    assigned: Math.max(0, profilesBefore.unassigned - profilesAfter),
  });

  return {
    dryRun,
    tenantSlug: slug,
    tenantId: tenant?.id ?? null,
    tenantCreated,
    platformAdmins: emails,
    tables,
  };
}
