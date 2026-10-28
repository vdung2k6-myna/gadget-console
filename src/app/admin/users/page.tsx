import Link from "next/link";
import { RoleControl } from "@/components/RoleControl";
import { requireAdmin } from "@/lib/auth/admin";
import { listAccounts } from "@/lib/users";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";

export const instant = false;

export default async function AdminUsersPage() {
  const { locale } = await getStrings();
  const adminStrings = adminStringsFor(locale);
  await requireAdmin();
  const accounts = await listAccounts();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{adminStrings.users}</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/devices" className="hover:underline">
            {adminStrings.devices}
          </Link>
          <Link href="/admin/claims" className="hover:underline">
            {adminStrings.claims}
          </Link>
          <Link href="/admin/firmware" className="hover:underline">
            {adminStrings.firmware}
          </Link>
        </nav>
      </div>

      <ul className="mt-4 space-y-3 md:hidden">
        {accounts.map((account) => (
          <li key={account.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="font-medium break-words">{account.email}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
              <dt className="text-zinc-500 dark:text-zinc-400">{adminStrings.role}</dt>
              <dd>{account.role}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">{adminStrings.deviceCount}</dt>
              <dd>{account.devices}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">{adminStrings.agentCount}</dt>
              <dd>{account.agents}</dd>
              <dt className="text-zinc-500 dark:text-zinc-400">{adminStrings.joined}</dt>
              <dd className="text-zinc-600 dark:text-zinc-400">{account.createdAt.toLocaleDateString()}</dd>
            </dl>
            <div className="mt-2">
              <RoleControl userId={account.id} email={account.email} role={account.role} locale={locale} />
            </div>
          </li>
        ))}
      </ul>

      <table className="mt-4 hidden w-full border-collapse text-sm md:table">
        <thead>
          <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
            <th className="py-2 pr-4 font-medium">Email</th>
            <th className="py-2 pr-4 font-medium">{adminStrings.role}</th>
            <th className="py-2 pr-4 font-medium">{adminStrings.deviceCount}</th>
            <th className="py-2 pr-4 font-medium">{adminStrings.agentCount}</th>
            <th className="py-2 pr-4 font-medium">{adminStrings.joined}</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-b border-zinc-100 dark:border-zinc-900">
              <td className="py-2 pr-4 font-medium">{account.email}</td>
              <td className="py-2 pr-4">{account.role}</td>
              <td className="py-2 pr-4">{account.devices}</td>
              <td className="py-2 pr-4">{account.agents}</td>
              <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                {account.createdAt.toLocaleDateString()}
              </td>
              <td className="py-2 text-right">
                <RoleControl userId={account.id} email={account.email} role={account.role} locale={locale} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
