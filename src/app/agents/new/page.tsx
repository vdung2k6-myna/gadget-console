import Link from "next/link";
import { NewPersonality } from "@/components/NewPersonality";
import { requireUser } from "@/lib/auth/require-user";
import {
  defaultProviderProfile,
  listProviderProfiles,
  publicProviderProfile,
} from "@/lib/provider-profiles";
import { listAgents } from "@/lib/agents";
import { listOwnedDevices } from "@/lib/devices";
import { listRuntimes } from "@/lib/runtimes";
import { deviceLabel } from "@/lib/ui/format";
import { getStrings } from "@/lib/i18n/locale";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ gadget?: string }>;
}) {
  const { gadget } = await searchParams;
  const { strings } = await getStrings();
  const user = await requireUser();
  const runtimes = await listRuntimes();
  const profiles = (await listProviderProfiles(user.id)).map(publicProviderProfile);
  const devices = await listOwnedDevices(user.id);
  const agents = await listAgents(user.id);
  const agentById = new Map(agents.map((entry) => [entry.id, entry]));
  const gadgets = devices.map((device) => {
    const active = device.agentId === null ? undefined : agentById.get(device.agentId);
    return {
      id: device.id,
      label: deviceLabel(device),
      agentId: device.agentId,
      agent:
        active === undefined
          ? null
          : {
              id: active.id,
              name: active.name,
              llmProfileId: active.llmProfileId,
              sttProfileId: active.sttProfileId,
              ttsProfileId: active.ttsProfileId,
              voice: active.voice,
              ovcConfig: active.ovcConfig,
              systemPrompt: active.systemPrompt,
              language: active.language,
              runtimeId: active.runtimeId,
              answerMode: active.answerMode,
              topics: active.topics,
            },
    };
  });
  const isAdmin = user.role === "admin";

  // The simple form answers on the deployment's built-in defaults. An
  // administrator, who may name an account profile, falls back to the first
  // profile of a kind when the deployment marks no default.
  const fallback = (kind: "llm" | "stt" | "tts") =>
    isAdmin ? (profiles.find((profile) => profile.kind === kind)?.id ?? null) : null;
  const defaults = {
    llm: (await defaultProviderProfile("llm"))?.id ?? fallback("llm"),
    stt: (await defaultProviderProfile("stt"))?.id ?? fallback("stt"),
    tts: (await defaultProviderProfile("tts"))?.id ?? fallback("tts"),
  };

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link href="/agents" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
        ← {strings.common.back}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{strings.personality.setupTitle}</h1>
      <NewPersonality
        runtimes={runtimes.map((runtime) => ({
          id: runtime.id,
          name: runtime.name,
          languages: runtime.languages,
        }))}
        profiles={profiles.map((profile) => ({
          id: profile.id,
          kind: profile.kind,
          name: profile.name,
          builtin: profile.builtin,
        }))}
        defaults={defaults}
        gadgets={gadgets}
        initialGadgetId={typeof gadget === "string" ? gadget : undefined}
        isAdmin={isAdmin}
      />
    </main>
  );
}
