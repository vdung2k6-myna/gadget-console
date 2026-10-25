import { redirect } from "next/navigation";
import { SignInPanel } from "@/components/SignInPanel";
import { optionalUser } from "@/lib/auth/require-user";
import { getStrings } from "@/lib/i18n/locale";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

/**
 * The only public page: sign in, or make an account. A signed-in person never
 * sees it, because the only thing to do here is what they have already done.
 */
export default async function Home() {
  const { strings } = await getStrings();
  const user = await optionalUser();
  if (user !== undefined) redirect("/devices");

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12">
      <h1 className="text-2xl font-semibold">{strings.appName}</h1>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {strings.signIn.subtitle}
      </p>
      <div className="mt-8">
        <SignInPanel />
      </div>
    </main>
  );
}
