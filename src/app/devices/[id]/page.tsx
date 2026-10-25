import Link from "next/link";
import { notFound } from "next/navigation";
import { DeviceActions } from "@/components/DeviceActions";
import { listAgents } from "@/lib/agents";
import { requireUser } from "@/lib/auth/require-user";
import { ownDevice, ownTurns } from "@/lib/auth/ownership";
import { listOwnedDevices, publicDevice } from "@/lib/devices";
import { deviceLabel, elapsed, elapsedText, turnTimeText } from "@/lib/ui/format";
import { getStrings } from "@/lib/i18n/locale";
import { requestNow } from "@/lib/ui/now";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

type Params = { params: Promise<{ id: string }> };

/**
 * One device, what it is, and everything an owner can change about it.
 *
 * The device is read through `ownDevice`, which answers `undefined` for a row
 * that is another account's exactly as for one that does not exist — so this
 * page's not-found is the same page in both cases.
 */
export default async function DevicePage({ params }: Params) {
  const { id } = await params;
  const { locale, strings } = await getStrings();
  const now = await requestNow();
  const user = await requireUser();

  const row = await ownDevice(user.id, id);
  if (row === undefined) notFound();
  const device = publicDevice(row);

  const turns = (await ownTurns(user.id, id, 50)) ?? [];
  const agents = await listAgents(user.id);
  const others = (await listOwnedDevices(user.id)).filter((entry) => entry.id !== id);

  const agent = agents.find((entry) => entry.id === device.agentId);
  const partner = device.partnerDeviceId === null ? undefined : others.find((entry) => entry.id === device.partnerDeviceId);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link href="/devices" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
        ← {strings.common.back}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{deviceLabel(device)}</h1>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">{strings.device.identifier}</dt>
          <dd className="font-mono break-all">{device.deviceId}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">{strings.device.agent}</dt>
          <dd>{agent?.name ?? strings.device.none}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">{strings.device.partner}</dt>
          <dd>{partner === undefined ? strings.device.none : deviceLabel(partner)}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">{strings.device.lastSeen}</dt>
          <dd>{elapsedText(elapsed(device.lastSeenAt, now), strings, locale)}</dd>
        </div>
      </dl>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{strings.device.toolsHeading}</h2>
        {device.tools === null || device.tools === undefined ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{strings.device.toolsUnknown}</p>
        ) : device.tools.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{strings.device.toolsNone}</p>
        ) : (
          <>
            <ul className="mt-2 space-y-2 text-sm">
              {device.tools.map((tool) => (
                <li key={tool.name} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                  <p className="font-mono text-xs break-all">{tool.name}</p>
                  <p className="mt-1 text-zinc-600 dark:text-zinc-400">{tool.description}</p>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {strings.device.toolsReportedAt}: {elapsedText(elapsed(device.toolsReportedAt, now), strings, locale)}
            </p>
          </>
        )}
      </section>

      <DeviceActions
        deviceId={device.id}
        name={device.name}
        agentId={device.agentId}
        partnerDeviceId={device.partnerDeviceId}
        agents={agents.map((entry) => ({ id: entry.id, name: entry.name }))}
        others={others.map((entry) => ({ id: entry.id, label: deviceLabel(entry) }))}
      />

      <section className="mt-10">
        <h2 className="text-lg font-semibold">{strings.device.turnsHeading}</h2>
        {turns.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{strings.device.turnsEmpty}</p>
        ) : (
          <>
          {/* Cards on a phone: a transcript table is three wrapped columns in a
              space narrower than one sentence. */}
          <ul className="mt-3 space-y-3 sm:hidden">
            {turns.map((turn) => (
              <li key={turn.id} className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {turnTimeText(turn.startedAt, locale)}
                </p>
                <p className="mt-2">
                  <span className="text-zinc-500 dark:text-zinc-400">{strings.device.personSaid}: </span>
                  {turn.userText}
                </p>
                <p className="mt-1">
                  <span className="text-zinc-500 dark:text-zinc-400">{strings.device.gadgetSaid}: </span>
                  {turn.assistantText}
                </p>
              </li>
            ))}
          </ul>

          <table className="mt-3 hidden w-full border-collapse text-sm sm:table">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">{strings.device.personSaid}</th>
                <th className="py-2 pr-4 font-medium">{strings.device.gadgetSaid}</th>
                <th className="py-2 font-medium">{strings.device.time}</th>
              </tr>
            </thead>
            <tbody>
              {turns.map((turn) => (
                <tr key={turn.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                  <td className="py-2 pr-4">{turn.userText}</td>
                  <td className="py-2 pr-4">{turn.assistantText}</td>
                  <td className="py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                    {turnTimeText(turn.startedAt, locale)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </>
        )}
      </section>
    </main>
  );
}
