import Link from "next/link";
import { notFound } from "next/navigation";

import { TenantBuiltinForm } from "@/components/TenantBuiltinForm";
import { requireTenantAdmin } from "@/lib/auth/admin";
import { listTenantBuiltins } from "@/lib/provider-profiles";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";

export const instant = false;

function kindLabel(
  kind: string,
  strings: Awaited<ReturnType<typeof getStrings>>["strings"]
): string {
  if (kind === "llm") return strings.providerProfiles.kindLlm;
  if (kind === "stt") return strings.providerProfiles.kindStt;
  return strings.providerProfiles.kindTts;
}

export default async function AdminProviderBuiltinsPage() {
  const { locale, strings } = await getStrings();
  const adminStrings = adminStringsFor(locale);
  const admin = await requireTenantAdmin();
  if (admin.tenantId === null) notFound();

  const builtins = await listTenantBuiltins(admin.tenantId);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{strings.providerProfiles.builtinsHeading}</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/users" className="hover:underline">
            {adminStrings.users}
          </Link>
          <Link href="/admin/devices" className="hover:underline">
            {adminStrings.devices}
          </Link>
        </nav>
      </div>

      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
        {strings.providerProfiles.builtinsIntro}
      </p>

      {builtins.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          {strings.providerProfiles.empty}
        </p>
      ) : (
        <table className="mt-4 w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-2 pr-4 font-medium">{strings.providerProfiles.name}</th>
              <th className="py-2 pr-4 font-medium">{strings.providerProfiles.kind}</th>
              <th className="py-2 pr-4 font-medium">{strings.providerProfiles.model}</th>
              <th className="py-2 pr-4 font-medium">{strings.providerProfiles.voice}</th>
              <th className="py-2 font-medium">{strings.providerProfiles.defaultLabel}</th>
            </tr>
          </thead>
          <tbody>
            {builtins.map((row) => (
              <tr key={row.id} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-4 font-medium">{row.name}</td>
                <td className="py-2 pr-4">{kindLabel(row.kind, strings)}</td>
                <td className="py-2 pr-4">{row.model}</td>
                <td className="py-2 pr-4 font-mono text-xs">{row.voice ?? ""}</td>
                <td className="py-2">
                  {row.isDefault ? strings.providerProfiles.defaultLabel : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <TenantBuiltinForm />
    </main>
  );
}
