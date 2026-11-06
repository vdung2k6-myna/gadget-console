import Link from "next/link";
import { listAgents } from "@/lib/agents";
import { requireUser } from "@/lib/auth/require-user";
import { listOwnedDevices } from "@/lib/devices";
import { listProviderProfiles, publicProviderProfile } from "@/lib/provider-profiles";
import { PersonalityPreview } from "@/components/PersonalityPreview";
import { UseOnGadget } from "@/components/UseOnGadget";
import { deviceLabel } from "@/lib/ui/format";
import { getStrings } from "@/lib/i18n/locale";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

/** The prompt as a one-line summary a person can scan, not the whole instruction. */
function describe(prompt: string): string {
  const line = prompt.replace(/\s+/g, " ").trim();
  return line.length > 140 ? `${line.slice(0, 137).trimEnd()}…` : line;
}

export default async function AgentsPage() {
  const { strings } = await getStrings();
  const user = await requireUser();
  const agents = await listAgents(user.id);
  const devices = await listOwnedDevices(user.id);
  const voiceOf = new Map(
    (await listProviderProfiles(user.id))
      .map(publicProviderProfile)
      .filter((profile) => profile.kind === "tts")
      .map((profile) => [profile.id, profile.voice])
  );

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{strings.personality.heading}</h1>
        <Link
          href="/agents/new"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {strings.personality.create}
        </Link>
      </div>

      {agents.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{strings.personality.empty}</p>
      ) : (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {agents.map((agent) => {
            const voice =
              agent.voice !== null && agent.voice.trim() !== ""
                ? agent.voice
                : agent.ttsProfileId !== null
                  ? (voiceOf.get(agent.ttsProfileId) ?? null)
                  : null;
            const answered = devices
              .filter((device) => device.agentId === agent.id)
              .map((device) => ({ id: device.id, label: deviceLabel(device) }));
            return (
              <li key={agent.id} className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
                <Link href={`/agents/${agent.id}`} className="font-medium hover:underline">
                  {agent.name}
                </Link>
                <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                  {describe(agent.systemPrompt)}
                </p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <dt className="text-zinc-500 dark:text-zinc-400">{strings.personality.language}</dt>
                  <dd>{agent.language}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">{strings.personality.voice}</dt>
                  <dd>{voice ?? strings.personality.none}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">{strings.personality.answers}</dt>
                  <dd>
                    {answered.length === 0
                      ? strings.personality.answersNone
                      : answered.map((entry) => entry.label).join(", ")}
                  </dd>
                </dl>
                <PersonalityPreview
                  runtimeId={agent.runtimeId}
                  ttsProfileId={agent.ttsProfileId}
                  voice={agent.voice}
                  language={agent.language}
                  ovcConfig={agent.ovcConfig}
                />
                <UseOnGadget agentId={agent.id} devices={devices.map((device) => ({ id: device.id, label: deviceLabel(device) }))} />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
