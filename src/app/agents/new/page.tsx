import Link from "next/link";
import { AgentForm } from "@/components/AgentForm";
import { requireUser } from "@/lib/auth/require-user";
import { listProviderProfiles, publicProviderProfile } from "@/lib/provider-profiles";
import { listRuntimes } from "@/lib/runtimes";
import { getStrings } from "@/lib/i18n/locale";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

export default async function NewAgentPage() {
  const { strings } = await getStrings();
  const user = await requireUser();
  const runtimes = await listRuntimes();
  const profiles = (await listProviderProfiles(user.id)).map(publicProviderProfile);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link href="/agents" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
        ← {strings.common.back}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{strings.agents.create}</h1>
      <AgentForm
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
      />
    </main>
  );
}
