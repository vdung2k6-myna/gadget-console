import Link from "next/link";
import { ClaimDecision } from "@/components/ClaimDecision";
import { requireAdmin } from "@/lib/auth/admin";
import { listPendingRequests } from "@/lib/claims";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { turnTimeText } from "@/lib/ui/format";

export const instant = false;

/**
 * The requests waiting for a decision. A code entered by an account is a request,
 * and nothing changes hands until one of these is approved.
 */
export default async function AdminClaimsPage() {
  const { locale } = await getStrings();
  const adminStrings = adminStringsFor(locale);
  await requireAdmin();
  const requests = await listPendingRequests();

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{adminStrings.claims}</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/devices" className="hover:underline">
            {adminStrings.devices}
          </Link>
          <Link href="/admin/users" className="hover:underline">
            {adminStrings.users}
          </Link>
        </nav>
      </div>

      {requests.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">{adminStrings.claimsEmpty}</p>
      ) : (
        <>
        <ul className="mt-4 space-y-3 md:hidden">
          {requests.map((request) => (
            <li key={request.claimId} className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <p className="font-mono text-xs break-all">{request.deviceId}</p>
              <p className="mt-2">{request.requesterEmail}</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {turnTimeText(request.requestedAt, locale)}
              </p>
              <div className="mt-2">
                <ClaimDecision claimId={request.claimId} locale={locale} />
              </div>
            </li>
          ))}
        </ul>

        <table className="mt-4 hidden w-full border-collapse text-sm md:table">
          <thead>
            <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
              <th className="py-2 pr-4 font-medium">{adminStrings.claimDevice}</th>
              <th className="py-2 pr-4 font-medium">{adminStrings.claimRequester}</th>
              <th className="py-2 pr-4 font-medium">{adminStrings.claimRequested}</th>
              <th className="py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <tr key={request.claimId} className="border-b border-zinc-100 dark:border-zinc-900">
                <td className="py-2 pr-4 font-mono text-xs">{request.deviceId}</td>
                <td className="py-2 pr-4">{request.requesterEmail}</td>
                <td className="py-2 pr-4 text-zinc-600 dark:text-zinc-400">
                  {turnTimeText(request.requestedAt, locale)}
                </td>
                <td className="py-2 text-right">
                  <ClaimDecision claimId={request.claimId} locale={locale} />
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
