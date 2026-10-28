import Link from "next/link";
import { notFound } from "next/navigation";
import { DeviceActions } from "@/components/DeviceActions";
import { adminDevice, adminTurns, listAllDevices } from "@/lib/admin";
import { listAgents } from "@/lib/agents";
import { requireAdmin } from "@/lib/auth/admin";
import { boardView, firmwareView } from "@/lib/device-board";
import { targetFor } from "@/lib/firmware";
import { deviceLabel, elapsed, elapsedText, turnTimeText } from "@/lib/ui/format";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { requestNow } from "@/lib/ui/now";

export const instant = false;

type Params = { params: Promise<{ id: string }> };

/**
 * Any account's gadget, as its owner sees it — and labelled as somebody else's,
 * because the conversation below is another person's speech and that should not
 * be something a page forgets to say.
 */
export default async function AdminDevicePage({ params }: Params) {
  const { id } = await params;
  const { locale, strings } = await getStrings();
  const now = await requestNow();
  const adminStrings = adminStringsFor(locale);
  await requireAdmin();

  const device = await adminDevice(id);
  if (device === undefined) notFound();

  const ownerId = device.userId;
  const ownerAgents = ownerId === null ? [] : await listAgents(ownerId);
  const ownerDevices = (await listAllDevices()).filter(
    (entry) => entry.userId === ownerId && entry.id !== device.id
  );
  const agent = ownerAgents.find((entry) => entry.id === device.agentId);
  const partner = ownerDevices.find((entry) => entry.id === device.partnerDeviceId);
  const turns = await adminTurns(device.id, 50);
  const board = boardView(device.hardware, strings);
  const target =
    device.hardware?.board?.type === undefined ? undefined : await targetFor(device.hardware.board.type);
  const firmware = firmwareView(device.hardware, target?.version);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link href="/admin/devices" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
        ← {adminStrings.devices}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{deviceLabel(device)}</h1>
      <p className="mt-1 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
        {adminStrings.viewing} {device.ownerEmail === "" ? adminStrings.noOwner : device.ownerEmail}
      </p>

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
        <h2 className="text-lg font-semibold">{strings.device.boardHeading}</h2>
        {board.kind === "not-reported" ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            {strings.device.boardNotReported}
          </p>
        ) : (
          <>
            <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              {board.facts.map((fact) => (
                <div key={fact.key}>
                  <dt className="text-zinc-500 dark:text-zinc-400">{fact.label}</dt>
                  <dd>{fact.value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
              {strings.device.boardReportedAt}:{" "}
              {elapsedText(elapsed(device.hardwareReportedAt, now), strings, locale)} ·{" "}
              {strings.device.boardReportedBy}
            </p>
            {firmware.different && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {strings.device.firmwareTarget}:{" "}
                <span className="font-mono">{firmware.target}</span>
              </p>
            )}
          </>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold">{strings.device.toolsHeading}</h2>
        {device.tools === null || device.tools === undefined ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{strings.device.toolsUnknown}</p>
        ) : device.tools.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{strings.device.toolsNone}</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {device.tools.map((tool) => (
              <li key={tool.name} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                <p className="font-mono text-xs break-all">{tool.name}</p>
                <p className="mt-1 text-zinc-600 dark:text-zinc-400">{tool.description}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <DeviceActions
        deviceId={device.id}
        name={device.name}
        agentId={device.agentId}
        partnerDeviceId={device.partnerDeviceId}
        agents={ownerAgents.map((entry) => ({ id: entry.id, name: entry.name }))}
        others={ownerDevices.map((entry) => ({ id: entry.id, label: deviceLabel(entry) }))}
        endpoint={`/api/admin/devices/${device.id}`}
        redirectTo="/admin/devices"
        releaseConfirm={adminStrings.releaseConfirm.replace(
          "{owner}",
          device.ownerEmail === "" ? adminStrings.noOwner : device.ownerEmail
        )}
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
