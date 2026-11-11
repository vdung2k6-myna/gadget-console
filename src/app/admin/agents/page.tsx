import Link from "next/link";

import { requireTenantAdminSurface } from "@/lib/auth/admin";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { listAgents as listTenantAgents } from "@/lib/tenancy/repository";
import { listAccounts } from "@/lib/users";

export const instant = false;

/** Every personality in this tenant, with the account that owns it. */
export default async function AdminAgentsPage() {
  const { locale, strings } = await getStrings();
  const adminStrings = adminStringsFor(locale);
  const { tenantId } = await requireTenantAdminSurface();

  const [agents, accounts] = await Promise.all([
    listTenantAgents({ tenantId }),
    listAccounts(tenantId),
  ]);
  const owners = new Map(accounts.map((account) => [account.id, account.email]));

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{strings.nav.agents}</h1>
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/admin/devices" className="hover:underline">
            {adminStrings.devices}
          </Link>
          <Link href="/admin/users" className="hover:underline">
            {adminStrings.users}
          </Link>
          <Link href="/admin/claims" className="hover:underline">
            {adminStrings.claims}
          </Link>
          <Link href="/admin/firmware" className="hover:underline">
            {adminStrings.firmware}
          </Link>
          <Link href="/admin/provider-profiles" className="hover:underline">
            {adminStrings.providers}
          </Link>
        </nav>
      </div>

      {agents.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          {strings.agents.empty}
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-3 md:hidden">
            {agents.map((agent) => (
              <li
                key={agent.id}
                className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <p className="font-medium">{agent.name}</p>
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-zinc-500 dark:text-zinc-400">{adminStrings.owner}</dt>
                  <dd className="break-words">
                    {owners.get(agent.userId) ?? adminStrings.noOwner}
                  </dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">{strings.agents.language}</dt>
                  <dd>{agent.language}</dd>
                  <dt className="text-zinc-500 dark:text-zinc-400">
                    {strings.providerProfiles.voice}
                  </dt>
                  <dd>{agent.voice ?? strings.device.none}</dd>
                </dl>
              </li>
            ))}
          </ul>

          <table className="mt-4 hidden w-full border-collapse text-sm md:table">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">{strings.agents.name}</th>
                <th className="py-2 pr-4 font-medium">{adminStrings.owner}</th>
                <th className="py-2 pr-4 font-medium">{strings.agents.language}</th>
                <th className="py-2 pr-4 font-medium">{strings.providerProfiles.voice}</th>
                <th className="py-2 font-medium">{strings.devices.agent}</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => (
                <tr
                  key={agent.id}
                  className="border-b border-zinc-100 dark:border-zinc-900"
                >
                  <td className="py-2 pr-4 font-medium">{agent.name}</td>
                  <td className="py-2 pr-4 break-words">
                    {owners.get(agent.userId) ?? adminStrings.noOwner}
                  </td>
                  <td className="py-2 pr-4">{agent.language}</td>
                  <td className="py-2 pr-4">{agent.voice ?? strings.device.none}</td>
                  <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                    {agent.answerMode}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
