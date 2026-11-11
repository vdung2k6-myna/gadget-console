import Link from "next/link";
import { RoleControl } from "@/components/RoleControl";
import { requirePlatformSurface } from "@/lib/auth/admin";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import {
  groupPlatformAccounts,
  platformAccounts,
  type PlatformAccountGroup,
} from "@/lib/platform";
import type { UserRole } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n/locales";

export const instant = false;

export default async function PlatformUsersPage() {
  const { locale } = await getStrings();
  const adminStrings = adminStringsFor(locale);
  const labels = adminStrings.platform;
  const admin = await requirePlatformSurface();
  const groups = groupPlatformAccounts(await platformAccounts());

  function roleLabel(role: UserRole): string {
    if (role === "platform_admin") return adminStrings.rolePlatformAdmin;
    if (role === "tenant_admin") return adminStrings.roleTenantAdmin;
    if (role === "support") return adminStrings.roleSupport;
    return adminStrings.roleUser;
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{labels.users}</h1>
        <Link href="/admin/platform" className="text-sm hover:underline">
          {labels.tenants}
        </Link>
      </div>

      {groups.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">{labels.empty}</p>
      ) : (
        <div className="mt-6 space-y-8">
          {groups.map((group) => (
            <GroupSection
              key={group.tenantId ?? "platform"}
              group={group}
              labels={labels}
              roleLabel={roleLabel}
              actorRole={admin.role}
              locale={locale}
            />
          ))}
        </div>
      )}
    </main>
  );
}

function GroupSection({
  group,
  labels,
  roleLabel,
  actorRole,
  locale,
}: {
  group: PlatformAccountGroup;
  labels: ReturnType<typeof adminStringsFor>["platform"];
  roleLabel: (role: UserRole) => string;
  actorRole: string;
  locale: Locale;
}) {
  const heading = group.tenantName ?? labels.platformAdmins;

  return (
    <section>
      <h2 className="text-sm font-semibold">{heading}</h2>

      <ul className="mt-2 space-y-2 md:hidden">
        {group.accounts.map((account) => (
          <li
            key={account.id}
            className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800"
          >
            <p className="font-medium break-words">{account.email}</p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {roleLabel(account.role)} · {account.devices} {labels.deviceCount.toLowerCase()}
            </p>
            <div className="mt-2">
              <RoleControl
                userId={account.id}
                email={account.email}
                role={account.role}
                actorRole={actorRole}
                locale={locale}
              />
            </div>
          </li>
        ))}
      </ul>

      <table className="mt-2 hidden w-full border-collapse text-sm md:table">
        <thead>
          <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
            <th className="py-2 pr-4 font-medium">Email</th>
            <th className="py-2 pr-4 font-medium">{labels.role}</th>
            <th className="py-2 pr-4 font-medium">{labels.deviceCount}</th>
            <th className="py-2 pr-4 font-medium">{labels.tenant}</th>
            <th className="py-2 font-medium" />
          </tr>
        </thead>
        <tbody>
          {group.accounts.map((account) => (
            <tr
              key={account.id}
              className="border-b border-zinc-100 dark:border-zinc-900"
            >
              <td className="py-2 pr-4 font-medium break-words">{account.email}</td>
              <td className="py-2 pr-4">{roleLabel(account.role)}</td>
              <td className="py-2 pr-4">{account.devices}</td>
              <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">{heading}</td>
              <td className="py-2 text-right">
                <RoleControl
                  userId={account.id}
                  email={account.email}
                  role={account.role}
                  actorRole={actorRole}
                  locale={locale}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
