/**
 * Parse the tenant a console request names.
 *
 * The host is the normal case: a tenant's console host is registered in
 * `tenant_domains`. The path fallback (`/t/<slug>/...`) exists for onboarding a
 * tenant before its DNS and certificate are ready. The platform host is a
 * separate host that never resolves to a tenant.
 *
 * This module is pure: it normalizes and classifies, but it does not query the
 * database. `resolve.ts` turns the classification into a tenant row.
 */

export interface TenantRequestInput {
  host: string | null | undefined;
  pathname: string;
  platformHost?: string | null;
}

export type ParsedTenantRequest =
  | { kind: "platform"; pathname: string }
  | {
      kind: "tenant";
      source: "host" | "path";
      pathname: string;
      host?: string;
      slug?: string;
    }
  | { kind: "unknown"; pathname: string };

const HOST = /^[a-z0-9.-]+$/;
const PATH_PREFIX = /^\/t\/([a-z0-9-]+)(\/.*)?$/;

/** Lowercase, without a scheme, port or trailing dot; undefined when unusable. */
export function normalizeHost(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  let value = raw.trim().toLowerCase();
  if (value === "") return undefined;

  if (value.includes("://")) {
    try {
      value = new URL(value).host;
    } catch {
      return undefined;
    }
  }

  value = (value.split("/")[0] ?? "").replace(/:\d+$/, "").replace(/\.$/, "");
  if (value === "" || !HOST.test(value)) return undefined;
  return value;
}

export function parseTenantRequest(input: TenantRequestInput): ParsedTenantRequest {
  const pathname = input.pathname === "" ? "/" : input.pathname;

  const path = PATH_PREFIX.exec(pathname);
  if (path !== null) {
    return {
      kind: "tenant",
      source: "path",
      slug: path[1]!,
      pathname: path[2] === undefined || path[2] === "" ? "/" : path[2],
    };
  }

  const host = normalizeHost(input.host?.split(",")[0]);
  const platformHost = normalizeHost(input.platformHost);
  if (platformHost !== undefined && host === platformHost) {
    return { kind: "platform", pathname };
  }
  if (host !== undefined) {
    return { kind: "tenant", source: "host", host, pathname };
  }
  return { kind: "unknown", pathname };
}
