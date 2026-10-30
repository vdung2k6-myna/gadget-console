import Link from "next/link";

import { DeleteProviderProfileButton } from "@/components/DeleteProviderProfileButton";
import { SpeechSettingsForm } from "@/components/SpeechSettingsForm";
import { requireUser } from "@/lib/auth/require-user";
import {
  accountSpeechSettings,
  listProviderProfiles,
  publicProviderProfile,
} from "@/lib/provider-profiles";
import { getStrings } from "@/lib/i18n/locale";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

export default async function ProviderSettingsPage() {
  const { strings } = await getStrings();
  const user = await requireUser();
  const settings = await accountSpeechSettings(user.id);
  const models = (await listProviderProfiles(user.id))
    .filter((profile) => profile.kind === "llm")
    .map(publicProviderProfile);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{strings.providerProfiles.heading}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {strings.providerProfiles.settingsIntro}
      </p>

      <SpeechSettingsForm kind="stt" own={settings.stt} />
      <SpeechSettingsForm kind="tts" own={settings.tts} />

      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{strings.providerProfiles.answeringModels}</h2>
          <Link
            href="/provider-profiles/new"
            className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900"
          >
            {strings.providerProfiles.createModel}
          </Link>
        </div>

        {models.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
            {strings.providerProfiles.noAnsweringModel}
          </p>
        ) : (
          <table className="mt-3 w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">{strings.providerProfiles.name}</th>
                <th className="py-2 pr-4 font-medium">{strings.providerProfiles.model}</th>
                <th className="py-2 pr-4 font-medium">{strings.providerProfiles.baseUrl}</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {models.map((profile) => (
                <tr key={profile.id} className="border-b border-zinc-100 dark:border-zinc-900">
                  <td className="py-2 pr-4">
                    {profile.builtin ? (
                      <span className="font-medium">{profile.name}</span>
                    ) : (
                      <Link
                        href={`/provider-profiles/${profile.id}`}
                        className="font-medium hover:underline"
                      >
                        {profile.name}
                      </Link>
                    )}
                  </td>
                  <td className="py-2 pr-4">{profile.model}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{profile.baseUrl}</td>
                  <td className="py-2 text-right">
                    {!profile.builtin && <DeleteProviderProfileButton id={profile.id} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
