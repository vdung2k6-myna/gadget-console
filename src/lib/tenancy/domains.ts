import { and, asc, eq, ne } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { tenantDomains, tenants } from "@/lib/db/schema";
import { findTenant } from "@/lib/tenants";
import { normalizeHost } from "./request";

/**
 * A tenant's white-label hosts.
 *
 * A host belongs to one tenant across the whole deployment: the unique domain
 * index is the authority, and `registerTenantDomain` checks it before inserting
 * so a collision is a named refusal rather than a database error. A tenant may
 * hold one console host and one gateway host, so the same kind cannot be
 * registered twice.
 *
 * Hosts are normalized the same way tenant resolution normalizes a request
 * host, so `HTTPS://Console.Example:8443/` and `console.example` are the same
 * registration.
 */

export type DomainKind = "console" | "gateway";
export type TenantDomainRow = typeof tenantDomains.$inferSelect;

export type DomainFailure =
  | "invalid-domain"
  | "invalid-kind"
  | "tenant-not-found"
  | "domain-taken"
  | "kind-taken";

export type RegisterDomainResult =
  | { ok: true; domain: TenantDomainRow }
  | { ok: false; reason: DomainFailure };

export function isDomainKind(value: unknown): value is DomainKind {
  return value === "console" || value === "gateway";
}

/** The Postgres unique violation under any wrapper Drizzle adds, as its constraint. */
function uniqueViolation(error: unknown): string | undefined {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505") {
      return typeof candidate.constraint === "string" ? candidate.constraint : "";
    }
    current = candidate.cause;
  }
  return undefined;
}

export async function registerTenantDomain(
  tenantId: string,
  input: unknown
): Promise<RegisterDomainResult> {
  const body =
    typeof input === "object" && input !== null
      ? (input as { domain?: unknown; kind?: unknown })
      : {};

  const domain = normalizeHost(typeof body.domain === "string" ? body.domain : undefined);
  if (domain === undefined) return { ok: false, reason: "invalid-domain" };
  if (!isDomainKind(body.kind)) return { ok: false, reason: "invalid-kind" };

  const tenant = await findTenant(tenantId);
  if (tenant === undefined || tenant.status === "deleted") {
    return { ok: false, reason: "tenant-not-found" };
  }

  const db = getDb();
  const sameHost = await db
    .select({ tenantId: tenantDomains.tenantId })
    .from(tenantDomains)
    .where(eq(tenantDomains.domain, domain))
    .limit(1);
  if (sameHost[0] !== undefined) return { ok: false, reason: "domain-taken" };

  const sameKind = await db
    .select({ id: tenantDomains.id })
    .from(tenantDomains)
    .where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.kind, body.kind)))
    .limit(1);
  if (sameKind[0] !== undefined) return { ok: false, reason: "kind-taken" };

  try {
    const rows = await db
      .insert(tenantDomains)
      .values({ tenantId, domain, kind: body.kind })
      .returning();
    return { ok: true, domain: rows[0]! };
  } catch (error) {
    const constraint = uniqueViolation(error);
    if (constraint === "tenant_domains_domain_unique") {
      return { ok: false, reason: "domain-taken" };
    }
    if (constraint === "tenant_domains_tenant_kind_unique") {
      return { ok: false, reason: "kind-taken" };
    }
    throw error;
  }
}

export async function listTenantDomains(tenantId: string): Promise<TenantDomainRow[]> {
  return getDb()
    .select()
    .from(tenantDomains)
    .where(eq(tenantDomains.tenantId, tenantId))
    .orderBy(asc(tenantDomains.kind), asc(tenantDomains.domain));
}

/** Remove one of the tenant's hosts. False when the row is not the tenant's. */
export async function removeTenantDomain(
  tenantId: string,
  domainId: string
): Promise<boolean> {
  const removed = await getDb()
    .delete(tenantDomains)
    .where(and(eq(tenantDomains.tenantId, tenantId), eq(tenantDomains.id, domainId)))
    .returning({ id: tenantDomains.id });
  return removed.length > 0;
}

/**
 * Whether a certificate may be issued for this host.
 *
 * This is the authority an on-demand TLS front (Caddy's `on_demand_tls` ask
 * endpoint) calls before asking the CA. Only a registered console or gateway
 * host of a tenant that has not been deleted qualifies; a suspended tenant still
 * qualifies so its console can be read and its data exported.
 */
export async function canIssueCertificate(
  raw: string | null | undefined
): Promise<boolean> {
  const domain = normalizeHost(raw);
  if (domain === undefined) return false;

  const rows = await getDb()
    .select({ id: tenantDomains.id })
    .from(tenantDomains)
    .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
    .where(and(eq(tenantDomains.domain, domain), ne(tenants.status, "deleted")))
    .limit(1);
  return rows.length > 0;
}
