import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SupportAccessForm } from "@/components/SupportAccessForm";
import { currentSupport } from "@/lib/auth/admin";
import { isPlatformAdmin } from "@/lib/auth/roles";
import { getDb } from "@/lib/db/client";
import { tenants, users } from "@/lib/db/schema";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { listTurns } from "@/lib/tenancy/repository";
import {
  findSupportDevice,
  supportAccessGrant,
} from "@/lib/support-access";
import { turnTimeText } from "@/lib/ui/format";

export const instant = false;

type Params = {
  params: Promise<{ deviceId: string }>;
  searchParams: Promise<{ access?: string }>;
};

/**
 * One tenant device, seen through support.
 *
 * The page shows metadata and the support action first. Conversation text is
 * read only when the URL carries a grant the audit created for this actor and
 * this device and the grant has not expired.
 */
export default async function SupportDevicePage({ params, searchParams }: Params) {
  const user = await currentSupport();
  if (user === undefined) notFound();

  const { deviceId } = await params;
  const device = await findSupportDevice(user, deviceId);
  if (device === undefined) notFound();

  const { locale, strings } = await getStrings();
  const labels = adminStringsFor(locale).supportAccess;

  const [tenant] = device.tenantId === null
    ? []
    : await getDb()
        .select({ name: tenants.name })
        .from(tenants)
        .where(eq(tenants.id, device.tenantId))
        .limit(1);
  const [owner] = device.userId === null
    ? []
    : await getDb()
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, device.userId))
        .limit(1);

  const requested = (await searchParams).access;
  const grant =
    requested === undefined
      ? undefined
      : await supportAccessGrant({
          accessId: requested,
          actorEmail: user.email,
          device,
        });
  const turns =
    grant === undefined
      ? []
      : (await listTurns({ tenantId: device.tenantId! }, device.id)).slice(0, 50);

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-semibold">{labels.heading}</h1>

      <dl className="mt-4 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">{labels.device}</dt>
          <dd className="font-mono break-all">{device.deviceId}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">{labels.tenant}</dt>
          <dd>{tenant?.name ?? adminStringsFor(locale).noOwner}</dd>
        </div>
        <div>
          <dt className="text-zinc-500 dark:text-zinc-400">{labels.owner}</dt>
          <dd className="break-words">{owner?.email ?? adminStringsFor(locale).noOwner}</dd>
        </div>
        {device.name !== "" && (
          <div>
            <dt className="text-zinc-500 dark:text-zinc-400">{strings.devices.name}</dt>
            <dd>{device.name}</dd>
          </div>
        )}
      </dl>

      {grant === undefined ? (
        <>
          <p className="mt-6 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
            {labels.intro}
          </p>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{labels.metadataOnly}</p>
          <SupportAccessForm deviceId={device.id} labels={labels} />
        </>
      ) : (
        <section className="mt-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-semibold">{labels.conversation}</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {labels.expires}: {grant.toLocaleString(locale === "vi" ? "vi-VN" : "en-GB")}
            </p>
          </div>

          {turns.length === 0 ? (
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">{labels.turnsEmpty}</p>
          ) : (
            <>
              <ul className="mt-3 space-y-3 sm:hidden">
                {turns.map((turn) => (
                  <li
                    key={turn.id}
                    className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800"
                  >
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      {turnTimeText(turn.startedAt, locale)}
                    </p>
                    <p className="mt-2">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {strings.device.personSaid}:{" "}
                      </span>
                      {turn.userText}
                    </p>
                    <p className="mt-1">
                      <span className="text-zinc-500 dark:text-zinc-400">
                        {strings.device.gadgetSaid}:{" "}
                      </span>
                      {turn.assistantText}
                    </p>
                  </li>
                ))}
              </ul>

              <table className="mt-3 hidden w-full border-collapse text-sm sm:table">
                <thead>
                  <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                    <th className="py-2 pr-4 font-medium">{strings.device.personSaid}</th>
                    <th className="py-2 pr-4 font-medium">{strings.device.gadgetSaid}</th>
                    <th className="py-2 font-medium">{strings.device.time}</th>
                  </tr>
                </thead>
                <tbody>
                  {turns.map((turn) => (
                    <tr
                      key={turn.id}
                      className="border-b border-zinc-100 align-top dark:border-zinc-900"
                    >
                      <td className="py-2 pr-4">{turn.userText}</td>
                      <td className="py-2 pr-4">{turn.assistantText}</td>
                      <td className="py-2 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                        {turnTimeText(turn.startedAt, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      <p className="mt-8 text-sm">
        <Link
          href={isPlatformAdmin(user.role) ? "/admin/platform" : "/admin/devices"}
          className="hover:underline"
        >
          ←
        </Link>
      </p>
    </main>
  );
}
