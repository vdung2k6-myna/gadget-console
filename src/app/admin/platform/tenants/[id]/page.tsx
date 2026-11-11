import Link from "next/link";
import { notFound } from "next/navigation";

import { listAllDevices } from "@/lib/admin";
import { requirePlatformSurface } from "@/lib/auth/admin";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { findTenant } from "@/lib/tenants";
import { listTenantDomains } from "@/lib/tenancy/domains";

export const instant = false;

type Params = { params: Promise<{ id: string }> };

/**
 * One tenant's metadata and devices. No conversation text: a platform admin
 * reaches that only through the audited support action on a device.
 */
export default async function PlatformTenantPage({ params }: Params) {
  await requirePlatformSurface();
  const { id } = await params;
  const tenant = await findTenant(id);
  if (tenant === undefined) notFound();

  const { locale } = await getStrings();
  const adminStrings = adminStringsFor(locale);
  const labels = adminStrings.platform;

  const [devices, domains] = await Promise.all([
    listAllDevices(tenant.id),
    listTenantDomains(tenant.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Link href="/admin/platform" className="text-sm hover:underline">
        ← {labels.tenants}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{tenant.name}</h1>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">{tenant.slug}</p>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">{labels.status}</dt>
          <dd>{tenant.status === "active" ? labels.active : labels.suspended}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">{labels.plan}</dt>
          <dd>{tenant.plan ?? labels.none}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">{labels.domains}</dt>
          <dd>
            {domains.length === 0
              ? labels.none
              : domains.map((domain) => `${domain.kind}: ${domain.domain}`).join(", ")}
          </dd>
        </div>
      </dl>

      <h2 className="mt-8 text-lg font-semibold">{adminStrings.devices}</h2>
      {devices.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{labels.empty}</p>
      ) : (
        <table className="mt-2 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-2 pr-4 font-medium">{labels.deviceCount}</th>
              <th className="py-2 pr-4 font-medium">{adminStrings.owner}</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-4">
                  <p className="font-medium">{device.name !== "" ? device.name : device.deviceId}</p>
                  <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
                    {device.deviceId}
                  </p>
                </td>
                <td className="py-2 pr-4 break-words">
                  {device.ownerEmail === "" ? adminStrings.noOwner : device.ownerEmail}
                </td>
                <td className="py-2 text-right">
                  <Link
                    href={`/admin/support/${device.id}`}
                    className="text-sm hover:underline"
                  >
                    {adminStrings.supportAccess.open}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
