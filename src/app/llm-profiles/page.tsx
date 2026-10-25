import Link from "next/link";
import { DeleteProfileButton } from "@/components/DeleteProfileButton";
import { requireUser } from "@/lib/auth/require-user";
import { publicProfile } from "@/lib/crypto/profiles";
import { agentsUsing, listProfiles } from "@/lib/llm-profiles";
import { getStrings } from "@/lib/i18n/locale";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

export default async function LlmProfilesPage() {
  const { strings } = await getStrings();
  const user = await requireUser();
  const profiles = await listProfiles(user.id);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{strings.llmProfiles.heading}</h1>
        <Link
          href="/llm-profiles/new"
          className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
        >
          {strings.llmProfiles.create}
        </Link>
      </div>

      {profiles.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{strings.llmProfiles.empty}</p>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-2 pr-4 font-medium">{strings.llmProfiles.name}</th>
              <th className="py-2 pr-4 font-medium">{strings.llmProfiles.model}</th>
              <th className="py-2 pr-4 font-medium">{strings.llmProfiles.baseUrl}</th>
              <th className="py-2 pr-4 font-medium">{strings.llmProfiles.usedBy}</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {await Promise.all(
              profiles.map(async (row) => {
                const profile = publicProfile(row);
                const used = await agentsUsing(user.id, profile.id);
                return (
                  <tr key={profile.id} className="border-b border-zinc-100 dark:border-zinc-900">
                    <td className="py-2 pr-4">
                      <Link href={`/llm-profiles/${profile.id}`} className="font-medium hover:underline">
                        {profile.name}
                      </Link>
                    </td>
                    <td className="py-2 pr-4">{profile.model}</td>
                    <td className="py-2 pr-4 font-mono text-xs">{profile.baseUrl}</td>
                    <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                      {used === 0 ? strings.llmProfiles.usedByNone : `${used} agent`}
                    </td>
                    <td className="py-2 text-right">
                      <DeleteProfileButton id={profile.id} />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      )}
    </main>
  );
}
