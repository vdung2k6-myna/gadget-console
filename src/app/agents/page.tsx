import Link from "next/link";
import { listAgents } from "@/lib/agents";
import { requireUser } from "@/lib/auth/require-user";
import { listOwnedDevices } from "@/lib/devices";
import { listProviderProfiles, publicProviderProfile } from "@/lib/provider-profiles";
import { deviceLabel } from "@/lib/ui/format";
import { getStrings } from "@/lib/i18n/locale";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

export default async function AgentsPage() {
  const { strings } = await getStrings();
  const user = await requireUser();
  const agents = await listAgents(user.id);
  const devices = await listOwnedDevices(user.id);
  const profileNames = new Map(
    (await listProviderProfiles(user.id)).map(publicProviderProfile).map((profile) => [profile.id, profile.name])
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{strings.agents.heading}</h1>
        <Link href="/agents/new" className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
          {strings.agents.create}
        </Link>
      </div>

      {agents.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{strings.agents.empty}</p>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-2 pr-4 font-medium">{strings.agents.name}</th>
              <th className="py-2 pr-4 font-medium">{strings.agents.language}</th>
              <th className="py-2 pr-4 font-medium">{strings.agents.providers}</th>
              <th className="py-2 font-medium">{strings.agents.answers}</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => {
              const answered = devices.filter((device) => device.agentId === agent.id).map(deviceLabel);
              const named = [agent.llmProfileId, agent.sttProfileId, agent.ttsProfileId]
                .map((id) => (id === null ? null : profileNames.get(id) ?? null))
                .filter((name): name is string => name !== null);
              return (
                <tr key={agent.id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-4">
                    <Link href={`/agents/${agent.id}`} className="font-medium hover:underline">
                      {agent.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{agent.language}</td>
                  <td className="py-2 pr-4">
                    {named.length === 0 ? strings.agentForm.noModel : named.join(", ")}
                  </td>
                  <td className="py-2 text-zinc-600 dark:text-zinc-400">
                    {answered.length === 0 ? strings.agents.answersNone : answered.join(", ")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </main>
  );
}
