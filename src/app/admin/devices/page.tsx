import Link from "next/link";
import { listAllDevices } from "@/lib/admin";
import { listAgents } from "@/lib/agents";
import { requireAdmin } from "@/lib/auth/admin";
import { deviceLabel, elapsed, elapsedText } from "@/lib/ui/format";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { requestNow } from "@/lib/ui/now";

export const instant = false;

/** Every gadget on the deployment, with the account it belongs to. */
export default async function AdminDevicesPage() {
  const { locale, strings } = await getStrings();
  const now = await requestNow();
  const adminStrings = adminStringsFor(locale);
  const admin = await requireAdmin();
  const devices = await listAllDevices();

  // Agent names are per account, so the name shown is resolved from the owner's
  // own list rather than from a deployment-wide one.
  const owners = [...new Set(devices.map((device) => device.userId).filter((id): id is string => id !== null))];
  const agentNames = new Map<string, string>();
  for (const ownerId of owners) {
    for (const agent of await listAgents(ownerId)) agentNames.set(agent.id, agent.name);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{adminStrings.devices}</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/users" className="hover:underline">
            {adminStrings.users}
          </Link>
          <Link href="/admin/claims" className="hover:underline">
            {adminStrings.claims}
          </Link>
        </nav>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {adminStrings.heading}: {admin.email}
      </p>

      <ul className="mt-4 space-y-3 md:hidden">
        {devices.map((device) => (
          <li key={device.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <Link href={`/admin/devices/${device.id}`} className="font-medium hover:underline">
              {deviceLabel(device)}
            </Link>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-zinc-500 dark:text-zinc-400">{adminStrings.owner}</dt>
              <dd className="break-words">
                {device.ownerEmail === "" ? adminStrings.noOwner : device.ownerEmail}
              </dd>
              <dt className="text-zinc-500 dark:text-zinc-400">{strings.devices.agent}</dt>
              <dd>
                {device.agentId === null
                  ? strings.devices.noAgent
                  : (agentNames.get(device.agentId) ?? strings.devices.noAgent)}
              </dd>
              <dt className="text-zinc-500 dark:text-zinc-400">{strings.devices.lastSeen}</dt>
              <dd className="text-zinc-600 dark:text-zinc-400">
                {elapsedText(elapsed(device.lastSeenAt, now), strings, locale)}
              </dd>
              <dt className="text-zinc-500 dark:text-zinc-400">{adminStrings.tools}</dt>
              <dd className="text-zinc-600 dark:text-zinc-400">
                {device.tools === null || device.tools === undefined ? adminStrings.noTools : device.tools.length}
              </dd>
            </dl>
          </li>
        ))}
      </ul>

      <table className="mt-4 hidden w-full border-collapse text-sm md:table">
        <thead>
          <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
            <th className="py-2 pr-4 font-medium">{strings.devices.name}</th>
            <th className="py-2 pr-4 font-medium">{adminStrings.owner}</th>
            <th className="py-2 pr-4 font-medium">{strings.devices.agent}</th>
            <th className="py-2 pr-4 font-medium">{strings.devices.lastSeen}</th>
            <th className="py-2 font-medium">{adminStrings.tools}</th>
          </tr>
        </thead>
        <tbody>
          {devices.map((device) => (
            <tr key={device.id} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-2 pr-4">
                <Link href={`/admin/devices/${device.id}`} className="font-medium hover:underline">
                  {deviceLabel(device)}
                </Link>
              </td>
              <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                {device.ownerEmail === "" ? adminStrings.noOwner : device.ownerEmail}
              </td>
              <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                {device.agentId === null
                  ? strings.devices.noAgent
                  : (agentNames.get(device.agentId) ?? strings.devices.noAgent)}
              </td>
              <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                {elapsedText(elapsed(device.lastSeenAt, now), strings, locale)}
              </td>
              <td className="py-2 text-zinc-600 dark:text-zinc-400">
                {device.tools === null || device.tools === undefined ? adminStrings.noTools : device.tools.length}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
