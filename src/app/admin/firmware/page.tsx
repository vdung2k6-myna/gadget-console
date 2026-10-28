import Link from "next/link";
import { FirmwareActions } from "@/components/FirmwareActions";
import { FirmwareUpload } from "@/components/FirmwareUpload";
import { requireAdmin } from "@/lib/auth/admin";
import { loadConfig } from "@/lib/config";
import { sizeText } from "@/lib/device-board";
import { firmwareDirectory, listFirmware } from "@/lib/firmware";
import { adminStringsFor } from "@/lib/i18n/admin-strings";
import { getStrings } from "@/lib/i18n/locale";
import { turnTimeText } from "@/lib/ui/format";

export const instant = false;

/**
 * The firmware releases, and which one each board type should run.
 *
 * Uploading needs a directory to write into; delivering needs an address a gadget
 * can reach. Each missing setting is said plainly, because both failures would
 * otherwise look like a release that silently does nothing.
 */
export default async function AdminFirmwarePage() {
  const { locale } = await getStrings();
  const adminStrings = adminStringsFor(locale);
  const admin = await requireAdmin();
  const config = loadConfig();
  const storage = firmwareDirectory();
  const releases = await listFirmware();
  const disabledReason =
    "problem" in storage
      ? storage.problem === "unset"
        ? adminStrings.storageUnconfigured
        : adminStrings.storageInsidePublic
      : null;

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{adminStrings.firmware}</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/firmware/inspect" className="hover:underline">
            {adminStrings.inspect}
          </Link>
          <Link href="/admin/devices" className="hover:underline">
            {adminStrings.devices}
          </Link>
          <Link href="/admin/users" className="hover:underline">
            {adminStrings.users}
          </Link>
          <Link href="/admin/claims" className="hover:underline">
            {adminStrings.claims}
          </Link>
        </nav>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        {adminStrings.heading}: {admin.email}
      </p>

      {config.consolePublicUrl === null && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
          {adminStrings.publicUrlUnconfigured}
        </p>
      )}

      <FirmwareUpload locale={locale} disabledReason={disabledReason} />

      {releases.length === 0 ? (
        <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">{adminStrings.firmwareEmpty}</p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-left dark:border-zinc-800">
                <th className="py-2 pr-4 font-medium">{adminStrings.boardType}</th>
                <th className="py-2 pr-4 font-medium">{adminStrings.version}</th>
                <th className="py-2 pr-4 font-medium">{adminStrings.size}</th>
                <th className="py-2 pr-4 font-medium">{adminStrings.hash}</th>
                <th className="py-2 pr-4 font-medium">{adminStrings.uploader}</th>
                <th className="py-2 pr-4 font-medium">{adminStrings.uploadedAt}</th>
                <th className="py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {releases.map((release) => (
                <tr key={release.id} className="border-b border-zinc-100 align-top dark:border-zinc-900">
                  <td className="py-2 pr-4 font-mono text-xs break-all">{release.boardType}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{release.version}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{sizeText(release.sizeBytes)}</td>
                  <td className="py-2 pr-4 font-mono text-xs" title={release.sha256}>
                    {release.sha256.slice(0, 16)}…
                  </td>
                  <td className="py-2 pr-4 break-words">{release.uploaderEmail || "—"}</td>
                  <td className="py-2 pr-4 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                    {turnTimeText(release.uploadedAt, locale)}
                  </td>
                  <td className="py-2">
                    <span className="flex flex-col gap-1">
                      {release.targeted && (
                        <span className="w-fit rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-900 dark:bg-emerald-900 dark:text-emerald-100">
                          {adminStrings.targetBadge}
                          {release.forced ? ` · ${adminStrings.forced}` : ""}
                        </span>
                      )}
                      <FirmwareActions
                        id={release.id}
                        targeted={release.targeted}
                        forced={release.forced}
                        locale={locale}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
