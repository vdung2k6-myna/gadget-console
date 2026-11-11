"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantSettingsStrings } from "@/lib/i18n/admin-strings";

/**
 * Export and delete, both platform-admin actions. The export is a download with
 * every secret removed; the delete requires typing the slug, because it removes
 * every user, device and turn the tenant owns.
 */
export function TenantLifecycleActions({
  tenantId,
  slug,
  labels,
}: {
  tenantId: string;
  slug: string;
  labels: TenantSettingsStrings;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function remove(): Promise<void> {
    const typed = window.prompt(labels.deleteHint.replace("{slug}", slug), "");
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== slug) {
      setError(labels.deleteConflict);
      return;
    }

    setPending(true);
    setError("");
    const response = await fetch(`/api/admin/tenants/${tenantId}`, {
      method: "DELETE",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: typed.trim() }),
    });
    setPending(false);

    if (!response.ok) {
      setError(labels.deleteFailed);
      return;
    }
    router.push("/admin/platform");
    router.refresh();
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
      <a
        href={`/api/admin/tenants/${tenantId}/export`}
        className="rounded border border-zinc-200 px-2 py-1 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        {labels.export}
      </a>
      <button
        type="button"
        disabled={pending}
        onClick={() => void remove()}
        className="rounded border border-red-300 px-2 py-1 text-red-800 hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:text-red-200 dark:hover:bg-red-950"
      >
        {labels.deleteTenant}
      </button>
      {error !== "" && (
        <span role="alert" className="text-red-700 dark:text-red-300">
          {error}
        </span>
      )}
    </div>
  );
}
