import Link from "next/link";
import { BinaryInspector } from "@/components/BinaryInspector";
import { requireAdmin } from "@/lib/auth/admin";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";

export const instant = false;

/**
 * A file someone wants to understand, read once and forgotten.
 *
 * Nothing here is stored: the page carries a form, the route parses the upload in
 * the request that delivered it, and the result dies with the response. The admin
 * gate is the same one the firmware surface uses, because a binary's strings can
 * name private endpoints.
 */
export default async function InspectBinaryPage() {
  const { locale } = await getStrings();
  const adminStrings = adminStringsFor(locale);
  await requireAdmin();

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{adminStrings.inspectHeading}</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/firmware" className="hover:underline">
            {adminStrings.firmware}
          </Link>
          <Link href="/admin/devices" className="hover:underline">
            {adminStrings.devices}
          </Link>
        </nav>
      </div>

      <BinaryInspector strings={adminStrings} />
    </main>
  );
}
