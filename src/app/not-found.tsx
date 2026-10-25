import Link from "next/link";
import { getStrings } from "@/lib/i18n/locale";

// Every screen reads the session and the database per request; there is nothing
// to prerender, and blocking is what an authenticated page does.
export const instant = false;

export default async function NotFound() {
  const { strings } = await getStrings();
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-semibold">{strings.common.notFound}</h1>
      <Link href="/devices" className="mt-4 inline-block text-sm underline">
        {strings.nav.devices}
      </Link>
    </main>
  );
}
