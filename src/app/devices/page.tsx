import Link from "next/link";
import { ClaimForm } from "@/components/ClaimForm";
import { DevicePersonality } from "@/components/DevicePersonality";
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

/**
 * The owner's home: one next step, then their gadgets.
 *
 * A gadget is the unit a person thinks in, so each is a card with its one
 * active personality and the switch for it. The claim is the page's primary
 * action when there is nothing to show, not a form below a table.
 */
export default async function DevicesPage() {
  const { locale, strings } = await getStrings();
  const now = await requestNow();
  const user = await requireUser();
  const devices = await listOwnedDevices(user.id);
  const waiting = await pendingRequestsFor(user.id);
  const agents = await listAgents(user.id);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{strings.home.heading}</h1>

      {devices.length === 0 && waiting.length === 0 && (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{strings.home.claimSteps}</p>
      )}

      {waiting.length > 0 && (
        <section className="mt-4 rounded border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-100">
            {strings.devices.pendingHeading}
          </h2>
          <p className="mt-1 text-sm text-amber-900 dark:text-amber-100">{strings.home.waiting}</p>
          <ul className="mt-2 space-y-1 font-mono text-xs text-amber-900 dark:text-amber-100">
            {waiting.map((request) => (
              <li key={request.claimId}>{request.deviceId}</li>
            ))}
          </ul>
        </section>
      )}

      {devices.length > 0 && (
        <ul className="mt-4 space-y-3">
          {devices.map((device) => {
            const agent =
              device.agentId === null
                ? undefined
                : agents.find((entry) => entry.id === device.agentId);
            return (
              <li key={device.id} className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <Link href={`/devices/${device.id}`} className="font-medium hover:underline">
                    {deviceLabel(device)}
                  </Link>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {strings.home.lastSeen}:{" "}
                    {elapsedText(elapsed(device.lastSeenAt, now), strings, locale)}
                  </span>
                </div>
                {agent === undefined ? (
                  <p className="mt-2 text-sm text-amber-800 dark:text-amber-200">
                    {strings.home.noPersonality}{" "}
                    <Link href="/agents" className="underline">
                      {strings.home.nextPersonality}
                    </Link>
                  </p>
                ) : (
                  <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                    {strings.personality.active}:{" "}
                    <Link href={`/agents/${agent.id}`} className="underline">
                      {agent.name}
                    </Link>{" "}
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {agent.language} · {agent.voice ?? strings.personality.none}
                    </span>
                  </p>
                )}
                <DevicePersonality
                  deviceId={device.id}
                  agentId={device.agentId}
                  agents={agents.map((entry) => ({ id: entry.id, name: entry.name }))}
                />
              </li>
            );
          })}
        </ul>
      )}

      <ClaimForm />
    </main>
  );
}
