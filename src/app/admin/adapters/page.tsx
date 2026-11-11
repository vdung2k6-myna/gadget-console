import Link from "next/link";

import { AdapterActions } from "@/components/AdapterActions";
import { AdapterForm } from "@/components/AdapterForm";
import { AdapterPolicyForm } from "@/components/AdapterPolicyForm";
import { listAdapters } from "@/lib/adapters";
import { tenantUsageReport } from "@/lib/adapter-egress";
import { requireTenantAdminSurface } from "@/lib/auth/admin";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { findTenant } from "@/lib/tenants";
import { readAdapterPolicy } from "@/lib/tenancy/adapters";

export const instant = false;

export default async function AdminAdaptersPage() {
  const { locale } = await getStrings();
  const adminStrings = adminStringsFor(locale);
  const labels = adminStrings.adapters;
  const { tenantId } = await requireTenantAdminSurface();

  const [adapters, tenant, usage] = await Promise.all([
    listAdapters(tenantId),
    findTenant(tenantId),
    tenantUsageReport(tenantId),
  ]);
  const policy = readAdapterPolicy(tenant?.adapterPolicy);
  const budget =
    (tenant?.adapterPolicy as { monthlyBudgetUsd?: number | null } | null)?.monthlyBudgetUsd ??
    null;

  function privacyLabel(adapter: (typeof adapters)[number]): string {
    const privacy = adapter.privacy;
    if (privacy === null || privacy === undefined) return "—";
    return [
      privacy.operator ?? "—",
      privacy.region ?? "—",
      (privacy.receives ?? []).join("+") || "—",
      privacy.retentionDays === null || privacy.retentionDays === undefined
        ? "—"
        : `${privacy.retentionDays}d`,
      privacy.remote === false ? "local" : "remote",
    ].join(" · ");
  }

  function kindLabel(kind: string): string {
    if (kind === "llm") return labels.kindLlm;
    if (kind === "stt") return labels.kindStt;
    return labels.kindTts;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{labels.heading}</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/users" className="hover:underline">{adminStrings.users}</Link>
          <Link href="/admin/devices" className="hover:underline">{adminStrings.devices}</Link>
          <Link href="/admin/provider-profiles" className="hover:underline">{adminStrings.providerBuiltins}</Link>
        </nav>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{labels.intro}</p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold">{labels.usageHeading}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{labels.usageIntro}</p>
        <dl className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
          <div><dt className="text-zinc-500">{labels.usageCalls}</dt><dd>{usage.calls}</dd></div>
          <div><dt className="text-zinc-500">{labels.usageBytes}</dt><dd>{usage.bytes}</dd></div>
          <div><dt className="text-zinc-500">{labels.usageAudio}</dt><dd>{usage.audioSeconds.toFixed(1)}</dd></div>
          <div><dt className="text-zinc-500">{labels.usagePlatform}</dt><dd>{usage.platformSpeechSeconds.toFixed(1)}</dd></div>
          <div><dt className="text-zinc-500">{labels.usageReseller}</dt><dd>{usage.resellerSpeechSeconds.toFixed(1)}</dd></div>
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{labels.policyHeading}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{labels.policyIntro}</p>
        <AdapterPolicyForm
          localOnly={policy.localOnly}
          order={policy.order}
          monthlyBudgetUsd={budget}
          labels={labels}
        />
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{labels.listHeading}</h2>
        {adapters.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{labels.empty}</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                  <th className="py-2 pr-4 font-medium">{labels.name}</th>
                  <th className="py-2 pr-4 font-medium">{labels.kinds}</th>
                  <th className="py-2 pr-4 font-medium">{labels.status}</th>
                  <th className="py-2 pr-4 font-medium">{labels.health}</th>
                  <th className="py-2 pr-4 font-medium">{labels.privacy}</th>
                  <th className="py-2 pr-4 font-medium">{labels.tokenHint}</th>
                  <th className="py-2 pr-4 font-medium">{labels.manifestVersion}</th>
                  <th className="py-2 pr-4 font-medium">{labels.verification}</th>
                  <th className="py-2 font-medium">{labels.actions}</th>
                </tr>
              </thead>
              <tbody>
                {adapters.map((adapter) => (
                  <tr key={adapter.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                    <td className="py-2 pr-4">
                      <p className="font-medium">{adapter.name}</p>
                      <p className="font-mono text-xs text-zinc-500">{adapter.endpoint}</p>
                    </td>
                    <td className="py-2 pr-4">{adapter.kinds.map(kindLabel).join(", ")}</td>
                    <td className="py-2 pr-4">{adapter.status}</td>
                    <td className="py-2 pr-4">{adapter.health}</td>
                    <td className="py-2 pr-4 text-xs">{privacyLabel(adapter)}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{adapter.tokenHint}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{adapter.manifestVersion ?? "—"}</td>
                    <td className="py-2 pr-4 text-xs">
                      {adapter.verification === null || adapter.verification === undefined
                        ? labels.neverVerified
                        : JSON.stringify(adapter.verification).slice(0, 80)}
                    </td>
                    <td className="py-2">
                      <AdapterActions id={adapter.id} labels={labels} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{labels.register}</h2>
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{labels.intro}</p>
        <AdapterForm labels={labels} />
      </section>
    </main>
  );
}
