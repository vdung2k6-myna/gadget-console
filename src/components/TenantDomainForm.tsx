"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { TenantSettingsStrings } from "@/lib/i18n/admin-strings";

/** The platform registering one tenant host. DNS and the certificate follow. */
export function TenantDomainForm({
  tenantId,
  labels,
}: {
  tenantId: string;
  labels: TenantSettingsStrings;
}) {
  const router = useRouter();
  const [domain, setDomain] = useState("");
  const [kind, setKind] = useState<"console" | "gateway">("console");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");

    const response = await fetch(`/api/admin/tenants/${tenantId}/domains`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domain: domain.trim(), kind }),
    });
    setPending(false);

    if (response.status === 409) {
      setError(labels.domainTaken);
      return;
    }
    if (!response.ok) {
      setError(labels.domainFailed);
      return;
    }

    setDomain("");
    router.refresh();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-3 flex flex-wrap items-end gap-2">
      <label className="text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">{labels.domain}</span>
        <input
          value={domain}
          onChange={(event) => setDomain(event.target.value)}
          required
          placeholder="console.example.com"
          className="mt-1 w-64 rounded border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-800"
        />
      </label>
      <label className="text-sm">
        <span className="text-zinc-600 dark:text-zinc-400">{labels.gatewayHost}</span>
        <select
          value={kind}
          onChange={(event) => setKind(event.target.value === "gateway" ? "gateway" : "console")}
          className="mt-1 rounded border border-zinc-200 bg-transparent px-2 py-1 dark:border-zinc-800"
        >
          <option value="console">{labels.consoleHost}</option>
          <option value="gateway">{labels.gatewayHost}</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded border border-zinc-200 px-2 py-1 text-sm disabled:opacity-50 dark:border-zinc-800"
      >
        {labels.addDomain}
      </button>
      {error !== "" && (
        <span role="alert" className="text-sm text-red-700 dark:text-red-300">
          {error}
        </span>
      )}
    </form>
  );
}
