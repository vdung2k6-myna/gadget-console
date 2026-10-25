import Link from "next/link";
import { notFound } from "next/navigation";
import { LlmProfileForm } from "@/components/LlmProfileForm";
import { requireUser } from "@/lib/auth/require-user";
import { findProfile, publicProfile } from "@/lib/crypto/profiles";
import { agentsUsing } from "@/lib/llm-profiles";
import { getStrings } from "@/lib/i18n/locale";

export const instant = false;

type Params = { params: Promise<{ id: string }> };

export default async function EditLlmProfilePage({ params }: Params) {
  const { id } = await params;
  const { strings } = await getStrings();
  const user = await requireUser();

  const row = await findProfile(user.id, id);
  if (row === undefined) notFound();
  const profile = publicProfile(row);
  const used = await agentsUsing(user.id, id);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link href="/llm-profiles" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
        ← {strings.common.back}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{profile.name}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {strings.llmProfiles.usedBy}: {used === 0 ? strings.llmProfiles.usedByNone : `${used} agent`}
      </p>

      <LlmProfileForm
        profile={{
          id: profile.id,
          name: profile.name,
          baseUrl: profile.baseUrl,
          model: profile.model,
          temperature: profile.temperature,
        }}
      />
    </main>
  );
}
