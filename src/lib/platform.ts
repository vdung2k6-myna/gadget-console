import { listTenantDomains, type TenantDomainRow } from "@/lib/tenancy/domains";
import { usageReport, type UsageReport } from "@/lib/tenancy/usage";
import { listTenants, type TenantRow } from "@/lib/tenants";
import { listAccounts, type AdminAccount } from "@/lib/users";

/**
 * The platform admin's read model.
 *
 * The page is a thin renderer over these rows: each tenant's status, its
 * registered hosts, its allowance and billable speech for the window, and how
 * many accounts it has. The roles view is the same accounts, grouped by tenant.
 */

export const PLATFORM_USAGE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface PlatformTenantView {
  tenant: TenantRow;
  domains: TenantDomainRow[];
  usage: UsageReport;
  accounts: number;
}

export async function platformTenants(
  now: Date = new Date()
): Promise<PlatformTenantView[]> {
  const since = new Date(now.getTime() - PLATFORM_USAGE_WINDOW_MS);
  const tenants = await listTenants();

  return Promise.all(
    tenants.map(async (tenant) => {
      const [domains, usage, accounts] = await Promise.all([
        listTenantDomains(tenant.id),
        usageReport(tenant.id, { since }),
        listAccounts(tenant.id),
      ]);
      return { tenant, domains, usage, accounts: accounts.length };
    })
  );
}

export interface PlatformAccountView extends AdminAccount {
  tenantName: string | null;
}

export interface PlatformAccountGroup {
  tenantId: string | null;
  tenantName: string | null;
  accounts: PlatformAccountView[];
}

export async function platformAccounts(): Promise<PlatformAccountView[]> {
  const [accounts, tenants] = await Promise.all([listAccounts(), listTenants()]);
  const names = new Map(tenants.map((tenant) => [tenant.id, tenant.name]));

  return accounts.map((account) => ({
    ...account,
    tenantName: account.tenantId === null ? null : (names.get(account.tenantId) ?? null),
  }));
}

/** One group per tenant, with the tenantless platform admins first. */
export function groupPlatformAccounts(
  accounts: PlatformAccountView[]
): PlatformAccountGroup[] {
  const groups = new Map<string, PlatformAccountGroup>();

  for (const account of accounts) {
    const key = account.tenantId ?? "platform";
    const group = groups.get(key) ?? {
      tenantId: account.tenantId,
      tenantName: account.tenantName,
      accounts: [],
    };
    group.accounts.push(account);
    groups.set(key, group);
  }

  return [...groups.values()].sort((a, b) => {
    if (a.tenantId === null) return -1;
    if (b.tenantId === null) return 1;
    return (a.tenantName ?? "").localeCompare(b.tenantName ?? "");
  });
}

/** Seconds as a short human duration for the usage column. */
export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
