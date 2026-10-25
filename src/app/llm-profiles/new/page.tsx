import Link from "next/link";
import { LlmProfileForm } from "@/components/LlmProfileForm";
import { requireUser } from "@/lib/auth/require-user";
import { getStrings } from "@/lib/i18n/locale";

export const instant = false;

export default async function NewLlmProfilePage() {
  const { strings } = await getStrings();
  await requireUser();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link href="/llm-profiles" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
        ← {strings.common.back}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{strings.llmProfiles.create}</h1>
      <LlmProfileForm />
    </main>
  );
}
