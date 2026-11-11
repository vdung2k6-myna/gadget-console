import Link from "next/link";
import { TenantCreateForm } from "@/components/TenantCreateForm";
import { TenantStatusControl } from "@/components/TenantStatusControl";
import { requirePlatformSurface } from "@/lib/auth/admin";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { formatSeconds, platformTenants, type PlatformTenantView } from "@/lib/platform";

export const instant = false;

function StatusBadge({
  status,
  active,
  suspended,
}: {
  status: string;
  active: string;
  suspended: string;
}) {
  const isActive = status === "active";
  return (
    <span
      className={
        isActive
          ? "rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200"
      }
    >
      {isActive ? active : suspended}
    </span>
  );
}

function Usage({
  view,
  labels,
}: {
  view: PlatformTenantView;
  labels: ReturnType<typeof adminStringsFor>["platform"];
}) {
  const { usage } = view;
  return (
    <div className="space-y-0.5 text-xs text-zinc-600 dark:text-zinc-400">
      <p>
        {labels.platformSeconds}: {formatSeconds(usage.platformSeconds)}
      </p>
      <p>
        {labels.resellerSeconds}: {formatSeconds(usage.resellerSeconds)}
      </p>
      <p>
        {labels.allowance}: {formatSeconds(usage.allowanceSeconds)}
      </p>
      {usage.billableSeconds > 0 && (
        <p className="text-amber-800 dark:text-amber-200">
          {labels.billable}: {formatSeconds(usage.billableSeconds)}
        </p>
      )}
    </div>
  );
}

export default async function PlatformPage() {
  const { locale } = await getStrings();
  const adminStrings = adminStringsFor(locale);
  const labels = adminStrings.platform;
  await requirePlatformSurface();
  const tenants = await platformTenants();

  const active = tenants.filter((view) => view.tenant.status === "active").length;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{labels.heading}</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/platform" className="font-medium hover:underline">
            {labels.tenants}
          </Link>
          <Link href="/admin/platform/users" className="hover:underline">
            {labels.users}
          </Link>
          <Link href="/admin/calibration" className="hover:underline">
            {adminStrings.calibration.defaultHeading}
          </Link>
        </nav>
      </div>

      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {tenants.length} {labels.tenants.toLowerCase()} · {active} {labels.active.toLowerCase()}
        {" · "}
        {labels.window}
      </p>

      <TenantCreateForm labels={labels} />

      {tenants.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">{labels.empty}</p>
      ) : (
        <>
          <ul className="mt-6 space-y-3 lg:hidden">
            {tenants.map((view) => (
              <li
                key={view.tenant.id}
                className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{view.tenant.name}</p>
                  <StatusBadge
                    status={view.tenant.status}
                    active={labels.active}
                    suspended={labels.suspended}
                  />
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">{view.tenant.slug}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-zinc-500 dark:text-zinc-400">{labels.plan}</dt>
                  <dd>{view.tenant.plan ?? labels.none}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">{labels.domains}</dt>
                  <dd>
                    {view.domains.length === 0
                      ? labels.none
                      : view.domains.map((domain) => `${domain.kind}: ${domain.domain}`).join(", ")}
                  </dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">{labels.accounts}</dt>
                  <dd>{view.accounts}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">{labels.usage}</dt>
                  <dd>
                    <Usage view={view} labels={labels} />
                  </dd>
                </dl>
                <div className="mt-3">
                  <TenantStatusControl
                    tenantId={view.tenant.id}
                    name={view.tenant.name}
                    status={view.tenant.status === "active" ? "active" : "suspended"}
                    labels={labels}
                  />
                </div>
              </li>
            ))}
          </ul>

          <table className="mt-6 hidden w-full border-collapse text-sm lg:table">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">{labels.tenant}</th>
                <th className="py-2 pr-4 font-medium">{labels.status}</th>
                <th className="py-2 pr-4 font-medium">{labels.plan}</th>
                <th className="py-2 pr-4 font-medium">{labels.domains}</th>
                <th className="py-2 pr-4 font-medium">{labels.accounts}</th>
                <th className="py-2 pr-4 font-medium">{labels.usage}</th>
                <th className="py-2 pr-4 font-medium">{labels.created}</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {tenants.map((view) => (
                <tr
                  key={view.tenant.id}
                  className="border-b border-zinc-100 dark:border-zinc-900"
                >
                  <td className="py-3 pr-4">
                    <p className="font-medium">{view.tenant.name}</p>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">{view.tenant.slug}</p>
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge
                      status={view.tenant.status}
                      active={labels.active}
                      suspended={labels.suspended}
                    />
                  </td>
                  <td className="py-3 pr-4">{view.tenant.plan ?? labels.none}</td>
                  <td className="py-3 pr-4">
                    {view.domains.length === 0 ? (
                      <span className="text-zinc-500 dark:text-zinc-400">{labels.none}</span>
                    ) : (
                      <ul className="space-y-0.5 text-xs">
                        {view.domains.map((domain) => (
                          <li key={domain.id}>
                            <span className="text-zinc-500 dark:text-zinc-400">
                              {domain.kind}:{" "}
                            </span>
                            {domain.domain}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className="py-3 pr-4">{view.accounts}</td>
                  <td className="py-3 pr-4">
                    <Usage view={view} labels={labels} />
                  </td>
                  <td className="py-3 pr-4 text-zinc-600 dark:text-zinc-400">
                    {view.tenant.createdAt.toLocaleDateString()}
                  </td>
                  <td className="py-3 text-right">
                    <TenantStatusControl
                      tenantId={view.tenant.id}
                      name={view.tenant.name}
                      status={view.tenant.status === "active" ? "active" : "suspended"}
                      labels={labels}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
