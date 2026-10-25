import Link from "next/link";
import { ClaimForm } from "@/components/ClaimForm";
import { listAgents } from "@/lib/agents";
import { pendingRequestsFor } from "@/lib/claims";
import { requireUser } from "@/lib/auth/require-user";
import { listOwnedDevices } from "@/lib/devices";
import { deviceLabel, elapsed, elapsedText } from "@/lib/ui/format";
import { getStrings } from "@/lib/i18n/locale";
import { requestNow } from "@/lib/ui/now";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

export default async function DevicesPage() {
  const { locale, strings } = await getStrings();
  const now = await requestNow();
  const user = await requireUser();
  const devices = await listOwnedDevices(user.id);
  const waiting = await pendingRequestsFor(user.id);
  const agents = await listAgents(user.id);
  const agentName = new Map(agents.map((agent) => [agent.id, agent.name]));
  const unbound = devices.filter((device) => device.agentId === null);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{strings.devices.heading}</h1>

      {devices.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{strings.devices.empty}</p>
      ) : (
        <>
        {/* A phone gets cards; a table is a wide thing that has to be scrolled
            sideways, and a device row has three facts, not thirty. */}
        <ul className="mt-4 space-y-3 sm:hidden">
          {devices.map((device) => (
            <li key={device.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
              <Link href={`/devices/${device.id}`} className="font-medium hover:underline">
                {deviceLabel(device)}
              </Link>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                <dt className="text-zinc-500 dark:text-zinc-400">{strings.devices.agent}</dt>
                <dd>
                  {device.agentId === null
                    ? strings.devices.noAgent
                    : (agentName.get(device.agentId) ?? strings.devices.noAgent)}
                </dd>
                <dt className="text-zinc-500 dark:text-zinc-400">{strings.devices.lastSeen}</dt>
                <dd className="text-zinc-600 dark:text-zinc-400">
                  {elapsedText(elapsed(device.lastSeenAt, now), strings, locale)}
                </dd>
              </dl>
            </li>
          ))}
        </ul>

        <table className="mt-4 hidden w-full border-collapse text-sm sm:table">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-2 pr-4 font-medium">{strings.devices.name}</th>
              <th className="py-2 pr-4 font-medium">{strings.devices.agent}</th>
              <th className="py-2 font-medium">{strings.devices.lastSeen}</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-4">
                  <Link href={`/devices/${device.id}`} className="font-medium hover:underline">
                    {deviceLabel(device)}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                  {device.agentId === null ? strings.devices.noAgent : (agentName.get(device.agentId) ?? strings.devices.noAgent)}
                </td>
                <td className="py-2 text-zinc-600 dark:text-zinc-400">{elapsedText(elapsed(device.lastSeenAt, now), strings, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </>
      )}

      {unbound.length > 0 && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {strings.devices.noAgentWarning}{" "}
          <Link href="/agents/new" className="underline">
            {strings.agents.create}
          </Link>
        </p>
      )}

      {waiting.length > 0 && (
        <section className="mt-6 rounded border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {strings.devices.pendingHeading}
          </h2>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-100">{strings.devices.pendingBody}</p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-amber-900 dark:text-amber-100">
            {waiting.map((request) => (
              <li key={request.claimId}>{request.deviceId}</li>
            ))}
          </ul>
        </section>
      )}

      <ClaimForm />
    </main>
  );
}
