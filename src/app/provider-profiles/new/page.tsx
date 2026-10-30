import Link from "next/link";

import { ProviderProfileForm } from "@/components/ProviderProfileForm";
import { requireUser } from "@/lib/auth/require-user";
import { getStrings } from "@/lib/i18n/locale";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

export default async function NewProviderProfilePage() {
  const { strings } = await getStrings();
  await requireUser();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link
        href="/provider-profiles"
        className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
      >
        ← {strings.common.back}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{strings.providerProfiles.answeringModels}</h1>
      <ProviderProfileForm fixedKind="llm" />
    </main>
  );
}
