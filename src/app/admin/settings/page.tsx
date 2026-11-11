import Link from "next/link";
import { notFound } from "next/navigation";

import { TenantSettingsForm } from "@/components/TenantSettingsForm";
import { requireTenantAdminSurface } from "@/lib/auth/admin";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { findTenant } from "@/lib/tenants";
import { tenantBranding } from "@/lib/tenancy/branding";
import { listTenantDomains } from "@/lib/tenancy/domains";

export const instant = false;

/** The tenant admin's settings: branding, locale and retention, with the
 * platform-owned quotas and domains shown read-only. */
export default async function TenantSettingsPage() {
  const { locale } = await getStrings();
  const adminStrings = adminStringsFor(locale);
  const labels = adminStrings.settings;
  const { tenantId } = await requireTenantAdminSurface();
  const tenant = await findTenant(tenantId);
  if (tenant === undefined) notFound();

  const domains = await listTenantDomains(tenantId);
  const quotas = Object.entries(tenant.quotas ?? {});

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{labels.heading}</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/devices" className="hover:underline">
            {adminStrings.devices}
          </Link>
          <Link href="/admin/users" className="hover:underline">
            {adminStrings.users}
          </Link>
          <Link href="/admin/adapters" className="hover:underline">
            {adminStrings.adapters.nav}
          </Link>
        </nav>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{labels.intro}</p>

      <TenantSettingsForm
        initialLocale={tenant.locale === "en" ? "en" : "vi"}
        initialRetentionDays={tenant.retentionDays}
        initialBranding={tenantBranding(tenant.branding)}
        labels={labels}
      />

      <section className="mt-10">
        <h2 className="text-lg font-semibold">{labels.quotas}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{labels.quotasHelp}</p>
        {quotas.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{labels.none}</p>
        ) : (
          <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {quotas.map(([key, value]) => (
              <div key={key} className="flex justify-between gap-4 border-b border-zinc-100 py-1 dark:border-zinc-900">
                <dt className="text-zinc-500 dark:text-zinc-400">{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{labels.domains}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{labels.domainsHelp}</p>
        {domains.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{labels.none}</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {domains.map((domain) => (
              <li key={domain.id} className="flex gap-2">
                <span className="text-zinc-500 dark:text-zinc-400">
                  {domain.kind === "console" ? labels.consoleHost : labels.gatewayHost}:
                </span>
                <span className="font-mono">{domain.domain}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
