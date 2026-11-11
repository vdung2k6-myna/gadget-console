"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PlatformStrings } from "@/lib/i18n/admin-strings";

/**
 * Suspending or resuming a tenant. The route keeps the row and all its data;
 * only the serving decision changes.
 */
export function TenantStatusControl({
  tenantId,
  name,
  status,
  labels,
}: {
  tenantId: string;
  name: string;
  status: "active" | "suspended";
  labels: PlatformStrings;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const next = status === "active" ? "suspended" : "active";

  async function change(): Promise<void> {
    const question =
      next === "suspended" ? labels.suspendConfirm : labels.resumeConfirm;
    if (!window.confirm(question.replace("{tenant}", name))) return;

    setPending(true);
    setError("");
    const response = await fetch(`/api/admin/tenants/${tenantId}`, {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    setPending(false);

    if (!response.ok) {
      setError(labels.statusFailed);
      return;
    }
    router.refresh();
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() => void change()}
        className="rounded border border-zinc-200 px-2 py-0.5 text-xs hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      >
        {next === "suspended" ? labels.suspend : labels.resume}
      </button>
      {error !== "" && (
        <span role="alert" className="text-xs text-red-700 dark:text-red-300">
          {error}
        </span>
      )}
    </span>
  );
}
