import { and, eq, ne } from "drizzle-orm";

import { getDb } from "@/lib/db/client";
import { tenantDomains, tenants } from "@/lib/db/schema";
import { parseTenantRequest, type TenantRequestInput } from "./request";

/**
 * The tenant a console request belongs to.
 *
 * A host resolves through `tenant_domains`; the path fallback resolves by slug.
 * A deleted tenant is answered as unknown, so its host stops serving. A
 * suspended tenant is still returned: the console may need to show its status
 * and export its data.
 */

export type ResolvedTenant =
  | { kind: "platform"; pathname: string }
  | {
      kind: "tenant";
      tenant: typeof tenants.$inferSelect;
      source: "host" | "path";
      pathname: string;
    }
  | { kind: "unknown"; pathname: string };

export async function findTenantBySlug(
  slug: string
): Promise<typeof tenants.$inferSelect | undefined> {
  const rows = await getDb()
    .select()
    .from(tenants)
    .where(and(eq(tenants.slug, slug), ne(tenants.status, "deleted")))
    .limit(1);
  return rows[0];
}

async function findTenantByDomain(
  host: string,
  kind: "console" | "gateway"
): Promise<typeof tenants.$inferSelect | undefined> {
  const rows = await getDb()
    .select({ tenant: tenants })
    .from(tenantDomains)
    .innerJoin(tenants, eq(tenants.id, tenantDomains.tenantId))
    .where(
      and(
        eq(tenantDomains.domain, host),
        eq(tenantDomains.kind, kind),
        ne(tenants.status, "deleted")
      )
    )
    .limit(1);
  return rows[0]?.tenant;
}

export async function findTenantByConsoleHost(
  host: string
): Promise<typeof tenants.$inferSelect | undefined> {
  return findTenantByDomain(host, "console");
}

export async function findTenantByGatewayHost(
  host: string
): Promise<typeof tenants.$inferSelect | undefined> {
  return findTenantByDomain(host, "gateway");
}

export async function resolveConsoleTenant(
  input: TenantRequestInput
): Promise<ResolvedTenant> {
  const parsed = parseTenantRequest(input);
  if (parsed.kind !== "tenant") return parsed;

  const tenant =
    parsed.source === "path"
      ? parsed.slug === undefined
        ? undefined
        : await findTenantBySlug(parsed.slug)
      : parsed.host === undefined
        ? undefined
        : await findTenantByConsoleHost(parsed.host);

  if (tenant === undefined) return { kind: "unknown", pathname: parsed.pathname };
  return {
    kind: "tenant",
    tenant,
    source: parsed.source,
    pathname: parsed.pathname,
  };
}
