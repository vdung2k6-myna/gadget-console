import Link from "next/link";

import { requireTenantAdminSurface } from "@/lib/auth/admin";
import { listTenantAudit } from "@/lib/audit";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { turnTimeText } from "@/lib/ui/format";

export const instant = false;

/** The tenant's view of platform support access and other recorded actions. */
export default async function AuditPage() {
  const { locale } = await getStrings();
  const labels = adminStringsFor(locale).audit;
  const { tenantId } = await requireTenantAdminSurface();
  const events = await listTenantAudit(tenantId, { actionPrefix: "support." });

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{labels.heading}</h1>
        <Link href="/admin/devices" className="text-sm hover:underline">
          ←
        </Link>
      </div>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{labels.intro}</p>

      {events.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{labels.empty}</p>
      ) : (
        <>
          <ul className="mt-4 space-y-3 md:hidden">
            {events.map((event) => (
              <li
                key={event.id}
                className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800"
              >
                <p className="font-medium break-words">{event.actorEmail}</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {turnTimeText(event.at, locale)}
                </p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-zinc-500 dark:text-zinc-400">{labels.action}</dt>
                  <dd>{event.action}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">{labels.target}</dt>
                  <dd className="font-mono text-xs break-all">
                    {deviceIdOf(event.metadata) ?? event.targetId}
                  </dd>
                </dl>
              </li>
            ))}
          </ul>

          <table className="mt-4 hidden w-full border-collapse text-sm md:table">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">{labels.time}</th>
                <th className="py-2 pr-4 font-medium">{labels.actor}</th>
                <th className="py-2 pr-4 font-medium">{labels.action}</th>
                <th className="py-2 font-medium">{labels.target}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                    {turnTimeText(event.at, locale)}
                  </td>
                  <td className="py-2 pr-4 break-words">{event.actorEmail}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{event.action}</td>
                  <td className="py-2 font-mono text-xs break-all">
                    {deviceIdOf(event.metadata) ?? event.targetId}
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

function deviceIdOf(metadata: Record<string, unknown> | null): string | undefined {
  const value = metadata?.deviceId;
  return typeof value === "string" ? value : undefined;
}
