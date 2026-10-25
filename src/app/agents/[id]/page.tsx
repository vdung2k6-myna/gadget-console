import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentForm } from "@/components/AgentForm";
import { requireUser } from "@/lib/auth/require-user";
import { ownAgent } from "@/lib/auth/ownership";
import { listOwnedDevices } from "@/lib/devices";
import { listProfiles } from "@/lib/llm-profiles";
import { listRuntimes } from "@/lib/runtimes";
import { deviceLabel } from "@/lib/ui/format";
import { getStrings } from "@/lib/i18n/locale";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

type Params = { params: Promise<{ id: string }> };

export default async function EditAgentPage({ params }: Params) {
  const { id } = await params;
  const { strings } = await getStrings();
  const user = await requireUser();

  const agent = await ownAgent(user.id, id);
  if (agent === undefined) notFound();

  const runtimes = await listRuntimes();
  const profiles = await listProfiles(user.id);
  const devices = (await listOwnedDevices(user.id)).filter((device) => device.agentId === agent.id);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link href="/agents" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
        ← {strings.common.back}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{agent.name}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {strings.agents.answers}:{" "}
        {devices.length === 0 ? strings.agents.answersNone : devices.map(deviceLabel).join(", ")}
      </p>

      <AgentForm
        runtimes={runtimes.map((runtime) => ({
          id: runtime.id,
          name: runtime.name,
          engines: runtime.engines,
          languages: runtime.languages,
        }))}
        profiles={profiles.map((profile) => ({ id: profile.id, name: profile.name }))}
        agent={{
          id: agent.id,
          name: agent.name,
          systemPrompt: agent.systemPrompt,
          language: agent.language,
          engine: agent.engine,
          runtimeId: agent.runtimeId,
          llmProfileId: agent.llmProfileId,
          answerMode: agent.answerMode,
          topics: agent.topics,
        }}
      />
    </main>
  );
}
