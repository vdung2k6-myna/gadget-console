import Link from "next/link";
import { notFound } from "next/navigation";

import { ProviderProfileForm } from "@/components/ProviderProfileForm";
import { requireUser } from "@/lib/auth/require-user";
import { findProviderProfile, publicProviderProfile } from "@/lib/provider-profiles";
import { getStrings } from "@/lib/i18n/locale";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

type Params = { params: Promise<{ id: string }> };

export default async function EditProviderProfilePage({ params }: Params) {
  const { id } = await params;
  const { strings } = await getStrings();
  const user = await requireUser();

  const row = await findProviderProfile(user.id, id);
  // A built-in is visible but not this account's to change, another account's
  // profile is not visible at all, and a speech profile is configured on the
  // settings page rather than here: all three answer as one that does not exist.
  if (row === undefined || row.builtin || row.userId !== user.id || row.kind !== "llm") notFound();
  const profile = publicProviderProfile(row);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <Link
        href="/provider-profiles"
        className="text-sm text-zinc-600 hover:underline dark:text-zinc-400"
      >
        ← {strings.common.back}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold">{profile.name}</h1>
      <ProviderProfileForm
        profile={{
          id: profile.id,
          kind: profile.kind,
          name: profile.name,
          baseUrl: profile.baseUrl,
          model: profile.model,
          voice: profile.voice,
          temperature: profile.temperature,
        }}
        fixedKind="llm"
      />
    </main>
  );
}
